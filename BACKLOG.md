# Backlog

**Project:** AI Company Detection Agent  
**Last updated:** 20 Mei 2026

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
- [x] Runs deterministic Go check.
- [x] Returns classification, confidence, action, and dashboard URL.
- [ ] Production DB write path from webhook is finalized.
- [ ] Komerce register flow validation is done.

### Documentation

- [x] PRD updated as product source of truth.
- [x] TRD updated as technical source of truth.
- [x] Flow map updated.
- [x] DB/dashboard docs updated to implemented 3-table schema.
- [x] Webhook API doc updated.
- [x] Fetch context file added for future AI agents.

---

## Next Priority

### 1. Telegram End-To-End Validation

- [ ] Send `/check contact@komerce.id` from Telegram.
- [ ] Confirm row appears in dashboard.
- [ ] Confirm job detail shows AI report.
- [ ] Confirm LLM cost appears.
- [ ] Confirm social/marketplace extraction where evidence exists.

### 2. Finalize Webhook Integration With Komerce Platform

- [ ] Share webhook URL and secret through secure channel.
- [ ] Align webhook evidence path with DB writer path.
- [ ] Trigger from real/staging register flow.
- [ ] Confirm JSON response.
- [ ] Confirm DB/dashboard row.
- [ ] Confirm timeout behavior is acceptable.

### 3. Finalize Slack Smart Routing

- [ ] Verify current smart routing logic.
- [ ] Re-enable delivery hook only after DB/testing is stable.
- [ ] Ensure personal/unknown cases do not send Slack.
- [ ] Ensure high-confidence business cases do send Slack.

### 4. Improve `db_writer.js` Extraction

- [ ] Better parse marketplace URLs and metrics.
- [ ] Better parse social profiles and handles.
- [ ] Better parse role evidence quotes.
- [ ] Reduce duplicate JSONB entries.

---

## Later

- [ ] Dashboard authentication.
- [ ] Queue/worker for webhook jobs.
- [ ] Rate limiting and idempotency key.
- [ ] Paid tools: Firecrawl, Tavily, enrichment APIs.
- [ ] Google CSE key if needed.
- [ ] Multi-agent parallel investigation.
- [ ] Normalize JSONB fields into dedicated analytics tables if dashboard queries require it.

---

## Active Services

| Service | Port | Purpose |
|---|---:|---|
| `openclaw-gateway` | 18789 | OpenClaw gateway |
| `company-dashboard` | 3001 | Dashboard |
| `company-webhook` | 3002 | Webhook API |
| `postgresql` | 5432 | Database |

---

## Important Files

| File | Purpose |
|---|---|
| `FETCH_CONTEXT.md` | Fast project context for future AI agents |
| `docs/product/PRD.md` | Product source of truth |
| `docs/technical/TRD.md` | Technical source of truth |
| `docs/technical/FLOW_MAP.md` | Runtime flow |
| `docs/technical/migration_v1.sql` | PostgreSQL schema |
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

The historical Telegram MVP building plan lives in:

```text
docs/archive/BUILDING_PLAN_OPENCLAW_TELEGRAM_MVP.md
```
