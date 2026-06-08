# Docker Deployment Runbook

**Purpose:** jalur deploy Company Detector ketika server kantor menjalankan aplikasi di atas Docker.  
**Status:** repo sudah menyediakan `Dockerfile`, `compose.yml`, dan `.env.docker.example` untuk smoke test lokal serta deployment berbasis Compose.

## 1. When To Use This

Gunakan dokumen ini jika engineer kantor meminta semua aplikasi berjalan sebagai
container. Dokumen bare-metal/systemd tetap berguna untuk memahami service yang
ada, tetapi eksekusi production-nya mengikuti Compose.

Docker path menjalankan:

```text
postgres   : PostgreSQL local container, optional untuk production
migrate    : migration runner
dashboard  : Node dashboard, port 3001
webhook    : Node webhook API, port 3002
worker     : queue worker
```

Important:

- Local smoke test default menggunakan `REGISTER_WORKER_MODE=deterministic`.
- Full AI investigation tetap membutuhkan OpenClaw runtime tersedia di dalam worker container atau image internal yang sudah membundel OpenClaw.
- Jangan anggap production siap sampai full OpenClaw agent smoke test berhasil.

## 2. Files

| File | Purpose |
|---|---|
| `Dockerfile` | Build runtime image berisi dashboard, webhook, workspace scripts, dan Go `company-check` binary |
| `compose.yml` | Service stack untuk PostgreSQL, migration, dashboard, webhook, worker |
| `.env.docker.example` | Template env Compose tanpa nilai secret asli |
| `docs/technical/DEPLOYMENT_SECRETS_HANDOVER.md` | Checklist key/secrets yang harus diserahkan |

## 3. Local Smoke Test

Run from repo root:

```bash
cp .env.docker.example .env
docker compose build
docker compose up -d postgres migrate dashboard webhook worker
docker compose ps
```

Verify health:

```bash
curl -fsS http://localhost:3002/health
curl -fsS http://localhost:3001/sales-sheet >/dev/null
```

Queue a test register:

```bash
curl -X POST http://localhost:3002/webhook/check \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer local-webhook-secret" \
  -d '{
    "email": "docker-smoke@example.com",
    "full_name": "Docker Smoke",
    "brand_name": "Docker Test",
    "no_hp": "08123456789",
    "source": "docker_smoke",
    "external_id": "docker-smoke-001",
    "idempotency_key": "docker_smoke:001"
  }'
```

Check worker and dashboard:

```bash
docker compose logs --tail=100 worker
docker compose exec postgres psql -U company_detection -d company_detection \
  -c "select email, status, investigation_job_id, last_error from register_intake_jobs order by created_at desc limit 5;"
```

Expected for local deterministic smoke:

- Webhook returns queued response.
- Worker consumes queue.
- DB row becomes `completed` or shows a clear actionable error.
- Dashboard route loads.

## 4. Production Docker Decisions

Engineer kantor must decide these before deployment:

| Decision | Recommended |
|---|---|
| PostgreSQL location | Use managed/existing office PostgreSQL if available; otherwise Compose `postgres` volume with backup policy |
| Reverse proxy | Office Nginx/Traefik/Caddy in front of `dashboard:3001` and `webhook:3002` |
| TLS | Terminate HTTPS at office reverse proxy |
| Secrets | Use `.env`, Docker secrets, or office secret manager; do not bake secrets into image |
| OpenClaw runtime | Provide office-approved OpenClaw image/binary mounted into worker container |
| Worker mode | `REGISTER_WORKER_MODE=agent` for production after OpenClaw smoke test passes |

## 5. Production Compose Env

Create `.env` on the server from `.env.docker.example` and real secret values:

```text
POSTGRES_PASSWORD=...
WEBHOOK_SECRET=...
DASHBOARD_BASE_URL=https://<SERVER_DOMAIN>
DASHBOARD_BIND_PORT=3001
WEBHOOK_BIND_PORT=3002
REGISTER_WORKER_MODE=agent
REGISTER_WORKER_DELIVER_TELEGRAM=true
OPENCLAW_BIN=/usr/local/bin/openclaw
```

If using an external PostgreSQL, update `DATABASE_URL` in `compose.yml` or add a
production override file such as `compose.prod.yml`.

## 6. OpenClaw In Docker

Full production requires `OPENCLAW_BIN` to work inside the `worker` container.
There are two acceptable approaches:

1. Build an internal image that installs OpenClaw in `/usr/local/bin/openclaw`.
2. Mount an approved OpenClaw binary/config into the worker container.

The worker also needs:

```text
OPENCLAW_WORKSPACE=/app/openclaw_workspace
OPENCLAW_BIN=/usr/local/bin/openclaw
OPENCLAW_CONFIG or equivalent provider config
Sumopod API key
Telegram/search credentials if enabled
```

Full agent smoke test:

```bash
docker compose exec worker /usr/local/bin/openclaw status
docker compose exec worker node webhook/worker.js --once
```

Do not switch production to `REGISTER_WORKER_MODE=agent` until these commands
work inside the container.

## 7. Server Deployment Steps

On server:

```bash
git clone https://github.com/nunutech40/company-detector-bot.git
cd company-detector-bot
cp .env.docker.example .env
# edit .env with real values
docker compose build
docker compose up -d postgres migrate dashboard webhook worker
docker compose ps
```

If database is restored from old VPS, restore before starting worker:

```bash
docker compose stop worker
# restore company_detection dump according to SERVER_MIGRATION_RUNBOOK.md
docker compose up -d worker
```

## 8. Verification Before Cutover

- [ ] `docker compose ps` shows `dashboard`, `webhook`, and `worker` running.
- [ ] `GET /health` returns OK.
- [ ] Dashboard `/sales-sheet` loads.
- [ ] Smoke webhook inserts `register_intake_jobs`.
- [ ] Worker processes deterministic smoke test.
- [ ] OpenClaw works inside worker container.
- [ ] Worker processes one full `agent` mode smoke test.
- [ ] Slack digest dry-run works in container.
- [ ] Public reverse proxy routes to dashboard and webhook.
- [ ] No URL in response points to `localhost` except local-only test.

## 9. Useful Commands

```bash
docker compose logs -f webhook
docker compose logs -f worker
docker compose logs -f dashboard
docker compose exec postgres psql -U company_detection -d company_detection -c "\dt"
docker compose down
docker compose down -v
```

Use `docker compose down -v` only for disposable local data. Do not run it on
production unless the database volume has already been backed up.
