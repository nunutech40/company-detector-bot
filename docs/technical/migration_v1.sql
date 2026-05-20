-- Company Detection DB Migration
-- Version: 1.0.0 — 2026-05-19

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Tabel 1: investigation_jobs ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS investigation_jobs (
  -- Identity
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email               TEXT NOT NULL,
  domain              TEXT,
  full_name           TEXT,
  brand_name          TEXT,
  source              TEXT NOT NULL DEFAULT 'telegram',

  -- Classification
  classification      TEXT,
  confidence_score    INTEGER,
  confidence_label    TEXT,
  automation_action   TEXT,
  review_status       TEXT NOT NULL DEFAULT 'unreviewed',

  -- Business Profile
  business_name       TEXT,
  business_industry   TEXT,
  business_website    TEXT,
  business_city       TEXT,
  business_address    TEXT,

  -- Person
  person_name         TEXT,
  person_role         TEXT,
  phone_confirmed     BOOLEAN DEFAULT false,

  -- Structured findings (JSONB — queryable)
  marketplace_json    JSONB DEFAULT '[]'::jsonb,
  social_media_json   JSONB DEFAULT '[]'::jsonb,
  role_evidence_json  JSONB DEFAULT '[]'::jsonb,

  -- Timestamps
  started_at          TIMESTAMPTZ,
  finished_at         TIMESTAMPTZ DEFAULT NOW(),
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jobs_email          ON investigation_jobs(email);
CREATE INDEX IF NOT EXISTS idx_jobs_classification ON investigation_jobs(classification);
CREATE INDEX IF NOT EXISTS idx_jobs_confidence     ON investigation_jobs(confidence_score);
CREATE INDEX IF NOT EXISTS idx_jobs_created_at     ON investigation_jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_review_status  ON investigation_jobs(review_status);
CREATE INDEX IF NOT EXISTS idx_jobs_marketplace    ON investigation_jobs USING GIN (marketplace_json);
CREATE INDEX IF NOT EXISTS idx_jobs_social_media   ON investigation_jobs USING GIN (social_media_json);

-- ── Tabel 2: final_reports ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS final_reports (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id           UUID REFERENCES investigation_jobs(id) ON DELETE CASCADE UNIQUE,
  telegram_text    TEXT,
  slack_text       TEXT,
  json_result      JSONB,
  sent_to_slack_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reports_job_id ON final_reports(job_id);

-- ── Tabel 3: llm_calls ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS llm_calls (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id            UUID REFERENCES investigation_jobs(id) ON DELETE CASCADE,
  model_provider    TEXT NOT NULL,
  model_name        TEXT NOT NULL,
  prompt_tokens     INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  total_tokens      INTEGER DEFAULT 0,
  cost_usd          NUMERIC(10,6) DEFAULT 0,
  prompt_preview    TEXT,
  response_preview  TEXT,
  called_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_llm_calls_job_id ON llm_calls(job_id);
