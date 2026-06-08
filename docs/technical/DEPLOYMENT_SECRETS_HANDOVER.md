# Deployment Secrets Handover

**Purpose:** checklist penyerahan key dan credential untuk deploy Company Detector.  
**Important:** dokumen ini hanya mencatat nama dan lokasi secret. Jangan menulis nilai secret asli di Git.

## 1. Handover Rules

- Kirim nilai secret melalui password manager atau secure channel kantor.
- Jangan kirim secret melalui GitHub, source code, screenshot, atau dokumen ini.
- Engineer server memasang secret langsung pada server tujuan.
- Batasi permission file yang berisi secret dengan `chmod 600`.
- Setelah deployment, pemilik sistem dan engineer server mengisi status checklist.
- Rotasi secret segera jika pernah terkirim melalui channel yang tidak aman.

## 2. Secret Locations

| Location | Contents | Permission |
|---|---|---|
| `~/.openclaw/gateway.systemd.env` | Database, webhook, Slack, Telegram target, search keys, runtime config | `600` |
| `~/.openclaw/openclaw.json` | OpenClaw provider configuration and Sumopod API key | `600` |
| `~/.openclaw/credentials/` | OpenClaw/Telegram credential files if used | directory private to app user |
| Docker `.env` or secret manager | Docker runtime env, LLM model/provider, webhook secret, Telegram values | server restricted |
| GitHub deploy key on server | Repository read access if repository is private | office-managed |

## 3. Required Secrets Checklist

| Secret / value | Required | Owner / source | Install location | Verification | Status |
|---|---:|---|---|---|---|
| `DATABASE_URL` or DB credentials | Yes | Database/server engineer | `gateway.systemd.env` | `psql "$DATABASE_URL" -c "select 1;"` | Pending |
| `WEBHOOK_SECRET` | Yes | Platform/backend owner | `gateway.systemd.env` and register platform | Authenticated webhook returns queued response | Pending |
| Sumopod API key | Yes | AI/provider account owner | `openclaw.json` | OpenClaw agent smoke test completes | Pending |
| `LLM_PRIMARY_MODEL` / `LLM_MODEL_ID` | Yes | Product/AI owner | Docker `.env` or OpenClaw config | `openclaw models list` and agent smoke test | Pending |
| `SLACK_BOT_TOKEN` | Yes | Slack app owner | `gateway.systemd.env` | Slack digest dry-run/send test | Pending |
| `SLACK_REPORT_CHANNEL` | Yes | Sales/Slack owner | `gateway.systemd.env` | Test message reaches correct channel | Pending |
| Telegram bot credential | If Telegram delivery enabled | Telegram bot owner | OpenClaw credentials/config | Worker delivery test succeeds | Pending |
| `TELEGRAM_DELIVERY_TO` or `REGISTER_WORKER_TELEGRAM_TO` | If Telegram delivery enabled | Telegram destination owner | `gateway.systemd.env` | Test report reaches correct destination | Pending |
| `BRAVE_SEARCH_API_KEY` | Optional but recommended | Search provider owner | `gateway.systemd.env` | Search tool smoke test succeeds | Pending |
| `GOOGLE_CSE_KEY` and `GOOGLE_CSE_ID` | Optional fallback | Search provider owner | `gateway.systemd.env` | Search fallback smoke test succeeds | Pending |
| GitHub deploy key/token | Only if repo is private | GitHub/repository admin | Server SSH/Git credential store | `git pull` succeeds | Pending |
| TLS certificate/private key | Depends on office infrastructure | Infrastructure engineer | Reverse proxy/certificate manager | Public HTTPS check succeeds | Pending |

## 4. Non-Secret Values That Must Be Confirmed

These values are not credentials, but deployment cannot be finalized without
agreement from the relevant owner.

| Value | Example / expected | Owner | Status |
|---|---|---|---|
| Server hostname/IP | Office-provided | Infrastructure | Pending |
| Public/internal domain | `company-detector.example.com` | Infrastructure | Pending |
| Dashboard URL | `https://<SERVER_DOMAIN>/sales-sheet` | Product/Infrastructure | Pending |
| Webhook URL | `https://<SERVER_DOMAIN>/webhook/check` | Platform/backend | Pending |
| App Linux user | `companydetector` | Infrastructure | Pending |
| Database retention/backup policy | Office policy | Infrastructure/DBA | Pending |
| Slack digest schedule | Daily `09:00 WIB` | Sales/Product | Pending |
| Primary model | `sumopod/kimi-k2.6` | Product/AI owner | Pending |

## 5. Installation Check

Run as the app user after secrets are installed:

```bash
chmod 600 ~/.openclaw/gateway.systemd.env
chmod 600 ~/.openclaw/openclaw.json
systemctl --user daemon-reload
systemctl --user restart openclaw-gateway company-dashboard company-webhook company-register-worker
```

Verify that secrets are readable by services without printing their values:

```bash
systemctl --user --no-pager status openclaw-gateway
systemctl --user --no-pager status company-dashboard
systemctl --user --no-pager status company-webhook
systemctl --user --no-pager status company-register-worker
```

Do not use commands such as `cat ~/.openclaw/gateway.systemd.env` in shared
screenshares or deployment reports.

## 6. Sign-Off

| Role | Name | Date | Result |
|---|---|---|---|
| Secret owner / system owner |  |  | Pending |
| Office deployment engineer |  |  | Pending |
| Platform webhook owner |  |  | Pending |
| User acceptance tester |  |  | Pending |
