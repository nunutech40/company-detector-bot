-- Negative Feedback Monitor DB Migration
-- Version: 5.0.0 - 2026-06-15

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS feedback_sources (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source              TEXT NOT NULL,
  external_account_id TEXT NOT NULL,
  display_name        TEXT,
  enabled             BOOLEAN NOT NULL DEFAULT true,
  status              TEXT NOT NULL DEFAULT 'active',
  last_error          TEXT,
  config_json         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source, external_account_id)
);

CREATE TABLE IF NOT EXISTS feedback_ingestion_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source              TEXT NOT NULL,
  event_type          TEXT NOT NULL,
  idempotency_key     TEXT NOT NULL UNIQUE,
  external_account_id TEXT,
  external_feedback_id TEXT,
  raw_payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  status              TEXT NOT NULL DEFAULT 'pending',
  attempt_count       INTEGER NOT NULL DEFAULT 0,
  locked_at           TIMESTAMPTZ,
  next_attempt_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error          TEXT,
  error_class         TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_feedback_ingestion_status
  ON feedback_ingestion_events(status, next_attempt_at, created_at);

CREATE TABLE IF NOT EXISTS feedback_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source              TEXT NOT NULL,
  external_account_id TEXT NOT NULL,
  external_content_id TEXT,
  external_feedback_id TEXT NOT NULL,
  external_parent_feedback_id TEXT,
  author_display_name TEXT,
  message             TEXT,
  rating              INTEGER,
  permalink           TEXT,
  content_context     TEXT,
  created_at_platform TIMESTAMPTZ,
  updated_at_platform TIMESTAMPTZ,
  deleted_at          TIMESTAMPTZ,
  raw_payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  status              TEXT NOT NULL DEFAULT 'received',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source, external_account_id, external_feedback_id)
);

CREATE INDEX IF NOT EXISTS idx_feedback_items_status
  ON feedback_items(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS feedback_classification_jobs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feedback_item_id    UUID NOT NULL REFERENCES feedback_items(id) ON DELETE CASCADE,
  source              TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending',
  attempt_count       INTEGER NOT NULL DEFAULT 0,
  locked_at           TIMESTAMPTZ,
  next_attempt_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error          TEXT,
  error_class         TEXT,
  last_provider       TEXT,
  last_model          TEXT,
  config_fingerprint  TEXT,
  classifier_version  TEXT,
  result_json         JSONB,
  processed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (feedback_item_id, classifier_version)
);

CREATE INDEX IF NOT EXISTS idx_feedback_classification_jobs_status
  ON feedback_classification_jobs(status, next_attempt_at, created_at);

CREATE TABLE IF NOT EXISTS feedback_classifications (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feedback_item_id    UUID NOT NULL REFERENCES feedback_items(id) ON DELETE CASCADE,
  source              TEXT NOT NULL,
  classifier_type     TEXT NOT NULL,
  classifier_version  TEXT NOT NULL,
  provider            TEXT,
  model               TEXT,
  config_fingerprint  TEXT,
  sentiment           TEXT NOT NULL,
  negative_score      INTEGER NOT NULL DEFAULT 0,
  confidence          INTEGER NOT NULL DEFAULT 0,
  urgency             TEXT NOT NULL DEFAULT 'low',
  category            TEXT NOT NULL DEFAULT 'other',
  needs_response      BOOLEAN NOT NULL DEFAULT false,
  reason_short        TEXT,
  result_json         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (feedback_item_id, classifier_version)
);

CREATE TABLE IF NOT EXISTS feedback_delivery_jobs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feedback_item_id    UUID NOT NULL REFERENCES feedback_items(id) ON DELETE CASCADE,
  classification_id   UUID REFERENCES feedback_classifications(id) ON DELETE CASCADE,
  channel             TEXT NOT NULL,
  destination         TEXT,
  status              TEXT NOT NULL DEFAULT 'pending',
  attempt_count       INTEGER NOT NULL DEFAULT 0,
  locked_at           TIMESTAMPTZ,
  next_attempt_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error          TEXT,
  error_class         TEXT,
  payload_text        TEXT NOT NULL,
  sent_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (feedback_item_id, classification_id, channel)
);

CREATE INDEX IF NOT EXISTS idx_feedback_delivery_jobs_status
  ON feedback_delivery_jobs(status, next_attempt_at, created_at);

CREATE TABLE IF NOT EXISTS feedback_deliveries (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_job_id     UUID REFERENCES feedback_delivery_jobs(id) ON DELETE SET NULL,
  feedback_item_id    UUID REFERENCES feedback_items(id) ON DELETE SET NULL,
  channel             TEXT NOT NULL,
  destination         TEXT,
  status              TEXT NOT NULL,
  error               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS feedback_monitor_runs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_type            TEXT NOT NULL,
  status              TEXT NOT NULL,
  detail              TEXT,
  metrics_json        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
