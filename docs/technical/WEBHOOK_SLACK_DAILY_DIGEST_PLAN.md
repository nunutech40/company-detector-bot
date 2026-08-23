# Webhook Queue + Slack Daily Digest Plan

**Status:** Implemented workflow note  
**Last updated:** 24 Agustus 2026
**Source of truth:** PRD + TRD  

---

## 1. Goal

Document the implemented platform integration without disturbing the working Telegram/OpenClaw/dashboard path.

Target behavior:

- Platform register sends account data to webhook.
- Webhook stores payload in a queue and returns quickly.
- Worker processes queued payloads one by one.
- Worker sends each queued investigation result to Telegram.
- Final results still go to PostgreSQL and dashboard.
- Slack sends one daily digest at 09:00 Asia/Jakarta.
- Slack only shows sales-ready prospect data and the browser Sales Sheet link.
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
  -> PostgreSQL table register_intake_jobs pending
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
- Insert into PostgreSQL table `register_intake_jobs`.
- Return `202 Accepted` style response.

Example response:

```json
{
  "ok": true,
  "queued": true,
  "intake_job_id": "uuid",
  "status": "pending",
  "dashboard_url": "<DASHBOARD_PUBLIC_BASE_URL>"
}
```

---

## 5. PostgreSQL Queue Schema Plan

The intake queue is a PostgreSQL-backed queue table. It is not an OpenClaw plugin, Redis, or RabbitMQ in this phase.

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
AND confidence_score >= 60
AND not already sent in a digest
```

Priority tiers:

```text
confidence_score >= 75 => Hot prospect
confidence_score 60-74 => Warm prospect
```

Digest always sends:

- Digest title and timestamp.
- Browser Sales Sheet link.
- Prospect count.
- Prospect list if any.
- No-prospect heartbeat if empty.

Per prospect item:

- Business or brand name if available.
- Contact field suitable for follow-up.
- Priority.
- Website if available.
- Marketplace links if available.
- Social media links if available.

The message points sales to:

```text
<DASHBOARD_PUBLIC_BASE_URL>/sales-sheet
```

The dashboard detail URL remains available in the Sales Sheet `Detail Lengkap` column for deeper internal review, but the Slack digest should not make dashboard detail links the main sales handoff.

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
Sales Sheet: Open Sales Sheet

Ada 5 prospect baru siap follow up.

1. Brand A
   Kontak: owner@example.com
   Prioritas: Hot prospect
   Website: https://brand-a.example
   Marketplace: Tokopedia: https://tokopedia.com/brand-a
   Sosial Media: Instagram: https://instagram.com/brand-a
```

Without prospects:

```text
Prospect Digest - 20 Mei 2026 09:00 WIB
Sales Sheet: Open Sales Sheet

Tidak ada prospect baru dalam window terakhir.
Pipeline tetap berjalan.
```

---

## 10. Implementation Status

- [x] DB migration for PostgreSQL intake queue and digest tracking.
- [x] Webhook final mode is enqueue-only.
- [x] Worker script/service processes one queue row at a time.
- [x] Worker uses OpenClaw agent by default and deterministic mode only for scaffold/debug.
- [x] Worker delivers each queued investigation to Telegram.
- [x] Worker finalizes into DB/dashboard through `finish_investigation.sh`.
- [x] Slack digest query and formatter.
- [x] systemd timer for 09:00 Asia/Jakarta.
- [x] `--dry-run` preview.
- [x] `--test-run` Slack preview without marking production digest rows.
- [x] 14-row queue simulation completed successfully.
- [x] Slack test digest sent 4 potential prospects from existing DB rows.

## 11. Remaining Questions / Next Refinement

- Validate Komerce platform register payload in the real integration path.
- Add dashboard queue visibility if the operator needs non-SQL failed/pending inspection.
- Improve `db_writer.js` extraction for cleaner business names/social/marketplace fields.
