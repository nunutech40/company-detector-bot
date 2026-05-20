# DB And Dashboard

**Status:** Implemented MVP  
**Last updated:** 20 Mei 2026  
**Primary references:** `TRD.md`, `migration_v1.sql`

---

## 1. Technical Decisions

| Area | Decision |
|---|---|
| Database | PostgreSQL 16 on the VPS |
| Schema | 3-table MVP with fat `investigation_jobs` + JSONB |
| Dashboard | Express.js + EJS |
| DB writer | `openclaw_workspace/scripts/db_writer.js` |
| Integration point | `finish_investigation.sh` and webhook service |
| Cost tracking | `llm_calls` table |

This document describes the implementation that exists now. It replaces the older normalized multi-table planning draft.

---

## 2. Schema

Schema source:

```text
docs/technical/migration_v1.sql
```

### `investigation_jobs`

One row per investigation.

Important fields:

- `id`
- `email`
- `domain`
- `full_name`
- `brand_name`
- `source`
- `classification`
- `confidence_score`
- `confidence_label`
- `automation_action`
- `review_status`
- `business_name`
- `business_industry`
- `business_website`
- `business_city`
- `business_address`
- `person_name`
- `person_role`
- `phone_confirmed`
- `marketplace_json`
- `social_media_json`
- `role_evidence_json`
- `started_at`
- `finished_at`
- `created_at`

Indexes:

- `email`
- `classification`
- `confidence_score`
- `created_at`
- `review_status`
- GIN index for `marketplace_json`
- GIN index for `social_media_json`

### `final_reports`

Stores full text and raw JSON:

- `job_id`
- `telegram_text`
- `slack_text`
- `json_result`
- `sent_to_slack_at`
- `created_at`

### `llm_calls`

Stores model usage:

- `job_id`
- `model_provider`
- `model_name`
- `prompt_tokens`
- `completion_tokens`
- `total_tokens`
- `cost_usd`
- `prompt_preview`
- `response_preview`
- `called_at`

---

## 3. DB Writer

File:

```text
openclaw_workspace/scripts/db_writer.js
```

Reads:

- `evidence/latest.json`
- `reports/ai_report_latest.txt`
- OpenClaw session token usage when available

Writes:

- `investigation_jobs`
- `final_reports`
- `llm_calls`

Current limitations:

- Social/marketplace/role extraction is regex/report-text based and should be improved.
- It is designed as a practical MVP, not a complete structured parser.

Operational rule:

- DB write must not block investigation delivery.

---

## 4. Dashboard

Path:

```text
dashboard/
```

Runtime:

- Express + EJS.
- Port `3001`.
- systemd service: `company-dashboard`.

Routes:

| Route | Purpose |
|---|---|
| `GET /` | List jobs, filters, stats, pagination |
| `GET /jobs/:id` | Job detail |
| `POST /jobs/:id/review` | Update review status |
| `GET /search` | Search jobs |

Dashboard URL:

```text
http://103.226.139.107:3001
```

---

## 5. Review Workflow

Review statuses:

- `unreviewed`
- `reviewed`
- `false_positive`
- `high_value`
- `needs_retry`

The dashboard is intentionally simple and internal. Authentication can be added later before wider exposure.

---

## 6. Future Improvements

- Better structured extraction from AI report.
- Dedicated normalized tables if JSONB querying becomes limiting.
- Dashboard authentication.
- Queue/worker for async webhook jobs.
- Audit log for review status changes.

