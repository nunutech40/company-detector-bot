#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const express = require('express');
const { Pool } = require('pg');

const PORT = parseInt(process.env.FEEDBACK_MONITOR_PORT || '3003', 10);
const DATABASE_URL = process.env.DATABASE_URL || '';
const META_VERIFY_TOKEN = process.env.META_WEBHOOK_VERIFY_TOKEN || '';
const GOOGLE_PUSH_TOKEN = process.env.GOOGLE_PUBSUB_PUSH_TOKEN || '';

if (!DATABASE_URL) {
  console.error('feedback_ingress: DATABASE_URL is required');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });
const app = express();
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'feedback-monitor-ingress' });
});

app.get('/webhook/meta', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && META_VERIFY_TOKEN && token === META_VERIFY_TOKEN) {
    return res.status(200).send(String(challenge || ''));
  }
  return res.status(403).send('forbidden');
});

app.post('/webhook/meta', async (req, res, next) => {
  try {
    const events = extractMetaEvents(req.body);
    await insertEvents(events);
    res.status(202).json({ ok: true, accepted: events.length });
  } catch (err) {
    next(err);
  }
});

app.post('/webhook/google', async (req, res, next) => {
  try {
    if (GOOGLE_PUSH_TOKEN && req.get('x-feedback-token') !== GOOGLE_PUSH_TOKEN) {
      return res.status(403).json({ ok: false, error: 'invalid google push token' });
    }
    const event = buildEvent('google_business', 'review_notification', req.body);
    await insertEvents([event]);
    res.status(202).json({ ok: true, accepted: 1 });
  } catch (err) {
    next(err);
  }
});

app.use((err, _req, res, _next) => {
  console.error('feedback_ingress:', err.message);
  res.status(500).json({ ok: false, error: err.message });
});

app.listen(PORT, () => {
  console.log(`feedback_ingress: listening on :${PORT}`);
});

function extractMetaEvents(payload) {
  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  const events = [];
  for (const entry of entries) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const source = value.item === 'comment' || value.comment_id ? 'facebook_page' : 'instagram';
      events.push(buildEvent(source, change.field || 'comment', {
        entry,
        change,
        feedback: value.feedback,
      }));
    }
  }
  if (!events.length) events.push(buildEvent('facebook_page', 'meta_webhook', payload));
  return events;
}

function buildEvent(source, eventType, rawPayload) {
  const feedback = rawPayload.feedback || rawPayload.review || rawPayload.comment || rawPayload;
  const accountId = feedback.external_account_id || feedback.account_id || feedback.page_id || rawPayload.account || 'unknown';
  const feedbackId = feedback.external_feedback_id || feedback.review_id || feedback.comment_id || feedback.id || '';
  const keySeed = feedbackId || JSON.stringify(rawPayload);
  return {
    source,
    eventType,
    externalAccountId: String(accountId),
    externalFeedbackId: String(feedbackId || crypto.createHash('sha256').update(keySeed).digest('hex')),
    idempotencyKey: `${source}:${accountId}:${feedbackId || crypto.createHash('sha256').update(keySeed).digest('hex')}`,
    rawPayload,
  };
}

async function insertEvents(events) {
  for (const event of events) {
    await pool.query(`
      INSERT INTO feedback_ingestion_events (
        source, event_type, idempotency_key, external_account_id, external_feedback_id, raw_payload
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (idempotency_key) DO NOTHING
    `, [
      event.source,
      event.eventType,
      event.idempotencyKey,
      event.externalAccountId,
      event.externalFeedbackId,
      event.rawPayload,
    ]);
  }
}
