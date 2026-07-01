# Company Detector Bot - AI Company Detection Agent

Company Detector menginvestigasi data register untuk mengidentifikasi akun
personal, pemilik bisnis, perusahaan, agency/freelancer, atau akun suspicious.

Sistem menggunakan deterministic Go pipeline sebagai fondasi dan OpenClaw AI
reasoning loop sebagai investigator. Hasil disimpan ke evidence files dan
PostgreSQL, ditampilkan di dashboard, dikirim ke Telegram, serta dirangkum ke
Slack setiap pukul 09:00 Asia/Jakarta.

## Current Status

Status per 10 Juni 2026:

- Production bundle berbasis Docker Compose untuk server kantor.
- Runtime Docker telah diuji setara dengan VPS lama: OpenClaw `2026.5.12`,
  Node 24, PostgreSQL 16, Go binaries, plugins, providers, search tools, dan
  agent investigation flow.
- Webhook queue memproses register secara sequential melalui OpenClaw agent,
  menyimpan retry provider secara durable, dan mengirim alert outage/recovery ke Telegram.
- Telegram mendukung outbound report dan inbound/manual investigation.
- Dashboard menyediakan investigation records dan browser-based Sales Sheet.
- Slack daily prospect digest berjalan setiap pukul 09:00 Asia/Jakarta.
- Pre-cutover, runtime parity, dan final deployment verification tersedia.

Docker Compose adalah jalur production utama. VPS lama tetap aktif sampai
cutover server kantor diterima. Jangan menjalankan dua Telegram gateway dengan
bot token yang sama.

Provider availability dan kredit merupakan dependency eksternal. Jangan
mengurangi tools, context, atau kualitas investigation hanya agar provider bisa
merespons.

## Start Here

Untuk pemilik sistem:

1. [Owner Office Deployment Guide](docs/operations/OWNER_OFFICE_DEPLOYMENT_GUIDE.md)
2. [Deployment Secrets Handover](docs/technical/DEPLOYMENT_SECRETS_HANDOVER.md)
3. [PRD](docs/product/PRD.md)

Untuk engineer/deployer:

1. [Docker Deployment Runbook](docs/technical/DOCKER_DEPLOYMENT_RUNBOOK.md)
2. [VPS-Docker Parity Audit](docs/technical/VPS_DOCKER_PARITY_AUDIT.md)
3. [Register Webhook API](docs/technical/REGISTER_WEBHOOK_API.md)
4. [TRD](docs/technical/TRD.md)
5. [Flow Map](docs/technical/FLOW_MAP.md)
6. [Google Review Monitor](docs/technical/GOOGLE_REVIEW_MONITOR.md) - isolated deterministic review monitoring feature
7. [Negative Feedback Monitor Architecture](docs/technical/NEGATIVE_FEEDBACK_MONITOR_ARCHITECTURE.md) - active Meta polling MVP, Telegram all-results, Slack negative-only, and future Google/webhook path

Untuk AI agent:

1. [FETCH_CONTEXT.md](FETCH_CONTEXT.md)
2. [PRD](docs/product/PRD.md)
3. [TRD](docs/technical/TRD.md)

Lihat [Documentation Index](docs/README.md) untuk seluruh dokumentasi.

## Docker Runtime

| Service | Purpose |
|---|---|
| `postgres` | PostgreSQL database; dapat diganti office-managed PostgreSQL |
| `migrate` | Database migration runner |
| `dashboard` | Dashboard dan browser-based Sales Sheet |
| `webhook` | Register intake API |
| `worker` | Sequential queued investigation worker |
| `gateway` | Telegram inbound/manual investigation poller |
| `digest` | Daily Slack prospect digest |
| `review-monitor` | Isolated Google Business Profile review 1-3 collector and Slack report scheduler |
| `feedback-monitor` | Negative feedback monitor: Meta polling, AI classifier, Telegram all-results, Slack negative-only |
| `feedback-monitor` | Negative feedback monitor: Meta polling, AI classifier, Telegram all-results, Slack negative-only |
| `feedback-monitor` | Negative feedback monitor: Meta polling, AI classifier, Telegram all-results, Slack negative-only |
| `feedback-monitor` | Negative feedback monitor: Meta polling, AI classifier, Telegram all-results, Slack negative-only |

`review-monitor` menggunakan Compose profile opt-in dan `.env.review-monitor`
terpisah. Normal deployment tidak menyalakannya sampai Google Business Profile
API preflight lolos.

Negative Feedback Monitor sekarang sudah aktif sebagai MVP terpisah:
Meta feedback menjalankan poll berikutnya 15 menit setelah poll sebelumnya
selesai. Polling memakai bounded concurrency dan mencatat status run ke DB. Komentar
Facebook/Instagram diklasifikasikan oleh dedicated structured AI classifier
tanpa OpenClaw agent, setiap hasil selesai dikirim ke Telegram, dan hanya hasil
negatif yang dikirim ke Slack monitoring. Google Business Profile masih
menunggu API approval dan nanti tetap memakai rule rating 1-3 tanpa AI.
Poll kosong tidak memanggil AI. Health monitor memberi alert khusus Negative
Comment Monitor jika timer mati, polling gagal, atau hasil poll menjadi stale.
Webhook Meta masih opsi masa depan sampai callback/subscription Meta App aktif.

Application ports default ke loopback-only:

```text
Dashboard: http://127.0.0.1:3001
Sales:     http://127.0.0.1:3001/sales-sheet
Webhook:   http://127.0.0.1:3002
Health:    http://127.0.0.1:3002/health
```

Production uses `company-ops-health.timer` to check the investigation and
negative-comment workers independently. Incidents are deduplicated in
PostgreSQL and sent once to each feature's Slack channel; the two-minute check
does not invoke an LLM. Blind periodic replay is disabled. After a confirmed
provider recovery, at most 5 historical AI failures return to the low-priority
queue; operators can also trigger the same bounded batch manually.

Gunakan reverse proxy kantor dan HTTPS untuk public access.

## Quick Start

Requirements:

- Docker Engine dan Docker Compose
- Real credentials dari
  [Deployment Secrets Handover](docs/technical/DEPLOYMENT_SECRETS_HANDOVER.md)
- Outbound HTTPS ke LLM provider, Telegram, Slack, Brave Search, GitHub, dan
  Docker registries

Prepare environment:

```bash
cp .env.docker.example .env
chmod 600 .env
# Replace every CHANGE_ME value before verification.
```

Build dan jalankan safe pre-cutover stack:

```bash
docker compose build
docker compose up -d postgres migrate dashboard webhook worker digest
docker compose ps
./ops/docker/verify-precutover.sh
```

Keep `gateway` stopped selama VPS lama masih polling bot Telegram production.
Pada final cutover, matikan gateway VPS terlebih dahulu, lalu:

```bash
docker compose up -d gateway
./ops/docker/verify-deployment.sh
```

Operational commands:

```bash
docker compose ps
docker compose logs -f worker
docker compose logs -f gateway
docker compose restart worker
docker compose down
```

## Production AI Runtime

Default primary model:

```text
provider: 9router
base URL: https://9router.komerce-tech.id/v1
model: 9router/komerce-1.2
```

Provider/model dikonfigurasi melalui `.env`, sehingga perubahan model tidak
memerlukan edit kode. Docker juga menyiapkan provider DeepSeek dan MiniMax,
plugin `llm-task`, full tool profile, Telegram, dan runtime database access.

Jangan commit `.env`, menulis secret ke dokumentasi, atau membagikan output
`docker compose config`. Production `.env` wajib memiliki permission `600`.

## Verification Gates

Jalankan berurutan:

```bash
./ops/docker/verify-precutover.sh
./ops/docker/verify-runtime-parity.sh
# Only after old Telegram gateway is stopped:
./ops/docker/verify-deployment.sh
```

Verification mencakup required secrets, service health, deterministic pipeline,
database persistence, dashboard visibility, runtime parity, dan final
production integrations.

## Useful Commands

Deterministic investigation:

```bash
docker compose exec worker openclaw_workspace/scripts/company_check_go.sh \
  --email contact@komerce.id \
  --full-name "Ragil Setiawan" \
  --brand-name "Komerce" \
  --no-hp "08123456789" \
  --save
```

Preview Slack digest:

```bash
docker compose exec digest node openclaw_workspace/scripts/slack_daily_digest.js \
  --dry-run --window-hours 24
```

Run Go tests:

```bash
cd go-service
go test ./...
```

## Repo Map

```text
.
├── Dockerfile
├── compose.yml
├── .env.docker.example
├── .env.review-monitor.example
├── README.md
├── FETCH_CONTEXT.md
├── docs/
│   ├── operations/
│   │   └── OWNER_OFFICE_DEPLOYMENT_GUIDE.md
│   ├── product/
│   │   └── PRD.md
│   └── technical/
│       ├── TRD.md
│       ├── DOCKER_DEPLOYMENT_RUNBOOK.md
│       ├── DEPLOYMENT_SECRETS_HANDOVER.md
│       ├── VPS_DOCKER_PARITY_AUDIT.md
│       ├── FLOW_MAP.md
│       ├── NEGATIVE_FEEDBACK_MONITOR_ARCHITECTURE.md
│       └── REGISTER_WEBHOOK_API.md
├── go-service/
├── dashboard/
├── webhook/
├── review_monitor/
├── ops/docker/
└── openclaw_workspace/
    ├── AGENTS.md
    ├── STANDING_ORDERS.md
    ├── TOOLS.md
    ├── config/
    └── scripts/
```

## Runtime Contract

Classifications:

- `possible_company_affiliated`
- `likely_personal_email`
- `unknown_needs_more_evidence`
- `suspicious_or_invalid`

Post-investigation finalizer:

```bash
openclaw_workspace/scripts/finish_investigation.sh --email <email>
```

Finalizer menangani evidence saving, database write, dan token usage per job.
Report final hanya menampilkan provider/model milik job tersebut; model dari
session historis tidak ikut ditampilkan. Slack
delivery ditangani daily digest flow.

Slack daily digest target:

```text
09:00 Asia/Jakarta every day
possible_company_affiliated + confidence >= 60 => listed as prospect
75-100 => Hot prospect
60-74 => Warm prospect
empty prospect window => send heartbeat digest
```

Digest tidak membuang kandidat yang bukti bisnisnya belum lengkap. Setiap item
menampilkan status prospect, kesimpulan profil, dan relasi/role bisnis.
Proyek personal/hobbyist tetap dapat terlihat untuk audit, tetapi ditandai
`Perlu verifikasi - bukan prospect utama`. Prioritas outreach untuk
kandidat seperti ini adalah `Review only`; kandidat bisnis tanpa role yang
jelas menggunakan `Qualification first`.

AI retry memakai session baru untuk setiap attempt dan berhenti setelah batas
`REGISTER_WORKER_MAX_ATTEMPTS`. Replay berkala tanpa health signal dimatikan;
provider recovery hanya membuka kembali batch kecil agar gangguan AI tidak
berubah menjadi retry storm dan pemborosan token.

Input rules:

- `email` wajib.
- `full_name` dan `brand_name` adalah optional hints.
- `no_hp` adalah confirmation-only dan tidak boleh digunakan untuk public
  search.

## Legacy VPS

Deployment VPS/systemd dan `deploy.sh` hanya dipertahankan sebagai migration
serta rollback reference. Deployment baru ke server kantor wajib mengikuti
[Docker Deployment Runbook](docs/technical/DOCKER_DEPLOYMENT_RUNBOOK.md).
