# Backlog

**Project:** AI Company Detection Agent  
**Last updated:** 21 Mei 2026

Backlog adalah tracker status kerja. Source of truth tetap:

- Product: `docs/product/PRD.md`
- Technical: `docs/technical/TRD.md`
- Flow: `docs/technical/FLOW_MAP.md`
- AI/new chat handoff: `FETCH_CONTEXT.md`
- Current feature plan: `docs/technical/WEBHOOK_SLACK_DAILY_DIGEST_PLAN.md`
- Current build checklist: `docs/technical/WEBHOOK_SLACK_BUILDING_CHECKLIST.md`

---

## Now

### Webhook Queue + Slack Daily Digest

- [x] Add PostgreSQL migration for:
  - `register_intake_jobs`
  - `slack_digest_runs`
  - `slack_digest_items`
- [x] Change webhook final behavior to enqueue-only.
- [x] Return queued response with `intake_job_id`.
- [x] Build sequential worker for `register_intake_jobs`.
- [x] Ensure worker processes one job at a time.
- [x] Worker default path uses OpenClaw agent investigation; deterministic Go mode remains scaffold/debug only.
- [x] Worker executes finalizer with `source=webhook` after OpenClaw returns the final report.
- [x] Worker delivers every queued investigation to Telegram using OpenClaw channel delivery.
- [x] Link completed queue jobs to `investigation_jobs`.
- [x] Build Slack daily digest script.
- [x] Configure digest timer for every day at 09:00 Asia/Jakarta.
- [x] Always send heartbeat when no prospects exist.
- [x] Prospect digest includes `possible_company_affiliated` records with confidence >= 60.
- [x] Slack digest separates Hot prospect (>=75) and Warm prospect (60-74).
- [x] Include browser Sales Sheet link in every digest.
- [x] Remove dashboard detail link per prospect from Slack.
- [x] Include available website, marketplace, and social media summary per prospect.
- [x] Browser Sales Sheet shows full sales phone numbers from original register payload.
- [x] Hide raw evidence, AI reasoning, search/scrape logic, tool traces, and scoring internals from Slack.
- [x] Add dry-run command for digest preview.
- [x] Add `--test-run` Slack digest mode that does not mark production digest rows.
- [x] Add systemd unit/timer templates for worker and digest.
- [x] Deploy scheduler via systemd timer.

### Validation

- [x] Validate Telegram/OpenClaw path still works for queued investigations.
- [x] Validate webhook enqueue with sample payload.
- [x] Validate worker drains queued payloads sequentially.
- [x] Validate 14-row webhook queue simulation from register fixture plus known records.
- [x] Validate known records through webhook queue + OpenClaw agent + DB/dashboard (`falasik@gmail.com`, `nawaystore@yahoo.com`).
- [x] Validate dashboard row appears after worker processing.
- [x] Validate Slack digest with prospects in dry-run and real `--test-run`.
- [x] Validate Slack digest empty heartbeat in dry-run.
- [ ] Validate Komerce platform register flow.

---

## Next

- [ ] Improve `db_writer.js` extraction for social, marketplace, and role evidence.
- [ ] Add dashboard visibility for queue status if needed.
- [ ] Add dashboard authentication before broad exposure.
- [ ] Add rate limiting if platform traffic increases.
- [ ] Add richer observability for queue and digest jobs.

---

## Later

- [ ] Paid enrichment/search tools: Firecrawl, Tavily, enrichment APIs.
- [ ] Google CSE key if needed.
- [ ] Multi-agent parallel investigation.
- [ ] Normalize JSONB fields into dedicated analytics tables if dashboard queries require it.

---

## Done

### Go MVP

- [x] Go CLI MVP deployed to VPS.
- [x] Email intelligence.
- [x] Domain check.
- [x] Website crawler.
- [x] Scraper.
- [x] Search cascade: Google CSE if configured, Brave, Bing, DDG fallback.
- [x] Deterministic scoring.
- [x] Report formatting.
- [x] File-based evidence store.
- [x] `go test ./...` passing when last verified.
- [x] `deploy.sh` syncs project to VPS.

### AI Reasoning Loop

- [x] OpenClaw agent behavior in `AGENTS.md`.
- [x] Persistent runtime instructions in `STANDING_ORDERS.md`.
- [x] Tool catalog and scoring rules.
- [x] Qwen3.6 Flash via Sumopod configured.
- [x] Stop conditions and anti-hallucination rules.
- [x] Token/cost display via `token_usage.sh`.

### Tool Expansion

- [x] `brandhint` Go package.
- [x] `sociallinks` Go package.
- [x] `rolesignal` Go package.

### Storage And Dashboard

- [x] PostgreSQL 16 on VPS.
- [x] Database `company_detection`.
- [x] Tables: `investigation_jobs`, `final_reports`, `llm_calls`.
- [x] `migration_v1.sql`.
- [x] `db_writer.js`.
- [x] `finish_investigation.sh` calls DB writer.
- [x] Express + EJS dashboard.
- [x] Dashboard list, filters, pagination, search.
- [x] Dashboard job detail.
- [x] Review status updates.
- [x] LLM cost display.

### Webhook API And Queue

- [x] Express webhook service.
- [x] `GET /health`.
- [x] `POST /webhook/check`.
- [x] Shared secret auth.
- [x] Deterministic check scaffold exists.
- [x] Enqueue-only production behavior.
- [x] Sequential worker linked to OpenClaw agent and finalizer.

### Documentation

- [x] PRD updated as product source of truth.
- [x] TRD updated as technical source of truth.
- [x] Flow map updated.
- [x] Webhook + Slack daily digest plan added.
- [x] Webhook + Slack building checklist added.
- [x] `FETCH_CONTEXT.md` updated for future AI agents.
- [x] `CONTEXT.md` reduced to pointer.

---

## Active Services

| Service | Port | Purpose |
|---|---:|---|
| `openclaw-gateway` | 18789 | OpenClaw gateway |
| `company-dashboard` | 3001 | Dashboard |
| `company-webhook` | 3002 | Webhook enqueue API |
| `company-register-worker` | - | Sequential register queue worker |
| `company-slack-digest.timer` | - | Daily Slack prospect digest at 09:00 WIB |
| `postgresql` | 5432 | Database |

---

## Important Files

| File | Purpose |
|---|---|
| `FETCH_CONTEXT.md` | Canonical handoff for future AI agents |
| `docs/product/PRD.md` | Product source of truth |
| `docs/technical/TRD.md` | Technical source of truth |
| `docs/technical/FLOW_MAP.md` | Runtime flow |
| `docs/technical/WEBHOOK_SLACK_DAILY_DIGEST_PLAN.md` | Implemented webhook/Slack workflow note |
| `docs/technical/WEBHOOK_SLACK_BUILDING_CHECKLIST.md` | Implementation and validation checklist |
| `docs/technical/migration_v1.sql` | Current PostgreSQL schema |
| `openclaw_workspace/AGENTS.md` | Agent behavior |
| `openclaw_workspace/STANDING_ORDERS.md` | Runtime standing orders |
| `openclaw_workspace/scripts/company_check_go.sh` | Go wrapper |
| `openclaw_workspace/scripts/finish_investigation.sh` | Finalizer |
| `openclaw_workspace/scripts/db_writer.js` | DB writer |
| `dashboard/app.js` | Dashboard service |
| `webhook/app.js` | Webhook service |
| `webhook/worker.js` | Sequential register queue worker |
| `openclaw_workspace/scripts/slack_daily_digest.js` | Daily Slack prospect digest and test-run preview |

---

## Legacy

Old Node.js investigation scripts have been replaced by Go packages and moved under:

```text
openclaw_workspace/scripts/_legacy/
```

Archived planning docs live in:

```text
docs/archive/
```
# Google Review Monitor

- [ ] Obtain and install an authorized Google Maps authenticated Playwright
      storage-state through a secure channel.
- [ ] Run authenticated collector acceptance test against the direct Komerce
      Maps place URL.
- [ ] Enable the opt-in `review-monitor` Compose profile only after collection,
      deduplication, Telegram, and failure-alert checks pass.
