# Company Detection Tool Notes

This workspace is for the Company Detection Telegram MVP.

## Current Runtime

- OpenClaw Gateway runs on the VPS.
- Default model: `minimax/MiniMax-M2.7`.
- Telegram bot: `@company_detector_bot`.
- Delivery channel: Telegram DM.
- Primary company detection runtime: Go CLI via `scripts/company_check_go.sh`.
- Node.js scripts remain available only as rollback/reference helpers.

## Tool Availability

- `company_check`: enabled, `scripts/company_check_go.sh --email <email> --save`.
- `company_check` register package: enabled, `scripts/company_check_go.sh --email <email> --full-name "..." --no-hp "..." --brand-name "..." --save`.
- `email_intelligence`: implemented in Go package `../go-service/internal/emailintel`.
- `domain_checker`: implemented in Go package `../go-service/internal/domaincheck`.
- `batch_csv_check`: enabled, `node scripts/batch_csv_check.js <csv_file> [--limit N] [--save]`; processes rows sequentially.
- `scoring_engine`: implemented in Go package `../go-service/internal/scoring`.
- `website_crawler_router`: implemented in Go package `../go-service/internal/crawler`.
- `serp_query_builder`: implemented in Go package `../go-service/internal/query`.
- `ddg_search`: implemented in Go package `../go-service/internal/search`; source reliability is low.
- `free_scraper`: implemented in Go package `../go-service/internal/scraper`; source reliability is low.
- `report_formatter`: implemented in Go package `../go-service/internal/report`.
- `evidence_store`: enabled via `company_check --save`; Go writes JSON to `evidence/` and report text to `reports/`.
- `tool_status`: enabled, `node scripts/tool_status.js`.
- `last_report`: enabled, `node scripts/last_report.js [email]`.
- `web_search`: enabled via `ddg_search` fallback; dedicated provider not configured yet.
- `web_fetch`: check_runtime.
- `firecrawl_scrape`: disabled_waiting_budget.
- `tavily_search`: disabled_waiting_budget.
- `enrichment_api`: disabled_waiting_budget.
- `browser`: optional, skipped for Telegram MVP unless needed.
- `slack_reporter`: optional; Go only sends when `--send-slack` is passed and `SLACK_BOT_TOKEN` + `SLACK_REPORT_CHANNEL` are configured.

## Operational Rule

If a tool is not available, do not fail the whole report. Mark it as skipped/not_configured and continue with the evidence available.

Fallback/error rules:
- Put a tool in `tools_used` only after it successfully runs.
- Put failed lightweight tools such as `ddg_search` and `free_scraper` in `tool_errors`.
- Put unavailable/budget-disabled tools in `tools_skipped`.
- DDG/free scraper evidence is low reliability and should only add small confidence deltas.
- Browser fallback is optional in MVP. If lightweight web evidence exists, use `skipped_not_needed_for_mvp`; otherwise use `optional_fallback_disabled_for_mvp`.

## Important

For `/check` requests, run `company_check` and return its report. Do not ask follow-up questions for a valid email.

For `/tool_status`, run `tool_status` and return its report.

For `/last_report`, run `last_report` and return the saved report.

Evidence retention defaults:
- evidence JSON files: keep latest 1000
- report text files: keep latest 1000
- audit lines: keep latest 5000

Override with `COMPANY_DETECTION_MAX_EVIDENCE_FILES`, `COMPANY_DETECTION_MAX_REPORT_FILES`, and `COMPANY_DETECTION_MAX_AUDIT_LINES`.
