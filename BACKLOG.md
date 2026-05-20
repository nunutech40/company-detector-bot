# Backlog

**Project:** AI Company Detection Agent  
**Last updated:** 20 Mei 2026

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
- [x] Link completed queue jobs to `investigation_jobs`.
- [x] Build Slack daily digest script.
- [x] Configure digest timer for every day at 09:00 Asia/Jakarta.
- [x] Always send heartbeat when no prospects exist.
- [x] Include dashboard home link in every digest.
- [x] Include dashboard detail link per prospect.
- [x] Hide raw evidence, AI reasoning, search/scrape logic, tool traces, and scoring internals from Slack.
- [x] Add dry-run command for digest preview.
- [x] Add systemd unit/timer templates for worker and digest.
- [x] Deploy scheduler via systemd timer.

### Validation

- [ ] Validate Telegram/OpenClaw path still works.
- [x] Validate webhook enqueue with sample payload.
- [x] Validate worker drains queued payloads sequentially.
- [x] Validate dashboard row appears after worker processing.
- [x] Validate Slack digest with prospects in dry-run.
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

### Webhook API Scaffold

- [x] Express webhook service.
- [x] `GET /health`.
- [x] `POST /webhook/check`.
- [x] Shared secret auth.
- [x] Deterministic check scaffold exists.

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
| `company-webhook` | 3002 | Webhook API scaffold |
| `postgresql` | 5432 | Database |

---

## Important Files

| File | Purpose |
|---|---|
| `FETCH_CONTEXT.md` | Canonical handoff for future AI agents |
| `docs/product/PRD.md` | Product source of truth |
| `docs/technical/TRD.md` | Technical source of truth |
| `docs/technical/FLOW_MAP.md` | Runtime flow |
| `docs/technical/WEBHOOK_SLACK_DAILY_DIGEST_PLAN.md` | Current feature plan |
| `docs/technical/WEBHOOK_SLACK_BUILDING_CHECKLIST.md` | Current build checklist |
| `docs/technical/migration_v1.sql` | Current PostgreSQL schema |
| `openclaw_workspace/AGENTS.md` | Agent behavior |
| `openclaw_workspace/STANDING_ORDERS.md` | Runtime standing orders |
| `openclaw_workspace/scripts/company_check_go.sh` | Go wrapper |
| `openclaw_workspace/scripts/finish_investigation.sh` | Finalizer |
| `openclaw_workspace/scripts/db_writer.js` | DB writer |
| `dashboard/app.js` | Dashboard service |
| `webhook/app.js` | Webhook service |

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
