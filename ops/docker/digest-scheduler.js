#!/usr/bin/env node
'use strict';

const { spawn } = require('child_process');

const hour = Number(process.env.SLACK_DIGEST_HOUR_WIB || 9);
const minute = Number(process.env.SLACK_DIGEST_MINUTE_WIB || 0);
const script = '/app/openclaw_workspace/scripts/slack_daily_digest.js';

schedule();

function schedule() {
  const delay = nextRunDelay();
  console.log(`digest_scheduler: next run in ${Math.round(delay / 1000)}s`);
  setTimeout(run, delay);
}

function run() {
  const child = spawn('node', [script], { stdio: 'inherit', env: process.env });
  child.on('exit', (code) => {
    console.log(`digest_scheduler: run exited code=${code}`);
    schedule();
  });
}

function nextRunDelay() {
  const now = new Date();
  const wibNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const target = new Date(wibNow);
  target.setUTCHours(hour, minute, 0, 0);
  if (target <= wibNow) target.setUTCDate(target.getUTCDate() + 1);
  return target.getTime() - wibNow.getTime();
}
