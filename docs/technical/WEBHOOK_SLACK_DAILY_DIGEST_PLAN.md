# Webhook Queue + Slack Daily Digest Plan

**Status:** Proposed final-phase implementation  
**Last updated:** 20 Mei 2026  
**Source of truth:** PRD + TRD  

---

## 1. Goal

Build the final platform integration without disturbing the working Telegram/OpenClaw/dashboard path.

Target behavior:

- Platform register sends account data to webhook.
- Webhook stores payload in a queue and returns quickly.
- Worker processes queued payloads one by one.
- Final results still go to PostgreSQL and dashboard.
- Slack sends one daily digest at 09:00 Asia/Jakarta.
- Slack only shows sales-ready prospect data and dashboard links.
- Slack hides internal evidence collection, AI reasoning, scraping logic, and tool traces.

---

## 2. Non-Goals

- No realtime Slack alert per register.
- No direct heavy investigation inside webhook HTTP request.
- No public search using `no_hp`.
- No raw evidence or debug report in Slack.
- No dashboard auth work in this phase.

---

## 3. Target Flow

```text
Platform Register
  -> Webhook intake
  -> register_intake_jobs pending
  -> sequential worker
  -> investigation and finalizer
  -> PostgreSQL and dashboard

Daily 09:00 cron
  -> read finalized investigation jobs
  -> filter prospect company candidates
  -> send Slack digest
  -> mark digest items as sent
```

---

## 4. Webhook Intake

Endpoint:

```text
POST /webhook/check
```

Input fields:

- `email`
- `full_name`
- `brand_name`
- `no_hp`
- optional platform metadata such as `external_id`, `source`, `registered_at`
- `secret` or auth header

Webhook behavior:

- Validate secret.
- Validate minimum payload.
- Normalize email and optional account fields.
- Mask phone before storage where possible.
- Generate or read an idempotency key.
- Insert into `register_intake_jobs`.
- Return `202 Accepted` style response.

Example response:

```json
{
  "ok": true,
  "queued": true,
  "intake_job_id": "uuid",
  "status": "pending",
  "dashboard_url": "http://103.226.139.107:3001"
}
```

---

## 5. Queue Schema Plan

### `register_intake_jobs`

```text
id UUID primary key
source TEXT
external_id TEXT nullable
idempotency_key TEXT nullable unique
email TEXT
full_name TEXT
brand_name TEXT
no_hp_masked TEXT
payload_json JSONB
status TEXT
attempt_count INTEGER
last_error TEXT
locked_at TIMESTAMPTZ
processed_at TIMESTAMPTZ
investigation_job_id UUID nullable
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

Statuses:

- `pending`
- `processing`
- `completed`
- `failed`
- `skipped`

Indexes:

- `status, created_at`
- `email`
- `idempotency_key`
- `investigation_job_id`

---

## 6. Sequential Worker

Worker responsibilities:

- Pick oldest `pending` job.
- Lock it as `processing`.
- Run the existing investigation path.
- Ensure finalizer writes DB/dashboard output.
- Link `register_intake_jobs.investigation_job_id`.
- Mark job `completed`.
- On infrastructure failure, retry up to max attempts.
- On permanent validation failure, mark `skipped` or `failed`.

Default concurrency:

```text
1 job at a time
```

Reason:

- Daily register volume is around 100.
- Slack only needs daily digest.
- Sequential processing protects tool limits and makes debugging simpler.

---

## 7. Slack Digest

Scheduler:

```text
09:00 Asia/Jakarta every day
```

Implementation options:

- Preferred: system cron or systemd timer calls a deterministic Node.js script.
- Alternative: OpenClaw Gateway cron can schedule the digest if Gateway cron and Slack announce delivery are configured.

OpenClaw docs note that Gateway `cron` supports cron expressions, timezone via `--tz`, isolated jobs, and Slack channel delivery. For this project, deterministic script output is preferred so the sales message format stays stable.

Digest data source:

- PostgreSQL `investigation_jobs`
- PostgreSQL `final_reports`
- `slack_digest_items` to avoid repeat items

Prospect filter:

```text
classification = possible_company_affiliated
AND confidence_score >= 75
AND not already sent in a digest
```

Digest always sends:

- Digest title and timestamp.
- Dashboard home link.
- Prospect count.
- Prospect list if any.
- No-prospect heartbeat if empty.

Per prospect item:

- Business or brand name if available.
- Contact field suitable for follow-up.
- Short sales-friendly signal.
- Detail dashboard link.

Slack must not include:

- Raw evidence.
- AI chain of thought or reasoning detail.
- Scraper/search mechanics.
- Tool error/debug lists.
- Internal scoring breakdown.

---

## 8. Digest Schema Plan

### `slack_digest_runs`

```text
id UUID primary key
window_start TIMESTAMPTZ
window_end TIMESTAMPTZ
prospect_count INTEGER
status TEXT
slack_message_ts TEXT
dashboard_url TEXT
error TEXT
created_at TIMESTAMPTZ
```

### `slack_digest_items`

```text
digest_run_id UUID
investigation_job_id UUID
created_at TIMESTAMPTZ
```

Unique rule:

```text
one investigation_job_id can only appear once in slack_digest_items
```

---

## 9. Slack Message Shape

With prospects:

```text
Prospect Digest - 20 Mei 2026 09:00 WIB
Dashboard: http://103.226.139.107:3001

Ada 5 prospect baru siap follow up.

1. Brand A
   Kontak: owner@example.com
   Sinyal: Terindikasi akun bisnis
   Detail: http://103.226.139.107:3001/jobs/<id>
```

Without prospects:

```text
Prospect Digest - 20 Mei 2026 09:00 WIB
Dashboard: http://103.226.139.107:3001

Tidak ada prospect baru dalam window terakhir.
Pipeline tetap berjalan.
```

---

## 10. Implementation Steps

1. Add DB migration for intake queue and digest tracking.
2. Change webhook final mode to enqueue-only.
3. Add worker script/service for sequential queue processing.
4. Add digest query and Slack formatter.
5. Add cron/systemd timer for 09:00 Asia/Jakarta.
6. Add dry-run command for digest preview.
7. Test webhook enqueue with dummy payloads.
8. Test worker one-by-one processing.
9. Test Slack digest with prospect and empty windows.
10. Update README and operational notes after implementation.

---

## 11. Review Questions

- Should the digest window be strict last 24 hours or since last successful digest run?
- What exact Slack channel ID should receive the digest?
- Is `confidence_score >= 75` enough, or should review status `high_value` also qualify?
- Should failed queue jobs appear in dashboard stats before investigation completes?
