#!/usr/bin/env node
'use strict';

/**
 * webhook/worker.js — sequential worker for register_intake_jobs
 *
 * Processes one PostgreSQL-backed queue item at a time:
 *   register_intake_jobs -> OpenClaw agent -> finish_investigation.sh -> investigation_jobs
 *
 * Set REGISTER_WORKER_MODE=deterministic to use the Go baseline-only path.
 */

const { execFile } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const ENV_FILE = process.env.COMPANY_DETECTOR_ENV_FILE
  || path.join(process.env.HOME || '/home/nunuopc', '.openclaw', 'gateway.systemd.env');
loadEnv(ENV_FILE);

const repoRoot = path.resolve(__dirname, '..');
const localWorkspace = path.join(repoRoot, 'openclaw_workspace');
const WORKSPACE = process.env.OPENCLAW_WORKSPACE
  || (fs.existsSync(localWorkspace) ? localWorkspace : '/home/nunuopc/.openclaw/workspace');

const DATABASE_URL = process.env.DATABASE_URL || '';
const MAX_ATTEMPTS = parseInt(process.env.REGISTER_WORKER_MAX_ATTEMPTS || '3', 10);
const RECOVERY_REPLAY_LIMIT = parseInt(process.env.REGISTER_WORKER_RECOVERY_REPLAY_LIMIT || '5', 10);
const CIRCUIT_FAILURE_THRESHOLD = parseInt(process.env.REGISTER_WORKER_CIRCUIT_FAILURE_THRESHOLD || '2', 10);
const CIRCUIT_CANARY_INTERVAL_MS = parseInt(process.env.REGISTER_WORKER_CIRCUIT_CANARY_INTERVAL_MS || '900000', 10);
const CIRCUIT_CANARY_TIMEOUT_MS = parseInt(process.env.REGISTER_WORKER_CIRCUIT_CANARY_TIMEOUT_MS || '30000', 10);
const MAX_BACKOFF_SEC = parseInt(process.env.REGISTER_WORKER_MAX_BACKOFF_SEC || '1800', 10);
const IDLE_MS = parseInt(process.env.REGISTER_WORKER_IDLE_MS || '10000', 10);
const RUN_TIMEOUT_MS = parseInt(process.env.REGISTER_WORKER_RUN_TIMEOUT_MS || '120000', 10);
const WORKER_MODE = process.env.REGISTER_WORKER_MODE || 'agent';
const OPENCLAW_BIN = process.env.OPENCLAW_BIN || '/home/nunuopc/.npm-global/bin/openclaw';
const AGENT_TIMEOUT_SEC = parseInt(process.env.REGISTER_WORKER_AGENT_TIMEOUT_SEC || '900', 10);
const DELIVER_TELEGRAM = (process.env.REGISTER_WORKER_DELIVER_TELEGRAM || 'true') !== 'false';
const TELEGRAM_TARGET = process.env.REGISTER_WORKER_TELEGRAM_TO
  || process.env.TELEGRAM_DELIVERY_TO
  || readTelegramAllowFromTarget(path.join(process.env.HOME || '/home/nunuopc', '.openclaw', 'credentials', 'telegram-default-allowFrom.json'));
const TELEGRAM_TOKEN = process.env.TELEGRAM_DEFAULT_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '';
const ACTIVE_MODEL = readActiveModel();
const CONFIG_FINGERPRINT = fingerprint(JSON.stringify(ACTIVE_MODEL));
let lastCanaryAt = 0;

const args = process.argv.slice(2);
const command = args[0] && !args[0].startsWith('--') ? args[0] : 'worker';
const once = args.includes('--once');
const limit = readIntArg('--limit', once ? 1 : 0);

if (!DATABASE_URL) {
  console.error('register_worker: DATABASE_URL is required');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

main().catch(async (err) => {
  console.error('register_worker: fatal:', err.message);
  await pool.end();
  process.exit(1);
});

async function main() {
  if (command === 'replay-provider-failures') return closeAfter(replayProviderFailures());
  if (command === 'status') return closeAfter(printStatus());
  if (command === 'provider-canary') return closeAfter(testProviderCanary());
  await replayBlockedAfterConfigChange();

  let processed = 0;

  while (true) {
    if (!await circuitAllowsInvestigation()) {
      if (once || (limit && processed >= limit)) break;
      await sleep(IDLE_MS);
      continue;
    }
    const job = await lockNextJob();
    if (!job) {
      if (once || (limit && processed >= limit)) break;
      await sleep(IDLE_MS);
      continue;
    }

    processed += 1;
    await processJob(job);

    if (once || (limit && processed >= limit)) break;
  }

  await pool.end();
  console.log(`register_worker: stopped processed=${processed}`);
}

async function lockNextJob() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(`
      WITH next_job AS (
        SELECT id
        FROM register_intake_jobs
        WHERE (status IN ('pending', 'retry_pending') AND next_attempt_at <= NOW())
           OR (status = 'processing' AND locked_at < NOW() - INTERVAL '30 minutes')
        ORDER BY queue_priority DESC, created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE register_intake_jobs j
      SET status = 'processing',
          locked_at = NOW(),
          attempt_count = attempt_count + 1,
          updated_at = NOW(),
          last_error = NULL
      FROM next_job
      WHERE j.id = next_job.id
      RETURNING j.*
    `);
    await client.query('COMMIT');
    return result.rows[0] || null;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function processJob(job) {
  console.log(`register_worker: processing id=${job.id} email=${job.email} attempt=${job.attempt_count}`);
  try {
    const investigationJobId = WORKER_MODE === 'deterministic'
      ? await processDeterministic(job)
      : await processWithOpenClawAgent(job);

    if (!investigationJobId) {
      throw new Error('investigation did not return job_id');
    }

    await pool.query(`
      UPDATE register_intake_jobs
      SET status = 'completed',
          investigation_job_id = $2,
          processed_at = NOW(),
          locked_at = NULL,
          last_error = NULL,
          error_class = NULL,
          updated_at = NOW()
      WHERE id = $1
    `, [job.id, investigationJobId]);

    console.log(`register_worker: completed id=${job.id} investigation_job_id=${investigationJobId}`);
    await resolveProviderIncident(job);
  } catch (err) {
    await markRetry(job, err);
  }
}

async function processDeterministic(job) {
  const fallbackReport = await runCompanyCheck(job);
  const dbWriterOutput = await runDbWriter(job, fallbackReport);
  return parseJobId(dbWriterOutput);
}

async function processWithOpenClawAgent(job) {
  const agentOutput = await runOpenClawAgent(job);
  const agentResult = extractAgentResult(agentOutput);
  const reportText = agentResult.text;
  if (!reportText) {
    throw new Error('openclaw agent did not return report text');
  }

  const finishOutput = await runFinishInvestigation(job, reportText, agentResult.usage);
  return parseJobId(finishOutput);
}

async function runCompanyCheck(job) {
  const script = path.join(WORKSPACE, 'scripts', 'company_check_go.sh');
  const commandArgs = ['--email', job.email, '--save'];
  if (job.full_name) commandArgs.push('--full-name', job.full_name);
  if (job.brand_name) commandArgs.push('--brand-name', job.brand_name);
  const phone = extractPhone(job.payload_json);
  if (phone) commandArgs.push('--no-hp', phone);
  return runCommand('bash', [script, ...commandArgs], { cwd: WORKSPACE, timeout: RUN_TIMEOUT_MS });
}

async function runDbWriter(job, reportText = '') {
  const script = path.join(WORKSPACE, 'scripts', 'db_writer.js');
  const reportFile = path.join(WORKSPACE, 'reports', `deterministic-${job.id}.txt`);
  if (reportText) {
    fs.mkdirSync(path.dirname(reportFile), { recursive: true });
    fs.writeFileSync(reportFile, reportText, 'utf8');
  }

  try {
    const commandArgs = [script, '--email', job.email, '--source', 'webhook', '--report-source', 'deterministic_fallback', '--skip-llm-usage'];
    if (reportText) commandArgs.push('--ai-report', reportFile);
    if (job.full_name) commandArgs.push('--full-name', job.full_name);
    if (job.brand_name) commandArgs.push('--brand-name', job.brand_name);
    return await runCommand('node', commandArgs, { cwd: WORKSPACE, timeout: RUN_TIMEOUT_MS });
  } finally {
    if (reportText) fs.rmSync(reportFile, { force: true });
  }
}

async function runOpenClawAgent(job) {
  // A retry must not inherit tool traces/context from a failed attempt.
  const sessionId = `register-intake-${job.id}-attempt-${job.attempt_count}`;
  const prompt = buildAgentPrompt(job);
  const commandArgs = [
    'agent',
    '--session-id', sessionId,
    '--message', prompt,
    '--json',
    '--timeout', String(AGENT_TIMEOUT_SEC),
  ];
  if (DELIVER_TELEGRAM) {
    commandArgs.push('--deliver', '--reply-channel', 'telegram');
    if (TELEGRAM_TARGET) commandArgs.push('--reply-to', TELEGRAM_TARGET);
  }
  return runCommand(OPENCLAW_BIN, commandArgs, {
    cwd: WORKSPACE,
    timeout: (AGENT_TIMEOUT_SEC + 60) * 1000,
  });
}

async function runFinishInvestigation(job, reportText, usage = null) {
  const script = path.join(WORKSPACE, 'scripts', 'finish_investigation.sh');
  const reportFile = path.join(WORKSPACE, 'reports', `register-intake-${job.id}.txt`);
  const usageFile = path.join(WORKSPACE, 'reports', `register-intake-${job.id}-usage.json`);
  fs.mkdirSync(path.dirname(reportFile), { recursive: true });
  fs.writeFileSync(reportFile, reportText, 'utf8');
  if (usage) fs.writeFileSync(usageFile, JSON.stringify(usage), 'utf8');

  try {
    const commandArgs = [script, '--email', job.email, '--source', 'webhook', '--report-source', 'ai_reasoning', '--report-file', reportFile];
    if (usage) commandArgs.push('--llm-usage', usageFile);
    if (job.full_name) commandArgs.push('--full-name', job.full_name);
    if (job.brand_name) commandArgs.push('--brand-name', job.brand_name);
    const phone = extractPhone(job.payload_json);
    if (phone) commandArgs.push('--no-hp', phone);
    return await runCommand('bash', commandArgs, { cwd: WORKSPACE, timeout: RUN_TIMEOUT_MS });
  } finally {
    fs.rmSync(reportFile, { force: true });
    fs.rmSync(usageFile, { force: true });
  }
}

async function markRetry(job, err) {
  const failure = classifyFailure(err);
  const providerBlocked = ['provider_auth', 'provider_credit', 'provider_model'].includes(failure.errorClass);
  const providerFailure = failure.errorClass.startsWith('provider_');
  const exhausted = job.attempt_count >= MAX_ATTEMPTS;
  // A provider failure may already have consumed a full investigation worth of
  // tokens. Park it for recovery replay instead of immediately running it again.
  const nextStatus = providerBlocked
    ? 'blocked_provider'
    : (providerFailure || exhausted ? 'failed' : 'retry_pending');
  const backoff = backoffSeconds(job.attempt_count);
  await pool.query(`
    UPDATE register_intake_jobs
    SET status = $2,
        locked_at = NULL,
        next_attempt_at = NOW() + ($3::TEXT || ' seconds')::INTERVAL,
        last_error = $4,
        error_class = $5,
        last_provider = $6,
        last_model = $7,
        config_fingerprint = $8,
        updated_at = NOW()
    WHERE id = $1
  `, [job.id, nextStatus, backoff, String(err.message || err).slice(0, 2000), failure.errorClass, ACTIVE_MODEL.provider, ACTIVE_MODEL.model, CONFIG_FINGERPRINT]);
  console.error(`register_worker: ${nextStatus} id=${job.id} error_class=${failure.errorClass}: ${err.message}`);
  if (providerFailure) await openProviderIncident(job, failure, err, nextStatus);
}

async function replayBlockedAfterConfigChange() {
  const result = await pool.query(`
    UPDATE register_intake_jobs
    SET status = 'retry_pending', attempt_count = 0, locked_at = NULL,
        next_attempt_at = NOW(), updated_at = NOW(), config_fingerprint = $1
    WHERE status = 'blocked_provider'
      AND config_fingerprint IS DISTINCT FROM $1
    RETURNING id
  `, [CONFIG_FINGERPRINT]);
  if (result.rowCount) console.log(`register_worker: config_changed requeued=${result.rowCount}`);
}

async function replayProviderFailures() {
  const sinceHours = readIntArg('--since-hours', 72);
  const replayLimit = Math.max(1, readIntArg('--limit', 25));
  const includeAll = args.includes('--all');
  const result = await pool.query(`
    WITH candidates AS (
      SELECT id
      FROM register_intake_jobs
      WHERE ($2::BOOLEAN OR created_at >= NOW() - ($3::TEXT || ' hours')::INTERVAL)
        AND (
          status = 'blocked_provider'
          OR (status = 'failed' AND (
            error_class LIKE 'provider_%'
            OR last_error ~* '(HTTP 40[1234]|HTTP 429|HTTP 5[0-9]{2}|522|credit|quota|key is blocked|temporarily unavailable|timeout|socket|ECONN)'
          ))
        )
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT $4
    )
    UPDATE register_intake_jobs j
    SET status = 'retry_pending', attempt_count = 0, locked_at = NULL,
        next_attempt_at = NOW(), updated_at = NOW(), config_fingerprint = $1,
        queue_priority = 10
    FROM candidates
    WHERE j.id = candidates.id
    RETURNING j.id
  `, [CONFIG_FINGERPRINT, includeAll, sinceHours, replayLimit]);
  console.log(`register_worker: replay_provider_failures all=${includeAll} since_hours=${sinceHours} limit=${replayLimit} requeued=${result.rowCount}`);
}

async function printStatus() {
  const rows = await pool.query(`
    SELECT status, count(*)::int
    FROM register_intake_jobs
    GROUP BY status
    ORDER BY status
  `);
  console.table(rows.rows);
}

async function openProviderIncident(job, failure, err, queueStatus) {
  const result = await pool.query(`
    INSERT INTO register_worker_incidents (
      incident_type, status, error_class, provider, model, message, occurrence_count, opened_at, last_seen_at
    ) VALUES ('ai_provider', 'open', $1, $2, $3, $4, 1, NOW(), NOW())
    ON CONFLICT (incident_type) WHERE status = 'open'
    DO UPDATE SET error_class = EXCLUDED.error_class, provider = EXCLUDED.provider,
      model = EXCLUDED.model, message = EXCLUDED.message,
      occurrence_count = register_worker_incidents.occurrence_count + 1,
      last_seen_at = NOW(), updated_at = NOW()
    RETURNING id, occurrence_count, alert_sent_at
  `, [failure.errorClass, ACTIVE_MODEL.provider, ACTIVE_MODEL.model, String(err.message || err).slice(0, 1000)]);
  const incident = result.rows[0];
  if (!incident || incident.alert_sent_at || incident.occurrence_count < CIRCUIT_FAILURE_THRESHOLD) return;
  const counts = await queueCounts();
  const text = [
    'ALERT Company Detector: AI investigation error',
    `Provider/model: ${ACTIVE_MODEL.provider}/${ACTIVE_MODEL.model}`,
    `Error: ${failure.errorClass}`,
    `Job: ${job.email} (${queueStatus})`,
    `Queue: ${counts}`,
    `Job tidak dibuang; provider failure diparkir sampai recovery terkonfirmasi.`,
  ].join('\n');
  if (await sendTelegramAlert(text)) {
    await pool.query('UPDATE register_worker_incidents SET alert_sent_at = NOW(), updated_at = NOW() WHERE id = $1', [incident.id]);
  }
}

async function circuitAllowsInvestigation() {
  const incident = await pool.query(`
    SELECT id, occurrence_count, last_seen_at
    FROM register_worker_incidents
    WHERE incident_type = 'ai_provider' AND status = 'open'
    LIMIT 1
  `);
  const open = incident.rows[0];
  if (!open || open.occurrence_count < CIRCUIT_FAILURE_THRESHOLD) return true;

  const now = Date.now();
  if (now - lastCanaryAt < CIRCUIT_CANARY_INTERVAL_MS) return false;
  lastCanaryAt = now;
  const healthy = await runProviderCanary();
  if (!healthy) {
    console.error(`register_worker: circuit_open provider=${ACTIVE_MODEL.provider}/${ACTIVE_MODEL.model} canary=failed`);
    return false;
  }
  console.log(`register_worker: circuit_half_open provider=${ACTIVE_MODEL.provider}/${ACTIVE_MODEL.model} canary=passed; allowing one real job`);
  return true;
}

async function runProviderCanary() {
  const runtime = readProviderRuntimeConfig();
  if (!runtime.baseUrl || !runtime.apiKey || !runtime.model) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CIRCUIT_CANARY_TIMEOUT_MS);
  try {
    const response = await fetch(`${runtime.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${runtime.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: runtime.model,
        messages: [{ role: 'user', content: 'Reply only: OK' }],
        max_tokens: 2,
        temperature: 0,
        stream: false,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500).replace(/\s+/g, ' ');
      console.error(`register_worker: provider_canary http=${response.status} detail=${detail}`);
      return false;
    }
    const body = await response.json();
    if (!Array.isArray(body?.choices) || !body.choices.length) {
      console.error('register_worker: provider_canary invalid_response=no_choices');
      return false;
    }
    return true;
  } catch (err) {
    console.error(`register_worker: provider_canary error=${String(err?.message || err).slice(0, 300)}`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function testProviderCanary() {
  const healthy = await runProviderCanary();
  console.log(`register_worker: provider_canary provider=${ACTIVE_MODEL.provider}/${ACTIVE_MODEL.model} healthy=${healthy}`);
  if (!healthy) throw new Error('provider canary failed');
}

async function resolveProviderIncident(job) {
  const result = await pool.query(`
    UPDATE register_worker_incidents
    SET status = 'resolved', resolved_at = NOW(), updated_at = NOW()
    WHERE incident_type = 'ai_provider' AND status = 'open'
    RETURNING id, opened_at, occurrence_count
  `);
  if (!result.rowCount) return;
  const replayed = await replayFailedProviderBatch(RECOVERY_REPLAY_LIMIT);
  const text = [
    'RECOVERY Company Detector: AI investigation normal kembali',
    `Provider/model: ${ACTIVE_MODEL.provider}/${ACTIVE_MODEL.model}`,
    `Validasi: job ${job.email} berhasil diproses`,
    `Gangguan tercatat: ${result.rows[0].occurrence_count} error`,
    `Replay recovery: ${replayed} job lama dimasukkan kembali ke antrean`,
    `Queue: ${await queueCounts()}`,
  ].join('\n');
  if (await sendTelegramAlert(text)) {
    await pool.query('UPDATE register_worker_incidents SET recovery_alert_sent_at = NOW(), updated_at = NOW() WHERE id = $1', [result.rows[0].id]);
  }
}

async function replayFailedProviderBatch(replayLimit) {
  const limit = Math.max(0, Number(replayLimit) || 0);
  if (!limit) return 0;
  const result = await pool.query(`
    WITH candidates AS (
      SELECT id
      FROM register_intake_jobs
      WHERE status = 'failed'
        AND error_class LIKE 'provider_%'
      ORDER BY updated_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT $1
    )
    UPDATE register_intake_jobs j
    SET status = 'retry_pending',
        attempt_count = 0,
        locked_at = NULL,
        next_attempt_at = NOW(),
        queue_priority = 10,
        updated_at = NOW()
    FROM candidates
    WHERE j.id = candidates.id
    RETURNING j.id
  `, [limit]);
  return result.rowCount;
}

async function queueCounts() {
  const result = await pool.query(`
    SELECT status, count(*)::int FROM register_intake_jobs
    WHERE status <> 'completed' GROUP BY status ORDER BY status
  `);
  return result.rows.map((row) => `${row.status}=${row.count}`).join(', ') || 'empty';
}

async function sendTelegramAlert(text) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_TARGET) {
    console.error('register_worker: alert skipped; Telegram token/target missing');
    return false;
  }
  try {
    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_TARGET, text }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.description || `HTTP ${response.status}`);
    return true;
  } catch (err) {
    console.error(`register_worker: Telegram alert failed: ${err.message}`);
    return false;
  }
}

function runCommand(cmd, commandArgs, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, commandArgs, {
      cwd: opts.cwd || WORKSPACE,
      timeout: opts.timeout || RUN_TIMEOUT_MS,
      maxBuffer: 5 * 1024 * 1024,
      env: process.env,
    }, (err, stdout, stderr) => {
      if (err) {
        return reject(new Error((stderr || stdout || err.message).trim()));
      }
      resolve(String(stdout || '').trim());
    });
  });
}

function parseJobId(output) {
  const match = String(output || '').match(/job_id=([0-9a-f-]{36})/i);
  return match ? match[1] : null;
}

function buildAgentPrompt(job) {
  const phone = extractPhone(job.payload_json);
  const lines = [
    'Investigasi satu data register untuk Company Detector.',
    '',
    'Pakai aturan di AGENTS.md dan STANDING_ORDERS.md sebagai panduan investigasi, tapi untuk job queue ini JANGAN menjalankan finish_investigation.sh sendiri. Worker akan menyimpan final report setelah jawabanmu selesai.',
    '',
    'Input:',
    `- email: ${job.email}`,
    `- full_name: ${job.full_name || '-'}`,
    `- brand_name: ${job.brand_name || '-'}`,
    `- no_hp: ${phone || '-'}`,
    `- source: ${job.source || 'platform_register'}`,
    '',
    'Cara kerja wajib:',
    '1. Jalankan baseline check dengan scripts/company_check_go.sh --save.',
    '2. Kalau baseline belum cukup dan ada sinyal brand/nama/domain, cari lewat bash scripts/web_search_go.sh --query "..." --limit 5. Gunakan web_fetch hanya untuk URL hasil yang relevan.',
    '3. Jangan panggil built-in web_search, browser, atau dir_list node sandbox; ketiganya tidak tersedia/stabil di runtime VPS.',
    '4. Stop kalau confidence cukup, evidence tidak bertambah, atau budget tool habis.',
    '5. Jangan kirim ke Slack. Jangan expose logic internal sales di output.',
    '',
    'Balas dengan final report lengkap saja, format Company Detection Report, berisi classification, confidence, evidence ringkas, source URL kalau ada, stop reason, dan rekomendasi. Jangan bungkus dalam markdown fence.',
  ];
  return lines.join('\n');
}

function extractAgentResult(output) {
  const raw = String(output || '').trim();
  if (!raw) return { text: '', usage: null };

  try {
    const parsed = JSON.parse(raw);
    const found = findText(parsed);
    return { text: found.trim(), usage: findAgentUsage(parsed) };
  } catch (_) {
    // Plain-text fallback.
  }

  return { text: raw, usage: null };
}

function findAgentUsage(parsed) {
  const meta = parsed?.result?.meta?.agentMeta || parsed?.meta?.agentMeta || {};
  const usage = meta.usage || meta.lastCallUsage || {};
  if (!meta.provider && !meta.model && !usage.input && !usage.output && !usage.total) return null;
  const promptTokens = Number(usage.input ?? meta.promptTokens ?? 0);
  const completionTokens = Number(usage.output ?? 0);
  const totalTokens = promptTokens + completionTokens;
  return {
    model_provider: meta.provider || 'unknown',
    model_name: meta.model || 'unknown',
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
  };
}

function findText(value) {
  if (!value) return '';
  if (typeof value === 'string') return looksLikeReport(value) ? value : '';
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findText(item);
      if (found) return found;
    }
    return '';
  }
  if (typeof value !== 'object') return '';

  for (const key of ['reply', 'text', 'message', 'content', 'output', 'result', 'response']) {
    const found = findText(value[key]);
    if (found) return found;
  }
  for (const item of Object.values(value)) {
    const found = findText(item);
    if (found) return found;
  }
  return '';
}

function looksLikeReport(text) {
  const normalized = String(text || '').toLowerCase();
  return normalized.includes('company detection report')
    || (normalized.includes('classification') && normalized.includes('confidence'))
    || normalized.length > 400;
}

function extractPhone(payload) {
  const data = payload && typeof payload === 'object' ? payload : {};
  const raw = data.no_hp || data.noHp || data.phone || data.hp || '';
  return String(raw || '').replace(/[^0-9+]/g, '').slice(0, 24);
}

function readIntArg(flag, fallback) {
  const idx = args.indexOf(flag);
  if (idx === -1) return fallback;
  const parsed = parseInt(args[idx + 1], 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
}

function readTelegramAllowFromTarget(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const first = Array.isArray(parsed.allowFrom) ? parsed.allowFrom[0] : '';
    return first ? String(first) : '';
  } catch (_) {
    return '';
  }
}

function classifyFailure(err) {
  const message = String(err?.message || err || '');
  const normalized = message.toLowerCase();
  if (/http 40[13]/i.test(message) || normalized.includes('authentication') || normalized.includes('key is blocked') || normalized.includes('invalid api key')) {
    return { errorClass: 'provider_auth' };
  }
  if (/http 402/i.test(message) || normalized.includes('credit') || normalized.includes('quota') || normalized.includes('membership')) {
    return { errorClass: 'provider_credit' };
  }
  if (/http 404/i.test(message) || normalized.includes('model not found') || normalized.includes('unknown model')) {
    return { errorClass: 'provider_model' };
  }
  if (/http (408|429|5[0-9]{2})/i.test(message)
    || normalized.includes('temporarily unavailable')
    || normalized.includes('timeout')
    || normalized.includes('timed out')
    || normalized.includes('socket')
    || normalized.includes('econn')
    || normalized.includes('fetch failed')
    || normalized.includes('failovererror')
    || normalized.includes('ai service')) {
    return { errorClass: 'provider_transient' };
  }
  return { errorClass: 'worker_error' };
}

function backoffSeconds(attempt) {
  return Math.min(MAX_BACKOFF_SEC, Math.max(10, 10 * Math.pow(2, Math.max(0, attempt - 1))));
}

function readActiveModel() {
  const configPath = process.env.OPENCLAW_CONFIG_PATH
    || path.join(process.env.HOME || '/home/nunuopc', '.openclaw', 'openclaw.json');
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const primary = String(config?.agents?.defaults?.model?.primary || 'unknown/unknown');
    const [provider, ...modelParts] = primary.split('/');
    const model = modelParts.join('/') || 'unknown';
    const providerConfig = config?.models?.providers?.[provider] || {};
    return {
      provider,
      model,
      baseUrl: providerConfig.baseUrl || '',
      apiKeyMarker: providerConfig.apiKey ? fingerprint(String(providerConfig.apiKey)).slice(0, 12) : '',
    };
  } catch (_) {
    return { provider: 'unknown', model: 'unknown', baseUrl: '', apiKeyMarker: '' };
  }
}

function readProviderRuntimeConfig() {
  const configPath = process.env.OPENCLAW_CONFIG_PATH
    || path.join(process.env.HOME || '/home/nunuopc', '.openclaw', 'openclaw.json');
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const primary = String(config?.agents?.defaults?.model?.primary || '');
    const [provider, ...modelParts] = primary.split('/');
    const providerConfig = config?.models?.providers?.[provider] || {};
    return {
      model: modelParts.join('/'),
      baseUrl: String(providerConfig.baseUrl || ''),
      apiKey: String(providerConfig.apiKey || ''),
    };
  } catch (_) {
    return { model: '', baseUrl: '', apiKey: '' };
  }
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

async function closeAfter(promise) {
  await promise;
  await pool.end();
}
