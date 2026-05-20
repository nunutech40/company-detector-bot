'use strict';

/**
 * webhook/app.js — Webhook API untuk trigger investigasi dari platform register
 *
 * Endpoint:
 *   POST /webhook/check
 *   Body: { email, full_name, no_hp, brand_name, secret }
 *
 * Yang dilakukan:
 *   1. Validasi secret key
 *   2. Jalankan finish_investigation.sh via company_check_go.sh
 *   3. Return job result
 *
 * Port: 3002
 */

const express    = require('express');
const { execFile } = require('child_process');
const fs         = require('fs');
const path       = require('path');

// ── Load env ─────────────────────────────────────────────────────────────────
const ENV_FILE = '/home/nunuopc/.openclaw/gateway.systemd.env';
if (fs.existsSync(ENV_FILE)) {
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
}

const PORT           = process.env.WEBHOOK_PORT   || 3002;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';
const WORKSPACE      = '/home/nunuopc/.openclaw/workspace';
const GO_BIN         = '/home/nunuopc/.openclaw/go-service/bin/company-check';

const app = express();
app.use(express.json());

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'company-detection-webhook', version: '1.0.0' });
});

// ── POST /webhook/check ───────────────────────────────────────────────────────
app.post('/webhook/check', async (req, res) => {
  const { email, full_name, no_hp, brand_name, secret } = req.body || {};

  // Validasi secret
  if (WEBHOOK_SECRET && secret !== WEBHOOK_SECRET) {
    return res.status(401).json({ ok: false, error: 'invalid_secret' });
  }

  // Validasi email
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ ok: false, error: 'email_required' });
  }

  // Sanitize inputs — hanya allow karakter aman
  const safeEmail     = email.trim().slice(0, 254);
  const safeFullName  = (full_name  || '').replace(/[^a-zA-Z0-9 .\-_]/g, '').slice(0, 100);
  const safeBrandName = (brand_name || '').replace(/[^a-zA-Z0-9 .\-_]/g, '').slice(0, 100);
  const safeNoHp      = (no_hp      || '').replace(/[^0-9+]/g, '').slice(0, 20);

  console.log(`[webhook] check request: ${safeEmail}`);

  // Build args untuk company-check Go binary
  const args = ['--email', safeEmail, '--json'];
  if (safeFullName)  args.push('--full-name',  safeFullName);
  if (safeBrandName) args.push('--brand-name', safeBrandName);
  if (safeNoHp)      args.push('--no-hp',      safeNoHp);
  args.push('--save');

  // Jalankan Go binary (deterministik baseline)
  let goResult = null;
  try {
    goResult = await runCommand(GO_BIN, args, { timeout: 30000 });
    goResult = JSON.parse(goResult);
  } catch (err) {
    console.error('[webhook] go binary error:', err.message);
    // Tidak fatal — lanjut dengan null
  }

  // Trigger db_writer untuk simpan ke DB
  try {
    const dbArgs = ['scripts/db_writer.js', '--email', safeEmail];
    if (safeFullName)  dbArgs.push('--full-name',  safeFullName);
    if (safeBrandName) dbArgs.push('--brand-name', safeBrandName);
    await runCommand('node', dbArgs, {
      cwd:     WORKSPACE,
      timeout: 15000,
    });
  } catch (err) {
    console.error('[webhook] db_writer error:', err.message);
    // Tidak fatal
  }

  // Response ke platform
  const response = {
    ok:               true,
    email:            safeEmail,
    classification:   goResult?.classification   || 'unknown_needs_more_evidence',
    confidence_score: goResult?.confidence_score || 0,
    confidence_label: goResult?.confidence_label || 'low',
    automation_action: goResult?.automation_action || 'store_unknown_retry_later',
    company_detected: goResult?.company_detected || false,
    summary:          goResult?.summary || 'Investigasi deterministik selesai. AI reasoning akan dilanjutkan via Telegram.',
    dashboard_url:    `http://103.226.139.107:3001`,
    note:             'Hasil ini dari deterministik pipeline (Go CLI). AI reasoning loop akan memperkaya hasil ini via Telegram/OpenClaw.',
  };

  console.log(`[webhook] done: ${safeEmail} → ${response.classification} (${response.confidence_score}/100)`);
  res.json(response);
});

// ── Helper: run command as promise ────────────────────────────────────────────
function runCommand(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, {
      timeout: opts.timeout || 30000,
      cwd:     opts.cwd || WORKSPACE,
      maxBuffer: 1024 * 1024,
    }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout.trim());
    });
  });
}

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Webhook API running at http://0.0.0.0:${PORT}`);
  console.log(`  POST /webhook/check  — trigger investigasi`);
  console.log(`  GET  /health         — health check`);
  if (!WEBHOOK_SECRET) {
    console.warn('  WARNING: WEBHOOK_SECRET not set — endpoint tidak terproteksi');
  }
});
