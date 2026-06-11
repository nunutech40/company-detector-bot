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
const mapsUrl = process.env.REVIEW_MONITOR_MAPS_URL || '';
const businessName = process.env.REVIEW_MONITOR_BUSINESS_NAME || 'Komerce';

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
  if (!mapsUrl) throw new Error('REVIEW_MONITOR_MAPS_URL is required');
  if ((process.env.REVIEW_MONITOR_CRAWLER || 'browser') === 'browser') {
    return collectWithBrowser();
  }
  return collectWithHttp();
}

async function collectWithBrowser() {
  const { chromium } = require('playwright-core');
  const storageState = process.env.REVIEW_MONITOR_STORAGE_STATE || '';
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.REVIEW_MONITOR_CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const context = await browser.newContext({
      locale: 'id-ID',
      ...(storageState && fs.existsSync(storageState) ? { storageState } : {}),
    });
    const page = await context.newPage();
    await page.goto(mapsUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(5000);
    const consent = page.getByRole('button', { name: /terima semua|accept all/i });
    if (await consent.count()) await consent.first().click();

    let reviewButton = page.locator('button[aria-label*="ulasan" i], button[aria-label*="review" i]')
      .or(page.locator('button').filter({ hasText: /ulasan|reviews/i }))
      .first();
    if (!await reviewButton.count()) {
      const firstPlace = page.locator('a[href*="/maps/place/"]').first();
      if (await firstPlace.count()) {
        await firstPlace.click();
        await page.waitForTimeout(5000);
        reviewButton = page.locator('button[aria-label*="ulasan" i], button[aria-label*="review" i]')
          .or(page.locator('button').filter({ hasText: /ulasan|reviews/i }))
          .first();
      }
    }
    if (await reviewButton.count()) {
      await reviewButton.click();
      await page.waitForTimeout(4000);
    }
    const limitedView = /tampilan terbatas|limited view/i.test(await page.locator('body').innerText());
    if (limitedView) {
      writeCollectStatus(false, 'google_maps_limited_view_requires_authenticated_session');
      throw new Error('Google Maps limited view: authenticated browser session is required');
    }

    const feed = page.locator('[role="feed"]').last();
    if (await feed.count()) {
      for (let index = 0; index < Number(process.env.REVIEW_MONITOR_SCROLLS || 8); index += 1) {
        await feed.evaluate((node) => { node.scrollTop = node.scrollHeight; });
        await page.waitForTimeout(1200);
      }
    }

    const reviews = await page.locator('[data-review-id]').evaluateAll((nodes) => nodes.map((node) => {
      const ratingNode = node.querySelector('[aria-label*="bintang"], [aria-label*="star"]');
      const ratingText = ratingNode?.getAttribute('aria-label') || '';
      const rating = Number((ratingText.match(/[1-5](?:[.,]0)?/) || [])[0]?.replace(',', '.'));
      const reviewer = node.querySelector('.d4r55, [class*="d4r55"]')?.textContent?.trim() || '';
      const comment = node.querySelector('.wiI7pd, [class*="wiI7pd"]')?.textContent?.trim() || '';
      return { rating, reviewer, comment };
    }));
    if (!reviews.length) {
      writeCollectStatus(false, 'google_maps_review_cards_not_observed');
      throw new Error('Google Maps review cards were not observed');
    }
    const negative = reviews
      .filter((review) => review.rating >= 1 && review.rating <= 3)
      .map((review) => makeReview({ ...review, source: mapsUrl }));
    const existing = readJson(reviewsFile, []);
    const merged = dedupe([...existing, ...negative]);
    writeJson(reviewsFile, merged);
    writeCollectStatus(true, `observed=${reviews.length} negative=${negative.length}`);
    console.log(`review_monitor: browser_collect observed=${reviews.length} negative=${negative.length} stored=${merged.length}`);
  } finally {
    await browser.close();
  }
}

async function collectWithHttp() {
  const response = await fetch(mapsUrl, {
    headers: {
      'accept-language': 'id-ID,id;q=0.9,en;q=0.7',
      'user-agent': process.env.REVIEW_MONITOR_USER_AGENT
        || 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/125 Safari/537.36',
    },
    signal: AbortSignal.timeout(Number(process.env.REVIEW_MONITOR_FETCH_TIMEOUT_MS || 45000)),
  });
  if (!response.ok) throw new Error(`Google Maps returned HTTP ${response.status}`);
  const html = await response.text();
  if (/captcha|unusual traffic/i.test(html)) throw new Error('Google Maps returned CAPTCHA');

  const reviews = parseEmbeddedReviews(html)
    .filter((review) => review.rating >= 1 && review.rating <= 3);
  if (!reviews.length) {
    writeCollectStatus(false, 'http_parser_did_not_observe_verified_reviews');
    throw new Error('HTTP parser did not observe verified reviews');
  }
  const existing = readJson(reviewsFile, []);
  const merged = dedupe([...existing, ...reviews]);
  writeJson(reviewsFile, merged);
  writeCollectStatus(true, `http_bytes=${html.length} parsed=${reviews.length}`);
  console.log(`review_monitor: collect bytes=${html.length} parsed=${reviews.length} stored=${merged.length}`);
}

function parseEmbeddedReviews(html) {
  // Google Maps' public HTML is not a stable API. Extract only conservative
  // rating/comment pairs and treat zero matches as an observable crawl result.
  const decoded = html
    .replace(/\\u003d/g, '=')
    .replace(/\\u0026/g, '&')
    .replace(/\\"/g, '"');
  const reviews = [];
  const patterns = [
    /"([^"]{8,800})",\s*\[\s*(?:null,){0,4}([1-5])(?:\.0)?\s*,/g,
    /\[\s*([1-5])(?:\.0)?\s*,\s*"([^"]{8,800})"/g,
  ];
  for (const pattern of patterns) {
    for (const match of decoded.matchAll(pattern)) {
      const rating = Number(pattern === patterns[0] ? match[2] : match[1]);
      const comment = cleanup(pattern === patterns[0] ? match[1] : match[2]);
      if (!comment || !/[A-Za-zÀ-ÿ]/.test(comment)) continue;
      reviews.push(makeReview({ rating, comment, source: mapsUrl }));
    }
  }
  return dedupe(reviews);
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
    source: mapsUrl || 'https://maps.google.com/',
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
    rating: Number(input.rating),
    reviewer: input.reviewer || '',
    comment: cleanup(input.comment || ''),
    source: input.source || '',
    collectedAt: new Date().toISOString(),
  };
  review.id = crypto.createHash('sha256')
    .update(`${review.rating}|${review.reviewer}|${review.comment}`)
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
