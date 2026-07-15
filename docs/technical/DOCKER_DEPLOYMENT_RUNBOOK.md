# Docker Deployment Runbook

**Purpose:** satu-satunya jalur deploy production Company Detector ke server kantor.
**Status:** repo menyediakan bundle production berbasis Docker Compose.

Last local pre-production check:

```text
2026-06-08
- Docker image build: passed
- Webhook health: passed
- Dashboard /sales-sheet: passed
- Webhook queue -> deterministic worker -> DB completed: passed
- Telegram send from worker image via OpenClaw CLI: passed
```

## 1. When To Use This

Gunakan dokumen ini untuk seluruh deployment server kantor. Jalur
bare-metal/systemd lama sudah tidak digunakan.

Docker path menjalankan:

```text
postgres   : PostgreSQL local container, optional untuk production
migrate    : migration runner
dashboard  : Node dashboard, port 3001
webhook    : Node webhook API, port 3002
worker     : queue worker
gateway    : OpenClaw Telegram inbound/manual investigation gateway
digest     : Slack prospect digest scheduler, daily 09:00 WIB
review-monitor : optional isolated Google review monitor; opt-in profile only
feedback-monitor : optional negative feedback monitor; Meta polling/classifier path uses `.env.feedback-monitor`
```

Important:

- Image membundel OpenClaw `2026.5.12`, Node 24, dan seluruh binary Go aktif.
- Production default menggunakan `REGISTER_WORKER_MODE=agent`.
- Jangan anggap production siap sampai parity gate dan full OpenClaw agent smoke test berhasil.

## 2. Files

| File | Purpose |
|---|---|
| `Dockerfile` | Build runtime image berisi OpenClaw, dashboard, webhook, workspace scripts, dan seluruh binary Go aktif |
| `compose.yml` | Service stack untuk PostgreSQL, migration, dashboard, webhook, worker |
| `.env.docker.example` | Template env Compose tanpa nilai secret asli |
| `.env.feedback-monitor.sample` | Template env negative feedback monitor tanpa secret asli |
| `ops/docker/configure-openclaw.js` | Generate/update OpenClaw provider/model/Telegram config dari env |
| `ops/docker/worker-entrypoint.sh` | Worker startup entrypoint untuk config OpenClaw saat agent mode |
| `docs/technical/DEPLOYMENT_SECRETS_HANDOVER.md` | Checklist key/secrets yang harus diserahkan |

## 3. Local Pre-Cutover Test

Run from repo root:

```bash
cp .env.docker.example .env
docker compose build
docker compose up -d postgres migrate dashboard webhook worker digest
docker compose ps
```

Keep `gateway` stopped while the VPS production gateway is polling the same
Telegram bot.

Verify health:

```bash
curl -fsS http://localhost:3002/health
curl -fsS http://localhost:3001/sales-sheet >/dev/null
```

Run the safe pre-cutover acceptance test:

```bash
chmod +x ops/docker/verify-precutover.sh
./ops/docker/verify-precutover.sh
```

This verifies webhook, deterministic pipeline, PostgreSQL persistence,
dashboard visibility, and Slack digest dry-run without starting the Telegram
poller or calling the LLM provider.

## 4. Production Docker Decisions

Engineer kantor must decide these before deployment:

| Decision | Recommended |
|---|---|
| PostgreSQL location | Use managed/existing office PostgreSQL if available; otherwise Compose `postgres` volume with backup policy |
| Reverse proxy | Office Nginx/Traefik/Caddy in front of `dashboard:3001` and `webhook:3002` |
| TLS | Terminate HTTPS at office reverse proxy |
| Secrets | Use `.env`, Docker secrets, or office secret manager; do not bake secrets into image |
| OpenClaw runtime | Bundled and pinned in the repository Docker image |
| Worker mode | Keep `REGISTER_WORKER_MODE=agent` for production |
| Review monitor | Keep disabled until Google Business Profile API preflight passes |
| Feedback monitor | Docker `feedback-monitor-worker` runs `ops/docker/feedback-monitor-scheduler.js`, which polls Meta and drains the feedback queues every 15 minutes by default |

## 4.1 Tools and Plugins on a Clean Server

The office engineer does not install Company Detector tools one by one.
`docker compose build` creates them automatically:

- OpenClaw `2026.5.12` and Node 24 are installed in the image.
- Go builds `company-check`, `tool-status`, and `last-report`.
- Workspace scripts, skills, scoring rules, and tool catalog are copied into
  the image.
- `configure-openclaw.js` creates the Sumopod, DeepSeek, MiniMax, `llm-task`,
  full tool profile, Telegram, and runtime DB configuration from `.env`.

Required outbound HTTPS access:

- `9router.komerce-tech.id`
- Telegram API
- Slack API
- Brave Search API
- GitHub/Docker registries during build/deploy
- Google OAuth and Business Profile APIs only when the optional review-monitor profile is enabled
- Meta Graph API when the optional feedback-monitor profile is enabled

If office egress uses an allow-list or proxy, these destinations must be
approved before acceptance testing.

## 5. Production Compose Env

Create `.env` on the server from `.env.docker.example` and real secret values:

```text
POSTGRES_PASSWORD=...
WEBHOOK_SECRET=...
DASHBOARD_BASE_URL=https://<SERVER_DOMAIN>
DASHBOARD_PUBLIC_BASE_URL=https://<SERVER_DOMAIN>
DASHBOARD_BIND_PORT=127.0.0.1:3001
WEBHOOK_BIND_PORT=127.0.0.1:3002
OPENCLAW_CONFIGURE=true
LLM_PROVIDER=9router
LLM_BASE_URL=https://9router.komerce-tech.id/v1
LLM_API_KEY=not-required
LLM_PRIMARY_MODEL=9router/komerce-1.2
LLM_MODEL_ID=komerce-1.2
LLM_ADDITIONAL_MODELS=
LLM_TIMEOUT_SECONDS=120
REGISTER_WORKER_MODE=agent
REGISTER_WORKER_DELIVER_TELEGRAM=true
OPENCLAW_BIN=/usr/local/bin/openclaw
TELEGRAM_DEFAULT_BOT_TOKEN=...
TELEGRAM_ALLOW_FROM=...
REGISTER_WORKER_TELEGRAM_TO=...
SLACK_BOT_TOKEN=...
SLACK_REPORT_CHANNEL=...
BRAVE_SEARCH_API_KEY=...
DEEPSEEK_API_KEY=...
MINIMAX_API_KEY=...
```

Optional review monitor values belong in a separate `.env.review-monitor`, not
the core `.env`:

```text
GBP_BUSINESS_NAME=<development warung or Komerce>
GBP_ACCOUNT_ID=...
GBP_LOCATION_ID=...
GBP_CLIENT_ID=...
GBP_CLIENT_SECRET=...
GBP_REFRESH_TOKEN=...
REVIEW_MONITOR_COLLECT_HOUR_WIB=21
REVIEW_MONITOR_SEND_HOUR_WIB=9
REVIEW_MONITOR_SLACK_CHANNEL=monitor-negatif-company
```

The review monitor is isolated and opt-in. Normal `docker compose up` does not
start it. Follow `docs/technical/GOOGLE_REVIEW_MONITOR.md` and enable only after
its Google Business Profile API preflight succeeds. It reuses
`SLACK_BOT_TOKEN` from core `.env`; do not duplicate that secret.

```bash
cp .env.review-monitor.example .env.review-monitor
chmod 600 .env.review-monitor
./ops/docker/verify-review-monitor.sh
```

If using an external PostgreSQL, update `DATABASE_URL` in `compose.yml` or add a
production override file such as `compose.prod.yml`.

To temporarily switch provider/model without editing code, change these values in `.env`:

```text
LLM_PROVIDER=<provider-id>
LLM_BASE_URL=<openai-compatible-base-url>
LLM_PRIMARY_MODEL=<provider-id>/<model-id>
LLM_MODEL_ID=<model-id>
```

Then restart only the worker:

```bash
docker compose up -d worker
```

To return to current production model:

```text
LLM_PRIMARY_MODEL=9router/komerce-1.2
LLM_MODEL_ID=komerce-1.2
```

## 6. OpenClaw In Docker

The provided Docker image uses Node 24 and installs pinned OpenClaw CLI version
`2026.5.12` in `/usr/local/bin/openclaw`, matching the verified production VPS
runtime.

When `OPENCLAW_CONFIGURE=true` or `REGISTER_WORKER_MODE=agent`, the worker
entrypoint runs `ops/docker/configure-openclaw.js`. That script creates or
updates `/root/.openclaw/openclaw.json` from `.env` values, so model/provider
changes do not require code edits.

It also writes `/root/.openclaw/company-detector.env` with mode `0600`.
This internal file contains only `DATABASE_URL`, which agent-launched finalizer
commands need when OpenClaw sanitizes inherited environment variables.
Integration tokens remain in the container environment/OpenClaw config and are
not duplicated into this runtime file.

The worker also needs:

```text
OPENCLAW_WORKSPACE=/app/openclaw_workspace
OPENCLAW_BIN=/usr/local/bin/openclaw
OPENCLAW_CONFIG or equivalent provider config
9Router endpoint/API configuration
Telegram/search credentials if enabled
```

Full agent smoke test:

```bash
docker compose exec worker /usr/local/bin/openclaw --version
docker compose exec worker /usr/local/bin/openclaw status
docker compose exec worker node webhook/worker.js --once
```

Do not cut over production until these commands work inside the container.

Local note from 2026-06-08: the developer machine's default OpenClaw config had
a stale `9router` provider entry that failed schema validation. Telegram was
tested with an isolated OpenClaw state directory copied from the existing
Telegram config and with the invalid model provider removed. Before production,
use a clean office-approved OpenClaw config containing the active 9Router
provider/model and Telegram credentials.

Telegram smoke test pattern:

```bash
docker compose run --rm -T \
  -v /secure/openclaw-state:/openclaw-state:ro \
  -e OPENCLAW_STATE_DIR=/openclaw-state \
  -e OPENCLAW_CONFIG_PATH=/openclaw-state/openclaw.json \
  worker openclaw message send \
    --channel telegram \
    --account default \
    --target "<TELEGRAM_TARGET>" \
    --message "[PRE-PRODUCTION DOCKER TEST] Company Detector Telegram delivery from worker container" \
    --json
```

## 7. Server Deployment Steps

On server:

```bash
git clone https://github.com/nunutech40/company-detector-bot.git
cd company-detector-bot
test -f go-service/go.mod
test -f go-service/internal/evidence/evidence.go
test ! -d go-services
sed -n '1,40p' Dockerfile
cp .env.docker.example .env
# edit .env with real values
docker compose build
docker compose up -d postgres migrate dashboard webhook worker digest
docker compose ps
./ops/docker/verify-precutover.sh
```

Important source-tree guard:

- The Go module path is `go-service`, singular.
- The Docker build entrypoints are `./cmd/company-check`, `./cmd/web-search`,
  `./cmd/tool-status`, and `./cmd/last-report`.
- There is no supported `go-services/cmd/main.go` build path. If an office
  server sees that path, it is building an old checkout, stale archive, or
  wrong Dockerfile.
- `go-service/internal/evidence/evidence.go` must exist before running
  `docker compose build`.

Keep `gateway` stopped until the final Telegram cutover window.

### Enable Negative Feedback Monitor

Meta monitoring uses a separate env file and Compose profile. Enable it after
the core stack is healthy:

```bash
cp .env.feedback-monitor.sample .env.feedback-monitor
chmod 600 .env.feedback-monitor
# Fill META_ACCESS_TOKEN, FEEDBACK_AI_*, FEEDBACK_TELEGRAM_TO,
# REVIEW_MONITOR_SLACK_CHANNEL, and optional META_PAGE_IDS.
docker compose --profile feedback-monitor up -d feedback-monitor-ingress feedback-monitor-worker
docker compose run --rm feedback-monitor-worker node feedback_monitor/worker.js poll-meta
docker compose run --rm feedback-monitor-worker node feedback_monitor/worker.js status
```

The first clean database run fetches Facebook Pages from `/me/accounts`.
The poller normalizes Meta's `access_token` field to `page_access_token`
internally; do not prefill stale page tokens in `feedback_sources`.

### Backup from the old VPS

Before cutover, stop intake briefly or coordinate a maintenance window, then
create a final PostgreSQL dump on the old VPS:

```bash
pg_dump -Fc "$DATABASE_URL" -f company_detection.dump
```

Transfer `company_detection.dump` to the office server through an approved
secure channel. Secrets are handed over separately; do not put them in Git.

### Restore existing production data

Restore before starting the office worker:

```bash
docker compose stop worker
docker compose cp company_detection.dump postgres:/tmp/company_detection.dump
docker compose exec -T postgres pg_restore \
  -U company_detection -d company_detection \
  --clean --if-exists /tmp/company_detection.dump
docker compose up -d worker
```

### Cutover order

1. Run `./ops/docker/verify-precutover.sh` while VPS production remains active.
2. Confirm the old VPS queues have no normal backlog (`pending`,
   `retry_pending`, or `processing`). `failed` or `blocked_provider` rows need
   separate operator handling and must not be silently dropped.
3. Stop the old VPS gateway, register worker, feedback worker, feedback poller
   timer, Slack digest timer, and old webhook if the platform URL is about to
   move.
4. Start office `gateway`, then run `./ops/docker/verify-deployment.sh`.
5. Confirm the report arrives through the production Telegram bot.
6. Run Slack `--test-run` and confirm the office channel receives it.
7. Start the feedback monitor profile and confirm `poll-meta` succeeds.
8. Change the platform register webhook URL to the office server.
9. Submit one final register test and confirm dashboard, DB, and Telegram.

Rollback: point the platform webhook back to the old VPS and restart its
services. Do not run both workers against the same intake flow.

## 8. Verification Before Cutover

### One-command acceptance test

After production secrets are installed and all Compose services are running:

```bash
chmod +x ops/docker/verify-deployment.sh
./ops/docker/verify-deployment.sh
```

The script verifies Compose, service status, webhook, dashboard, OpenClaw,
model access, and Slack digest dry-run. It then asks for one real test identity,
queues it through the same webhook/worker flow as production, and waits until
the result is saved to PostgreSQL.

The final human acceptance check is simple: confirm that the resulting
`Company Detection Report` arrives in the intended production Telegram bot.
Do not cut over if the script fails or Telegram receives nothing.

Example failure:

```text
FAIL  LLM_API_KEY is missing
```

Fix the named `.env` value, run `docker compose up -d worker`, then rerun the
acceptance test. A failed acceptance test is a deployment blocker, not a warning.

### Manual investigation through Telegram

The production Telegram bot can also be used as a manual investigation console.
This requires an active Telegram gateway/poller on the office server. Never run
the office poller and old-VPS poller concurrently with the same bot token.
Send a message in this format:

```text
Investigasi akun ini sampai selesai:
email: nama@example.com
full_name: Nama Lengkap
brand_name: Nama Brand
no_hp: 08123456789

Cari evidence bisnis dari public web dan social media yang tersedia.
Simpan hasil investigasi sesuai standing orders.
```

`email` is required. Other fields are optional but improve investigation
quality. The agent may discover public Instagram/Facebook/marketplace evidence,
but `no_hp` remains confirmation-only and must not be used as a public search
seed.

- [ ] `docker compose ps` shows `dashboard`, `webhook`, `worker`, `gateway`, and `digest` running.
- [ ] `docker compose ps` shows `feedback-monitor-ingress` and `feedback-monitor-worker` running if Meta monitoring is in scope.
- [ ] `digest` is running and its log shows the next scheduled run.
- [ ] `GET /health` returns OK.
- [ ] Feedback ingress `/health` returns OK when its profile is enabled.
- [ ] Dashboard `/sales-sheet` loads.
- [ ] Smoke webhook inserts `register_intake_jobs`.
- [ ] Worker processes deterministic smoke test.
- [ ] OpenClaw works inside worker container.
- [ ] Worker processes one full `agent` mode smoke test.
- [ ] Full agent result is saved to DB and delivered by the production Telegram bot.
- [ ] Meta `poll-meta` returns `successful_pages > 0` and `failed_pages = 0` when Meta monitoring is enabled.
- [ ] Slack digest dry-run works in container.
- [ ] Slack digest `--test-run` reaches the intended office Slack channel.
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
