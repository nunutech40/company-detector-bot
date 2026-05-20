# Technical Requirements Document

**Project:** AI Company Detection Agent  
**Version:** v7  
**Status:** Active technical source of truth  
**Last updated:** 20 Mei 2026

---

## 1. System Overview

AI Company Detection Agent is a hybrid deterministic + agentic investigation system.

Primary responsibilities:

- Accept investigation input from Telegram, webhook, or manual CLI.
- Run deterministic checks in Go.
- Allow OpenClaw AI to reason over evidence and call tools when deeper investigation is needed.
- Produce deterministic classification and confidence score.
- Persist evidence to files and PostgreSQL.
- Expose operator dashboard and platform webhook API.

---

## 2. Runtime Architecture

```text
Telegram / Webhook / Manual CLI
        |
        v
OpenClaw workspace + Go binary
        |
        v
company_check_go.sh
        |
        v
go-service/cmd/company-check
        |
        +--> emailintel
        +--> domaincheck
        +--> crawler
        +--> search cascade
        +--> scraper
        +--> brandhint / sociallinks / rolesignal
        +--> scoring
        +--> evidence/report
        |
        v
finish_investigation.sh
        |
        +--> db_writer.js --> PostgreSQL
        +--> smart Slack routing
        +--> token_usage.sh
        |
        v
Dashboard / Telegram / Slack
```

AI reasoning runs inside OpenClaw. It must use the deterministic tools as evidence sources and must finish by calling `finish_investigation.sh`.

---

## 3. Repositories And Main Paths

| Path | Responsibility |
|---|---|
| `go-service/` | Deterministic Go CLI and packages |
| `openclaw_workspace/` | Agent prompt, standing orders, tool catalog, runtime scripts |
| `dashboard/` | Express + EJS internal dashboard |
| `webhook/` | Express webhook API |
| `docs/technical/migration_v1.sql` | PostgreSQL schema |
| `docs/` | Product and technical documentation |

---

## 4. Go Service Components

| Component | Responsibility |
|---|---|
| `cmd/company-check` | Main CLI |
| `cmd/last-report` | Read latest saved report |
| `cmd/tool-status` | Tool status command |
| `internal/emailintel` | Email parsing and heuristics |
| `internal/domaincheck` | DNS/MX/website checks |
| `internal/crawler` | Lightweight website crawler |
| `internal/search` | Search provider cascade |
| `internal/scraper` | Page fetch/extraction |
| `internal/scoring` | Deterministic scoring/classification |
| `internal/report` | Report formatting |
| `internal/evidence` | Evidence JSON storage |
| `internal/slack` | Slack delivery helper |
| `internal/brandhint` | Brand/local-part analysis |
| `internal/sociallinks` | Social link extraction |
| `internal/rolesignal` | Owner/founder/CEO role signals |

CLI input contract:

```text
--email        required
--full-name    optional
--no-hp        optional, confirmation only
--brand-name   optional
--json         optional JSON output
--save         save evidence/report
```

---

## 5. OpenClaw Runtime

| File | Responsibility |
|---|---|
| `openclaw_workspace/AGENTS.md` | Investigation policy and agent behavior |
| `openclaw_workspace/STANDING_ORDERS.md` | Persistent session instructions |
| `openclaw_workspace/TOOLS.md` | Runtime tool notes |
| `openclaw_workspace/config/tool_catalog.yaml` | Tool availability/cost tiers |
| `openclaw_workspace/config/scoring_rules.yaml` | Scoring and classification notes |

AI rules:

- Do not invent evidence.
- Do not use failed tools as negative evidence.
- Respect max rounds/tool budget.
- Deterministic scoring is source of truth.
- Always finalize with `finish_investigation.sh`.

---

## 6. Storage Model

The system stores results in both file evidence and PostgreSQL.

### File Storage

Used for audit/debug and compatibility with the original MVP.

```text
openclaw_workspace/evidence/*.json
openclaw_workspace/evidence/latest.json
openclaw_workspace/reports/ai_report_latest.txt
```

### PostgreSQL

Database: `company_detection` on PostgreSQL 16.

Current MVP schema intentionally uses 3 tables instead of the older 7/8-table plan.

#### `investigation_jobs`

One row per investigation.

Key fields:

- Identity: `id`, `email`, `domain`, `full_name`, `brand_name`, `source`
- Classification: `classification`, `confidence_score`, `confidence_label`, `automation_action`, `review_status`
- Business/person: `business_name`, `business_industry`, `business_website`, `business_city`, `business_address`, `person_name`, `person_role`, `phone_confirmed`
- JSONB findings: `marketplace_json`, `social_media_json`, `role_evidence_json`
- Timestamps: `started_at`, `finished_at`, `created_at`

#### `final_reports`

Stores full report text and raw JSON:

- `job_id`
- `telegram_text`
- `slack_text`
- `json_result`
- `sent_to_slack_at`

#### `llm_calls`

Tracks model usage and estimated cost:

- `model_provider`
- `model_name`
- `prompt_tokens`
- `completion_tokens`
- `total_tokens`
- `cost_usd`
- previews and timestamp

Schema source: `docs/technical/migration_v1.sql`.

---

## 7. Database Writer

File: `openclaw_workspace/scripts/db_writer.js`

Responsibilities:

- Read `evidence/latest.json`.
- Read `reports/ai_report_latest.txt`.
- Extract structured fields for dashboard.
- Extract social/marketplace/role evidence from evidence/report text.
- Read OpenClaw token usage when available.
- Insert into `investigation_jobs`, `final_reports`, and `llm_calls`.

Operational requirement:

- DB write failure must not block Telegram/report delivery.
- `DATABASE_URL` is loaded from environment/systemd env.
- The writer currently uses pragmatic parsing; richer extraction is next priority.

---

## 8. Dashboard

Path: `dashboard/`  
Stack: Node.js, Express, EJS, `pg`  
Port: `3001`  
Service: `company-dashboard`

Routes:

- `GET /` — investigation list, filters, pagination, stats.
- `GET /jobs/:id` — detail page.
- `POST /jobs/:id/review` — update review status.
- `GET /search?q=...` — search across key fields and JSONB text.

Dashboard reads directly from PostgreSQL.

---

## 9. Webhook API

Path: `webhook/`  
Stack: Node.js, Express  
Port: `3002`  
Service: `company-webhook`

Status: service scaffold is live, but production DB integration is part of the final webhook/Slack phase. The already validated persistence path is `finish_investigation.sh -> db_writer.js -> PostgreSQL`.

Routes:

- `GET /health`
- `POST /webhook/check`

Request body:

```json
{
  "email": "user@example.com",
  "full_name": "Nama User",
  "no_hp": "08123456789",
  "brand_name": "Nama Brand",
  "secret": "<shared-secret>"
}
```

Response includes:

- `ok`
- `email`
- `classification`
- `confidence_score`
- `confidence_label`
- `automation_action`
- `company_detected`
- `summary`
- `dashboard_url`

Current webhook runs the deterministic Go binary and returns a fast JSON response. The final production step is to align webhook evidence output with `db_writer.js` so the exact webhook request is persisted reliably. Full async queue/worker is future work.

---

## 10. Delivery

| Surface | Current Behavior |
|---|---|
| Telegram | Main interactive testing/AI delivery channel |
| Dashboard | Persistent operator interface |
| Slack | Intended only for high-confidence business alerts |
| Webhook response | Fast deterministic result; final DB integration pending |

Smart Slack routing rule:

```text
possible_company_affiliated AND confidence_score >= 75 => Slack
otherwise => DB/dashboard only
```

---

## 11. Deployment

Current production deployment is VPS + systemd, not Docker Compose.

VPS:

- Host: `103.226.139.107`
- User: `nunuopc`
- Workspace: `/home/nunuopc/.openclaw/workspace/`
- Go binary: `/home/nunuopc/.openclaw/go-service/bin/company-check`

Services:

| Service | Port | Responsibility |
|---|---:|---|
| `openclaw-gateway` | 18789 | OpenClaw gateway |
| `company-dashboard` | 3001 | Dashboard |
| `company-webhook` | 3002 | Webhook API |
| `postgresql` | 5432 | Database |

Deploy command from repo root:

```bash
bash deploy.sh
```

---

## 12. Configuration

Credentials live on VPS env files and must not be committed.

Important variables:

- `DATABASE_URL`
- `BRAVE_SEARCH_API_KEY`
- `SLACK_BOT_TOKEN`
- `SLACK_REPORT_CHANNEL`
- `WEBHOOK_SECRET`
- `OPENCLAW_BASE_URL`
- Optional: `GOOGLE_CSE_KEY`, `GOOGLE_CSE_ID`

---

## 13. Security Requirements

- Keep secrets in environment files only.
- Webhook must validate shared secret.
- `no_hp` must not be used as a public search query.
- Dashboard is internal; add auth before exposing broadly.
- Avoid storing unnecessary PII beyond investigation requirement.
- Reports must preserve evidence source so decisions are auditable.

---

## 14. Observability

Current:

- `token_usage.sh` reads model pricing from OpenClaw config.
- `llm_calls` stores token and estimated cost.
- Dashboard shows cost per job.
- Script logs are available through shell/systemd.

Future:

- Structured service logs.
- Queue metrics.
- Alert delivery success/failure tracking.
- Dashboard usage/audit events.

---

## 15. Test Requirements

Core verification:

```bash
cd go-service
go test ./...
```

Manual E2E:

- Telegram `/check contact@komerce.id`
- Confirm dashboard row appears.
- Confirm job detail contains report, social/marketplace where available, and LLM cost.
- Webhook `POST /webhook/check`.
- Confirm response classification and DB insert.

---

## 16. Roadmap

### Done

- Go MVP.
- AI reasoning loop.
- Tool catalog expansion.
- PostgreSQL + dashboard.
- Webhook API scaffold.

### Next

- E2E Telegram validation.
- Finalize webhook DB path and validate from Komerce platform register.
- Improve `db_writer.js` extraction quality.
- Finalize Slack hook with smart routing after validation.

### Later

- Queue/worker with retry and idempotency.
- Dashboard authentication.
- Paid enrichment/search tools.
- Multi-agent parallel investigation.
- Normalize JSONB fields into dedicated analytics tables if query needs grow.
