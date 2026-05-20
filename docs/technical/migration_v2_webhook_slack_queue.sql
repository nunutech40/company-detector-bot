-- Company Detection DB Migration
-- Version: 2.0.0 — 2026-05-20
-- Adds PostgreSQL-backed webhook intake queue and Slack daily digest tracking.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Webhook intake queue ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS register_intake_jobs (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source               TEXT NOT NULL DEFAULT 'platform_register',
  external_id          TEXT,
  idempotency_key      TEXT,

  email                TEXT NOT NULL,
  full_name            TEXT,
  brand_name           TEXT,
  no_hp_masked         TEXT,
  payload_json         JSONB NOT NULL DEFAULT '{}'::jsonb,

  status               TEXT NOT NULL DEFAULT 'pending',
  attempt_count        INTEGER NOT NULL DEFAULT 0,
  last_error           TEXT,
  locked_at            TIMESTAMPTZ,
  processed_at         TIMESTAMPTZ,
  investigation_job_id UUID REFERENCES investigation_jobs(id) ON DELETE SET NULL,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_register_intake_jobs_status
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'skipped'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_register_intake_idempotency_key
  ON register_intake_jobs(idempotency_key)
  WHERE idempotency_key IS NOT NULL AND idempotency_key <> '';

CREATE INDEX IF NOT EXISTS idx_register_intake_status_created
  ON register_intake_jobs(status, created_at);

CREATE INDEX IF NOT EXISTS idx_register_intake_locked_at
  ON register_intake_jobs(locked_at);

CREATE INDEX IF NOT EXISTS idx_register_intake_email
  ON register_intake_jobs(email);

CREATE INDEX IF NOT EXISTS idx_register_intake_investigation_job_id
  ON register_intake_jobs(investigation_job_id);

-- ── Slack daily digest tracking ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS slack_digest_runs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  window_start     TIMESTAMPTZ NOT NULL,
  window_end       TIMESTAMPTZ NOT NULL,
  prospect_count   INTEGER NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'pending',
  slack_message_ts TEXT,
  dashboard_url    TEXT,
  error            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_slack_digest_runs_status
    CHECK (status IN ('pending', 'sent', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_slack_digest_runs_window
  ON slack_digest_runs(window_start, window_end);

CREATE INDEX IF NOT EXISTS idx_slack_digest_runs_status_created
  ON slack_digest_runs(status, created_at DESC);

CREATE TABLE IF NOT EXISTS slack_digest_items (
  digest_run_id        UUID NOT NULL REFERENCES slack_digest_runs(id) ON DELETE CASCADE,
  investigation_job_id UUID NOT NULL REFERENCES investigation_jobs(id) ON DELETE CASCADE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (digest_run_id, investigation_job_id),
  CONSTRAINT uq_slack_digest_items_job UNIQUE (investigation_job_id)
);

CREATE INDEX IF NOT EXISTS idx_slack_digest_items_digest_run_id
  ON slack_digest_items(digest_run_id);
