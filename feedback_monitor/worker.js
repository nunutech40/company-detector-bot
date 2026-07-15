#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || '';
const IDLE_MS = parseInt(process.env.FEEDBACK_WORKER_IDLE_MS || '5000', 10);
const MAX_ATTEMPTS = parseInt(process.env.FEEDBACK_WORKER_MAX_ATTEMPTS || '3', 10);
const DELIVERY_DRY_RUN = (process.env.FEEDBACK_DELIVERY_DRY_RUN || 'true') !== 'false';
const AI_PROVIDER = process.env.FEEDBACK_AI_PROVIDER || 'stub';
const AI_MODEL = process.env.FEEDBACK_AI_MODEL || 'stub-negative-comment-v1';
const AI_BASE_URL = (process.env.FEEDBACK_AI_BASE_URL || process.env.LLM_BASE_URL || '').replace(/\/+$/, '');
const AI_API_KEY = process.env.FEEDBACK_AI_API_KEY || process.env.LLM_API_KEY || '';
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN || process.env.FACEBOOK_ACCESS_TOKEN || '';
const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v20.0';
const META_GRAPH_BASE = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
const META_PAGE_IDS = (process.env.META_PAGE_IDS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const META_POST_LIMIT = parseInt(process.env.META_POST_LIMIT || '10', 10);
const META_COMMENT_LIMIT = parseInt(process.env.META_COMMENT_LIMIT || '50', 10);
const META_LOOKBACK_MINUTES = parseInt(process.env.META_LOOKBACK_MINUTES || '30', 10);
const META_PAGE_CONCURRENCY = parseInt(process.env.META_PAGE_CONCURRENCY || '2', 10);
const META_COMMENT_CONCURRENCY = parseInt(process.env.META_COMMENT_CONCURRENCY || '5', 10);
const CLASSIFIER_VERSION = process.env.FEEDBACK_CLASSIFIER_VERSION || `meta-ai:${AI_PROVIDER}:${AI_MODEL}:v1`;
const CONFIG_FINGERPRINT = process.env.FEEDBACK_AI_CONFIG_FINGERPRINT || fingerprint([
  AI_PROVIDER,
  AI_MODEL,
  AI_BASE_URL,
  AI_API_KEY ? AI_API_KEY.slice(-8) : '',
  CLASSIFIER_VERSION,
].join('|'));

if (!DATABASE_URL) {
  console.error('feedback_worker: DATABASE_URL is required');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });
const args = process.argv.slice(2);
const command = args[0] || 'worker';
const once = args.includes('--once') || command.endsWith(':once');

main().catch(async (err) => {
  console.error('feedback_worker: fatal:', err.message);
  await pool.end();
  process.exit(1);
});

async function main() {
  if (command === 'simulate-google') return closeAfter(simulateGoogle());
  if (command === 'simulate-meta') return closeAfter(simulateMeta());
  if (command === 'sync-meta-pages') return closeAfter(syncMetaPages());
  if (command === 'poll-meta') return closeAfter(pollMetaComments());
  if (command === 'replay-blocked') return closeAfter(replayBlocked());
  if (command === 'status') return closeAfter(printStatus());
  if (command === 'drain') return closeAfter(drainQueues());
  await workerLoop();
}

async function workerLoop() {
  let processed = 0;
  while (true) {
    const didWork = await processOneIngestion()
      || await processOneClassification()
      || await processOneDelivery();
    if (didWork) processed += 1;
    if (once) break;
    if (!didWork) await sleep(IDLE_MS);
  }
  await pool.end();
  console.log(`feedback_worker: stopped processed=${processed}`);
}

async function drainQueues() {
  let processed = 0;
  while (true) {
    const didWork = await processOneIngestion()
      || await processOneClassification()
      || await processOneDelivery();
    if (!didWork) break;
    processed += 1;
  }
  console.log(`feedback_worker: drained processed=${processed}`);
}

async function processOneIngestion() {
  const event = await lockNext('feedback_ingestion_events');
  if (!event) return false;
  try {
    const item = normalizeFeedback(event);
    const itemRow = await upsertFeedbackItem(item);
    await pool.query(`
      INSERT INTO feedback_classification_jobs (
        feedback_item_id, source, status, classifier_version, config_fingerprint
      )
      VALUES ($1, $2, 'pending', $3, $4)
      ON CONFLICT (feedback_item_id, classifier_version)
      DO UPDATE SET
        status = CASE
          WHEN feedback_classification_jobs.status IN ('completed', 'blocked_provider', 'dead_letter')
          THEN 'retry_pending'
          ELSE feedback_classification_jobs.status
        END,
        next_attempt_at = NOW(),
        locked_at = NULL,
        updated_at = NOW(),
        config_fingerprint = EXCLUDED.config_fingerprint
    `, [itemRow.id, item.source, classifierVersionFor(item.source), CONFIG_FINGERPRINT]);
    await pool.query(`
      UPDATE feedback_ingestion_events
      SET status = 'completed', processed_at = NOW(), locked_at = NULL, updated_at = NOW()
      WHERE id = $1
    `, [event.id]);
    console.log(`feedback_worker: ingested id=${event.id} item=${itemRow.id}`);
    return true;
  } catch (err) {
    await markRetry('feedback_ingestion_events', event, err, 'provider_transient');
    return true;
  }
}

async function processOneClassification() {
  const job = await lockNext('feedback_classification_jobs');
  if (!job) return false;
  const item = await getFeedbackItem(job.feedback_item_id);
  try {
    const result = isGoogle(item.source)
      ? classifyGoogle(item)
      : await classifyMeta(item);
    const classification = await storeClassification(item, result);
    await enqueueDeliveries(item, classification, result);
    await pool.query(`
      UPDATE feedback_classification_jobs
      SET status = 'completed',
          result_json = $2,
          processed_at = NOW(),
          locked_at = NULL,
          last_error = NULL,
          error_class = NULL,
          last_provider = $3,
          last_model = $4,
          config_fingerprint = $5,
          updated_at = NOW()
      WHERE id = $1
    `, [job.id, result, AI_PROVIDER, result.model || AI_MODEL, CONFIG_FINGERPRINT]);
    console.log(`feedback_worker: classified item=${item.id} sentiment=${result.sentiment}`);
    return true;
  } catch (err) {
    const classified = classifyFailure(err);
    await markClassificationRetry(job, err, classified);
    return true;
  }
}

async function processOneDelivery() {
  const job = await lockNext('feedback_delivery_jobs');
  if (!job) return false;
  try {
    if (DELIVERY_DRY_RUN) {
      console.log(`feedback_delivery[dry_run]: channel=${job.channel} destination=${job.destination || '-'}\n${job.payload_text}\n---`);
    } else if (job.channel === 'telegram') {
      await sendTelegram(job.payload_text, job.destination);
    } else if (job.channel === 'slack') {
      await sendSlack(job.payload_text, job.destination);
    } else {
      throw new Error(`unsupported delivery channel: ${job.channel}`);
    }
    await pool.query(`
      UPDATE feedback_delivery_jobs
      SET status = 'sent', sent_at = NOW(), locked_at = NULL, last_error = NULL, updated_at = NOW()
      WHERE id = $1
    `, [job.id]);
    await pool.query(`
      INSERT INTO feedback_deliveries (delivery_job_id, feedback_item_id, channel, destination, status)
      VALUES ($1, $2, $3, $4, 'sent')
    `, [job.id, job.feedback_item_id, job.channel, job.destination]);
    return true;
  } catch (err) {
    await markRetry('feedback_delivery_jobs', job, err, 'delivery_error');
    return true;
  }
}

async function lockNext(table) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(`
      WITH next_job AS (
        SELECT id
        FROM ${table}
        WHERE (
            status IN ('pending', 'retry_pending')
            AND next_attempt_at <= NOW()
          )
           OR (
            status = 'processing'
            AND locked_at < NOW() - INTERVAL '15 minutes'
          )
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE ${table} j
      SET status = 'processing',
          locked_at = NOW(),
          attempt_count = attempt_count + 1,
          updated_at = NOW()
      FROM next_job
      WHERE j.id = next_job.id
      RETURNING j.*
    `);
    await client.query('COMMIT');
    return result.rows[0] || null;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

function normalizeFeedback(event) {
  const raw = event.raw_payload || {};
  const feedback = raw.feedback || raw.review || raw.comment || raw;
  const source = event.source;
  const accountId = String(feedback.external_account_id || event.external_account_id || 'unknown');
  const feedbackId = String(feedback.external_feedback_id || event.external_feedback_id || feedback.id || event.id);
  return {
    source,
    external_account_id: accountId,
    external_content_id: feedback.external_content_id || feedback.post_id || feedback.media_id || feedback.ad_id || '',
    external_feedback_id: feedbackId,
    external_parent_feedback_id: feedback.external_parent_feedback_id || feedback.parent_id || '',
    author_display_name: feedback.author_display_name || feedback.reviewer || feedback.from?.name || '',
    message: cleanup(feedback.message || feedback.comment || feedback.text || ''),
    rating: feedback.rating == null ? null : Number(feedback.rating),
    permalink: feedback.permalink || feedback.review_url || '',
    content_context: cleanup(feedback.content_context || feedback.post_caption || feedback.ad_name || ''),
    created_at_platform: feedback.created_at || feedback.createTime || null,
    updated_at_platform: feedback.updated_at || feedback.updateTime || null,
    deleted_at: feedback.deleted_at || null,
    raw_payload: raw,
  };
}

async function upsertFeedbackItem(item) {
  const result = await pool.query(`
    INSERT INTO feedback_items (
      source, external_account_id, external_content_id, external_feedback_id,
      external_parent_feedback_id, author_display_name, message, rating,
      permalink, content_context, created_at_platform, updated_at_platform,
      deleted_at, raw_payload, status
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'ready')
    ON CONFLICT (source, external_account_id, external_feedback_id)
    DO UPDATE SET
      external_content_id = EXCLUDED.external_content_id,
      external_parent_feedback_id = EXCLUDED.external_parent_feedback_id,
      author_display_name = EXCLUDED.author_display_name,
      message = EXCLUDED.message,
      rating = EXCLUDED.rating,
      permalink = EXCLUDED.permalink,
      content_context = EXCLUDED.content_context,
      created_at_platform = EXCLUDED.created_at_platform,
      updated_at_platform = EXCLUDED.updated_at_platform,
      deleted_at = EXCLUDED.deleted_at,
      raw_payload = EXCLUDED.raw_payload,
      status = 'ready',
      updated_at = NOW()
    RETURNING *
  `, [
    item.source, item.external_account_id, item.external_content_id, item.external_feedback_id,
    item.external_parent_feedback_id, item.author_display_name, item.message, item.rating,
    item.permalink, item.content_context, item.created_at_platform, item.updated_at_platform,
    item.deleted_at, item.raw_payload,
  ]);
  return result.rows[0];
}

async function getFeedbackItem(id) {
  const result = await pool.query('SELECT * FROM feedback_items WHERE id = $1', [id]);
  if (!result.rows[0]) throw new Error(`feedback item not found: ${id}`);
  return result.rows[0];
}

function classifyGoogle(item) {
  const rating = Number(item.rating);
  if (rating >= 1 && rating <= 3) {
    return baseResult('negative', 100, 100, 'high', 'service', true, `Google review rating ${rating}/5`, 'google-rating-rule-v1');
  }
  if (rating >= 4 && rating <= 5) {
    return baseResult('non_negative', 0, 100, 'low', 'other', false, `Google review rating ${rating}/5`, 'google-rating-rule-v1');
  }
  return baseResult('ambiguous', 0, 60, 'medium', 'other', true, 'Google review rating missing/invalid', 'google-rating-rule-v1');
}

async function classifyMeta(item) {
  if (AI_PROVIDER === 'stub') return classifyMetaStub(item);
  if (!AI_BASE_URL) throw providerError('provider_model', 'FEEDBACK_AI_BASE_URL is required');
  if (!AI_API_KEY) throw providerError('provider_auth', 'FEEDBACK_AI_API_KEY is required');
  const response = await fetch(`${AI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${AI_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: AI_MODEL,
      temperature: Number(process.env.FEEDBACK_AI_TEMPERATURE || '1'),
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Classify Indonesian social media comments for operational negative feedback. Return only JSON.' },
        { role: 'user', content: JSON.stringify({
          schema: {
            sentiment: 'negative|non_negative|ambiguous',
            negative_score: '0-100',
            confidence: '0-100',
            urgency: 'low|medium|high|critical',
            category: 'product|service|delivery|billing|fraud_claim|legal|privacy|other',
            needs_response: 'boolean',
            reason_short: 'short operational reason',
          },
          comment: item.message || '',
          source: item.source,
          context: item.content_context || '',
        }) },
      ],
    }),
    signal: AbortSignal.timeout(parseInt(process.env.FEEDBACK_AI_TIMEOUT_MS || '60000', 10)),
  });
  const rawText = await response.text();
  const payload = parseOpenAiLikeResponse(rawText, response.headers.get('content-type') || '');
  if (!response.ok) throw providerError(errorClassFromStatus(response.status, payload), payload.error?.message || `AI provider HTTP ${response.status}`);
  const content = payload.choices?.[0]?.message?.content || payload.choices?.[0]?.delta?.content || '';
  let parsed;
  try {
    parsed = JSON.parse(extractJsonObject(content));
  } catch {
    throw providerError('invalid_ai_output', `AI response is not valid JSON: ${String(content).slice(0, 160)}`);
  }
  return validateAiResult(parsed, AI_MODEL);
}

function parseOpenAiLikeResponse(rawText, contentType) {
  const text = String(rawText || '').trim();
  if (!text) return {};
  if (contentType.includes('text/event-stream') || text.startsWith('data:')) {
    const chunks = [];
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try { chunks.push(JSON.parse(data)); } catch {}
    }
    const merged = { choices: [{ message: { content: '' } }] };
    for (const chunk of chunks) {
      const choice = chunk.choices?.[0] || {};
      const deltaContent = choice.delta?.content || '';
      const messageContent = choice.message?.content || '';
      if (deltaContent || messageContent) merged.choices[0].message.content += deltaContent || messageContent;
      if (!merged.usage && chunk.usage) merged.usage = chunk.usage;
      if (chunk.error) merged.error = chunk.error;
    }
    if (!merged.choices[0].message.content && chunks.length) {
      merged.choices[0].message.content = chunks[chunks.length - 1].choices?.[0]?.message?.content || chunks[chunks.length - 1].choices?.[0]?.delta?.content || '';
    }
    return merged;
  }
  try { return JSON.parse(text); } catch { return {}; }
}

function extractJsonObject(content) {
  const text = String(content || '').trim();
  if (text.startsWith('{')) return text;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return text;
}

function classifyMetaStub(item) {
  const text = `${item.message || ''} ${item.content_context || ''}`.toLowerCase();
  const negativeWords = ['jelek', 'buruk', 'lama', 'kecewa', 'marah', 'penipuan', 'mahal', 'rusak', 'komplain', 'parah'];
  const isNegative = negativeWords.some((word) => text.includes(word));
  if (isNegative) return baseResult('negative', 80, 75, 'medium', 'service', true, 'Stub classifier detected complaint wording', 'stub-meta-v1');
  return baseResult('non_negative', 10, 70, 'low', 'other', false, 'Stub classifier did not detect complaint wording', 'stub-meta-v1');
}

function validateAiResult(value, model) {
  const sentiment = ['negative', 'non_negative', 'ambiguous'].includes(value.sentiment) ? value.sentiment : null;
  if (!sentiment) throw providerError('invalid_ai_output', 'AI sentiment is invalid');
  return baseResult(
    sentiment,
    clampInt(value.negative_score, 0, 100),
    clampInt(value.confidence, 0, 100),
    value.urgency || 'low',
    value.category || 'other',
    Boolean(value.needs_response),
    String(value.reason_short || '').slice(0, 300),
    model,
  );
}

async function storeClassification(item, result) {
  const type = isGoogle(item.source) ? 'google_rating_rule' : 'meta_ai_classifier';
  const version = classifierVersionFor(item.source);
  const db = await pool.query(`
    INSERT INTO feedback_classifications (
      feedback_item_id, source, classifier_type, classifier_version, provider,
      model, config_fingerprint, sentiment, negative_score, confidence, urgency,
      category, needs_response, reason_short, result_json
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
    ON CONFLICT (feedback_item_id, classifier_version)
    DO UPDATE SET
      provider = EXCLUDED.provider,
      model = EXCLUDED.model,
      config_fingerprint = EXCLUDED.config_fingerprint,
      sentiment = EXCLUDED.sentiment,
      negative_score = EXCLUDED.negative_score,
      confidence = EXCLUDED.confidence,
      urgency = EXCLUDED.urgency,
      category = EXCLUDED.category,
      needs_response = EXCLUDED.needs_response,
      reason_short = EXCLUDED.reason_short,
      result_json = EXCLUDED.result_json,
      created_at = NOW()
    RETURNING *
  `, [
    item.id, item.source, type, version, isGoogle(item.source) ? 'deterministic' : AI_PROVIDER,
    result.model || AI_MODEL, CONFIG_FINGERPRINT, result.sentiment, result.negative_score,
    result.confidence, result.urgency, result.category, result.needs_response,
    result.reason_short, result,
  ]);
  await pool.query('UPDATE feedback_items SET status = $2, updated_at = NOW() WHERE id = $1', [item.id, 'classified']);
  return db.rows[0];
}

async function enqueueDeliveries(item, classification, result) {
  const sourceName = await resolveSourceDisplayName(item);
  const telegramText = formatReport(item, result, false, sourceName);
  await enqueueDelivery(item.id, classification.id, 'telegram', process.env.FEEDBACK_TELEGRAM_TO || '', telegramText);
  if (isNegative(result)) {
    const slackText = formatReport(item, result, true, sourceName);
    await enqueueDelivery(item.id, classification.id, 'slack', process.env.REVIEW_MONITOR_SLACK_CHANNEL || process.env.FEEDBACK_SLACK_CHANNEL || '', slackText);
  }
}

async function enqueueDelivery(itemId, classificationId, channel, destination, text) {
  await pool.query(`
    INSERT INTO feedback_delivery_jobs (feedback_item_id, classification_id, channel, destination, payload_text)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (feedback_item_id, classification_id, channel) DO NOTHING
  `, [itemId, classificationId, channel, destination, text]);
}

async function markRetry(table, row, err, errorClass) {
  const status = row.attempt_count >= MAX_ATTEMPTS ? 'dead_letter' : 'retry_pending';
  await pool.query(`
    UPDATE ${table}
    SET status = $2,
        locked_at = NULL,
        next_attempt_at = NOW() + ($3::TEXT || ' seconds')::INTERVAL,
        last_error = $4,
        error_class = $5,
        updated_at = NOW()
    WHERE id = $1
  `, [row.id, status, backoffSeconds(row.attempt_count), String(err.message || err).slice(0, 2000), errorClass]);
  console.error(`feedback_worker: ${table} ${status} id=${row.id}: ${err.message}`);
}

async function markClassificationRetry(job, err, failure) {
  const providerBlocked = ['provider_auth', 'provider_credit', 'provider_model'].includes(failure.errorClass);
  const status = providerBlocked || job.attempt_count >= MAX_ATTEMPTS ? 'blocked_provider' : 'retry_pending';
  await pool.query(`
    UPDATE feedback_classification_jobs
    SET status = $2,
        locked_at = NULL,
        next_attempt_at = NOW() + ($3::TEXT || ' seconds')::INTERVAL,
        last_error = $4,
        error_class = $5,
        last_provider = $6,
        last_model = $7,
        config_fingerprint = $8,
        updated_at = NOW()
    WHERE id = $1
  `, [job.id, status, backoffSeconds(job.attempt_count), String(err.message || err).slice(0, 2000), failure.errorClass, AI_PROVIDER, AI_MODEL, CONFIG_FINGERPRINT]);
  console.error(`feedback_worker: classification ${status} id=${job.id} error_class=${failure.errorClass}: ${err.message}`);
}

async function replayBlocked() {
  const result = await pool.query(`
    UPDATE feedback_classification_jobs
    SET status = 'retry_pending',
        locked_at = NULL,
        next_attempt_at = NOW(),
        last_error = NULL,
        updated_at = NOW(),
        config_fingerprint = $1
    WHERE status = 'blocked_provider'
    RETURNING id
  `, [CONFIG_FINGERPRINT]);
  console.log(`feedback_worker: replay_blocked requeued=${result.rowCount}`);
}

async function printStatus() {
  const rows = await pool.query(`
    SELECT 'ingestion' AS queue, status, count(*)::int FROM feedback_ingestion_events GROUP BY status
    UNION ALL
    SELECT 'classification' AS queue, status, count(*)::int FROM feedback_classification_jobs GROUP BY status
    UNION ALL
    SELECT 'delivery' AS queue, status, count(*)::int FROM feedback_delivery_jobs GROUP BY status
    ORDER BY queue, status
  `);
  console.table(rows.rows);
}

async function simulateGoogle() {
  await insertSimulatedEvent('google_business', {
    external_account_id: 'locations/test-warung',
    external_feedback_id: `google-review-${Date.now()}`,
    author_display_name: 'Customer Test',
    rating: Number(process.env.FEEDBACK_SIM_RATING || '2'),
    message: process.env.FEEDBACK_SIM_MESSAGE || 'Pelayanan lama dan saya kecewa.',
    permalink: 'https://example.com/google-review',
  });
}

async function simulateMeta() {
  await insertSimulatedEvent('instagram', {
    external_account_id: 'ig/test-account',
    external_feedback_id: `meta-comment-${Date.now()}`,
    external_content_id: 'post/test-post',
    author_display_name: 'Customer Sosmed',
    message: process.env.FEEDBACK_SIM_MESSAGE || 'Adminnya lama banget balesnya, kecewa.',
    content_context: 'Promo Komerce',
    permalink: 'https://example.com/meta-comment',
  });
}

async function syncMetaPages() {
  const pages = await fetchMetaPages();
  for (const page of pages) {
    await pool.query(`
      INSERT INTO feedback_sources (source, external_account_id, display_name, enabled, status, config_json)
      VALUES ('facebook_page', $1, $2, true, 'active', $3)
      ON CONFLICT (source, external_account_id)
      DO UPDATE SET
        display_name = EXCLUDED.display_name,
        enabled = true,
        status = 'active',
        config_json = EXCLUDED.config_json,
        updated_at = NOW()
    `, [
      String(page.id),
      page.name || String(page.id),
      {
        tasks: page.tasks || [],
        page_access_token: page.access_token || '',
        instagram_business_account: page.instagram_business_account || null,
        synced_at: new Date().toISOString(),
      },
    ]);
  }
  console.log(`feedback_worker: meta_pages synced=${pages.length}`);
  for (const page of pages) console.log(`- ${page.name || '-'} (${page.id})`);
}

async function pollMetaComments() {
  const startedAt = Date.now();
  try {
    const pages = await resolveMetaPages();
    const results = await mapLimit(pages, META_PAGE_CONCURRENCY, async (page) => {
      try {
        const [facebookInserted, instagramInserted] = await Promise.all([
          pollFacebookComments(page),
          page.instagram_business_account?.id ? pollInstagramComments(page) : Promise.resolve(0),
        ]);
        return { ok: true, inserted: facebookInserted + instagramInserted };
      } catch (err) {
        console.error(`feedback_worker: meta_poll page_failed page=${page.name || page.id}: ${err.message}`);
        return { ok: false, inserted: 0, error: err.message };
      }
    });
    const successfulPages = results.filter((result) => result.ok).length;
    const failedPages = results.length - successfulPages;
    const inserted = results.reduce((sum, result) => sum + result.inserted, 0);
    if (pages.length && successfulPages === 0) throw new Error('all Meta pages failed to poll');
    const metrics = {
      pages: pages.length,
      successful_pages: successfulPages,
      failed_pages: failedPages,
      inserted_events: inserted,
      duration_ms: Date.now() - startedAt,
    };
    await recordMonitorRun('meta_poll', failedPages ? 'partial' : 'completed', `inserted=${inserted}`, metrics);
    console.log(`feedback_worker: meta_poll pages=${pages.length} successful=${successfulPages} failed=${failedPages} inserted_events=${inserted} duration_ms=${metrics.duration_ms}`);
  } catch (err) {
    await recordMonitorRun('meta_poll', 'failed', err.message, { duration_ms: Date.now() - startedAt });
    throw err;
  }
}

async function pollFacebookComments(page) {
  const posts = await graphGet(`/${page.id}/posts`, {
    fields: 'id,message,created_time,permalink_url',
    limit: META_POST_LIMIT,
  }, page.page_access_token);
  const counts = await mapLimit(posts.data || [], META_COMMENT_CONCURRENCY, async (post) => {
    const comments = await graphGet(`/${post.id}/comments`, {
      fields: 'id,message,from,created_time,permalink_url,parent{id}',
      filter: 'stream',
      limit: META_COMMENT_LIMIT,
    }, page.page_access_token);
    let inserted = 0;
    for (const comment of comments.data || []) {
      if (!isWithinLookback(comment.created_time || comment.timestamp)) continue;
      const result = await pool.query(`
        INSERT INTO feedback_ingestion_events (
          source, event_type, idempotency_key, external_account_id, external_feedback_id, raw_payload
        ) VALUES ('facebook_page', 'poll_comment', $1, $2, $3, $4)
        ON CONFLICT (idempotency_key) DO NOTHING
      `, [
        `facebook_page:${page.id}:${comment.id}`,
        String(page.id),
        String(comment.id),
        {
          feedback: {
            external_account_id: String(page.id),
            external_content_id: String(post.id),
            external_feedback_id: String(comment.id),
            external_parent_feedback_id: comment.parent?.id || '',
            author_display_name: comment.from?.name || '',
            message: comment.message || '',
            content_context: post.message || '',
            permalink: comment.permalink_url || post.permalink_url || '',
            created_at: comment.created_time || null,
          },
          page: { id: page.id, name: page.name || '' },
          post,
          comment,
        },
      ]);
      inserted += result.rowCount || 0;
    }
    return inserted;
  });
  return counts.reduce((sum, count) => sum + count, 0);
}

async function pollInstagramComments(page) {
  const ig = page.instagram_business_account;
  const media = await graphGet(`/${ig.id}/media`, {
    fields: 'id,caption,timestamp,permalink',
    limit: META_POST_LIMIT,
  }, page.page_access_token);
  const counts = await mapLimit(media.data || [], META_COMMENT_CONCURRENCY, async (item) => {
    const comments = await graphGet(`/${item.id}/comments`, {
      fields: 'id,text,username,timestamp,permalink',
      limit: META_COMMENT_LIMIT,
    }, page.page_access_token);
    let inserted = 0;
    for (const comment of comments.data || []) {
      if (!isWithinLookback(comment.timestamp)) continue;
      const result = await pool.query(`
        INSERT INTO feedback_ingestion_events (
          source, event_type, idempotency_key, external_account_id, external_feedback_id, raw_payload
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (idempotency_key) DO NOTHING
      `, [
        'instagram',
        'poll_comment',
        `instagram:${ig.id}:${comment.id}`,
        String(ig.id),
        String(comment.id),
        {
          feedback: {
            external_account_id: String(ig.id),
            external_content_id: String(item.id),
            external_feedback_id: String(comment.id),
            author_display_name: comment.username || '',
            message: comment.text || '',
            content_context: item.caption || '',
            permalink: comment.permalink || item.permalink || '',
            created_at: comment.timestamp || null,
          },
          page: { id: page.id, name: page.name || '' },
          instagram: ig,
          media: item,
          comment,
        },
      ]);
      inserted += result.rowCount || 0;
    }
    return inserted;
  });
  return counts.reduce((sum, count) => sum + count, 0);
}

async function recordMonitorRun(runType, status, detail, metrics) {
  await pool.query(`
    INSERT INTO feedback_monitor_runs (run_type, status, detail, metrics_json)
    VALUES ($1, $2, $3, $4)
  `, [runType, status, String(detail || '').slice(0, 1000), metrics || {}]);
}

async function resolveMetaPages() {
  if (META_PAGE_IDS.length) {
    return META_PAGE_IDS.map((id) => ({ id, name: id }));
  }
  const rows = await pool.query(`
    SELECT external_account_id AS id,
           display_name AS name,
           config_json->>'page_access_token' AS page_access_token,
           config_json->'instagram_business_account' AS instagram_business_account
    FROM feedback_sources
    WHERE source = 'facebook_page' AND enabled = true AND status = 'active'
    ORDER BY display_name NULLS LAST, external_account_id
  `);
  if (rows.rows.length) return rows.rows;
  return fetchMetaPages();
}

async function fetchMetaPages() {
  if (!META_ACCESS_TOKEN) throw new Error('META_ACCESS_TOKEN is required');
  const me = await graphGet('/me', { fields: 'id,name' });
  const pages = await graphGet(`/${me.id}/accounts`, {
    fields: 'id,name,tasks,access_token,instagram_business_account{id,username,name}',
    limit: 100,
  });
  return (pages.data || []).map((page) => ({
    ...page,
    page_access_token: page.page_access_token || page.access_token || '',
  }));
}

function isWithinLookback(value) {
  if (!value || !META_LOOKBACK_MINUTES) return true;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return true;
  return time >= Date.now() - META_LOOKBACK_MINUTES * 60 * 1000;
}

async function graphGet(path, params = {}, accessToken = META_ACCESS_TOKEN) {
  if (!META_ACCESS_TOKEN) throw new Error('META_ACCESS_TOKEN is required');
  const url = new URL(`${META_GRAPH_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  url.searchParams.set('access_token', accessToken || META_ACCESS_TOKEN);
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.error?.message || `Meta Graph HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

async function insertSimulatedEvent(source, feedback) {
  const idempotency = `${source}:${feedback.external_account_id}:${feedback.external_feedback_id}`;
  await pool.query(`
    INSERT INTO feedback_ingestion_events (
      source, event_type, idempotency_key, external_account_id, external_feedback_id, raw_payload
    )
    VALUES ($1, 'simulation', $2, $3, $4, $5)
    ON CONFLICT (idempotency_key) DO NOTHING
  `, [source, idempotency, feedback.external_account_id, feedback.external_feedback_id, { feedback }]);
  console.log(`feedback_worker: simulated source=${source} key=${idempotency}`);
}

async function sendTelegram(text, destination) {
  const token = process.env.TELEGRAM_DEFAULT_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '';
  const chatId = destination || process.env.FEEDBACK_TELEGRAM_TO || '';
  if (!token || !chatId) throw new Error('Telegram token/chat id is required');
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    signal: AbortSignal.timeout(30000),
  });
  const payload = await response.json();
  if (!payload.ok) throw new Error(`Telegram send failed: ${payload.description || response.status}`);
}

async function sendSlack(text, destination) {
  const token = process.env.SLACK_BOT_TOKEN || '';
  const channel = destination || process.env.REVIEW_MONITOR_SLACK_CHANNEL || process.env.FEEDBACK_SLACK_CHANNEL || '';
  if (!token || !channel) throw new Error('Slack token/channel is required');
  const response = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ channel, text, unfurl_links: false, unfurl_media: false }),
    signal: AbortSignal.timeout(30000),
  });
  const payload = await response.json();
  if (!payload.ok) throw new Error(`Slack send failed: ${payload.error || response.status}`);
}

async function resolveSourceDisplayName(item) {
  if (item.source === 'facebook_page') {
    const result = await pool.query(
      'SELECT display_name FROM feedback_sources WHERE source = $1 AND external_account_id = $2 LIMIT 1',
      ['facebook_page', item.external_account_id],
    );
    return result.rows[0]?.display_name || item.external_account_id || '-';
  }
  if (item.source === 'instagram') {
    const result = await pool.query(
      "SELECT display_name FROM feedback_sources WHERE source = 'facebook_page' AND config_json->'instagram_business_account'->>'id' = $1 LIMIT 1",
      [item.external_account_id],
    );
    return result.rows[0]?.display_name || item.external_account_id || '-';
  }
  return item.external_account_id || '-';
}

function sourceLabel(source) {
  if (source === 'instagram') return 'Instagram';
  if (source === 'facebook_page') return 'Facebook Page';
  if (source === 'google_business') return 'Google Business Profile';
  return source || '-';
}

function conclusionLabel(result) {
  if (result.sentiment === 'negative') return 'Negatif';
  if (result.sentiment === 'non_negative') return 'Tidak negatif';
  return 'Ambigu / perlu dicek manual';
}

function formatReport(item, result, slack, sourceName) {
  const title = slack ? 'Negative Feedback Alert' : 'Feedback Monitoring Result';
  const lines = [
    title,
    '',
    sourceLabel(item.source),
    `Nama Instagram/FB Page: ${sourceName || '-'}`,
    `Komentar: ${item.message || '(empty)'}`,
    `Kesimpulan: ${conclusionLabel(result)} (${result.negative_score}/100, confidence ${result.confidence}/100)`,
    `Alasan: ${result.reason_short || '-'}`,
    `Link komentar/postingan: ${item.permalink || '-'}`,
    '',
    `Author: ${item.author_display_name || '-'}`,
    `Urgency: ${result.urgency}`,
    `Category: ${result.category}`,
  ];
  if (item.rating) lines.push(`Rating: ${item.rating}/5`);
  return lines.join('\n').slice(0, slack ? 3500 : 3900);
}

function baseResult(sentiment, negativeScore, confidence, urgency, category, needsResponse, reasonShort, model) {
  return {
    sentiment,
    negative_score: negativeScore,
    confidence,
    urgency,
    category,
    needs_response: needsResponse,
    reason_short: reasonShort,
    model,
  };
}

function isNegative(result) {
  return result.sentiment === 'negative'
    && (result.urgency === 'critical' || (result.negative_score >= 70 && result.confidence >= 70));
}

function classifierVersionFor(source) {
  return isGoogle(source) ? 'google-rating-rule-v1' : CLASSIFIER_VERSION;
}

function isGoogle(source) {
  return source === 'google_business';
}

function classifyFailure(err) {
  return { errorClass: err.errorClass || 'provider_transient' };
}

function providerError(errorClass, message) {
  const err = new Error(message);
  err.errorClass = errorClass;
  return err;
}

function errorClassFromStatus(status, payload) {
  const message = String(payload.error?.message || payload.error || '').toLowerCase();
  if (status === 401 || status === 403) return 'provider_auth';
  if (status === 402 || message.includes('credit') || message.includes('quota')) return 'provider_credit';
  if (status === 404 || message.includes('model')) return 'provider_model';
  return 'provider_transient';
}

function backoffSeconds(attempt) {
  return Math.min(900, Math.max(10, 10 * Math.pow(2, Math.max(0, attempt - 1))));
}

function cleanup(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function clampInt(value, min, max) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mapLimit(items, concurrency, mapper) {
  const values = Array.from(items || []);
  const results = new Array(values.length);
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(Number(concurrency) || 1, values.length || 1));
  const runners = Array.from({ length: workerCount }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      results[index] = await mapper(values[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

async function closeAfter(promise) {
  await promise;
  await pool.end();
}
