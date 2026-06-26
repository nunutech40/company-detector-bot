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
- Pastikan `.env` tidak ikut backup publik, artifact build, atau log deployment.
- Jangan menjalankan `docker compose config` pada output CI/log publik karena
  Compose dapat menampilkan nilai environment yang sudah di-resolve.

## 2. Secret Locations

| Location | Contents | Permission |
|---|---|---|
| Docker `.env` or office secret manager | DB, LLM, webhook, Slack, Telegram, search keys, runtime config | `600` / server restricted |
| GitHub deploy key on server | Repository read access if repository is private | office-managed |

## 3. Required Secrets Checklist

| Secret / value | Required | Owner / source | Install location | Verification | Status |
|---|---:|---|---|---|---|
| `POSTGRES_PASSWORD` or external DB credentials | Yes | Database/server engineer | Docker `.env` / secret manager | Acceptance test DB checks pass | Pending |
| `WEBHOOK_SECRET` | Yes | Platform/backend owner | Docker `.env` and register platform | Authenticated webhook returns queued response | Pending |
| `LLM_API_KEY` / 9Router API key or placeholder | Yes | AI/provider account owner | Docker `.env` or secret manager | OpenClaw agent smoke test completes | Pending |
| `LLM_PRIMARY_MODEL` / `LLM_MODEL_ID` | Yes | Product/AI owner | Docker `.env` or OpenClaw config | `openclaw models list` and agent smoke test | Pending |
| `DEEPSEEK_API_KEY` | Required for VPS-equivalent fallback | AI/provider account owner | Docker `.env` / secret manager | DeepSeek provider appears in OpenClaw config | Pending |
| `MINIMAX_API_KEY` | Required for VPS-equivalent fallback | AI/provider account owner | Docker `.env` / secret manager | MiniMax provider appears in OpenClaw config | Pending |
| `SLACK_BOT_TOKEN` | Yes | Slack app owner | Docker `.env` / secret manager | Slack digest dry-run/send test | Pending |
| `SLACK_REPORT_CHANNEL` | Yes | Sales/Slack owner | Docker `.env` / secret manager | Test message reaches correct channel | Pending |
| `TELEGRAM_DEFAULT_BOT_TOKEN` | Yes | Telegram bot owner | Docker `.env` / secret manager | Worker delivery test succeeds | Pending |
| `REGISTER_WORKER_TELEGRAM_TO` | Yes | Telegram destination owner | Docker `.env` / secret manager | Test report reaches correct destination | Pending |
| `BRAVE_SEARCH_API_KEY` | Yes, required for VPS-equivalent investigation quality | Search provider owner | Docker `.env` / secret manager | Runtime parity and search behavior tests pass | Pending |
| `GOOGLE_CSE_KEY` and `GOOGLE_CSE_ID` | Optional fallback | Search provider owner | Docker `.env` / secret manager | Search fallback smoke test succeeds | Pending |
| GitHub deploy key/token | Only if repo is private | GitHub/repository admin | Server SSH/Git credential store | `git pull` succeeds | Pending |
| TLS certificate/private key | Depends on office infrastructure | Infrastructure engineer | Reverse proxy/certificate manager | Public HTTPS check succeeds | Pending |
| Google OAuth client ID/secret | Only when review monitor is enabled | Google Cloud project owner | `.env.review-monitor` / secret manager | OAuth refresh succeeds | Pending |
| Google OAuth refresh token | Only when review monitor is enabled | Authorized Business Profile manager | `.env.review-monitor` / secret manager | Reviews API collect succeeds | Pending |
| `GBP_ACCOUNT_ID` / `GBP_LOCATION_ID` | Only when review monitor is enabled | Business Profile manager | `.env.review-monitor` | Correct profile reviews are returned | Pending |
| `REVIEW_MONITOR_SLACK_CHANNEL` | Only when review monitor is enabled | Slack/channel owner | `.env.review-monitor` | Shared Slack bot `test-send` reaches `monitor-negatif-company` | Pending |
| `META_ACCESS_TOKEN` | Yes for Meta feedback monitor | Meta Business/App owner | `.env.feedback-monitor` / secret manager | `sync-meta-pages` returns owned FB Pages and IG accounts | Pending |
| `META_PAGE_IDS` | Optional allow-list | Meta Business/App owner | `.env.feedback-monitor` | Poller only monitors intended pages | Pending |
| `FEEDBACK_AI_API_KEY` / `FEEDBACK_AI_BASE_URL` / `FEEDBACK_AI_MODEL` | Yes for Meta comment classifier | AI/provider owner | `.env.feedback-monitor` / secret manager | Test comment is classified and delivered to Telegram | Pending |
| `FEEDBACK_TELEGRAM_TO` | Yes for feedback monitor | Telegram destination owner | `.env.feedback-monitor` | Non-negative test comment reaches Telegram | Pending |
| `META_WEBHOOK_VERIFY_TOKEN` / `META_APP_SECRET` | Only if Meta webhook is enabled | Meta App owner | `.env.feedback-monitor` / secret manager | Meta webhook verification and signature validation pass | Pending |
| `META_ACCESS_TOKEN` | Yes for Meta feedback monitor | Meta Business/App owner | `.env.feedback-monitor` / secret manager | `sync-meta-pages` returns owned FB Pages and IG accounts | Pending |
| `META_PAGE_IDS` | Optional allow-list | Meta Business/App owner | `.env.feedback-monitor` | Poller only monitors intended pages | Pending |
| `FEEDBACK_AI_API_KEY` / `FEEDBACK_AI_BASE_URL` / `FEEDBACK_AI_MODEL` | Yes for Meta comment classifier | AI/provider owner | `.env.feedback-monitor` / secret manager | Test comment is classified and delivered to Telegram | Pending |
| `FEEDBACK_TELEGRAM_TO` | Yes for feedback monitor | Telegram destination owner | `.env.feedback-monitor` | Non-negative test comment reaches Telegram | Pending |
| `META_WEBHOOK_VERIFY_TOKEN` / `META_APP_SECRET` | Only if Meta webhook is enabled | Meta App owner | `.env.feedback-monitor` / secret manager | Meta webhook verification and signature validation pass | Pending |
| `META_ACCESS_TOKEN` | Yes for Meta feedback monitor | Meta Business/App owner | `.env.feedback-monitor` / secret manager | `sync-meta-pages` returns owned FB Pages and IG accounts | Pending |
| `META_PAGE_IDS` | Optional allow-list | Meta Business/App owner | `.env.feedback-monitor` | Poller only monitors intended pages | Pending |
| `FEEDBACK_AI_API_KEY` / `FEEDBACK_AI_BASE_URL` / `FEEDBACK_AI_MODEL` | Yes for Meta comment classifier | AI/provider owner | `.env.feedback-monitor` / secret manager | Test comment is classified and delivered to Telegram | Pending |
| `FEEDBACK_TELEGRAM_TO` | Yes for feedback monitor | Telegram destination owner | `.env.feedback-monitor` | Non-negative test comment reaches Telegram | Pending |
| `META_WEBHOOK_VERIFY_TOKEN` / `META_APP_SECRET` | Only if Meta webhook is enabled | Meta App owner | `.env.feedback-monitor` / secret manager | Meta webhook verification and signature validation pass | Pending |

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
| Primary model | `9router/komerce-1.2` | Product/AI owner | Pending |

## 5. Installation Check

Run from the repository as the deployment user after secrets are installed:

```bash
chmod 600 .env
docker compose up -d postgres migrate dashboard webhook worker digest
./ops/docker/verify-precutover.sh
# Start gateway only during the final Telegram cutover window.
docker compose up -d gateway
./ops/docker/verify-deployment.sh
```

Do not use commands such as `cat .env` in shared screenshares or deployment reports.
Do not start the office `gateway` while the VPS gateway is polling the same
Telegram bot.

Review monitor uses a separate `.env.review-monitor` with permission `600`.
Do not enable the optional Compose profile until OAuth, real API collect, and
Telegram test-send checks pass.

Negative feedback monitor uses `.env.feedback-monitor` with permission `600`.
Current production source is Meta Graph API polling, so `META_ACCESS_TOKEN` is
required. `META_WEBHOOK_VERIFY_TOKEN` and `META_APP_SECRET` are only required
when Meta webhook callback/subscription is activated.

Negative feedback monitor uses `.env.feedback-monitor` with permission `600`.
Current production source is Meta Graph API polling, so `META_ACCESS_TOKEN` is
required. `META_WEBHOOK_VERIFY_TOKEN` and `META_APP_SECRET` are only required
when Meta webhook callback/subscription is activated.

Negative feedback monitor uses `.env.feedback-monitor` with permission `600`.
Current production source is Meta Graph API polling, so `META_ACCESS_TOKEN` is
required. `META_WEBHOOK_VERIFY_TOKEN` and `META_APP_SECRET` are only required
when Meta webhook callback/subscription is activated.

## 6. Sign-Off

| Role | Name | Date | Result |
|---|---|---|---|
| Secret owner / system owner |  |  | Pending |
| Office deployment engineer |  |  | Pending |
| Platform webhook owner |  |  | Pending |
| User acceptance tester |  |  | Pending |
