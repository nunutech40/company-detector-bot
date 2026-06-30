#!/usr/bin/env node
'use strict';

const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

loadEnv(process.env.COMPANY_DETECTOR_ENV_FILE
  || path.join(process.env.HOME || '/home/nunuopc', '.openclaw', 'gateway.systemd.env'));
loadEnv(process.env.FEEDBACK_MONITOR_ENV_FILE
  || path.join(process.env.HOME || '/home/nunuopc', '.openclaw', 'feedback-monitor.env'));

const DATABASE_URL = process.env.DATABASE_URL || '';
const SLACK_TOKEN = process.env.SLACK_BOT_TOKEN || '';
const STALL_MINUTES = parseInt(process.env.OPS_HEALTH_QUEUE_STALL_MINUTES || '25', 10);
const TRANSIENT_WINDOW_MINUTES = parseInt(process.env.OPS_HEALTH_AI_WINDOW_MINUTES || '10', 10);
const SERVICE_CONFIRM_CHECKS = parseInt(process.env.OPS_HEALTH_SERVICE_CONFIRM_CHECKS || '2', 10);
const RECOVERY_CONFIRM_CHECKS = parseInt(process.env.OPS_HEALTH_RECOVERY_CONFIRM_CHECKS || '2', 10);
const ALERT_PREFIX = String(process.env.OPS_HEALTH_ALERT_PREFIX || '').trim();

if (!DATABASE_URL) {
  console.error('ops_health_monitor: DATABASE_URL is required');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });
const features = [
  {
    key: 'brands_prospect',
    label: 'Brands Prospect Investigation',
    service: process.env.OPS_HEALTH_BRANDS_SERVICE || 'company-register-worker.service',
    channel: process.env.BRANDS_PROSPECT_ALERT_SLACK_CHANNEL || process.env.SLACK_REPORT_CHANNEL || '',
  },
  {
    key: 'negative_comment_monitor',
    label: 'Negative Comment Monitor',
    service: process.env.OPS_HEALTH_NEGATIVE_SERVICE || 'company-feedback-monitor-worker.service',
    channel: process.env.NEGATIVE_MONITOR_ALERT_SLACK_CHANNEL
      || process.env.REVIEW_MONITOR_SLACK_CHANNEL
      || process.env.FEEDBACK_SLACK_CHANNEL
      || '',
  },
];

main().catch(async (err) => {
  console.error(`ops_health_monitor: fatal: ${err.message}`);
  await pool.end();
  process.exit(1);
});

async function main() {
  for (const feature of features) await evaluateFeature(feature);
  await pool.end();
}

async function evaluateFeature(feature) {
  const serviceActive = isServiceActive(feature.service);
  await observe(feature, 'service_down', serviceActive ? null : {
    summary: `${feature.service} tidak aktif`,
    fingerprint: `${feature.service}:inactive`,
    evidenceCount: 1,
  }, SERVICE_CONFIRM_CHECKS);

  const queue = await readQueueHealth(feature.key);
  const stalled = queue.processingStale > 0 || (serviceActive && queue.dueCount > 0 && queue.recentActivity === 0);
  await observe(feature, 'queue_stalled', stalled ? {
    summary: `Queue tidak bergerak: due=${queue.dueCount}, stale_processing=${queue.processingStale}, tanpa aktivitas ${STALL_MINUTES} menit`,
    fingerprint: `${queue.dueCount}:${queue.processingStale}:${queue.oldestDueId || '-'}`,
    evidenceCount: queue.dueCount + queue.processingStale,
    metadata: queue,
  } : null, 2);

  if (feature.key === 'negative_comment_monitor') {
    const poller = await readMetaPollerHealth();
    await observe(feature, 'source_poller', poller.issue, 2);
  }

  const ai = await readAiHealth(feature.key);
  await observe(feature, 'ai_provider', ai.issue, 1, async (incident) => {
    const successes = await successfulAiJobsSince(feature.key, incident.opened_at);
    return successes >= RECOVERY_CONFIRM_CHECKS;
  });

  console.log(`ops_health_monitor: feature=${feature.key} service=${serviceActive ? 'active' : 'inactive'} due=${queue.dueCount} ai_issue=${ai.issue ? ai.issue.errorClass : 'none'}`);
}

async function observe(feature, kind, issue, confirmChecks, recoveryCheck = null) {
  const active = await activeIncident(feature.key, kind);
  if (!issue) {
    if (!active) return;
    if (active.status === 'suspected') return resolveIncident(active, feature, false);
    if (recoveryCheck && !(await recoveryCheck(active))) return;
    const successChecks = Number(active.success_checks || 0) + 1;
    if (!recoveryCheck && successChecks < RECOVERY_CONFIRM_CHECKS) {
      await pool.query('UPDATE operational_incidents SET success_checks=$2, updated_at=NOW() WHERE id=$1', [active.id, successChecks]);
      return;
    }
    await resolveIncident(active, feature, true);
    return;
  }

  if (!active) {
    const status = confirmChecks <= 1 ? 'open' : 'suspected';
    const inserted = await pool.query(`
      INSERT INTO operational_incidents (
        feature_key, incident_kind, status, fingerprint, evidence_count, summary, metadata_json
      ) VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING *
    `, [feature.key, kind, status, issue.fingerprint, issue.evidenceCount || 1, issue.summary, issue.metadata || {}]);
    if (status === 'open') await alertIncident(inserted.rows[0], feature, issue);
    return;
  }

  const checks = Number(active.consecutive_checks || 0) + 1;
  const status = active.status === 'open' || checks >= confirmChecks ? 'open' : 'suspected';
  const updated = await pool.query(`
    UPDATE operational_incidents
    SET status=$2, fingerprint=$3, consecutive_checks=$4, success_checks=0,
        evidence_count=$5, summary=$6, metadata_json=$7, last_seen_at=NOW(), updated_at=NOW()
    WHERE id=$1 RETURNING *
  `, [active.id, status, issue.fingerprint, checks, issue.evidenceCount || 1, issue.summary, issue.metadata || {}]);
  if (status === 'open' && !active.alerted_at) await alertIncident(updated.rows[0], feature, issue);
}

async function readAiHealth(featureKey) {
  const table = featureKey === 'brands_prospect' ? 'register_intake_jobs' : 'feedback_classification_jobs';
  const rows = await pool.query(`
    SELECT id, status, attempt_count, error_class, last_error, last_provider, last_model, updated_at
    FROM ${table}
    WHERE status IN ('retry_pending','blocked_provider')
      AND error_class LIKE 'provider_%'
      AND updated_at >= NOW() - ($1::TEXT || ' minutes')::INTERVAL
    ORDER BY updated_at DESC
  `, [TRANSIENT_WINDOW_MINUTES]);
  if (!rows.rowCount) return { issue: null };

  const hard = rows.rows.find((row) => ['provider_auth', 'provider_credit', 'provider_model'].includes(row.error_class));
  const distinctJobs = new Set(rows.rows.map((row) => row.id)).size;
  const maxAttempts = Math.max(...rows.rows.map((row) => Number(row.attempt_count || 0)));
  const confirmed = Boolean(hard) || distinctJobs >= 2 || maxAttempts >= 3;
  if (!confirmed) return { issue: null };

  const latest = hard || rows.rows[0];
  return { issue: {
    errorClass: latest.error_class,
    summary: `${latest.error_class}: ${cleanError(latest.last_error)}`,
    fingerprint: hash(`${latest.error_class}|${latest.last_provider}|${latest.last_model}`),
    evidenceCount: distinctJobs,
    metadata: {
      provider: latest.last_provider || 'unknown',
      model: latest.last_model || 'unknown',
      affected_jobs: distinctJobs,
      max_attempts: maxAttempts,
    },
  } };
}

async function readQueueHealth(featureKey) {
  const table = featureKey === 'brands_prospect' ? 'register_intake_jobs' : 'feedback_classification_jobs';
  const result = await pool.query(`
    SELECT
      count(*) FILTER (WHERE status IN ('pending','retry_pending') AND next_attempt_at <= NOW())::int AS due_count,
      count(*) FILTER (WHERE status='processing' AND locked_at < NOW() - ($1::TEXT || ' minutes')::INTERVAL)::int AS processing_stale,
      COALESCE(EXTRACT(EPOCH FROM (NOW() - min(created_at) FILTER (WHERE status IN ('pending','retry_pending') AND next_attempt_at <= NOW()))) / 60, 0)::int AS oldest_due_minutes,
      min(id::text) FILTER (WHERE status IN ('pending','retry_pending') AND next_attempt_at <= NOW()) AS oldest_due_id,
      count(*) FILTER (WHERE status IN ('processing','completed') AND updated_at >= NOW() - ($1::TEXT || ' minutes')::INTERVAL)::int AS recent_activity
    FROM ${table}
  `, [STALL_MINUTES]);
  const row = result.rows[0];
  return {
    dueCount: Number(row.due_count || 0),
    processingStale: Number(row.processing_stale || 0),
    oldestDueMinutes: Number(row.oldest_due_minutes || 0),
    oldestDueId: row.oldest_due_id || '',
    recentActivity: Number(row.recent_activity || 0),
  };
}

async function readMetaPollerHealth() {
  if (!isServiceActive('company-feedback-meta-poller.timer')) {
    return { issue: {
      summary: 'Meta comment poller timer tidak aktif',
      fingerprint: 'meta-poller-timer-inactive',
      evidenceCount: 1,
    } };
  }
  const result = await pool.query(`
    SELECT status, detail, metrics_json, created_at,
           EXTRACT(EPOCH FROM (NOW() - created_at)) / 60 AS age_minutes
    FROM feedback_monitor_runs
    WHERE run_type='meta_poll'
    ORDER BY created_at DESC
    LIMIT 1
  `);
  if (!result.rowCount) return { issue: null };
  const row = result.rows[0];
  const stale = Number(row.age_minutes || 0) > 60;
  if (row.status !== 'failed' && !stale) return { issue: null };
  return { issue: {
    summary: stale
      ? `Meta comment poller belum sukses lagi selama ${Math.round(row.age_minutes)} menit`
      : `Meta comment poller gagal: ${row.detail || 'unknown error'}`,
    fingerprint: hash(`meta-poller|${row.status}|${row.detail || ''}`),
    evidenceCount: 1,
    metadata: row.metrics_json || {},
  } };
}

async function successfulAiJobsSince(featureKey, since) {
  const table = featureKey === 'brands_prospect' ? 'register_intake_jobs' : 'feedback_classification_jobs';
  const sourceFilter = featureKey === 'negative_comment_monitor' ? "AND source <> 'google_business'" : '';
  const result = await pool.query(`
    SELECT count(*)::int AS count FROM ${table}
    WHERE status='completed' AND processed_at > $1
      ${sourceFilter}
  `, [since]);
  return Number(result.rows[0]?.count || 0);
}

async function activeIncident(featureKey, kind) {
  const result = await pool.query(`
    SELECT * FROM operational_incidents
    WHERE feature_key=$1 AND incident_kind=$2 AND status IN ('suspected','open')
    ORDER BY created_at DESC LIMIT 1
  `, [featureKey, kind]);
  return result.rows[0] || null;
}

async function alertIncident(incident, feature, issue) {
  const text = [
    `${ALERT_PREFIX ? `${ALERT_PREFIX} ` : ''}ALERT [${feature.label}]`,
    `Jenis: ${incidentLabel(incident.incident_kind)}`,
    `Status: CONFIRMED`,
    `Detail: ${issue.summary}`,
    issue.metadata?.provider ? `Provider/model: ${issue.metadata.provider}/${issue.metadata.model}` : null,
    `Evidence: ${issue.evidenceCount || 1}`,
    'Notifikasi ini dideduplikasi; tidak dikirim ulang selama incident yang sama masih terbuka.',
  ].filter(Boolean).join('\n');
  if (await sendSlack(feature.channel, text)) {
    await pool.query('UPDATE operational_incidents SET alerted_at=NOW(), updated_at=NOW() WHERE id=$1', [incident.id]);
  }
}

async function resolveIncident(incident, feature, notify) {
  const result = await pool.query(`
    UPDATE operational_incidents SET status='resolved', resolved_at=NOW(), updated_at=NOW()
    WHERE id=$1 RETURNING *
  `, [incident.id]);
  if (!notify || !incident.alerted_at) return;
  const text = [
    `${ALERT_PREFIX ? `${ALERT_PREFIX} ` : ''}RECOVERY [${feature.label}]`,
    `Jenis: ${incidentLabel(incident.incident_kind)}`,
    'Status: NORMAL KEMBALI',
    `Incident dibuka: ${new Date(incident.opened_at).toISOString()}`,
    incident.incident_kind === 'ai_provider'
      ? `Validasi: minimal ${RECOVERY_CONFIRM_CHECKS} job AI nyata berhasil setelah incident.`
      : `Validasi: ${RECOVERY_CONFIRM_CHECKS} health check berturut-turut berhasil.`,
  ].join('\n');
  if (await sendSlack(feature.channel, text)) {
    await pool.query('UPDATE operational_incidents SET recovery_alerted_at=NOW(), updated_at=NOW() WHERE id=$1', [result.rows[0].id]);
  }
}

async function sendSlack(channel, text) {
  if (!SLACK_TOKEN || !channel) {
    console.error('ops_health_monitor: Slack token/channel missing');
    return false;
  }
  try {
    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { authorization: `Bearer ${SLACK_TOKEN}`, 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ channel, text, unfurl_links: false, unfurl_media: false }),
      signal: AbortSignal.timeout(30000),
    });
    const payload = await response.json();
    if (!payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    return true;
  } catch (err) {
    console.error(`ops_health_monitor: Slack send failed: ${err.message}`);
    return false;
  }
}

function isServiceActive(service) {
  try {
    return execFileSync('systemctl', ['--user', 'is-active', service], { encoding: 'utf8' }).trim() === 'active';
  } catch (_) {
    return false;
  }
}

function incidentLabel(kind) {
  if (kind === 'ai_provider') return 'AI provider bermasalah';
  if (kind === 'service_down') return 'Worker service berhenti';
  if (kind === 'queue_stalled') return 'Queue tidak bergerak';
  if (kind === 'source_poller') return 'Sumber komentar Meta tidak terpantau';
  return kind;
}

function cleanError(value) {
  return String(value || 'unknown error').replace(/\s+/g, ' ').trim().slice(0, 500);
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16);
}

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}
