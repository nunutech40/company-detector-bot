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
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const ENV_FILE = '/home/nunuopc/.openclaw/gateway.systemd.env';
loadEnv(ENV_FILE);

const repoRoot = path.resolve(__dirname, '..');
const localWorkspace = path.join(repoRoot, 'openclaw_workspace');
const WORKSPACE = process.env.OPENCLAW_WORKSPACE
  || (fs.existsSync(localWorkspace) ? localWorkspace : '/home/nunuopc/.openclaw/workspace');

const DATABASE_URL = process.env.DATABASE_URL || '';
const MAX_ATTEMPTS = parseInt(process.env.REGISTER_WORKER_MAX_ATTEMPTS || '3', 10);
const IDLE_MS = parseInt(process.env.REGISTER_WORKER_IDLE_MS || '10000', 10);
const RUN_TIMEOUT_MS = parseInt(process.env.REGISTER_WORKER_RUN_TIMEOUT_MS || '120000', 10);
const WORKER_MODE = process.env.REGISTER_WORKER_MODE || 'agent';
const OPENCLAW_BIN = process.env.OPENCLAW_BIN || '/home/nunuopc/.npm-global/bin/openclaw';
const AGENT_TIMEOUT_SEC = parseInt(process.env.REGISTER_WORKER_AGENT_TIMEOUT_SEC || '900', 10);

const args = process.argv.slice(2);
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
  let processed = 0;

  while (true) {
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
        WHERE status = 'pending'
           OR (status = 'processing' AND locked_at < NOW() - INTERVAL '30 minutes')
        ORDER BY created_at ASC
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
          updated_at = NOW()
      WHERE id = $1
    `, [job.id, investigationJobId]);

    console.log(`register_worker: completed id=${job.id} investigation_job_id=${investigationJobId}`);
  } catch (err) {
    await markFailedOrPending(job, err);
  }
}

async function processDeterministic(job) {
  const fallbackReport = await runCompanyCheck(job);
  const dbWriterOutput = await runDbWriter(job, fallbackReport);
  return parseJobId(dbWriterOutput);
}

async function processWithOpenClawAgent(job) {
  const agentOutput = await runOpenClawAgent(job);
  const reportText = extractAgentText(agentOutput);
  if (!reportText) {
    throw new Error('openclaw agent did not return report text');
  }

  const finishOutput = await runFinishInvestigation(job, reportText);
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
    const commandArgs = [script, '--email', job.email, '--source', 'webhook', '--report-source', 'deterministic_fallback'];
    if (reportText) commandArgs.push('--ai-report', reportFile);
    if (job.full_name) commandArgs.push('--full-name', job.full_name);
    if (job.brand_name) commandArgs.push('--brand-name', job.brand_name);
    return await runCommand('node', commandArgs, { cwd: WORKSPACE, timeout: RUN_TIMEOUT_MS });
  } finally {
    if (reportText) fs.rmSync(reportFile, { force: true });
  }
}

async function runOpenClawAgent(job) {
  const sessionId = `register-intake-${job.id}`;
  const prompt = buildAgentPrompt(job);
  return runCommand(OPENCLAW_BIN, [
    'agent',
    '--session-id', sessionId,
    '--message', prompt,
    '--json',
    '--timeout', String(AGENT_TIMEOUT_SEC),
  ], {
    cwd: WORKSPACE,
    timeout: (AGENT_TIMEOUT_SEC + 60) * 1000,
  });
}

async function runFinishInvestigation(job, reportText) {
  const script = path.join(WORKSPACE, 'scripts', 'finish_investigation.sh');
  const reportFile = path.join(WORKSPACE, 'reports', `register-intake-${job.id}.txt`);
  fs.mkdirSync(path.dirname(reportFile), { recursive: true });
  fs.writeFileSync(reportFile, reportText, 'utf8');

  try {
  const commandArgs = [script, '--email', job.email, '--source', 'webhook', '--report-source', 'ai_reasoning', '--report-file', reportFile];
    if (job.full_name) commandArgs.push('--full-name', job.full_name);
    if (job.brand_name) commandArgs.push('--brand-name', job.brand_name);
    const phone = extractPhone(job.payload_json);
    if (phone) commandArgs.push('--no-hp', phone);
    return await runCommand('bash', commandArgs, { cwd: WORKSPACE, timeout: RUN_TIMEOUT_MS });
  } finally {
    fs.rmSync(reportFile, { force: true });
  }
}

async function markFailedOrPending(job, err) {
  const nextStatus = job.attempt_count >= MAX_ATTEMPTS ? 'failed' : 'pending';
  await pool.query(`
    UPDATE register_intake_jobs
    SET status = $2,
        locked_at = NULL,
        last_error = $3,
        updated_at = NOW()
    WHERE id = $1
  `, [job.id, nextStatus, String(err.message || err).slice(0, 2000)]);
  console.error(`register_worker: ${nextStatus} id=${job.id}: ${err.message}`);
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
    '2. Kalau baseline belum cukup dan ada sinyal brand/nama/domain, lanjutkan investigasi memakai search/fetch/browser yang tersedia.',
    '3. Stop kalau confidence cukup, evidence tidak bertambah, atau budget tool habis.',
    '4. Jangan kirim ke Slack. Jangan expose logic internal sales di output.',
    '',
    'Balas dengan final report lengkap saja, format Company Detection Report, berisi classification, confidence, evidence ringkas, source URL kalau ada, stop reason, dan rekomendasi. Jangan bungkus dalam markdown fence.',
  ];
  return lines.join('\n');
}

function extractAgentText(output) {
  const raw = String(output || '').trim();
  if (!raw) return '';

  try {
    const parsed = JSON.parse(raw);
    const found = findText(parsed);
    if (found) return found.trim();
  } catch (_) {
    // Plain-text fallback.
  }

  return raw;
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
