# Office Server Deployment Handover

**Audience:** engineer kantor yang akan deploy Company Detector tanpa akses ke laptop developer.  
**Goal:** dari GitHub repo sampai semua service aktif di server kantor.  
**Repo:** `https://github.com/nunutech40/company-detector-bot`

Dokumen ini berbeda dari runbook migrasi. Runbook migrasi menjelaskan pindahan dari VPS lama. Dokumen ini adalah paket instruksi untuk orang yang menerima handover deployment.

## Document Map

| Kebutuhan | Dokumen |
|---|---|
| Deploy manual dari GitHub sampai service aktif | Dokumen ini |
| Daftar key/secrets yang harus diserahkan | `docs/technical/DEPLOYMENT_SECRETS_HANDOVER.md` |
| Memindahkan data dan runtime dari VPS lama | `docs/technical/SERVER_MIGRATION_RUNBOOK.md` |
| Kontrak endpoint register | `docs/technical/REGISTER_WEBHOOK_API.md` |
| Memahami alur sistem | `docs/technical/FLOW_MAP.md` |

## Deployment Sections

1. **System Overview** — komponen dan alur yang akan dijalankan.
2. **Server Preparation** — spesifikasi, package, user, dan folder.
3. **Repository** — akses GitHub dan clone source code.
4. **Keys And Secrets** — penyerahan serta pemasangan credential.
5. **Database** — membuat atau restore PostgreSQL.
6. **OpenClaw And AI** — runtime agent dan model provider.
7. **Application Install** — build dan copy seluruh project.
8. **Services** — systemd untuk dashboard, webhook, worker, dan digest.
9. **Network** — Nginx, domain, HTTPS, dan firewall.
10. **Verification And Cutover** — pembuktian seluruh flow berjalan.

---

## 1. System Overview

Company Detector terdiri dari:

```text
PostgreSQL company_detection
OpenClaw gateway/runtime
Go binary company-check
openclaw_workspace scripts/config/agent instructions
Webhook API       : port 3002
Register worker  : systemd user service
Dashboard         : port 3001
Nginx reverse proxy
Slack digest      : systemd user timer, daily 09:00 WIB
```

Runtime flow:

```text
Platform register
-> POST /webhook/check
-> PostgreSQL register_intake_jobs
-> company-register-worker
-> OpenClaw agent + Go baseline + tools
-> finish_investigation.sh
-> investigation_jobs/final_reports/llm_calls
-> dashboard + Sales Sheet
-> Slack daily digest jam 09:00 WIB
```

---

## 2. Server Preparation

### 2.1 Server Requirements

Minimum:

- Linux with systemd.
- Shell access with a non-root app user.
- Public or internal URL reachable by the platform register service.
- Outbound HTTPS to:
  - LLM provider `https://ai.sumopod.com`
  - Slack API
  - Telegram API
  - search providers if configured
- Inbound HTTP/HTTPS to dashboard/webhook through nginx.
- PostgreSQL available locally or reachable from server.

Recommended packages:

```bash
sudo apt update
sudo apt install -y git curl build-essential postgresql postgresql-contrib nginx nodejs npm golang
```

Node.js LTS is recommended. Go must support module `go 1.22`.

### 2.2 Account And Paths

Recommended app user:

```text
companydetector
```

Recommended paths:

```text
/home/companydetector/company-detector-bot
/home/companydetector/.openclaw/workspace
/home/companydetector/.openclaw/go-service/bin/company-check
/home/companydetector/.openclaw/dashboard
/home/companydetector/.openclaw/webhook
/home/companydetector/.openclaw/gateway.systemd.env
/home/companydetector/.openclaw/openclaw.json
/home/companydetector/.openclaw/credentials/
```

If the server uses another username, replace `companydetector` in every command and in `gateway.systemd.env`.

Enable user services after logout:

```bash
sudo loginctl enable-linger companydetector
```

---

## 3. Repository

### 3.1 Repository Access

Required:

```text
Repository : https://github.com/nunutech40/company-detector-bot
Branch     : main
Access     : read access is enough for deployment
```

The office engineer must confirm that the server can clone and pull the
repository before continuing. For a private repository, use a GitHub deploy key
or office-managed machine user. Do not copy a developer's personal SSH key.

### 3.2 Clone Repository

As app user:

```bash
cd ~
git clone https://github.com/nunutech40/company-detector-bot.git
cd company-detector-bot
```

If repository access uses SSH/private GitHub access, configure deploy key first.

---

## 4. Keys And Secrets

The deployment document intentionally contains no real secret values. Use the
separate checklist:

```text
docs/technical/DEPLOYMENT_SECRETS_HANDOVER.md
```

Secret values must be sent through an approved secure channel, then installed
directly on the server. Do not send them through GitHub issues, commit them to
the repository, or paste them into this document.

### 4.1 Runtime Environment File

Create:

```bash
mkdir -p ~/.openclaw
cp ops/gateway.systemd.env.example ~/.openclaw/gateway.systemd.env
chmod 600 ~/.openclaw/gateway.systemd.env
```

Fill real values:

```text
DATABASE_URL
WEBHOOK_SECRET
DASHBOARD_PUBLIC_BASE_URL
SALES_SHEET_WEB_URL
SALES_SHEET_LATEST_URL
SALES_SHEET_EXPORT_DIR
SLACK_BOT_TOKEN
SLACK_REPORT_CHANNEL
TELEGRAM_DELIVERY_TO or REGISTER_WORKER_TELEGRAM_TO
BRAVE_SEARCH_API_KEY if available
GOOGLE_CSE_KEY / GOOGLE_CSE_ID if available
OpenClaw provider API key in ~/.openclaw/openclaw.json
```

Do not put real secrets in Git.

---

## 5. Database

### 5.1 PostgreSQL Setup

Create DB and user according to internal policy.

Example:

```bash
sudo -u postgres psql
```

```sql
CREATE USER company_detection WITH PASSWORD 'CHANGE_ME_STRONG_PASSWORD';
CREATE DATABASE company_detection OWNER company_detection;
\q
```

Set `DATABASE_URL`:

```text
DATABASE_URL=postgresql://company_detection:CHANGE_ME_STRONG_PASSWORD@127.0.0.1:5432/company_detection
```

Apply migrations if starting fresh:

```bash
psql "$DATABASE_URL" -f docs/technical/migration_v1.sql
psql "$DATABASE_URL" -f docs/technical/migration_v2_webhook_slack_queue.sql
psql "$DATABASE_URL" -f docs/technical/migration_v3_report_provenance.sql
psql "$DATABASE_URL" -f docs/technical/migration_v4_llm_usage_provenance.sql
```

If migrating existing production data, restore dump instead:

```bash
pg_restore -d "$DATABASE_URL" /path/to/company_detection.dump
```

Verify:

```bash
psql "$DATABASE_URL" -c "\dt"
psql "$DATABASE_URL" -c "select count(*) from investigation_jobs;"
```

---

## 6. OpenClaw And AI

### 6.1 Install OpenClaw

Install OpenClaw according to the approved internal method.

Expected command after install:

```bash
~/.npm-global/bin/openclaw status
```

Restore or create:

```text
~/.openclaw/openclaw.json
~/.openclaw/credentials/
```

Required model config:

```text
provider: sumopod
baseUrl: https://ai.sumopod.com/v1
primary model: sumopod/kimi-k2.6
```

The API key must live in `~/.openclaw/openclaw.json` or whatever OpenClaw provider config uses on that server.

Smoke test:

```bash
~/.npm-global/bin/openclaw status
```

Expected: gateway reachable/running.

---

## 7. Application Install

### 7.1 Build And Install Project Files

Create target folders:

```bash
mkdir -p ~/.openclaw/workspace/{config,scripts,hooks,evidence,reports,exports}
mkdir -p ~/.openclaw/go-service/bin
mkdir -p ~/.openclaw/dashboard/views ~/.openclaw/dashboard/public/exports
mkdir -p ~/.openclaw/webhook
```

Build Go binary:

```bash
cd ~/company-detector-bot/go-service
go build -o ~/.openclaw/go-service/bin/company-check ./cmd/company-check
chmod +x ~/.openclaw/go-service/bin/company-check
```

Copy workspace:

```bash
cd ~/company-detector-bot
cp openclaw_workspace/AGENTS.md ~/.openclaw/workspace/
cp openclaw_workspace/STANDING_ORDERS.md ~/.openclaw/workspace/
cp openclaw_workspace/TOOLS.md ~/.openclaw/workspace/
cp -r openclaw_workspace/config ~/.openclaw/workspace/
cp -r openclaw_workspace/hooks ~/.openclaw/workspace/
cp -r openclaw_workspace/skills ~/.openclaw/workspace/ 2>/dev/null || true
cp openclaw_workspace/package*.json ~/.openclaw/workspace/
cp -r openclaw_workspace/scripts ~/.openclaw/workspace/
chmod +x ~/.openclaw/workspace/scripts/*.sh
cd ~/.openclaw/workspace && npm install --omit=dev
```

Copy dashboard:

```bash
cd ~/company-detector-bot
cp dashboard/package*.json ~/.openclaw/dashboard/
cp dashboard/app.js ~/.openclaw/dashboard/
cp -r dashboard/views ~/.openclaw/dashboard/
cd ~/.openclaw/dashboard && npm install --omit=dev
```

Copy webhook:

```bash
cd ~/company-detector-bot
cp webhook/package*.json ~/.openclaw/webhook/
cp webhook/app.js webhook/worker.js ~/.openclaw/webhook/
chmod +x ~/.openclaw/webhook/worker.js
cd ~/.openclaw/webhook && npm install --omit=dev
```

---

## 8. Services

### 8.1 Install Systemd User Services

Copy unit files:

```bash
mkdir -p ~/.config/systemd/user
cp ~/company-detector-bot/ops/systemd/company-dashboard.service ~/.config/systemd/user/
cp ~/company-detector-bot/ops/systemd/company-webhook.service ~/.config/systemd/user/
cp ~/company-detector-bot/ops/systemd/company-register-worker.service ~/.config/systemd/user/
cp ~/company-detector-bot/ops/systemd/company-slack-digest.service ~/.config/systemd/user/
cp ~/company-detector-bot/ops/systemd/company-slack-digest.timer ~/.config/systemd/user/
systemctl --user daemon-reload
```

Start services:

```bash
systemctl --user enable --now company-dashboard.service
systemctl --user enable --now company-webhook.service
systemctl --user enable --now company-register-worker.service
systemctl --user enable --now company-slack-digest.timer
```

Check:

```bash
systemctl --user --no-pager status company-dashboard
systemctl --user --no-pager status company-webhook
systemctl --user --no-pager status company-register-worker
systemctl --user list-timers | grep company-slack-digest
```

OpenClaw gateway service is managed by the OpenClaw installation. Ensure it is enabled/running separately:

```bash
systemctl --user --no-pager status openclaw-gateway
```

---

## 9. Network

### 9.1 Nginx

Install config:

```bash
sudo cp ~/company-detector-bot/ops/nginx/company-detector.conf /etc/nginx/sites-available/company-detector.conf
sudo ln -sf /etc/nginx/sites-available/company-detector.conf /etc/nginx/sites-enabled/company-detector.conf
sudo nginx -t
sudo systemctl reload nginx
```

Default routes:

```text
/             -> dashboard port 3001
/sales-sheet  -> dashboard port 3001
/webhook/*    -> webhook port 3002
/health       -> webhook health
```

If using a domain and HTTPS, add `server_name` and TLS config according to internal policy.

Give platform team this webhook URL:

```text
https://<SERVER_DOMAIN>/webhook/check
```

or, if not using nginx proxy for webhook:

```text
http://<SERVER_HOST>:3002/webhook/check
```

---

### 9.2 Firewall

Open only what is needed.

Typical:

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 22/tcp
```

Ports `3001`, `3002`, and `18789` should ideally stay localhost/internal only if nginx and OpenClaw gateway do not require public access.

---

## 10. Verification And Cutover

### 10.1 Verification

Run these as app user.

### OpenClaw

```bash
~/.npm-global/bin/openclaw status
```

### Dashboard

```bash
curl -fsS http://127.0.0.1:3001/sales-sheet >/dev/null
curl -fsS https://<SERVER_DOMAIN>/sales-sheet >/dev/null
```

### Webhook

```bash
curl -fsS http://127.0.0.1:3002/health
curl -fsS https://<SERVER_DOMAIN>/health
```

### Go baseline

```bash
cd ~/.openclaw/workspace
scripts/company_check_go.sh --email contact@komerce.id --save
```

### Slack digest dry-run

```bash
cd ~/.openclaw/workspace
node scripts/slack_daily_digest.js --dry-run --test-run --window-hours 999 | sed -n '1,80p'
```

Expected:

- No fatal error.
- Sales Sheet URL points to server kantor.
- Prospect rows include `Kontak:` and `WhatsApp:` when phone is available.

### Webhook queue smoke test

```bash
curl -X POST https://<SERVER_DOMAIN>/webhook/check \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <WEBHOOK_SECRET>" \
  -d '{
    "email": "office-deploy-smoke@example.com",
    "full_name": "Office Deploy Smoke",
    "brand_name": "Office Deploy Test",
    "no_hp": "08123456789",
    "source": "office_deploy_smoke",
    "external_id": "office-deploy-smoke-001",
    "idempotency_key": "office_deploy_smoke:001"
  }'
```

Expected response:

```json
{
  "ok": true,
  "queued": true,
  "status": "pending"
}
```

Check queue:

```bash
psql "$DATABASE_URL" -c "select email, status, attempt_count, investigation_job_id, last_error from register_intake_jobs where idempotency_key='office_deploy_smoke:001';"
```

If worker has not picked it yet:

```bash
cd ~/.openclaw/webhook
node worker.js --once
```

Then check dashboard and DB:

```bash
psql "$DATABASE_URL" -c "select email, classification, confidence_score, report_source from investigation_jobs order by created_at desc limit 5;"
```

---

### 10.2 Platform Cutover Checklist

Before platform team switches webhook:

- [ ] Dashboard loads on server kantor public URL.
- [ ] `/health` returns OK.
- [ ] `WEBHOOK_SECRET` agreed with platform team.
- [ ] Smoke webhook inserts queue row.
- [ ] Worker processes a smoke row.
- [ ] Completed job appears in dashboard.
- [ ] Slack digest dry-run works.
- [ ] Sales Sheet URL points to server kantor.
- [ ] OpenClaw model is `sumopod/kimi-k2.6`.
- [ ] Old VPS worker is stopped or old webhook is no longer receiving traffic to avoid duplicate investigations.

After platform switches webhook:

- [ ] Watch webhook logs.
- [ ] Watch worker logs.
- [ ] Confirm new register event reaches `register_intake_jobs`.
- [ ] Confirm first production register event completes.
- [ ] Confirm 09:00 Slack digest points to server kantor.

Logs:

```bash
journalctl --user -u company-webhook -f
journalctl --user -u company-register-worker -f
journalctl --user -u company-dashboard -f
journalctl --user -u company-slack-digest.service -n 100
```

---

## 11. Handover Deliverables

Send:

1. GitHub repo URL and branch:

   ```text
   https://github.com/nunutech40/company-detector-bot
   branch: main
   ```

2. This document:

   ```text
   docs/technical/OFFICE_SERVER_DEPLOYMENT_HANDOVER.md
   ```

3. Migration runbook if moving existing data:

   ```text
   docs/technical/SERVER_MIGRATION_RUNBOOK.md
   ```

4. Secrets checklist:

   ```text
   docs/technical/DEPLOYMENT_SECRETS_HANDOVER.md
   ```

5. Real secret values through an approved secure channel, not Git.

6. Expected public URLs:

   ```text
   Dashboard/Sales Sheet: https://<SERVER_DOMAIN>/sales-sheet
   Webhook: https://<SERVER_DOMAIN>/webhook/check
   ```

---

## 12. Known Gaps And Feedback

- OpenClaw installation method is external to this repo. Office engineer must install/enable OpenClaw runtime and provide `~/.npm-global/bin/openclaw`.
- Real OpenClaw provider API key must be added to `~/.openclaw/openclaw.json`.
- If server kantor cannot expose public HTTP/HTTPS, platform register must reach it through VPN/private network.
- If the app user is not `companydetector`, update path values in `gateway.systemd.env`.
- If old data must be preserved, do not start fresh migrations; restore `company_detection.dump`.

After the first office deployment, record any environment-specific correction
below and submit it back to this repository.

| Date | Feedback / missing step | Resolution | Added to docs |
|---|---|---|---|
| - | - | - | - |
