#!/usr/bin/env node
'use strict';

/**
 * slack_daily_digest.js — daily sales-ready prospect digest.
 *
 * Reads finalized investigation rows from PostgreSQL and posts one Slack
 * message. It never includes raw evidence, AI reasoning, tool traces, or
 * internal scoring details.
 */

const fs = require('fs');
const { Client } = require('pg');

const ENV_FILE = '/home/nunuopc/.openclaw/gateway.systemd.env';
loadEnv(ENV_FILE);

const { sendToSlack } = require('./slack_reporter');

const DATABASE_URL = process.env.DATABASE_URL || '';
const DASHBOARD_BASE_URL = (process.env.DASHBOARD_BASE_URL || 'http://103.226.139.107:3001').replace(/\/+$/, '');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const windowHours = readIntArg('--window-hours', 24);

if (!DATABASE_URL) {
  console.error('slack_daily_digest: DATABASE_URL is required');
  process.exit(1);
}

main().catch((err) => {
  console.error('slack_daily_digest: fatal:', err.message);
  process.exit(1);
});

async function main() {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  try {
    const window = await getDigestWindow(client);
    const prospects = await getProspects(client, window);
    const message = buildMessage(prospects, window);

    if (dryRun) {
      console.log(message);
      console.log(`\nslack_daily_digest: dry_run prospect_count=${prospects.length}`);
      return;
    }

    const digestRun = await createDigestRun(client, window, prospects.length, 'pending');
    const sent = await sendToSlack(message);

    if (!sent) {
      await updateDigestRun(client, digestRun.id, 'failed', null, 'slack_send_failed');
      console.error('slack_daily_digest: failed to send Slack message');
      process.exitCode = 1;
      return;
    }

    await markDigestItems(client, digestRun.id, prospects);
    await updateDigestRun(client, digestRun.id, 'sent', null, null);
    console.log(`slack_daily_digest: sent prospect_count=${prospects.length}`);
  } finally {
    await client.end();
  }
}

async function getDigestWindow(client) {
  const last = await client.query(`
    SELECT window_end
    FROM slack_digest_runs
    WHERE status = 'sent'
    ORDER BY created_at DESC
    LIMIT 1
  `);
  const end = new Date();
  const start = last.rows[0]?.window_end
    ? new Date(last.rows[0].window_end)
    : new Date(end.getTime() - windowHours * 60 * 60 * 1000);
  return { start, end };
}

async function getProspects(client, window) {
  const result = await client.query(`
    SELECT
      j.id,
      j.email,
      j.full_name,
      j.brand_name,
      j.business_name,
      j.business_website,
      j.confidence_score,
      j.finished_at,
      j.created_at
    FROM investigation_jobs j
    WHERE j.classification = 'possible_company_affiliated'
      AND COALESCE(j.confidence_score, 0) >= 75
      AND COALESCE(j.finished_at, j.created_at) >= $1
      AND COALESCE(j.finished_at, j.created_at) < $2
      AND NOT EXISTS (
        SELECT 1
        FROM slack_digest_items i
        WHERE i.investigation_job_id = j.id
      )
    ORDER BY COALESCE(j.confidence_score, 0) DESC, COALESCE(j.finished_at, j.created_at) DESC
    LIMIT 50
  `, [window.start, window.end]);
  return result.rows;
}

function buildMessage(prospects, window) {
  const titleDate = formatJakarta(new Date());
  const windowText = `${formatJakarta(window.start)} - ${formatJakarta(window.end)}`;
  const lines = [
    `Prospect Digest - ${titleDate}`,
    `Dashboard: ${DASHBOARD_BASE_URL}`,
    `Window: ${windowText}`,
    '',
  ];

  if (!prospects.length) {
    lines.push('Tidak ada prospect baru dalam window terakhir.');
    lines.push('Pipeline tetap berjalan.');
    return lines.join('\n');
  }

  lines.push(`Ada ${prospects.length} prospect baru siap follow up.`);
  lines.push('');

  prospects.forEach((job, index) => {
    const name = job.business_name || job.brand_name || job.full_name || job.email;
    const contact = job.email;
    const detailUrl = `${DASHBOARD_BASE_URL}/jobs/${job.id}`;
    lines.push(`${index + 1}. ${name}`);
    lines.push(`   Kontak: ${contact}`);
    lines.push(`   Sinyal: Terindikasi akun bisnis`);
    lines.push(`   Detail: ${detailUrl}`);
    if (index !== prospects.length - 1) lines.push('');
  });

  return lines.join('\n');
}

async function createDigestRun(client, window, prospectCount, status) {
  const result = await client.query(`
    INSERT INTO slack_digest_runs (
      window_start, window_end, prospect_count, status, dashboard_url
    ) VALUES ($1, $2, $3, $4, $5)
    RETURNING id
  `, [window.start, window.end, prospectCount, status, DASHBOARD_BASE_URL]);
  return result.rows[0];
}

async function updateDigestRun(client, id, status, slackMessageTs, error) {
  await client.query(`
    UPDATE slack_digest_runs
    SET status = $2,
        slack_message_ts = $3,
        error = $4
    WHERE id = $1
  `, [id, status, slackMessageTs, error]);
}

async function markDigestItems(client, digestRunId, prospects) {
  for (const job of prospects) {
    await client.query(`
      INSERT INTO slack_digest_items (digest_run_id, investigation_job_id)
      VALUES ($1, $2)
      ON CONFLICT (investigation_job_id) DO NOTHING
    `, [digestRunId, job.id]);
  }
}

function formatJakarta(value) {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value)).replace(/\./g, ':') + ' WIB';
}

function readIntArg(flag, fallback) {
  const idx = args.indexOf(flag);
  if (idx === -1) return fallback;
  const parsed = parseInt(args[idx + 1], 10);
  return Number.isFinite(parsed) ? parsed : fallback;
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
