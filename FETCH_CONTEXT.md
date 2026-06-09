# Fetch Context

**Purpose:** Fast orientation for any AI agent continuing this project.  
**Last updated:** 4 Juni 2026

---

## 1. What This Project Is

AI Company Detection Agent detects whether a registering user is personal, business-affiliated, company-owned, agency/freelancer, or suspicious.

It is used for Komerce user segmentation:

- Business/company users can be routed to B2B or sales workflows.
- Personal users continue normal flow.
- Unknown users are stored for retry/review.
- Suspicious users go to risk review.

---

## 2. Read These First

Canonical docs:

1. `docs/product/PRD.md` — product source of truth.
2. `docs/technical/TRD.md` — technical source of truth.
3. `docs/technical/FLOW_MAP.md` — runtime flow.
4. `docs/technical/WEBHOOK_SLACK_DAILY_DIGEST_PLAN.md` — implemented workflow note for webhook queue + Slack digest.
5. `docs/technical/WEBHOOK_SLACK_BUILDING_CHECKLIST.md` — implementation and validation checklist.
6. `docs/technical/DOCKER_DEPLOYMENT_RUNBOOK.md` — single production deploy path: Docker/Compose, migration, cutover, and acceptance test.
7. `docs/technical/DEPLOYMENT_SECRETS_HANDOVER.md` — secret/key handover checklist without real values.
8. `docs/operations/OWNER_OFFICE_DEPLOYMENT_GUIDE.md` — owner checklist for office deployment handover and acceptance.
9. `docs/handover/COMPANY_DETECTOR_DOCKER_DEPLOYMENT_HANDOVER.docx` — office engineer deployment handover document.
10. `BACKLOG.md` — status and next priorities.

Runtime instructions:

1. `openclaw_workspace/AGENTS.md`
2. `openclaw_workspace/STANDING_ORDERS.md`
3. `openclaw_workspace/config/tool_catalog.yaml`
4. `openclaw_workspace/config/scoring_rules.yaml`

---

## 3. Current Architecture

```text
Telegram / Manual CLI
        |
        v
Deterministic Go pipeline
        |
        +--> emailintel
        +--> domaincheck
        +--> crawler/search/scraper
        +--> brandhint/sociallinks/rolesignal
        +--> scoring/report/evidence
        |
        v
OpenClaw AI reasoning loop when needed
        |
        v
finish_investigation.sh
        |
        +--> file evidence
        +--> PostgreSQL through db_writer.js
        +--> dashboard
        +--> Telegram delivery
        +--> token usage

Platform Register
        |
        v
Webhook intake
        |
        v
PostgreSQL company_detection.register_intake_jobs
        |
        v
Sequential worker
        |
        v
Existing investigation + finalization path

Daily 09:00 Asia/Jakarta
        |
        v
Slack digest script reads PostgreSQL
        |
        v
Sales-ready prospect digest + Sales Sheet link
```

Important point: AI can reason and choose tools, but deterministic scoring/classification is the source of truth.

Important boundary: AI/OpenClaw does not write directly to storage or Slack. Finalizer/db_writer writes results. Slack digest reads finalized DB rows later.

Current production AI provider:

```text
OpenClaw primary model: sumopod/kimi-k2.6
Provider base URL: https://ai.sumopod.com/v1
Config path on VPS: /home/nunuopc/.openclaw/openclaw.json
```

`deploy.sh` syncs this provider URL and primary model while preserving the existing API key in the VPS config. Do not reduce context, visible tools, or investigation depth just to make a provider fit; only swap the AI provider/model unless explicitly requested.

---

## 4. Implemented Services

| Service | Port | Path | Notes |
|---|---:|---|---|
| OpenClaw gateway | 18789 | VPS service | AI runtime |
| Dashboard | 3001 | `dashboard/` | Express + EJS |
| Webhook API | 3002 | `webhook/` | Express enqueue-only API backed by PostgreSQL queue |
| PostgreSQL | 5432 | VPS service | DB `company_detection` |

VPS:

- IP: `103.226.139.107`
- Workspace: `/home/nunuopc/.openclaw/workspace/`
- Go binary: `/home/nunuopc/.openclaw/go-service/bin/company-check`
- OpenClaw config: `/home/nunuopc/.openclaw/openclaw.json`

---

## 5. Database

Schema sources:

```text
docs/technical/migration_v1.sql
docs/technical/migration_v2_webhook_slack_queue.sql
docs/technical/migration_v3_report_provenance.sql
docs/technical/migration_v4_llm_usage_provenance.sql
```

Current tables:

- `investigation_jobs`: main investigation row, searchable columns and JSONB findings.
- `final_reports`: full report text and raw JSON.
- `llm_calls`: model token usage and estimated cost.
- `register_intake_jobs`: PostgreSQL-backed queue for platform register payloads.
- `slack_digest_runs`: one row per daily Slack digest execution.
- `slack_digest_items`: sent prospect item tracking so jobs are not repeated.

Do not resurrect the older 7/8-table plan unless the user explicitly asks for a normalized analytics schema.

---

## 6. Critical Runtime Rule

After AI finishes an investigation, run:

```bash
cd openclaw_workspace
scripts/finish_investigation.sh --email <email>
```

This is mandatory. It writes DB records and shows token usage. Slack delivery is handled separately by the daily digest flow.

---

## 7. Classifications

- `possible_company_affiliated`
- `likely_personal_email`
- `unknown_needs_more_evidence`
- `suspicious_or_invalid`

Slack daily digest target:

```text
09:00 Asia/Jakarta every day
possible_company_affiliated + confidence_score >= 60 => listed as prospect
75-100 => Hot prospect
60-74 => Warm prospect
empty prospect window => send heartbeat digest
```

Slack links to the browser Sales Sheet:

```text
http://103.226.139.107/sales-sheet
```

This is the main sales handoff. The `.xlsx` export still exists as fallback/internal artifact, but Slack should not rely on an Excel-only download path.

Slack must not include raw evidence, AI reasoning detail, scraping/search logic, tool traces, or internal scoring breakdown. Slack is for sales/stakeholder handoff only.

Slack test mode:

```bash
cd openclaw_workspace
node scripts/slack_daily_digest.js --test-run --window-hours 999
```

`--test-run` sends a `[TEST]` Slack preview from existing DB rows and does not insert `slack_digest_runs` or `slack_digest_items`.

---

## 8. Input Contract

| Field | Required | Rule |
|---|---:|---|
| `email` | Yes | Primary signal |
| `full_name` | No | Identity hint |
| `brand_name` | No | Business hint |
| `no_hp` | No | Confirmation only, never public search seed |

Testing fixture for webhook queue simulation:

```text
/Users/nununugraha/Downloads/All Parter User.xlsx
```

Known shape when last inspected:

- Sheet: `Result 1`
- Columns: `email`, `full_name`, `no_hp`, `brand_name`
- Data rows: `117711`
- Use only 10-20 selected rows for implementation testing.
- Do not enqueue the whole workbook or run large batch/load testing unless explicitly requested.

---

## 9. Common Commands

Run Go check:

```bash
cd openclaw_workspace
scripts/company_check_go.sh --email contact@komerce.id --save
```

Finalize investigation:

```bash
cd openclaw_workspace
scripts/finish_investigation.sh --email contact@komerce.id
```

Run Go tests:

```bash
cd go-service
go test ./...
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

Expected final webhook behavior is queued response, not direct investigation:

```json
{
  "ok": true,
  "queued": true,
  "intake_job_id": "uuid",
  "status": "pending",
  "dashboard_url": "http://103.226.139.107:3001"
}
```

Process one queued webhook job:

```bash
cd webhook
npm run worker:once
```

Preview Slack digest without sending:

```bash
cd openclaw_workspace
node scripts/slack_daily_digest.js --dry-run --test-run --window-hours 999
```

Deploy:

```bash
bash deploy.sh
```

---

## 10. Next Work

Current next priorities:

1. Prepare and verify server kantor deployment using `docs/technical/DOCKER_DEPLOYMENT_RUNBOOK.md`.
2. Validate from Komerce platform register flow.
3. Improve `db_writer.js` extraction for social/marketplace/role evidence.
4. Add dashboard queue visibility if operationally needed.
5. Add dashboard authentication before broader exposure.

Avoid broad rewrites. This project already has the core implementation; most near-term work is validation, polish, and operational hardening.
