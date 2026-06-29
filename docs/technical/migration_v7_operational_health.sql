-- Company Detection DB Migration
-- Version: 7.0.0 - prioritized backlog replay and deduplicated operational alerts.

ALTER TABLE register_intake_jobs
  ADD COLUMN IF NOT EXISTS queue_priority INTEGER NOT NULL DEFAULT 100;

CREATE INDEX IF NOT EXISTS idx_register_intake_priority_schedule
  ON register_intake_jobs(status, next_attempt_at, queue_priority DESC, created_at);

CREATE TABLE IF NOT EXISTS operational_incidents (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_key            TEXT NOT NULL,
  incident_kind          TEXT NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'suspected',
  fingerprint            TEXT,
  consecutive_checks     INTEGER NOT NULL DEFAULT 1,
  success_checks         INTEGER NOT NULL DEFAULT 0,
  evidence_count         INTEGER NOT NULL DEFAULT 1,
  summary                TEXT,
  metadata_json          JSONB NOT NULL DEFAULT '{}'::jsonb,
  opened_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  alerted_at             TIMESTAMPTZ,
  resolved_at            TIMESTAMPTZ,
  recovery_alerted_at    TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_operational_incident_status
    CHECK (status IN ('suspected', 'open', 'resolved'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_operational_active_incident
  ON operational_incidents(feature_key, incident_kind)
  WHERE status IN ('suspected', 'open');

CREATE INDEX IF NOT EXISTS idx_operational_incidents_history
  ON operational_incidents(feature_key, incident_kind, created_at DESC);
