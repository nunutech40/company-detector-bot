#!/usr/bin/env node
'use strict';

const { spawn } = require('child_process');

const collectHour = Number(process.env.REVIEW_MONITOR_COLLECT_HOUR_WIB || 21);
const sendHour = Number(process.env.REVIEW_MONITOR_SEND_HOUR_WIB || 9);
const minute = Number(process.env.REVIEW_MONITOR_MINUTE_WIB || 0);
const script = '/app/review_monitor/monitor.js';

schedule('collect', collectHour);
schedule('send', sendHour);

function schedule(command, hour) {
  const delay = nextRunDelay(hour);
  console.log(`review_monitor_scheduler: ${command} next run in ${Math.round(delay / 1000)}s`);
  setTimeout(() => run(command, hour), delay);
}

function run(command, hour) {
  const child = spawn('node', [script, command], { stdio: 'inherit', env: process.env });
  child.on('exit', (code) => {
    console.log(`review_monitor_scheduler: ${command} exited code=${code}`);
    schedule(command, hour);
  });
}

function nextRunDelay(hour) {
  const now = new Date();
  const wibNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const target = new Date(wibNow);
  target.setUTCHours(hour, minute, 0, 0);
  if (target <= wibNow) target.setUTCDate(target.getUTCDate() + 1);
  return target.getTime() - wibNow.getTime();
}
