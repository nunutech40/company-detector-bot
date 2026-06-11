#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const command = process.argv[2] || 'collect';
const stateDir = process.env.REVIEW_MONITOR_STATE_DIR || '/app/review_monitor/state';
const reviewsFile = path.join(stateDir, 'negative-reviews.json');
const sentFile = path.join(stateDir, 'sent-review-ids.json');
const statusFile = path.join(stateDir, 'last-collect-status.json');
const provider = process.env.REVIEW_MONITOR_PROVIDER || 'google-business-profile-api';
const businessName = process.env.GBP_BUSINESS_NAME || process.env.REVIEW_MONITOR_BUSINESS_NAME || 'Google Business Profile';

main().catch((error) => {
  console.error(`review_monitor: ${command} failed: ${error.message}`);
  process.exit(1);
});

async function main() {
  fs.mkdirSync(stateDir, { recursive: true });
  if (command === 'collect') return collect();
  if (command === 'send') return send(false);
  if (command === 'test-send') return send(true);
  throw new Error(`unknown command: ${command}`);
}

async function collect() {
  if (provider === 'google-business-profile-api') return collectWithBusinessProfileApi();
  throw new Error(`unsupported REVIEW_MONITOR_PROVIDER: ${provider}`);
}

async function collectWithBusinessProfileApi() {
  const accountId = requireEnv('GBP_ACCOUNT_ID');
  const locationId = requireEnv('GBP_LOCATION_ID');
  const accessToken = await getAccessToken();
  const apiBase = (process.env.GBP_API_BASE_URL || 'https://mybusiness.googleapis.com/v4').replace(/\/+$/, '');
  let pageToken = '';
  const apiReviews = [];
  do {
    const url = new URL(`${apiBase}/accounts/${encodeURIComponent(accountId)}/locations/${encodeURIComponent(locationId)}/reviews`);
    url.searchParams.set('pageSize', '50');
    url.searchParams.set('orderBy', 'updateTime desc');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const payload = await apiJson(url, accessToken);
    apiReviews.push(...(payload.reviews || []));
    pageToken = payload.nextPageToken || '';
  } while (pageToken);

  const reviews = apiReviews
    .map(mapApiReview)
    .filter((review) => review.rating >= 1 && review.rating <= 3);
  const existing = readJson(reviewsFile, []);
  const merged = dedupe([...existing, ...reviews]);
  writeJson(reviewsFile, merged);
  writeCollectStatus(true, `provider=google_business_profile_api observed=${apiReviews.length} negative=${reviews.length}`);
  console.log(`review_monitor: api_collect observed=${apiReviews.length} negative=${reviews.length} stored=${merged.length}`);
}

function mapApiReview(review) {
  const ratingMap = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
  const rating = ratingMap[review.starRating] || Number(review.starRating);
  return makeReview({
    externalId: review.reviewId || '',
    rating,
    reviewer: review.reviewer?.displayName || '',
    comment: review.comment || '(tanpa komentar)',
    source: review.name || `accounts/${process.env.GBP_ACCOUNT_ID}/locations/${process.env.GBP_LOCATION_ID}`,
    createTime: review.createTime || '',
    updateTime: review.updateTime || '',
  });
}

async function send(testMode) {
  const status = readJson(statusFile, null);
  if (!testMode && (!status?.ok || Date.now() - new Date(status.at).getTime() > 36 * 60 * 60 * 1000)) {
    await sendTelegram(buildFailureMessage(status));
    console.log('review_monitor: send crawl_status_unhealthy');
    return;
  }
  const reviews = testMode ? [makeReview({
    rating: 2,
    reviewer: 'Review Monitor Test',
    comment: 'Contoh review negatif untuk membuktikan jalur Telegram.',
    source: 'google-business-profile-api',
  })] : unsentReviews();
  const text = buildMessage(reviews, testMode);
  await sendTelegram(text);
  if (!testMode) {
    const sent = new Set(readJson(sentFile, []));
    for (const review of reviews) sent.add(review.id);
    writeJson(sentFile, [...sent]);
  }
  console.log(`review_monitor: ${testMode ? 'test_' : ''}send count=${reviews.length}`);
}

function buildFailureMessage(status) {
  return [
    `Google Business Review Monitor - ${businessName}`,
    '',
    'Monitoring review gagal atau data crawl belum valid.',
    `Status: ${status?.detail || 'belum pernah berhasil collect'}`,
    'Laporan tidak menyimpulkan bahwa review negatif kosong.',
  ].join('\n');
}

function unsentReviews() {
  const sent = new Set(readJson(sentFile, []));
  return readJson(reviewsFile, []).filter((review) => !sent.has(review.id));
}

async function sendTelegram(text) {
  const token = process.env.TELEGRAM_DEFAULT_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '';
  const target = process.env.REVIEW_MONITOR_TELEGRAM_TO
    || process.env.REGISTER_WORKER_TELEGRAM_TO
    || process.env.TELEGRAM_DELIVERY_TO
    || '';
  if (!token) throw new Error('Telegram bot token is required');
  if (!target) throw new Error('REVIEW_MONITOR_TELEGRAM_TO is required');
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: target, text, disable_web_page_preview: true }),
    signal: AbortSignal.timeout(30000),
  });
  const result = await response.json();
  if (!result.ok) throw new Error(`Telegram send failed: ${result.description || response.status}`);
}

function buildMessage(reviews, testMode) {
  const title = `${testMode ? '[TEST] ' : ''}Google Business Review Monitor - ${businessName}`;
  if (!reviews.length) return `${title}\n\nTidak ada review baru berbintang 1-3 sejak laporan sebelumnya.`;
  const lines = [title, '', `Ditemukan ${reviews.length} review baru berbintang 1-3.`];
  for (const review of reviews.slice(0, 20)) {
    lines.push('', `${'★'.repeat(review.rating)}${'☆'.repeat(5 - review.rating)} - ${review.reviewer || 'Reviewer Google'}`);
    lines.push(review.comment);
    if (review.source) lines.push(review.source);
  }
  return lines.join('\n').slice(0, 4000);
}

function makeReview(input) {
  const review = {
    externalId: input.externalId || '',
    rating: Number(input.rating),
    reviewer: input.reviewer || '',
    comment: cleanup(input.comment || ''),
    source: input.source || '',
    collectedAt: new Date().toISOString(),
    createTime: input.createTime || '',
    updateTime: input.updateTime || '',
  };
  review.id = crypto.createHash('sha256')
    .update(review.externalId || `${review.rating}|${review.reviewer}|${review.comment}`)
    .digest('hex');
  return review;
}

function cleanup(value) {
  return value.replace(/\\n/g, ' ').replace(/\\+/g, '\\').replace(/\s+/g, ' ').trim();
}

function dedupe(reviews) {
  return [...new Map(reviews.map((review) => [review.id, review])).values()];
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function writeCollectStatus(ok, detail) {
  writeJson(statusFile, { ok, detail, at: new Date().toISOString() });
}

async function getAccessToken() {
  const response = await fetch(process.env.GBP_TOKEN_URL || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: requireEnv('GBP_CLIENT_ID'),
      client_secret: requireEnv('GBP_CLIENT_SECRET'),
      refresh_token: requireEnv('GBP_REFRESH_TOKEN'),
      grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(30000),
  });
  const payload = await response.json();
  if (!response.ok || !payload.access_token) {
    writeCollectStatus(false, `oauth_refresh_failed:${payload.error || response.status}`);
    throw new Error(`OAuth refresh failed: ${payload.error_description || payload.error || response.status}`);
  }
  return payload.access_token;
}

async function apiJson(url, accessToken) {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(45000),
  });
  const payload = await response.json();
  if (!response.ok) {
    writeCollectStatus(false, `google_business_profile_api_failed:${response.status}`);
    throw new Error(`Google Business Profile API failed: ${payload.error?.message || response.status}`);
  }
  return payload;
}

function requireEnv(name) {
  const value = process.env[name] || '';
  if (!value) throw new Error(`${name} is required`);
  return value;
}
