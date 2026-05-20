# Context — AI Company Detection Agent

Short project handoff for humans and AI agents.

**Last updated:** 20 Mei 2026

For the most structured AI handoff, read `FETCH_CONTEXT.md` first.

---

## What This Is

AI Company Detection Agent detects whether a registering user is personal, business-affiliated, company-owned, agency/freelancer, or suspicious.

Business purpose:

- Business users can be routed to B2B/company handling.
- Personal users continue normal flow.
- Unknown users are stored for retry/review.
- Suspicious users go to risk review.

---

## Source Of Truth

- Product direction: `docs/product/PRD.md`
- Technical architecture: `docs/technical/TRD.md`
- Runtime flow: `docs/technical/FLOW_MAP.md`
- Next feature plan: `docs/technical/WEBHOOK_SLACK_DAILY_DIGEST_PLAN.md`
- Build checklist: `docs/technical/WEBHOOK_SLACK_BUILDING_CHECKLIST.md`
- Current status: `BACKLOG.md`
- AI handoff: `FETCH_CONTEXT.md`

---

## Architecture

```text
Layer 1 — Deterministic Go pipeline
  emailintel -> domaincheck -> crawler/search/scraper -> scoring -> report

Layer 2 — AI reasoning loop
  OpenClaw + Qwen chooses tools, gathers evidence, and reasons over findings.

Layer 3 — Storage and operations
  evidence files + PostgreSQL + dashboard + webhook intake + Slack digest
```

Principles:

- AI must not invent evidence.
- Classification and scoring remain deterministic.
- Failed tools are errors, not evidence.
- `no_hp` is confirmation only and must not be used for public search.
- Webhook final target is async enqueue, not direct investigation inside HTTP request.
- Slack final target is one daily prospect digest at 09:00 Asia/Jakarta, not realtime raw reports.

---

## Current Status

Done:

- Go CLI pipeline.
- AI reasoning loop via OpenClaw + Qwen3.6 Flash.
- Telegram investigation flow.
- PostgreSQL 16 database `company_detection`.
- 3 tables: `investigation_jobs`, `final_reports`, `llm_calls`.
- `db_writer.js`.
- Dashboard on port 3001.
- Webhook API scaffold on port 3002; final target is PostgreSQL-backed intake queue.
- Go packages: `brandhint`, `sociallinks`, `rolesignal`.
- Token usage/cost tracking.

Next:

- Telegram E2E validation.
- Build webhook PostgreSQL intake queue using `register_intake_jobs`.
- Build sequential worker that processes queued register payloads one by one.
- Build Slack daily prospect digest at 09:00 Asia/Jakarta.
- Validate from Komerce platform register flow.
- Improve `db_writer.js` extraction.

---

## Important Files

| File | Purpose |
|---|---|
| `openclaw_workspace/scripts/company_check_go.sh` | Go wrapper |
| `openclaw_workspace/scripts/finish_investigation.sh` | Mandatory finalizer |
| `openclaw_workspace/scripts/db_writer.js` | PostgreSQL writer |
| `openclaw_workspace/AGENTS.md` | Agent behavior contract |
| `openclaw_workspace/STANDING_ORDERS.md` | Runtime standing orders |
| `dashboard/app.js` | Dashboard service |
| `webhook/app.js` | Webhook service |
| `docs/technical/migration_v1.sql` | Database schema |
| `docs/technical/WEBHOOK_SLACK_DAILY_DIGEST_PLAN.md` | Next feature plan |
| `docs/technical/WEBHOOK_SLACK_BUILDING_CHECKLIST.md` | Build checklist |

---

## Runtime

VPS:

- IP: `103.226.139.107`
- Workspace: `/home/nunuopc/.openclaw/workspace/`
- Go binary: `/home/nunuopc/.openclaw/go-service/bin/company-check`

Services:

| Service | Port |
|---|---:|
| `openclaw-gateway` | 18789 |
| `company-dashboard` | 3001 |
| `company-webhook` | 3002 |
| `postgresql` | 5432 |

---

## Critical Command

After AI finishes an investigation:

```bash
cd openclaw_workspace
scripts/finish_investigation.sh --email <email>
```

This writes evidence, inserts DB rows, applies delivery routing, and shows token usage.

For platform register input, the planned final flow is:

```text
Platform Register
  -> webhook/app.js
  -> PostgreSQL company_detection.register_intake_jobs
  -> sequential worker
  -> OpenClaw/Go investigation
  -> finish_investigation.sh
  -> db_writer.js
  -> investigation_jobs / final_reports / llm_calls
  -> dashboard
```

Slack must read finalized DB rows later through the digest script. Slack should not receive raw investigation logic.

---

## Credentials

Credentials are stored on VPS env files only. Do not commit secrets.

Important variables:

- `DATABASE_URL`
- `BRAVE_SEARCH_API_KEY`
- `SLACK_BOT_TOKEN`
- `SLACK_REPORT_CHANNEL`
- `WEBHOOK_SECRET`
- `OPENCLAW_BASE_URL`
- `DASHBOARD_BASE_URL`
