# Company Detector Bot — Agentic Company Detector

AI Company Detection Agent berbasis OpenClaw untuk mendeteksi apakah akun yang register di platform merupakan individu biasa, karyawan perusahaan, pemilik bisnis, founder, agency, atau suspicious/spam.

Sistem ini bekerja seperti **agentic coding** — AI punya goal, punya tool catalog, dan dia reasoning loop sampai goal tercapai atau budget habis. Kalau satu tool gagal, AI cari alternatif. Kalau AI tidak tersedia, deterministik pipeline jalan sebagai fallback.

MVP saat ini berjalan lewat Telegram: user mengirim `/check email@domain.com`, agent menjalankan investigation flow, lalu mengembalikan report dengan narasi tiga layer: `[Deterministik]`, `[Tools]`, dan `[AI Reasoning]` (AI Reasoning belum aktif di fase ini — direncanakan di Phase A).

## Current Status

Yang sudah aktif:

- Telegram bot command flow via OpenClaw.
- Deterministic Go `company-check` orchestrator via `openclaw_workspace/scripts/company_check_go.sh`.
- Email intelligence, DNS/domain check, lightweight website crawler.
- Search cascade: Google CSE → Brave → Bing → DDG (automatic fallback).
- Rules-first scoring engine dengan anti-hallucination enforcement.
- AI reasoning loop (AGENTS.md Phase A): two-phase investigation, structured findings, evidence chain.
- Telegram report formatter.
- File-based evidence store dengan retention.
- `/tool_status` dan `/last_report`.
- Go CLI MVP under `go-service/` with unit tests and network smoke-tested DNS/crawler/scraper.
- `deploy.sh`: satu command untuk sync semua ke VPS.
- `deliver_report.sh`: kirim AI report ke Slack (prioritas ai_report_latest.txt).

Yang belum production:

- **Google CSE API key belum dikonfigurasi** (gratis, 100/hari) — set `GOOGLE_CSE_KEY` + `GOOGLE_CSE_ID` di VPS.
- **Brave Search API belum dikonfigurasi** (~$5/bulan) — set `BRAVE_SEARCH_API_KEY` di VPS.
- **Phase A belum ditest end-to-end dari Telegram** — AI reasoning loop siap, perlu verifikasi live.
- **Tool Catalog Expansion**: brand_hint_detector, social_link_extractor, role_signal_extractor, marketplace_search belum jadi Go package.
- **Slack delivery otomatis**: deliver_report.sh masih perlu dijalankan manual oleh AI.
- Postgres, queue, dashboard, dan platform register API.
- Multi-agent parallel investigation (setelah Phase A terbukti).

## Read The Docs

Mulai dari sini: [Documentation Index](docs/README.md).

Urutan baca paling enak:

1. [High Level Business Flow](docs/product/HIGH_LEVEL_BUSINESS_FLOW.md) - gambar besar input sampai output, current vs level 2.
2. [Flow Map](docs/technical/FLOW_MAP.md) - alur runtime dan decision point yang lebih teknis.
3. [Tools and Algorithms Reference](docs/technical/TOOLS_AND_ALGORITHMS.md) - kamus semua script/tool dan algoritmanya.
4. [Project Implementation Review](docs/reviews/PROJECT_IMPLEMENTATION_REVIEW.md) - status aktual, gap, dan next priority.
5. [Backlog](BACKLOG.md) - apa yang sudah selesai dan apa yang belum.

## Run Locally

Current active runtime is the Go wrapper from the OpenClaw workspace:

```bash
cd openclaw_workspace
scripts/company_check_go.sh --email contact@komerce.id --save --send-slack
```

Run with the current register input package:

```bash
cd openclaw_workspace
scripts/company_check_go.sh --email person@gmail.com --full-name "Person Name" --no-hp "08123456789" --brand-name "Acme Studio" --save --send-slack
```

Or pass JSON:

```bash
cd openclaw_workspace
scripts/company_check_go.sh --input-json '{"email":"person@gmail.com","full_name":"Person Name","no_hp":"08123456789","brand_name":"Acme Studio"}' --json
```

Process CSV rows sequentially, legacy JS reference only:

```bash
cd openclaw_workspace
node scripts/batch_csv_check.js ../data/all_partner_user.csv --limit 10
```

JSON output:

```bash
cd openclaw_workspace
scripts/company_check_go.sh --email contact@komerce.id --json
```

Tool status:

```bash
cd openclaw_workspace
scripts/tool_status_go.sh
```

Last saved report:

```bash
cd openclaw_workspace
scripts/last_report_go.sh contact@komerce.id
```

Optional Slack send:

```bash
cd openclaw_workspace
SLACK_BOT_TOKEN='xoxb-...' SLACK_REPORT_CHANNEL='C0B3JEYN1HV' scripts/company_check_go.sh --email contact@komerce.id --save --send-slack
```

Go CLI MVP:

```bash
cd go-service
go test ./...
go run ./cmd/company-check --email contact@komerce.id --brand-name Komerce --json
go run ./cmd/company-check --input-json '{"email":"person@gmail.com","full_name":"Person Name","no_hp":"08123456789","brand_name":"Acme Studio"}' --skip-network --json
```

Go save and explicit Slack send:

```bash
cd go-service
go run ./cmd/company-check --email contact@komerce.id --brand-name Komerce --save
SLACK_BOT_TOKEN='xoxb-...' SLACK_REPORT_CHANNEL='C0B3JEYN1HV' go run ./cmd/company-check --email contact@komerce.id --brand-name Komerce --send-slack
```

## Runtime Contract

For every valid `/check <email>` request, OpenClaw should run:

```bash
cd ~/.openclaw/workspace
scripts/company_check_go.sh --email <email> --save --send-slack
```

The final result must stand on its own for automation. It must not ask the user for feedback or clarification when a valid email exists.

Node.js scripts remain as rollback/reference helpers, but the OpenClaw workspace command is now the Go wrapper.

Current classifications:

- `possible_company_affiliated`
- `unknown_needs_more_evidence`
- `likely_personal_email`
- `suspicious_or_invalid`

Fallback policy:

- A tool enters `tools_used` only when it actually runs successfully.
- Failed DDG/free scraper calls go to `tool_errors`, not evidence.
- Skipped paid/unavailable tools go to `tools_skipped`.
- Slack delivery is part of the Telegram `/check` command through `--send-slack`. Go posts to Slack for **all results** regardless of classification. After a database is available, routing will be split: personal/unknown saved to DB only, company-associated to both Telegram and Slack.

Current register input contract:

- `email`: required, primary routing signal.
- `full_name`: optional identity hint.
- `brand_name`: optional business hint.
- `no_hp`: optional internal matching/dedup field; not used for public search by default.

## Repo Map

```text
.
+-- README.md
+-- BACKLOG.md
+-- docs/
|   +-- README.md
|   +-- product/
|   +-- technical/
|   +-- operations/
|   +-- reviews/
+-- openclaw_workspace/
+-- go-service/
|   +-- cmd/company-check/
|   +-- internal/
|   +-- test-fixtures/
+-- openclaw_workspace/
|   +-- AGENTS.md
|   +-- TOOLS.md
|   +-- config/
|   +-- scripts/
|   +-- skills/
```

Operational VPS details, passwords, tokens, `evidence/`, `reports/`, and `.env` are intentionally not tracked in git.
