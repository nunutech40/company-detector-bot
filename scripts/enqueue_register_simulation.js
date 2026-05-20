#!/usr/bin/env node
'use strict';

const fs = require('fs');

const filePath = process.argv[2];
const endpoint = process.env.REGISTER_SIMULATION_ENDPOINT || 'http://127.0.0.1:3002/webhook/check';
const secret = process.env.WEBHOOK_SECRET || '';

if (!filePath || !secret) {
  console.error('Usage: WEBHOOK_SECRET=... node scripts/enqueue_register_simulation.js payload.json');
  process.exit(1);
}

async function main() {
  const rows = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!Array.isArray(rows)) throw new Error('payload file must contain an array');

  for (const row of rows) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-webhook-secret': secret,
      },
      body: JSON.stringify(row),
    });
    const text = await response.text();
    console.log(`${response.status}\t${row.email}\t${text}`);
    if (!response.ok) process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
