#!/usr/bin/env node
'use strict';

const { spawn } = require('child_process');

const INTERVAL_MINUTES = parseInt(process.env.FEEDBACK_META_POLL_INTERVAL_MINUTES || '15', 10);
const STARTUP_DELAY_MS = parseInt(process.env.FEEDBACK_META_STARTUP_DELAY_MS || '5000', 10);

main().catch((err) => {
  console.error(`feedback_scheduler: fatal: ${err.message}`);
  process.exit(1);
});

async function main() {
  await sleep(STARTUP_DELAY_MS);
  while (true) {
    const startedAt = Date.now();
    try {
      await runWorkerCommand(['poll-meta']);
      await runWorkerCommand(['drain']);
    } catch (err) {
      console.error(`feedback_scheduler: cycle failed: ${err.message}`);
    }

    const elapsedMs = Date.now() - startedAt;
    const waitMs = Math.max(1000, INTERVAL_MINUTES * 60 * 1000);
    console.log(`feedback_scheduler: next poll in ${Math.round(waitMs / 1000)}s elapsed_ms=${elapsedMs}`);
    await sleep(waitMs);
  }
}

function runWorkerCommand(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', ['feedback_monitor/worker.js', ...args], {
      cwd: '/app',
      env: process.env,
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) return resolve();
      reject(new Error(`worker ${args.join(' ')} exited code=${code} signal=${signal || '-'}`));
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
