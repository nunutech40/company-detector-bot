-- Company Detection DB Migration
-- Version: 3.0.0 — 2026-05-20
--
-- Add explicit report provenance so dashboard reviewers can distinguish
-- OpenClaw AI reasoning reports from deterministic fallback/scaffold reports.

ALTER TABLE final_reports
  ADD COLUMN IF NOT EXISTS report_source TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS report_quality TEXT NOT NULL DEFAULT 'unknown';

CREATE INDEX IF NOT EXISTS idx_reports_source ON final_reports(report_source);

-- Repair old scaffold rows that accidentally copied a stale smoke report into
-- final_reports.telegram_text while their real Go fallback report is stored in
-- json_result.telegram_report.
UPDATE final_reports
SET telegram_text = COALESCE(NULLIF(json_result->>'telegram_report', ''), telegram_text),
    report_source = 'deterministic_fallback',
    report_quality = 'fallback'
WHERE telegram_text LIKE 'Smoke report.%';

UPDATE final_reports
SET report_source = 'ai_reasoning',
    report_quality = 'full_investigation'
WHERE telegram_text ILIKE '%Round%'
  AND telegram_text ILIKE '%Company Detection Report%'
  AND report_source = 'unknown';

UPDATE final_reports
SET report_source = 'deterministic_fallback',
    report_quality = 'fallback'
WHERE telegram_text ILIKE '%FALLBACK MODE%'
  AND report_source = 'unknown';
