#!/usr/bin/env node
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SERVICE = process.env.REGISTER_WORKER_SERVICE || 'company-register-worker.service';
const STATE_FILE = process.env.REGISTER_WORKER_HEALTH_STATE_FILE
  || path.join(process.env.HOME || '/home/nunuopc', '.openclaw', 'register-worker-health-state.json');
const TOKEN = process.env.TELEGRAM_DEFAULT_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '';
const TARGET = process.env.REGISTER_WORKER_TELEGRAM_TO
  || process.env.TELEGRAM_DELIVERY_TO
  || readTelegramTarget(path.join(process.env.HOME || '/home/nunuopc', '.openclaw', 'credentials', 'telegram-default-allowFrom.json'));

main().catch((err) => {
  console.error(`register_worker_healthcheck: ${err.message}`);
  process.exit(1);
});

async function main() {
  const active = serviceIsActive();
  const previous = readState();
  const current = { active, checked_at: new Date().toISOString() };

  if ((!previous && !active) || (previous && previous.active !== active)) {
    const text = active
      ? `RECOVERY Company Detector: ${SERVICE} kembali aktif.`
      : `ALERT Company Detector: ${SERVICE} tidak aktif. Pending jobs tetap tersimpan di PostgreSQL.`;
    await sendTelegram(text);
  }

  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(current, null, 2));
  console.log(`register_worker_healthcheck: service=${SERVICE} active=${active}`);
}

function serviceIsActive() {
  try {
    return execFileSync('systemctl', ['--user', 'is-active', SERVICE], { encoding: 'utf8' }).trim() === 'active';
  } catch (_) {
    return false;
  }
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch (_) {
    return null;
  }
}

function readTelegramTarget(filePath) {
  try {
    const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(payload.allowFrom) && payload.allowFrom[0] ? String(payload.allowFrom[0]) : '';
  } catch (_) {
    return '';
  }
}

async function sendTelegram(text) {
  if (!TOKEN || !TARGET) {
    console.error('register_worker_healthcheck: Telegram token/target missing');
    return;
  }
  const response = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TARGET, text }),
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw new Error(payload.description || `Telegram HTTP ${response.status}`);
}
