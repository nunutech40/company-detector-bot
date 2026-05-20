# Company Detector Bot — AI Company Detection Agent

AI Company Detection Agent untuk mendeteksi apakah user register adalah personal, pemilik bisnis, perusahaan, agency/freelancer, atau akun suspicious.

Sistem ini memakai deterministic Go pipeline sebagai fondasi dan OpenClaw AI reasoning loop sebagai investigator. Semua hasil disimpan ke file evidence dan PostgreSQL, lalu bisa dilihat lewat dashboard.

---

## Current Status

Status per 20 Mei 2026:

Done:

- Go CLI pipeline: email intelligence, domain check, crawler, search cascade, scraper, scoring, report, evidence.
- AI reasoning loop via OpenClaw + Qwen3.6 Flash.
- Telegram investigation flow.
- PostgreSQL 16 database `company_detection`.
- 3-table storage: `investigation_jobs`, `final_reports`, `llm_calls`.
- `db_writer.js` integrated with `finish_investigation.sh`.
- Dashboard Express + EJS at port `3001`.
- Webhook API Express at port `3002` as final integration scaffold; target final is PostgreSQL-backed queue intake.
- Tool packages: `brandhint`, `sociallinks`, `rolesignal`.
- Token/cost tracking.
- One-command deploy via `deploy.sh`.

Next validation:

- Telegram end-to-end test.
- Build webhook PostgreSQL intake queue and sequential worker for Komerce register flow.
- Improve `db_writer.js` social/marketplace extraction.
- Build Slack daily prospect digest at 09:00 Asia/Jakarta.

---

## Start Here

For humans:

1. [PRD](docs/product/PRD.md) — product source of truth.
2. [TRD](docs/technical/TRD.md) — technical source of truth.
3. [Flow Map](docs/technical/FLOW_MAP.md) — satu-satunya flow aktif: data akun, orchestra loop, finalizer, DB/dashboard.
4. [Webhook + Slack Plan](docs/technical/WEBHOOK_SLACK_DAILY_DIGEST_PLAN.md) — plan fitur berikutnya.
5. [Documentation Index](docs/README.md) — all docs.
6. [Backlog](BACKLOG.md) — status and next work.

For another AI agent:

1. [FETCH_CONTEXT.md](FETCH_CONTEXT.md)
2. [PRD](docs/product/PRD.md)
3. [TRD](docs/technical/TRD.md)

---

## Main URLs

| Service | URL |
|---|---|
| Dashboard | `http://103.226.139.107:3001` |
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
  -d '{
    "email": "contact@komerce.id",
    "full_name": "Ragil Setiawan",
    "brand_name": "Komerce",
    "secret": "<shared-secret>"
  }'
```

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
│   │   ├── TOOLS_AND_ALGORITHMS.md
│   │   └── migration_v1.sql
│   └── archive/       ← plan/review/checklist/flow lama
├── go-service/
│   ├── cmd/
│   └── internal/
├── dashboard/
├── webhook/
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

This finalizer handles evidence saving, DB write, delivery routing, and token usage.

Slack daily digest target:

```text
09:00 Asia/Jakarta every day
possible_company_affiliated + confidence >= 75 => listed as prospect
empty prospect window => send heartbeat digest
```

Input rule:

- `email` is required.
- `full_name` and `brand_name` are optional hints.
- `no_hp` is confirmation only and must not be used for public search.
