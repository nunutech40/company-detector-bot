# Company Detection Tool Notes

This workspace is for the Company Detection Telegram MVP.

## Current Runtime

- OpenClaw Gateway runs on the VPS.
- Default model: `minimax/MiniMax-M2.7`.
- Telegram bot: `@company_detector_bot`.
- Delivery channel: Telegram DM.

## Tool Availability

- `email_intelligence`: enabled, `node scripts/email_intelligence.js <email>`.
- `domain_checker`: enabled, `node scripts/domain_checker.js <domain>`.
- `company_check`: enabled, `node scripts/company_check.js <email> --save`.
- `scoring_engine`: enabled, called by `company_check`; standalone accepts JSON on stdin via `node scripts/scoring_engine.js`.
- `website_crawler_router`: enabled, called by `company_check`; standalone `node scripts/website_crawler_router.js <domain>`.
- `serp_query_builder`: enabled, called by `company_check`; builds search queries while search provider is not configured.
- `report_formatter`: enabled, called by `company_check`; formats Telegram-safe report.
- `evidence_store`: enabled via `company_check --save`; writes JSON to `evidence/` and report text to `reports/`.
- `tool_status`: enabled, `node scripts/tool_status.js`.
- `last_report`: enabled, `node scripts/last_report.js [email]`.
- `web_search`: check_runtime / provider not configured yet.
- `web_fetch`: check_runtime.
- `firecrawl_scrape`: disabled_waiting_budget.
- `tavily_search`: disabled_waiting_budget.
- `enrichment_api`: disabled_waiting_budget.
- `browser`: optional, skipped for Telegram MVP unless needed.

## Operational Rule

If a tool is not available, do not fail the whole report. Mark it as skipped/not_configured and continue with the evidence available.

## Important

For `/check` requests, run `company_check` and return its report. Do not ask follow-up questions for a valid email.

For `/tool_status`, run `tool_status` and return its report.

For `/last_report`, run `last_report` and return the saved report.

Evidence retention defaults:
- evidence JSON files: keep latest 1000
- report text files: keep latest 1000
- audit lines: keep latest 5000

Override with `COMPANY_DETECTION_MAX_EVIDENCE_FILES`, `COMPANY_DETECTION_MAX_REPORT_FILES`, and `COMPANY_DETECTION_MAX_AUDIT_LINES`.
