# VPS and Docker Production Parity Audit (Historical Snapshot)

**Audit date:** 9 June 2026
**Current note:** This is a historical parity record. Current deployment status
is maintained in `README.md`, `FETCH_CONTEXT.md`, and the deployment checklist.
**Purpose:** Prevent the office Docker deployment from running with fewer
capabilities or producing lower-quality investigations than the current VPS.

## Release Rule

The office deployment is not production-ready until all mandatory rows below
are `PASS` and one known investigation produces an acceptable result.

```bash
./ops/docker/verify-precutover.sh
./ops/docker/verify-runtime-parity.sh
./ops/docker/verify-deployment.sh
```

Do not cut over only because containers are running.

`verify-precutover.sh` is safe to run while the VPS Telegram gateway remains
active. It intentionally skips the Telegram poller and full AI call.

## Current Pair-by-Pair Result

| Area | VPS | Docker office bundle | Status | Required action |
|---|---|---|---|---|
| OpenClaw | `2026.5.12` | `2026.5.12` | PASS | Keep version pinned |
| Node.js | `v24.15.0` | Node 24, tested `v24.16.0` | PASS | Same major runtime |
| PostgreSQL | `16.14` | `16.14` | PASS | Keep PostgreSQL 16 |
| Database schema | 6 tables, 74 columns | Same exact column and index fingerprints | PASS | Run all four migrations |
| Primary model | `9router/komerce-1.2` | `9router/komerce-1.2` | PASS | Keep exact model ID |
| 9Router protocol | `openai-completions` | `openai-completions` | PASS | Set `LLM_API` |
| 9Router models | `komerce-1.2` | Same | PASS | Keep both configured |
| OpenClaw plugins | `deepseek`, `llm-task`, `minimax` | Same | PASS | Supply provider keys |
| Tool profile | `full` + `llm-task` | Same | PASS | Checked automatically |
| Deterministic Go pipeline | Active | Active | PASS | Docker compiles current source |
| Go diagnostic binaries | `company-check`, `tool-status`, `last-report` | Same after audit fix | PASS | Checked automatically |
| Brave Search | Active | Active after gzip adapter fix | PASS | Brave key is mandatory |
| Telegram gateway | Active after local acceptance test | Docker gateway tested healthy, currently stopped | CONDITIONAL | Only one bot poller may run |
| Register worker mode | Agent | Agent default | PASS | Never deploy deterministic-only |
| Register Telegram delivery | Enabled | Enabled default | PASS | Set destination and allow list |
| Daily Slack digest | systemd timer, 09:00 WIB | Docker scheduler, 09:00 WIB | PASS BY DESIGN | Validate dry-run |
| Dashboard and webhook | systemd services | Compose services | PASS BY DESIGN | Validate health and routes |
| Historical data | 379 investigations, 489 register rows at audit time | Local test data only | BLOCKER | Restore production dump if history must move |
| Full AI behavior | VPS previously found Siti Romelah business evidence | Qwen test found the same business at 80/100; Kimi currently times out | CONDITIONAL PASS | Repeat once with production Kimi |
| Manual agent DB persistence | Writes final result to PostgreSQL | Verified after runtime-env fallback fix | PASS | Checked with clean agent environment |

`PASS BY DESIGN` means the deployment mechanism differs while the user-facing
capability and schedule remain equivalent.

Verified route parity:

- `/`
- `/sales-sheet`
- `/search?q=<email>`
- webhook `/health`

All returned HTTP `200` from both audited environments.

Verified database fingerprints:

- columns/defaults: `592b990ea17b587dafe3c32f569a0dc1`
- indexes: `b854f10b927a68423e3980159ed77797`

## Active File Comparison

Identical active files:

- `AGENTS.md`, `STANDING_ORDERS.md`
- scoring and tool catalog YAML files
- delivery hook
- Go wrapper, delivery, finalizer, exporter, reporter, and tool-status scripts
- dashboard views

Files that differ because the current repository contains newer office/Docker
preparation changes than the audited VPS:

- `openclaw_workspace/TOOLS.md`
- `openclaw_workspace/scripts/db_writer.js`
- `openclaw_workspace/scripts/slack_daily_digest.js`
- `openclaw_workspace/scripts/token_usage.sh`
- `dashboard/app.js`
- `webhook/app.js`
- `webhook/worker.js`
- four systemd service files

The Git repository is the source of truth for the office deployment. Do not
overwrite it with older files copied from the VPS. Validate the newer files
through the acceptance test.

## Required Secret Mapping

| Capability | VPS name/location | Docker office name |
|---|---|---|
| Telegram bot | `TELEGRAM_BOT_TOKEN` | `TELEGRAM_DEFAULT_BOT_TOKEN` |
| Telegram recipient | credential allow-list or worker config | `REGISTER_WORKER_TELEGRAM_TO`, `TELEGRAM_ALLOW_FROM` |
| Database | `DATABASE_URL` | Generated from `POSTGRES_PASSWORD` |
| Sumopod | Stored in OpenClaw config | `LLM_API_KEY` |
| Brave Search | `BRAVE_SEARCH_API_KEY` | Same |
| Slack | `SLACK_BOT_TOKEN`, `SLACK_REPORT_CHANNEL` | Same |
| MiniMax | Stored/configured on VPS | `MINIMAX_API_KEY` |
| DeepSeek | Stored/configured on VPS | `DEEPSEEK_API_KEY` |

Never commit real values. Put them only in the office server `.env`.

Security verification:

- `.env` is ignored by Git and Docker build context.
- Deployment scripts reject `CHANGE_ME` placeholders.
- Production `.env` must have permission `0600`.
- Internal agent runtime env has permission `0600` and contains only
  `DATABASE_URL`.
- Dashboard and webhook bind to `127.0.0.1` by default and should be exposed
  only through the office reverse proxy.

## Known Blockers and Risks

1. 9Router `komerce-1.2` is the current production AI provider/model. VPS
   verification completed for register investigation and negative feedback
   classification, but 9Router can still return intermittent socket resets;
   workers must keep retry behavior enabled.
2. The VPS gateway is active and currently owns the production Telegram bot.
   Starting the office/Docker gateway before stopping VPS causes duplicate
   polling/conflicts.
3. Production data must be dumped and restored before cutover if dashboard
   history must be retained.
4. A deterministic baseline is insufficient. Final acceptance must complete
   the agent investigation, save PostgreSQL output, display it on the
   dashboard, and deliver the report to Telegram.
5. Office deployment must build the current repository tree. The active Go
   path is `go-service/`; `go-services/cmd/main.go` is stale/unsupported and
   will fail because it is not the current module layout.
6. On a clean Docker database, Meta polling must fetch page tokens from
   `/me/accounts`. The Docker poller normalizes Meta's `access_token` response
   field into `page_access_token`; do not seed `feedback_sources` with stale
   page tokens.

## July 2026 Local Docker Cutover Check

Temporary local Docker cutover verified:

- Old VPS `openclaw-gateway`, register worker, feedback worker, feedback
  poller timer, and Slack digest timer were stopped before enabling the local
  gateway.
- Docker `gateway` reported healthy and Telegram channel `ON/OK` for the
  production bot.
- Docker `worker` generated OpenClaw config with provider `9router` and primary
  model `9router/komerce-1.2`.
- Docker feedback monitor profile ran `poll-meta` successfully across 13 Meta
  pages with `failed=0` after the clean-DB page token mapping fix.

## Final Acceptance Case

```text
email: sromelah24@gmail.com
full_name: Siti Romelah
brand_name: Romelaanasa
no_hp: 081334026834
```

Acceptance criteria:

- Agent investigation completes without provider or streaming errors.
- Public evidence search runs.
- Result is not degraded to `unknown` because search tooling is missing.
- Final report is saved in PostgreSQL.
- Result appears in dashboard search.
- Telegram receives the report.
- Slack digest dry-run succeeds.

## 9 June 2026 Qwen Acceptance Result

Temporary test-only override:

```text
9router/komerce-1.2
```

Result:

- Provider preflight returned `PROVIDER_OK` in about 7 seconds.
- Full Docker gateway investigation completed in about 47 seconds.
- Found `Romelaanasa - Distributor Herbal NASA Malang`.
- Phone evidence matched.
- Confidence: `80/100`, equal to the known VPS result.
- Docker Telegram gateway health passed while it temporarily owned the bot
  poller.
- Agent DB runtime environment persistence was fixed and verified separately.
- Docker configuration was returned to production model `9router/komerce-1.2`.
- Telegram poller was returned to the VPS after testing.
