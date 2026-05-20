# Webhook Queue + Slack Daily Digest Building Checklist

**Status:** Ready for implementation review  
**Last updated:** 20 Mei 2026  
**Source of truth:** PRD, TRD, FLOW_MAP, WEBHOOK_SLACK_DAILY_DIGEST_PLAN  

---

## 1. Implementation Rules

- [ ] Do not change the working Telegram/OpenClaw/dashboard path unless required for integration.
- [ ] Webhook must enqueue register payloads, not run heavy investigation inside the HTTP request.
- [ ] Queue is PostgreSQL-backed in the existing `company_detection` database.
- [ ] Worker processes one queued register payload at a time.
- [ ] Slack sends one digest every day at 09:00 Asia/Jakarta.
- [ ] Slack always sends a daily heartbeat, even when there are no prospects.
- [ ] Slack only shows sales-ready prospect summaries and dashboard links.
- [ ] Slack must not expose raw evidence, search/scrape logic, AI reasoning details, tool traces, or scoring internals.
- [ ] Full evidence/report remains available in DB/dashboard.

---

## 2. Phase 0 - Pre-Implementation Audit

- [ ] Confirm current services on VPS:
  - `openclaw-gateway`
  - `company-dashboard`
  - `company-webhook`
  - `postgresql`
- [ ] Confirm current DB is `company_detection`.
- [ ] Confirm current tables exist:
  - `investigation_jobs`
  - `final_reports`
  - `llm_calls`
- [ ] Confirm dashboard base URL.
- [ ] Confirm Slack channel ID and bot token env names.
- [ ] Confirm timezone target is `Asia/Jakarta`.
- [ ] Confirm platform register payload fields and whether it has `external_id`.
- [ ] Confirm local test fixture exists:
  - `/Users/nununugraha/Downloads/All Parter User.xlsx`
- [ ] Confirm digest window rule:
  - preferred: since last successful digest run
  - fallback: last 24 hours

Known test fixture shape:

- Sheet: `Result 1`
- Columns: `email`, `full_name`, `no_hp`, `brand_name`
- Data rows when last inspected: `117711`
- Non-empty email rows when last inspected: `117711`
- Non-empty phone rows when last inspected: `117579`
- Non-empty brand rows when last inspected: `28302`

Exit criteria:

- [ ] We know exact env vars, DB URL, Slack channel, dashboard URL, and payload contract.

---

## 3. Phase 1 - Database Migration

Create a new migration after `migration_v1.sql`.

- [ ] Add `register_intake_jobs`.
- [ ] Add `slack_digest_runs`.
- [ ] Add `slack_digest_items`.
- [ ] Add status constraints or status validation.
- [ ] Add indexes for queue pickup:
  - `status, created_at`
  - `locked_at`
  - `idempotency_key`
- [ ] Add unique rule for digest item dedupe:
  - one `investigation_job_id` appears once in `slack_digest_items`
- [ ] Add FK from `register_intake_jobs.investigation_job_id` to `investigation_jobs.id`.
- [ ] Add FK from `slack_digest_items.digest_run_id` to `slack_digest_runs.id`.
- [ ] Add FK from `slack_digest_items.investigation_job_id` to `investigation_jobs.id`.

Verification:

- [ ] Migration runs on local/dev DB.
- [ ] Migration is idempotent where possible.
- [ ] `psql` can show all new tables and indexes.
- [ ] Existing dashboard still loads.

Exit criteria:

- [ ] DB can store queued register payloads and daily digest records.

---

## 4. Phase 2 - Webhook Enqueue Mode

Update `webhook/` service.

- [ ] Keep `GET /health`.
- [ ] Keep `POST /webhook/check` route.
- [ ] Validate shared secret or auth header.
- [ ] Validate minimum payload.
- [ ] Normalize:
  - `email`
  - `full_name`
  - `brand_name`
  - `no_hp`
- [ ] Mask `no_hp` before storing if stored in a separate column.
- [ ] Store original payload in `payload_json`.
- [ ] Generate idempotency key if platform does not provide one.
- [ ] Insert into `register_intake_jobs` with status `pending`.
- [ ] Return fast queued response:

```json
{
  "ok": true,
  "queued": true,
  "intake_job_id": "uuid",
  "status": "pending",
  "dashboard_url": "http://103.226.139.107:3001"
}
```

- [ ] Do not run Go investigation inside webhook request.
- [ ] Do not call OpenClaw inside webhook request.
- [ ] Do not send Slack from webhook request.

Verification:

- [ ] Valid payload returns queued response.
- [ ] Invalid secret is rejected.
- [ ] Invalid payload is rejected.
- [ ] Duplicate idempotency key does not create duplicate queue row.
- [ ] DB row appears in `register_intake_jobs`.

Exit criteria:

- [ ] Platform can submit register data safely without waiting for investigation.

---

## 5. Phase 3 - Sequential Worker

Build worker as deterministic service/script.

Recommended first implementation:

- [ ] Node.js worker, because webhook/dashboard/db_writer are already Node-adjacent.

Worker behavior:

- [ ] Select oldest `pending` row.
- [ ] Lock row as `processing`.
- [ ] Avoid double-processing locked rows.
- [ ] Run one job at a time.
- [ ] Convert queue row into existing investigation input.
- [ ] Run existing investigation/finalization path.
- [ ] Ensure finalizer writes:
  - `investigation_jobs`
  - `final_reports`
  - `llm_calls`
- [ ] Link `register_intake_jobs.investigation_job_id`.
- [ ] Mark queue row `completed`.
- [ ] On retryable infrastructure error:
  - increment `attempt_count`
  - store `last_error`
  - release or mark failed after max attempts
- [ ] On invalid payload:
  - mark `skipped`
- [ ] Log enough information for developer debugging.

Concurrency rule:

- [ ] Default concurrency is `1`.
- [ ] New worker run must not process a second job before the current job completes/fails/skips.

Verification:

- [ ] One pending row becomes processing.
- [ ] One processing row becomes completed.
- [ ] Dashboard gets a result row.
- [ ] Failed job records error.
- [ ] Worker can resume after restart.
- [ ] Running two worker processes does not process the same row twice.

Exit criteria:

- [ ] Queue can drain register payloads one by one into existing result tables.

---

## 6. Phase 4 - Dashboard Visibility

Minimum dashboard update:

- [ ] Dashboard can still show completed investigation jobs.
- [ ] Job detail link works from Slack.
- [ ] Dashboard home link works from Slack.

Optional but useful:

- [ ] Add queue status page or stat card.
- [ ] Show pending/processing/failed intake counts.
- [ ] Link intake job to investigation detail when completed.

Verification:

- [ ] Completed webhook item is visible in dashboard.
- [ ] Failed queue item is inspectable somewhere, or at least queryable from DB.

Exit criteria:

- [ ] Sales/stakeholders can use Slack links; developer can investigate failures.

---

## 7. Phase 5 - Slack Digest Script

Build deterministic digest script.

- [ ] Read `DASHBOARD_BASE_URL`.
- [ ] Read Slack credentials from env.
- [ ] Determine digest window:
  - since last successful digest run, or
  - last 24 hours if no previous run exists
- [ ] Query prospects:

```text
classification = possible_company_affiliated
AND confidence_score >= 75
AND not already in slack_digest_items
```

- [ ] Build dashboard home URL.
- [ ] Build detail URL per prospect:

```text
<DASHBOARD_BASE_URL>/jobs/<investigation_job_id>
```

- [ ] Format Slack message for sales.
- [ ] Hide raw evidence and internal logic.
- [ ] Send digest if prospects exist.
- [ ] Send heartbeat if no prospects exist.
- [ ] Insert `slack_digest_runs`.
- [ ] Insert `slack_digest_items` for sent prospects.
- [ ] Record Slack message timestamp if available.
- [ ] Add dry-run/preview mode.

Verification:

- [ ] Dry-run with prospects prints expected message.
- [ ] Dry-run with empty window prints heartbeat.
- [ ] Real Slack send works in test channel.
- [ ] Sent prospects are not repeated in the next digest.
- [ ] Empty digest creates a run record.

Exit criteria:

- [ ] Slack gets one clean daily sales digest and no raw investigation report.

---

## 8. Phase 6 - Scheduler

Preferred:

- [ ] systemd timer or cron runs digest script at 09:00 Asia/Jakarta.

Alternative:

- [ ] OpenClaw Gateway cron schedules the digest if cron and Slack delivery are configured.

Implementation checklist:

- [ ] Add service/timer or crontab entry.
- [ ] Confirm host timezone or set explicit timezone.
- [ ] Confirm logs are written somewhere inspectable.
- [ ] Confirm failure does not spam Slack.
- [ ] Add manual command to run digest now.

Verification:

- [ ] Manual run sends digest.
- [ ] Scheduled run fires at expected time.
- [ ] Failure is visible in logs.

Exit criteria:

- [ ] Slack digest runs automatically every day at 09:00.

---

## 9. Phase 7 - End-To-End Test Matrix

Fixture strategy:

- [ ] Use `/Users/nununugraha/Downloads/All Parter User.xlsx` as register payload simulation data.
- [ ] Start with 10 rows.
- [ ] Then test 100 rows to match expected daily register volume.
- [ ] Only run larger batches after queue locking, retry, and digest dedupe are proven.
- [ ] Map fixture columns directly:
  - `email` -> `email`
  - `full_name` -> `full_name`
  - `no_hp` -> `no_hp`
  - `brand_name` -> `brand_name`
- [ ] Do not use `no_hp` as public search seed.
- [ ] Treat missing `brand_name` as valid optional input.

Webhook tests:

- [ ] Valid full payload queues successfully.
- [ ] Email-only payload queues successfully if allowed.
- [ ] Invalid secret rejected.
- [ ] Invalid email rejected or marked skipped according to contract.
- [ ] Duplicate idempotency key does not create duplicate processing.

Worker tests:

- [ ] Processes one queued job.
- [ ] Processes multiple queued jobs sequentially.
- [ ] Failed job retries.
- [ ] Max retry job becomes `failed`.
- [ ] Completed job links to investigation result.

Slack tests:

- [ ] One prospect appears in digest.
- [ ] Multiple prospects appear in digest.
- [ ] Personal/unknown/suspicious jobs do not appear as prospects.
- [ ] Empty window sends heartbeat.
- [ ] Dashboard home link appears.
- [ ] Each prospect detail link works.
- [ ] Raw evidence/reasoning/tool traces do not appear.

Regression tests:

- [ ] Telegram/OpenClaw path still works.
- [ ] Dashboard list still loads.
- [ ] Dashboard detail still loads.
- [ ] Go tests still pass.
- [ ] Node syntax checks pass.

Exit criteria:

- [ ] Full webhook-to-dashboard-to-Slack flow works without breaking existing flow.

---

## 10. Phase 8 - Deployment

- [ ] Deploy migration.
- [ ] Deploy webhook changes.
- [ ] Deploy worker service/script.
- [ ] Deploy Slack digest script.
- [ ] Deploy scheduler.
- [ ] Restart affected services.
- [ ] Confirm service status.
- [ ] Run smoke test on VPS.
- [ ] Confirm dashboard row appears.
- [ ] Confirm Slack test digest works.

Rollback notes:

- [ ] Webhook can temporarily return maintenance/error if queue fails.
- [ ] Worker can be stopped without losing queued payloads.
- [ ] Slack scheduler can be disabled independently.
- [ ] Existing Telegram/OpenClaw path should remain usable.

Exit criteria:

- [ ] Production VPS has queue, worker, dashboard, and Slack digest running.

---

## 11. Phase 9 - Documentation Closeout

After implementation is validated:

- [ ] Update PRD status from planned to done.
- [ ] Update TRD with exact file paths, commands, services, and migration filename.
- [ ] Update FLOW_MAP if runtime differs from planned flow.
- [ ] Update README commands.
- [ ] Update `FETCH_CONTEXT.md` for future AI handoff.
- [ ] Update BACKLOG done/next sections.
- [ ] Archive or fold this checklist into source-of-truth docs if no longer needed.

Exit criteria:

- [ ] Docs reflect actual implementation, not the plan.

---

## 12. Implementation Order Summary

Recommended order:

1. DB migration.
2. Webhook enqueue mode.
3. Worker sequential processing.
4. Dashboard/link verification.
5. Slack digest script.
6. Scheduler.
7. VPS deployment.
8. Full E2E validation.
9. Documentation closeout.

Do not build Slack first. Slack depends on reliable stored results and dashboard links.
