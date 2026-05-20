#!/usr/bin/env node
'use strict';

/**
 * webhook/worker.js — sequential worker for register_intake_jobs
 *
 * Processes one PostgreSQL-backed queue item at a time:
 *   register_intake_jobs -> company_check_go.sh --save -> db_writer.js -> investigation_jobs
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
    await runCompanyCheck(job);
    const dbWriterOutput = await runDbWriter(job);
    const investigationJobId = parseJobId(dbWriterOutput);
    if (!investigationJobId) {
      throw new Error('db_writer did not return job_id');
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

async function runCompanyCheck(job) {
  const script = path.join(WORKSPACE, 'scripts', 'company_check_go.sh');
  const commandArgs = ['--email', job.email, '--save', '--json'];
  if (job.full_name) commandArgs.push('--full-name', job.full_name);
  if (job.brand_name) commandArgs.push('--brand-name', job.brand_name);
  const phone = extractPhone(job.payload_json);
  if (phone) commandArgs.push('--no-hp', phone);
  await runCommand('bash', [script, ...commandArgs], { cwd: WORKSPACE, timeout: RUN_TIMEOUT_MS });
}

async function runDbWriter(job) {
  const script = path.join(WORKSPACE, 'scripts', 'db_writer.js');
  const commandArgs = [script, '--email', job.email, '--source', 'webhook'];
  if (job.full_name) commandArgs.push('--full-name', job.full_name);
  if (job.brand_name) commandArgs.push('--brand-name', job.brand_name);
  return runCommand('node', commandArgs, { cwd: WORKSPACE, timeout: RUN_TIMEOUT_MS });
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
