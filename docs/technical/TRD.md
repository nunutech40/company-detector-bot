# Technical Requirements Document

**Project:** AI Company Detection Agent  
**Version:** v7  
**Status:** Active technical source of truth  
**Last updated:** 21 Mei 2026

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
- Queue platform register payloads and process them sequentially.
- Send one daily Slack prospect digest at 09:00 Asia/Jakarta.

---

## 2. Runtime Architecture

```text
Telegram / Manual CLI
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
        +--> token_usage.sh
        |
        v
Dashboard / Telegram

Platform Register
        |
        v
Webhook intake service
        |
        v
PostgreSQL table register_intake_jobs
        |
        v
Sequential worker
        |
        v
OpenClaw workspace + Go binary
        |
        v
finish_investigation.sh
        |
        v
db_writer.js --> PostgreSQL company_detection

Daily 09:00 cron
        |
        v
Slack prospect digest reads PostgreSQL company_detection
        |
        v
Slack channel + Sales Sheet link
```

AI reasoning runs inside OpenClaw. It must use the deterministic tools as evidence sources and must finish by calling `finish_investigation.sh`.

Slack delivery is not part of the AI reasoning loop. Slack reads finalized data from PostgreSQL and sends a sales-ready digest once per day.

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
- `report_source`: `ai_reasoning`, `deterministic_fallback`, or `unknown`
- `report_quality`: `full_investigation`, `fallback`, or `unknown`
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

LLM usage rules:

- `ai_reasoning` jobs store per-job usage returned by the OpenClaw agent run.
- `deterministic_fallback` jobs must not create `llm_calls` rows.
- Aggregate usage from `openclaw sessions --json` is fallback-only and should not be used for queue jobs.

Schema sources:

- `docs/technical/migration_v1.sql`
- `docs/technical/migration_v2_webhook_slack_queue.sql`

### Planned Final-Phase Tables

Webhook queue and Slack digest require a small schema extension. The queue is a PostgreSQL-backed queue table, not a separate Redis/RabbitMQ service. The exact migration should be created during implementation, but the expected model is:

#### `register_intake_jobs`

One row per payload received from platform register.

Key fields:

- `id`
- `source`
- `external_id` or `idempotency_key`
- `payload_json`
- `email`, `full_name`, `brand_name`, `no_hp_masked`
- `status`: `pending`, `processing`, `completed`, `failed`, `skipped`
- `attempt_count`
- `last_error`
- `locked_at`, `processed_at`, `created_at`, `updated_at`
- `investigation_job_id`

#### `slack_digest_runs`

One row per daily Slack digest execution.

Key fields:

- `id`
- `window_start`, `window_end`
- `prospect_count`
- `status`: `sent`, `failed`
- `slack_message_ts`
- `dashboard_url`
- `error`
- `created_at`

#### `slack_digest_items`

Join table that records which investigation jobs have already appeared in a digest.

Key fields:

- `digest_run_id`
- `investigation_job_id`
- `created_at`

This prevents repeated Slack prospect items across days.

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

Status: live enqueue-only API. The webhook stores register payloads in PostgreSQL and returns quickly; the sequential worker performs the heavy investigation later. The validated persistence path is `OpenClaw agent -> finish_investigation.sh -> db_writer.js -> PostgreSQL`.

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

Intake response includes:

- `ok`
- `email`
- `queued`
- `intake_job_id`
- `status`
- `dashboard_url`

Webhook rules:

- Do not run the full investigation inside the HTTP request.
- Validate auth and payload.
- Normalize fields.
- Insert into PostgreSQL table `register_intake_jobs`.
- Return quickly to the caller.
- Let the worker process pending jobs one at a time.

---

## 10. Queue Worker

The worker processes PostgreSQL table `register_intake_jobs` sequentially.

Responsibilities:

- Select the oldest `pending` job.
- Lock it by marking `processing` with `locked_at`.
- Run the OpenClaw agent investigation path by default.
- Use the Go deterministic path only when `REGISTER_WORKER_MODE=deterministic` is set for scaffold/debug.
- Execute `finish_investigation.sh --source webhook` after OpenClaw returns the final report.
- Store output through `db_writer.js`.
- Attach resulting `investigation_job_id` to the intake job.
- Mark `completed`, `failed`, or `skipped`.
- Retry transient failures with a max attempt limit.

Concurrency:

- Default concurrency is `1`.
- A job must complete or fail before the next job starts.
- This protects search/API limits and keeps AI/tool cost predictable for around 100 register payloads per day.

Failure handling:

- Tool failure inside investigation is not automatically queue failure if a valid classification/report is produced.
- Infrastructure failure should increment `attempt_count`.
- After max attempts, keep the payload as `failed` for dashboard/developer review.

---

## 11. Delivery

| Surface | Current Behavior |
|---|---|
| Telegram | Mandatory per-investigation delivery channel |
| Dashboard | Persistent operator interface |
| Slack | Daily 09:00 prospect digest for sales/stakeholders |
| Webhook response | Fast queue acknowledgement; no direct investigation in final design |

Slack digest prospect selection rule:

```text
possible_company_affiliated AND confidence_score >= 60 => Slack
confidence_score >= 75 => Hot prospect
confidence_score 60-74 => Warm prospect
otherwise => not listed as prospect
```

Slack digest behavior:

- Runs every day at `09:00 Asia/Jakarta`.
- Sends one message per day.
- Always sends a heartbeat, even if no prospects are found.
- Includes Sales Sheet link.
- Does not include dashboard detail links per prospect.
- Includes available website, marketplace, and social media summary per prospect.
- Supports `--test-run` for Slack preview without inserting `slack_digest_runs` or `slack_digest_items`.
- Does not include raw evidence, AI reasoning, tool traces, scraping logic, or internal score breakdown.
- Records sent jobs in `slack_digest_items` so prospects are not repeated.
- Realtime Slack forwarding from Telegram messages is disabled; Slack must read finalized DB rows only.

Scheduler options:

- Preferred deterministic implementation: system cron or systemd timer runs a Node.js digest script.
- OpenClaw Gateway cron is acceptable if the deployed gateway has `cron` enabled and Slack delivery configured. OpenClaw docs describe built-in `cron` scheduling, `--tz`, and Slack announce delivery.

---

## 12. Deployment

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

## 13. Configuration

Credentials live on VPS env files and must not be committed.

Important variables:

- `DATABASE_URL`
- `BRAVE_SEARCH_API_KEY`
- `SLACK_BOT_TOKEN`
- `SLACK_REPORT_CHANNEL`
- `WEBHOOK_SECRET`
- `OPENCLAW_BASE_URL`
- `DASHBOARD_BASE_URL`
- `SALES_SHEET_URL`
- `SLACK_DIGEST_CRON`
- Optional: `GOOGLE_CSE_KEY`, `GOOGLE_CSE_ID`

---

## 14. Security Requirements

- Keep secrets in environment files only.
- Webhook must validate shared secret.
- `no_hp` must not be used as a public search query.
- Dashboard is internal; add auth before exposing broadly.
- Avoid storing unnecessary PII beyond investigation requirement.
- Reports must preserve evidence source so decisions are auditable.
- Slack digest must hide internal evidence-gathering logic and only show sales-ready prospect summaries.

---

## 15. Observability

Current:

- `token_usage.sh` reads model pricing from OpenClaw config.
- `llm_calls` stores token and estimated cost.
- Dashboard shows cost per job.
- Script logs are available through shell/systemd.
- Daily Slack digest sends an operational heartbeat even when no prospect is found.

Future:

- Structured service logs.
- Queue metrics.
- Alert delivery success/failure tracking.
- Dashboard usage/audit events.

---

## 16. Test Requirements

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
- Confirm response is queued/accepted quickly.
- Confirm queue worker processes one pending item at a time.
- Confirm completed webhook jobs appear in dashboard.
- Confirm Slack digest sends prospect list plus Sales Sheet link at 09:00.
- Confirm Slack digest sends a no-prospect heartbeat when the window is empty.
- Confirm non-prospect investigations do not appear as Slack prospect items.

---

## 17. Roadmap

### Done

- Go MVP.
- AI reasoning loop.
- Tool catalog expansion.
- PostgreSQL + dashboard.
- Webhook enqueue API.
- Sequential queue worker with retry/idempotency.
- Mandatory Telegram delivery for queued investigations.
- Slack daily prospect digest at 09:00 Asia/Jakarta.
- Slack `--test-run` preview mode.

### Next

- Validate from Komerce platform register.
- Improve `db_writer.js` extraction quality.
- Add dashboard queue visibility if operationally needed.

### Later

- Dashboard authentication.
- Paid enrichment/search tools.
- Multi-agent parallel investigation.
- Normalize JSONB fields into dedicated analytics tables if query needs grow.
