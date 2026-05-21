# Webhook Queue + Slack Daily Digest Checklist

**Status:** Implemented and VPS-tested  
**Last updated:** 21 Mei 2026  
**Source of truth:** PRD, TRD, FLOW_MAP  

---

## 1. Guardrails

- [x] Do not break the working Telegram/OpenClaw/dashboard path.
- [x] Webhook enqueues register payloads; it does not run heavy investigation inside the HTTP request.
- [x] Queue is PostgreSQL-backed in the existing `company_detection` database.
- [x] Worker processes one queued register payload at a time.
- [x] Queued investigations deliver their final report to Telegram.
- [x] Slack sends one digest every day at 09:00 Asia/Jakarta.
- [x] Slack sends a heartbeat when no prospects exist.
- [x] Slack only shows sales-ready summaries and the Sales Sheet link.
- [x] Slack does not expose raw evidence, search/scrape logic, AI reasoning, tool traces, or scoring internals.

---

## 2. Database

- [x] `migration_v2_webhook_slack_queue.sql` added.
- [x] `register_intake_jobs` table added.
- [x] `slack_digest_runs` table added.
- [x] `slack_digest_items` table added.
- [x] Queue pickup indexes added.
- [x] Digest dedupe unique constraint added.
- [x] FK from `register_intake_jobs.investigation_job_id` to `investigation_jobs.id`.
- [x] FK from `slack_digest_items` to digest runs and investigation jobs.
- [x] Migration applied on VPS.

---

## 3. Webhook Intake

- [x] `GET /health` exists.
- [x] `POST /webhook/check` exists.
- [x] Shared secret/header auth supported.
- [x] Required `email` validation.
- [x] Optional `full_name`, `brand_name`, `no_hp`, `source`, `external_id`.
- [x] `no_hp` masked in the main column.
- [x] Original payload stored in `payload_json`.
- [x] Idempotency key generated when platform does not provide one.
- [x] Response returns `queued`, `intake_job_id`, `status`, and `dashboard_url`.
- [x] Webhook does not call Go/OpenClaw/Slack directly.

---

## 4. Sequential Worker

- [x] `webhook/worker.js` added.
- [x] `company-register-worker` systemd unit added and deployed.
- [x] Worker locks oldest `pending` row.
- [x] Worker marks row `processing`.
- [x] Worker runs one job at a time.
- [x] Worker default path uses OpenClaw agent.
- [x] Deterministic mode remains available only for scaffold/debug.
- [x] Worker sends final report to Telegram using OpenClaw channel delivery.
- [x] Worker runs `finish_investigation.sh --source webhook`.
- [x] Finalizer writes `investigation_jobs`, `final_reports`, and `llm_calls`.
- [x] Worker links `register_intake_jobs.investigation_job_id`.
- [x] Worker marks completed jobs `completed`.
- [x] Retry/failure metadata uses `attempt_count` and `last_error`.
- [x] Stale `processing` rows can be reclaimed after timeout.

---

## 5. Dashboard

- [x] Dashboard stores completed investigation detail.
- [x] Slack no longer sends dashboard links; sales continues from the Sales Sheet link.
- [x] Completed webhook investigations appear in dashboard.
- [ ] Queue status page/stat card is not built yet; query DB directly for now.

---

## 6. Slack Digest

- [x] `openclaw_workspace/scripts/slack_daily_digest.js` added.
- [x] Reads `DATABASE_URL`, Slack env, and `DASHBOARD_BASE_URL`.
- [x] Window rule: since last successful digest, fallback to last 24 hours.
- [x] Production prospect filter:

```text
classification = possible_company_affiliated
AND confidence_score >= 60
AND not already in slack_digest_items
```

- [x] Priority tiers:

```text
75-100 => Hot prospect
60-74  => Warm prospect
```

- [x] Includes Sales Sheet link.
- [x] Does not include dashboard detail links per prospect.
- [x] Includes available website, marketplace, and social media summary per prospect.
- [x] Sends heartbeat when prospect list is empty.
- [x] Inserts `slack_digest_runs` and `slack_digest_items` for production sends.
- [x] `--dry-run` previews without sending.
- [x] `--test-run` sends `[TEST]` Slack preview without marking production rows.
- [x] Realtime Slack forwarding from Telegram messages is disabled.

---

## 7. Scheduler

- [x] `company-slack-digest.service` added.
- [x] `company-slack-digest.timer` added.
- [x] Timer uses `02:00 UTC`, equivalent to `09:00 Asia/Jakarta`.
- [x] Timer enabled on VPS.
- [x] Manual run command works.
- [x] Test-run command works without changing production digest marker tables.

---

## 8. Test Results

- [x] DB reset and 14-row register simulation completed.
- [x] Webhook accepted 14 payloads with `202` queued responses.
- [x] Worker drained 14/14 rows sequentially.
- [x] No queue failures in final simulation.
- [x] Telegram delivery worked after adding explicit Telegram target.
- [x] Reports were saved as `report_source=ai_reasoning`.
- [x] LLM usage was stored per AI investigation.
- [x] Slack production-style digest sent successfully.
- [x] Improved Slack test digest showed 4 potential prospects:
  - `jenang gemi` / `bagusmediajogja@gmail.com` / Hot
  - `Arafa Hijab` / `danielnewbie@gmail.com` / Warm
  - `Falasik` / `falasik@gmail.com` / Warm
  - `toko mas ikan mas` / `dhianika.abhimantra@gmail.com` / Warm

---

## 9. Remaining Work

- [ ] Validate real Komerce platform register payload.
- [ ] Improve `db_writer.js` extraction for social, marketplace, role, and business-name fields.
- [ ] Add dashboard queue status if operationally needed.
- [ ] Add dashboard authentication before broader exposure.
- [ ] Add richer queue/digest observability if traffic increases.
