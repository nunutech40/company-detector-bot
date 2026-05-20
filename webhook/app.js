'use strict';

/**
 * webhook/app.js — platform register intake API
 *
 * Final behavior:
 *   1. Validate shared secret.
 *   2. Normalize register payload.
 *   3. Insert payload into PostgreSQL queue table register_intake_jobs.
 *   4. Return a fast queued response.
 *
 * Heavy investigation is handled later by the sequential worker.
 */

const express = require('express');
const fs = require('fs');
const { Pool } = require('pg');

const ENV_FILE = '/home/nunuopc/.openclaw/gateway.systemd.env';
loadEnv(ENV_FILE);

const PORT = process.env.WEBHOOK_PORT || 3002;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';
const DATABASE_URL = process.env.DATABASE_URL || '';
const DASHBOARD_BASE_URL = (process.env.DASHBOARD_BASE_URL || 'http://103.226.139.107:3001').replace(/\/+$/, '');

if (!DATABASE_URL) {
  console.warn('[webhook] DATABASE_URL not set; enqueue endpoint will return service_unavailable');
}

const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL }) : null;
const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/health', async (req, res) => {
  let db = 'not_configured';
  if (pool) {
    try {
      await pool.query('SELECT 1');
      db = 'ok';
    } catch (err) {
      db = 'error';
    }
  }
  res.json({
    ok: db !== 'error',
    service: 'company-detection-webhook',
    version: '2.0.0',
    mode: 'enqueue',
    db,
  });
});

app.post('/webhook/check', async (req, res) => {
  if (!pool) {
    return res.status(503).json({ ok: false, error: 'database_not_configured' });
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({ ok: false, error: 'invalid_secret' });
  }

  const normalized = normalizePayload(req.body || {});
  if (!normalized.email) {
    return res.status(400).json({ ok: false, error: 'email_required' });
  }

  try {
    const queued = await enqueuePayload(normalized);
    const statusCode = queued.duplicate ? 200 : 202;
    console.log(`[webhook] queued ${normalized.email} job=${queued.id} duplicate=${queued.duplicate}`);
    return res.status(statusCode).json({
      ok: true,
      queued: true,
      duplicate: queued.duplicate,
      intake_job_id: queued.id,
      status: queued.status,
      email: normalized.email,
      dashboard_url: DASHBOARD_BASE_URL,
    });
  } catch (err) {
    console.error('[webhook] enqueue failed:', err.message);
    return res.status(500).json({ ok: false, error: 'enqueue_failed' });
  }
});

async function enqueuePayload(input) {
  const result = await pool.query(`
    INSERT INTO register_intake_jobs (
      source, external_id, idempotency_key,
      email, full_name, brand_name, no_hp_masked,
      payload_json, status, updated_at
    ) VALUES (
      $1, $2, $3,
      $4, $5, $6, $7,
      $8, 'pending', NOW()
    )
    ON CONFLICT (idempotency_key)
    WHERE idempotency_key IS NOT NULL AND idempotency_key <> ''
    DO UPDATE SET updated_at = register_intake_jobs.updated_at
    RETURNING id, status, (xmax::text <> '0') AS duplicate
  `, [
    input.source,
    input.external_id,
    input.idempotency_key,
    input.email,
    input.full_name,
    input.brand_name,
    input.no_hp_masked,
    JSON.stringify(input.payload_json),
  ]);

  return result.rows[0];
}

function isAuthorized(req) {
  if (!WEBHOOK_SECRET) return true;
  const bodySecret = typeof req.body?.secret === 'string' ? req.body.secret : '';
  const auth = req.get('authorization') || '';
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  const headerSecret = req.get('x-webhook-secret') || req.get('x-openclaw-token') || '';
  return [bodySecret, bearer, headerSecret].some((candidate) => candidate === WEBHOOK_SECRET);
}

function normalizePayload(body) {
  const email = cleanEmail(firstString(body.email, body.Email, body.mail));
  const fullName = cleanText(firstString(body.full_name, body.fullName, body.name, body.nama), 120);
  const brandName = cleanText(firstString(body.brand_name, body.brandName, body.company_field, body.company, body.brand), 120);
  const noHpRaw = firstString(body.no_hp, body.noHp, body.phone, body.hp);
  const noHp = normalizePhone(noHpRaw);
  const source = cleanText(firstString(body.source), 80) || 'platform_register';
  const externalId = cleanText(firstString(body.external_id, body.externalId, body.id, body.user_id, body.userId), 120);
  const idempotencyKey = cleanText(
    firstString(body.idempotency_key, body.idempotencyKey) || buildIdempotencyKey(source, externalId, email),
    200
  );

  const payloadJson = { ...body };
  delete payloadJson.secret;

  return {
    source,
    external_id: externalId || null,
    idempotency_key: idempotencyKey || null,
    email,
    full_name: fullName || null,
    brand_name: brandName || null,
    no_hp: noHp || null,
    no_hp_masked: maskPhone(noHp),
    payload_json: payloadJson,
  };
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return '';
}

function cleanEmail(value) {
  const email = cleanText(value, 254).toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return '';
  return email;
}

function cleanText(value, maxLength) {
  if (!value) return '';
  return String(value)
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function normalizePhone(value) {
  if (!value) return '';
  return String(value).replace(/[^0-9+]/g, '').slice(0, 24);
}

function maskPhone(value) {
  if (!value) return null;
  const digits = value.replace(/\D/g, '');
  if (digits.length <= 4) return '****';
  return `${'*'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

function buildIdempotencyKey(source, externalId, email) {
  if (externalId) return `${source}:${externalId}`;
  if (!email) return '';
  const today = new Date().toISOString().slice(0, 10);
  return `${source}:${email.toLowerCase()}:${today}`;
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

process.on('SIGTERM', async () => {
  if (pool) await pool.end();
  process.exit(0);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Webhook API running at http://0.0.0.0:${PORT}`);
  console.log('  POST /webhook/check  — enqueue register payload');
  console.log('  GET  /health         — health check');
  if (!WEBHOOK_SECRET) {
    console.warn('  WARNING: WEBHOOK_SECRET not set — endpoint is not protected');
  }
});
