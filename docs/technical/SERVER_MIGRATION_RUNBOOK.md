# Server Migration Runbook

**Status:** Preparation checklist  
**Purpose:** Pindah Company Detector dari VPS lama ke server kantor, termasuk OpenClaw runtime, webhook, worker, dashboard, PostgreSQL, Sales Sheet, Telegram delivery, dan Slack daily digest.

---

## 1. Migration Goal

Target migrasi:

```text
Old VPS: 103.226.139.107
New server: <SERVER_KANTOR_IP_OR_DOMAIN>
App user: <SERVER_USER>
```

Komponen yang harus ikut pindah:

- OpenClaw gateway/runtime
- `openclaw_workspace` instructions, tools, scripts, hooks, skills
- Go binary `company-check`
- PostgreSQL database `company_detection`
- Dashboard Express/EJS
- Webhook API + sequential register worker
- Slack daily digest jam 09:00 Asia/Jakarta
- Nginx reverse proxy untuk dashboard/Sales Sheet
- Environment secrets dan credentials
- Existing evidence/report/export artifacts jika masih dibutuhkan untuk audit

---

## 2. Non-Negotiable Rules

- Jangan cutover webhook register sebelum server baru lolos smoke test.
- Jangan mengurangi tool, context, investigation depth, atau model capability hanya supaya server baru terlihat "jalan".
- Jangan expose raw evidence, AI reasoning, search logic, tool traces, atau scoring internals ke Slack.
- `no_hp` tetap confirmation-only untuk investigasi, tetapi boleh tampil di Sales Sheet dan Slack prospect digest untuk follow-up sales.
- AI/OpenClaw tidak menulis langsung ke DB/Slack; finalizer dan digest tetap menjadi writer/delivery boundary.
- Worker tetap sequential kecuali ada instruksi eksplisit untuk parallelization.
- Simpan backup DB dan config lama sebelum perubahan DNS/webhook URL.

---

## 3. Current Production Inventory

| Area | Old VPS Value |
|---|---|
| Host | `103.226.139.107` |
| User | `nunuopc` |
| Workspace | `/home/nunuopc/.openclaw/workspace` |
| Go binary | `/home/nunuopc/.openclaw/go-service/bin/company-check` |
| OpenClaw config | `/home/nunuopc/.openclaw/openclaw.json` |
| Env file | `/home/nunuopc/.openclaw/gateway.systemd.env` |
| Dashboard path | `/home/nunuopc/.openclaw/dashboard` |
| Webhook path | `/home/nunuopc/.openclaw/webhook` |
| DB | PostgreSQL `company_detection` |
| Dashboard public URL | `http://103.226.139.107/sales-sheet` |
| Webhook URL | `http://103.226.139.107:3002/webhook/check` |
| OpenClaw provider | `sumopod` |
| OpenClaw primary model | `sumopod/kimi-k2.6` |
| Provider base URL | `https://ai.sumopod.com/v1` |

Active services:

```text
openclaw-gateway       port 18789
company-dashboard      port 3001
company-webhook        port 3002
company-register-worker
company-slack-digest.timer  02:00 UTC = 09:00 WIB
postgresql             port 5432 local
nginx                  port 80
```

---

## 4. Data To Collect From Server Kantor

Isi ini sebelum eksekusi:

```text
SERVER_HOST=
SERVER_USER=
SSH_PORT=22
PUBLIC_BASE_URL=
WEBHOOK_PUBLIC_URL=
DASHBOARD_PUBLIC_BASE_URL=
POSTGRES_VERSION=
OS=
CPU/RAM/DISK=
FIREWALL_POLICY=
DOMAIN_OR_SUBDOMAIN=
```

Minimum server requirement:

- Linux server dengan systemd.
- Node.js LTS tersedia.
- Go tersedia untuk build di server, atau binary Linux dikirim dari lokal.
- PostgreSQL tersedia.
- Nginx tersedia untuk reverse proxy.
- Outbound HTTPS boleh ke provider LLM, Slack, Telegram, search provider.
- Inbound HTTP/HTTPS dibuka untuk dashboard dan webhook sesuai network kantor.

---

## 5. Secrets And Credentials Checklist

Secrets tidak boleh ditulis ke Git.

Harus dimigrasikan dari old VPS ke server kantor:

- `DATABASE_URL`
- `WEBHOOK_SECRET`
- `SLACK_BOT_TOKEN`
- `SLACK_REPORT_CHANNEL`
- Telegram credentials/allowFrom file
- OpenClaw provider API key untuk Sumopod
- Brave/Search provider key jika dipakai
- Any `DASHBOARD_BASE_URL`, `DASHBOARD_PUBLIC_BASE_URL`, `SALES_SHEET_WEB_URL`, `SALES_SHEET_LATEST_URL`

File penting:

```text
/home/nunuopc/.openclaw/gateway.systemd.env
/home/nunuopc/.openclaw/openclaw.json
/home/nunuopc/.openclaw/credentials/
```

Di server kantor, path boleh tetap mengikuti pola:

```text
/home/<SERVER_USER>/.openclaw/gateway.systemd.env
/home/<SERVER_USER>/.openclaw/openclaw.json
/home/<SERVER_USER>/.openclaw/credentials/
```

Kalau user bukan `nunuopc`, update semua systemd unit dan script yang hardcoded path `/home/nunuopc`.

---

## 6. Backup Old VPS

Jalankan di old VPS sebelum migrasi:

```bash
mkdir -p ~/company-detector-backup

pg_dump -Fc company_detection \
  -f ~/company-detector-backup/company_detection_$(date +%Y%m%d-%H%M%S).dump

tar -czf ~/company-detector-backup/openclaw_workspace_artifacts_$(date +%Y%m%d-%H%M%S).tgz \
  -C ~/.openclaw/workspace evidence reports exports 2>/dev/null || true

cp ~/.openclaw/gateway.systemd.env ~/company-detector-backup/gateway.systemd.env
cp ~/.openclaw/openclaw.json ~/company-detector-backup/openclaw.json
tar -czf ~/company-detector-backup/openclaw_credentials_$(date +%Y%m%d-%H%M%S).tgz \
  -C ~/.openclaw credentials 2>/dev/null || true
```

Copy backup ke lokal atau langsung ke server kantor:

```bash
scp -r <OLD_USER>@<OLD_HOST>:~/company-detector-backup ./company-detector-backup
```

---

## 7. Prepare Server Kantor

Install packages:

```bash
sudo apt update
sudo apt install -y git curl build-essential postgresql postgresql-contrib nginx nodejs npm
```

Create directories:

```bash
mkdir -p ~/.openclaw/workspace/{config,scripts,hooks,evidence,reports,exports}
mkdir -p ~/.openclaw/go-service/bin
mkdir -p ~/.openclaw/dashboard/views
mkdir -p ~/.openclaw/dashboard/public/exports
mkdir -p ~/.openclaw/webhook
mkdir -p ~/.config/systemd/user
```

Enable lingering if user services must run after logout:

```bash
sudo loginctl enable-linger <SERVER_USER>
```

---

## 8. Restore Database

Create DB and user according to server policy.

Example:

```bash
sudo -u postgres createdb company_detection
pg_restore -d company_detection /path/to/company_detection.dump
```

If not restoring existing DB, apply migrations in order:

```bash
psql -d company_detection -f docs/technical/migration_v1.sql
psql -d company_detection -f docs/technical/migration_v2_webhook_slack_queue.sql
psql -d company_detection -f docs/technical/migration_v3_report_provenance.sql
psql -d company_detection -f docs/technical/migration_v4_llm_usage_provenance.sql
```

Verify:

```bash
psql "$DATABASE_URL" -c "\dt"
psql "$DATABASE_URL" -c "select count(*) from investigation_jobs;"
psql "$DATABASE_URL" -c "select count(*) from register_intake_jobs;"
```

---

## 9. Deploy Code And Runtime Files

Current `deploy.sh` is still old-VPS specific:

```text
VPS_HOST=103.226.139.107
VPS_USER=nunuopc
Paths hardcoded to /home/nunuopc/.openclaw/...
```

Before using it for server kantor, either:

1. parameterize `deploy.sh`, or
2. copy it to a temporary migration script and replace host/user/path values.

Files/directories to deploy:

- `openclaw_workspace/AGENTS.md`
- `openclaw_workspace/STANDING_ORDERS.md`
- `openclaw_workspace/TOOLS.md`
- `openclaw_workspace/config/*.yaml`
- `openclaw_workspace/scripts/*.js`
- `openclaw_workspace/scripts/*.sh`
- `openclaw_workspace/hooks/`
- `dashboard/`
- `webhook/`
- `ops/systemd/`
- `ops/nginx/company-detector.conf`
- Linux Go binary `company-check`

After copy:

```bash
chmod +x ~/.openclaw/workspace/scripts/*.sh
chmod +x ~/.openclaw/webhook/worker.js
cd ~/.openclaw/workspace && npm install --omit=dev
cd ~/.openclaw/dashboard && npm install --omit=dev
cd ~/.openclaw/webhook && npm install --omit=dev
```

---

## 10. OpenClaw Setup

Install/start OpenClaw according to the server kantor policy.

Then restore/update:

```text
~/.openclaw/openclaw.json
~/.openclaw/gateway.systemd.env
~/.openclaw/credentials/
```

Must preserve:

```text
provider: sumopod
baseUrl: https://ai.sumopod.com/v1
primary model: sumopod/kimi-k2.6
```

Smoke test:

```bash
openclaw status
```

---

## 11. Systemd Services

Install user units:

```bash
cp ops/systemd/company-register-worker.service ~/.config/systemd/user/
cp ops/systemd/company-slack-digest.service ~/.config/systemd/user/
cp ops/systemd/company-slack-digest.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now company-register-worker.service
systemctl --user enable --now company-slack-digest.timer
```

Important: if server user is not `nunuopc`, update paths in the unit files:

```text
WorkingDirectory=/home/<SERVER_USER>/.openclaw/...
EnvironmentFile=/home/<SERVER_USER>/.openclaw/gateway.systemd.env
Environment=OPENCLAW_WORKSPACE=/home/<SERVER_USER>/.openclaw/workspace
```

Dashboard and webhook services currently exist on old VPS but are not fully stored in repo. During migration, export them from old VPS or create equivalent units:

```text
company-dashboard.service
company-webhook.service
openclaw-gateway.service
```

Minimum expected:

```bash
systemctl --user status openclaw-gateway
systemctl --user status company-dashboard
systemctl --user status company-webhook
systemctl --user status company-register-worker
systemctl --user list-timers | grep company-slack-digest
```

---

## 12. Nginx And Public URLs

Current nginx template proxies `/` to dashboard:

```text
ops/nginx/company-detector.conf
```

Install:

```bash
sudo cp ops/nginx/company-detector.conf /etc/nginx/sites-available/company-detector.conf
sudo ln -s /etc/nginx/sites-available/company-detector.conf /etc/nginx/sites-enabled/company-detector.conf
sudo nginx -t
sudo systemctl reload nginx
```

If using domain/HTTPS, add server_name and TLS config.

Set env values to new public URL:

```text
DASHBOARD_BASE_URL=http://127.0.0.1:3001
DASHBOARD_PUBLIC_BASE_URL=https://<domain-or-ip>
SALES_SHEET_WEB_URL=https://<domain-or-ip>/sales-sheet
SALES_SHEET_LATEST_URL=https://<domain-or-ip>/sales-sheet/latest.xlsx
```

Webhook public URL to give platform team:

```text
https://<domain-or-ip>:3002/webhook/check
```

or proxy it through nginx:

```text
https://<domain-or-ip>/webhook/check
```

If webhook is proxied through nginx, update dashboard/webhook docs and platform integration.

---

## 13. Verification Checklist

Run these on server kantor.

### Service health

```bash
openclaw status
curl -fsS http://127.0.0.1:3001/sales-sheet >/dev/null
curl -fsS http://127.0.0.1:3002/health
systemctl --user --no-pager status company-register-worker
systemctl --user list-timers | grep company-slack-digest
```

### Database

```bash
psql "$DATABASE_URL" -c "select count(*) from investigation_jobs;"
psql "$DATABASE_URL" -c "select count(*) from final_reports;"
psql "$DATABASE_URL" -c "select count(*) from llm_calls;"
psql "$DATABASE_URL" -c "select status, count(*) from register_intake_jobs group by status;"
```

### OpenClaw model

```bash
node -e "const c=require(process.env.HOME+'/.openclaw/openclaw.json'); console.log(c.agents.defaults.model.primary)"
```

Expected:

```text
sumopod/kimi-k2.6
```

### Deterministic Go pipeline

```bash
cd ~/.openclaw/workspace
scripts/company_check_go.sh --email contact@komerce.id --save
```

### Slack digest preview

```bash
cd ~/.openclaw/workspace
node scripts/slack_daily_digest.js --dry-run --test-run --window-hours 999 | sed -n '1,80p'
```

Expected:

- Message renders without error.
- Prospect list includes `Kontak:` and `WhatsApp:` when phone exists.
- Sales Sheet URL points to server kantor, not old VPS.

### Webhook queue smoke test

```bash
curl -X POST https://<SERVER_KANTOR_URL>/webhook/check \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <WEBHOOK_SECRET>" \
  -d '{
    "email": "migration-smoke-test@example.com",
    "full_name": "Migration Smoke Test",
    "brand_name": "Migration Test",
    "no_hp": "08123456789",
    "source": "migration_smoke_test",
    "external_id": "migration-smoke-test-001",
    "idempotency_key": "migration_smoke_test:001"
  }'
```

Then verify:

```bash
psql "$DATABASE_URL" -c "select email, status, attempt_count, investigation_job_id, last_error from register_intake_jobs where idempotency_key='migration_smoke_test:001';"
```

Run one worker pass if needed:

```bash
cd ~/.openclaw/webhook
node worker.js --once
```

### Dashboard

Open:

```text
https://<domain-or-ip>/sales-sheet
https://<domain-or-ip>/
```

Verify:

- Completed jobs visible.
- Sales Sheet loads.
- Phone column populated from `payload_json.no_hp`.
- Detail page does not route to old IP.

---

## 14. Cutover Plan

1. Freeze old server worker temporarily:

   ```bash
   systemctl --user stop company-register-worker
   ```

2. Ensure old queue is drained or intentionally exported.
3. Take final DB backup.
4. Restore DB to server kantor.
5. Start services on server kantor.
6. Run all verification checks.
7. Ask platform team to update webhook URL to server kantor.
8. Keep old VPS read-only/standby for at least 24-48 hours.
9. Monitor:

   ```bash
   journalctl --user -u company-register-worker -f
   journalctl --user -u company-webhook -f
   journalctl --user -u company-dashboard -f
   journalctl --user -u company-slack-digest.service -n 100
   ```

10. After stable, disable old timers/services.

---

## 15. Rollback Plan

Rollback trigger:

- Webhook returns 5xx/401 unexpectedly.
- Worker cannot process jobs.
- OpenClaw provider fails.
- Dashboard/Sales Sheet unavailable.
- Slack digest points to wrong URL or sends malformed output.

Rollback:

1. Point platform webhook URL back to old VPS.
2. Restart old worker:

   ```bash
   systemctl --user start company-register-worker
   ```

3. Disable server kantor worker to avoid duplicate processing:

   ```bash
   systemctl --user stop company-register-worker
   ```

4. Compare queues and recover any pending jobs manually if needed.

---

## 16. Post-Migration Docs To Update

After migration succeeds, update:

- `FETCH_CONTEXT.md`
- `README.md`
- `docs/README.md`
- `docs/technical/TRD.md`
- `docs/technical/FLOW_MAP.md`
- `docs/technical/REGISTER_WEBHOOK_API.md`
- `docs/technical/WEBHOOK_SLACK_DAILY_DIGEST_PLAN.md`
- `ops/systemd/README.md`
- `deploy.sh` host/user/path

Replace old references:

```text
103.226.139.107
nunuopc
/home/nunuopc
http://103.226.139.107/sales-sheet
http://103.226.139.107:3002/webhook/check
```

with server kantor values.
