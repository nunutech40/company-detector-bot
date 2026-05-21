# Company Detector Bot — AI Company Detection Agent

AI Company Detection Agent untuk mendeteksi apakah user register adalah personal, pemilik bisnis, perusahaan, agency/freelancer, atau akun suspicious.

Sistem ini memakai deterministic Go pipeline sebagai fondasi dan OpenClaw AI reasoning loop sebagai investigator. Semua hasil disimpan ke file evidence dan PostgreSQL, lalu bisa dilihat lewat dashboard.

---

## Current Status

Status per 21 Mei 2026:

Done:

- Go CLI pipeline: email intelligence, domain check, crawler, search cascade, scraper, scoring, report, evidence.
- AI reasoning loop via OpenClaw + Qwen3.6 Flash.
- Telegram investigation flow.
- PostgreSQL 16 database `company_detection`.
- 3-table storage: `investigation_jobs`, `final_reports`, `llm_calls`.
- `db_writer.js` integrated with `finish_investigation.sh`.
- Report provenance in DB/dashboard: AI reasoning vs deterministic fallback.
- Dashboard Express + EJS at port `3001`.
- Webhook API Express at port `3002` with PostgreSQL-backed queue intake.
- Sequential register worker: `register_intake_jobs` -> OpenClaw agent investigation -> finalizer -> DB/dashboard.
- Telegram delivery is mandatory for each queued investigation.
- Slack daily prospect digest at 09:00 Asia/Jakarta.
- Slack digest test mode: `--test-run` sends a preview without marking production digest rows.
- Tool packages: `brandhint`, `sociallinks`, `rolesignal`.
- Token/cost tracking.
- One-command deploy via `deploy.sh`.

Next validation:

- Improve `db_writer.js` social/marketplace extraction.
- Validate Komerce platform register flow against the queue webhook.

---

## Start Here

For humans:

1. [PRD](docs/product/PRD.md) — product source of truth.
2. [TRD](docs/technical/TRD.md) — technical source of truth.
3. [Flow Map](docs/technical/FLOW_MAP.md) — satu-satunya flow aktif: data akun, orchestra loop, finalizer, DB/dashboard.
4. [Register Webhook API](docs/technical/REGISTER_WEBHOOK_API.md) — kontrak REST API untuk tim platform register.
5. [Webhook + Slack Plan](docs/technical/WEBHOOK_SLACK_DAILY_DIGEST_PLAN.md) — implemented workflow note untuk webhook queue + Slack digest.
6. [Webhook + Slack Building Checklist](docs/technical/WEBHOOK_SLACK_BUILDING_CHECKLIST.md) — checklist implementasi dan validasi terbaru.
7. [Documentation Index](docs/README.md) — all docs.
8. [Backlog](BACKLOG.md) — status and next work.

For another AI agent:

1. [FETCH_CONTEXT.md](FETCH_CONTEXT.md)
2. [PRD](docs/product/PRD.md)
3. [TRD](docs/technical/TRD.md)

---

## Main URLs

| Service | URL |
|---|---|
| Dashboard | `http://103.226.139.107` |
| Sales Sheet Web | `http://103.226.139.107/sales-sheet` |
| Webhook API | `http://103.226.139.107:3002` |
| Webhook health | `http://103.226.139.107:3002/health` |

---

## Commands

Run deterministic check:

```bash
cd openclaw_workspace
scripts/company_check_go.sh --email contact@komerce.id --save
```

Run with register fields:

```bash
cd openclaw_workspace
scripts/company_check_go.sh \
  --email person@gmail.com \
  --full-name "Person Name" \
  --no-hp "08123456789" \
  --brand-name "Acme Studio" \
  --save
```

Finalize an AI investigation:

```bash
cd openclaw_workspace
scripts/finish_investigation.sh --email contact@komerce.id
```

Write latest result to database manually:

```bash
cd openclaw_workspace
node scripts/db_writer.js --email contact@komerce.id
```

Test webhook:

```bash
curl -X POST http://103.226.139.107:3002/webhook/check \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <shared-secret>" \
  -d '{
    "email": "contact@komerce.id",
    "full_name": "Ragil Setiawan",
    "brand_name": "Komerce",
    "no_hp": "08123456789",
    "source": "platform_register",
    "external_id": "register-user-id-123",
    "idempotency_key": "platform_register:register-user-id-123"
  }'
```

Process one queued webhook job:

```bash
cd webhook
npm run worker:once
```

Preview Slack daily digest:

```bash
cd openclaw_workspace
npm run slack:digest:dry-run
```

Send Slack test digest without marking production items:

```bash
cd openclaw_workspace
node scripts/slack_daily_digest.js --test-run --window-hours 999
```

Slack digest links to the browser-based Sales Sheet at `http://103.226.139.107/sales-sheet`, so sales users do not need Excel. A fresh `.xlsx` export is still generated as a fallback/internal artifact under dashboard `/exports/`. On VPS, nginx proxies the dashboard on port 80, so Slack links do not use `:3001`. Override `DASHBOARD_PUBLIC_BASE_URL`, `SALES_SHEET_WEB_URL`, `SALES_SHEET_LATEST_URL`, and `SALES_SHEET_EXPORT_DIR` if the public URL changes.

Run Go tests:

```bash
cd go-service
go test ./...
```

Deploy:

```bash
bash deploy.sh
```

---

## Repo Map

```text
.
├── README.md
├── FETCH_CONTEXT.md
├── CONTEXT.md
├── BACKLOG.md
├── deploy.sh
├── docs/
│   ├── README.md
│   ├── product/
│   │   ├── PRD.md
│   ├── technical/
│   │   ├── TRD.md
│   │   ├── FLOW_MAP.md
│   │   ├── REGISTER_WEBHOOK_API.md
│   │   ├── TOOLS_AND_ALGORITHMS.md
│   │   ├── migration_v1.sql
│   │   └── migration_v2_webhook_slack_queue.sql
│   └── archive/       ← plan/review/checklist/flow lama
├── go-service/
│   ├── cmd/
│   └── internal/
├── dashboard/
├── webhook/
├── ops/
│   └── systemd/
└── openclaw_workspace/
    ├── AGENTS.md
    ├── STANDING_ORDERS.md
    ├── TOOLS.md
    ├── config/
    └── scripts/
```

---

## Runtime Contract

Classifications:

- `possible_company_affiliated`
- `likely_personal_email`
- `unknown_needs_more_evidence`
- `suspicious_or_invalid`

Post-investigation rule:

```bash
scripts/finish_investigation.sh --email <email>
```

This finalizer handles evidence saving, DB write, and token usage. Slack delivery is handled by the daily digest flow.

Slack daily digest target:

```text
09:00 Asia/Jakarta every day
possible_company_affiliated + confidence >= 60 => listed as prospect
75-100 => Hot prospect
60-74 => Warm prospect
empty prospect window => send heartbeat digest
```

Slack test mode:

```text
--test-run sends a [TEST] digest and does not insert slack_digest_runs/slack_digest_items.
```

Input rule:

- `email` is required.
- `full_name` and `brand_name` are optional hints.
- `no_hp` is confirmation only and must not be used for public search.
