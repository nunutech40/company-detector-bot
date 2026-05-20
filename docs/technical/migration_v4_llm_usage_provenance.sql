-- Company Detection DB Migration
-- Version: 4.0.0 — 2026-05-20
--
-- Remove copied aggregate LLM usage from deterministic fallback jobs. Those
-- jobs did not call an LLM, so their llm_calls rows are misleading.

DELETE FROM llm_calls l
USING final_reports fr
WHERE l.job_id = fr.job_id
  AND fr.report_source = 'deterministic_fallback';
