-- Company Detection DB Migration
-- Version: 6.0.0 - durable investigation retries and operational incidents.

ALTER TABLE register_intake_jobs
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS error_class TEXT,
  ADD COLUMN IF NOT EXISTS last_provider TEXT,
  ADD COLUMN IF NOT EXISTS last_model TEXT,
  ADD COLUMN IF NOT EXISTS config_fingerprint TEXT;

ALTER TABLE register_intake_jobs
  DROP CONSTRAINT IF EXISTS chk_register_intake_jobs_status;

ALTER TABLE register_intake_jobs
  ADD CONSTRAINT chk_register_intake_jobs_status
  CHECK (status IN (
    'pending',
    'retry_pending',
    'blocked_provider',
    'processing',
    'completed',
    'failed',
    'skipped'
  ));

CREATE INDEX IF NOT EXISTS idx_register_intake_retry_schedule
  ON register_intake_jobs(status, next_attempt_at, created_at);

CREATE TABLE IF NOT EXISTS register_worker_incidents (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_type          TEXT NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'open',
  error_class            TEXT,
  provider               TEXT,
  model                  TEXT,
  message                TEXT,
  occurrence_count       INTEGER NOT NULL DEFAULT 1,
  opened_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at            TIMESTAMPTZ,
  alert_sent_at          TIMESTAMPTZ,
  recovery_alert_sent_at TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_register_worker_incident_status
    CHECK (status IN ('open', 'resolved'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_register_worker_open_incident
  ON register_worker_incidents(incident_type)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_register_worker_incidents_created
  ON register_worker_incidents(created_at DESC);
