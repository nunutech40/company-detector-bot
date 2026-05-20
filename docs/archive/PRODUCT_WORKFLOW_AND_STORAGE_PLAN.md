# Product Workflow And Storage Plan

**Status:** Implemented MVP  
**Last updated:** 20 Mei 2026  
**Source of truth:** See `PRD.md` for product direction and `../technical/TRD.md` for technical architecture.

---

## 1. Why This Exists

Original MVP stored investigation output as files and sent reports through Telegram/Slack. That was enough for testing, but not enough for operations. The product now needs:

- searchable history,
- dashboard review,
- Slack routing without alert fatigue,
- webhook-triggered investigations after final integration,
- LLM cost tracking,
- future retry/enrichment.

---

## 2. Implemented Data Lifecycle

```text
Input from Telegram / Webhook / CLI
        |
        v
Go deterministic pipeline
        |
        v
AI reasoning loop when needed
        |
        v
finish_investigation.sh
        |
        +--> evidence JSON files
        +--> PostgreSQL via db_writer.js
        +--> dashboard
        +--> Telegram report
        +--> Slack only for high-confidence business
```

---

## 3. Current Storage Design

The implemented MVP uses 3 PostgreSQL tables:

| Table | Purpose |
|---|---|
| `investigation_jobs` | Main row per investigation; includes searchable columns and JSONB findings |
| `final_reports` | Full Telegram/Slack text and raw JSON result |
| `llm_calls` | Token usage and estimated cost |

Schema file:

```text
docs/technical/migration_v1.sql
```

The older 7/8-table normalized plan is intentionally not the MVP. Social media, marketplace, and role evidence are stored as JSONB first so the team can move faster and backfill later if needed.

---

## 4. Dashboard Workflow

Operator workflow:

1. Open dashboard.
2. Filter by classification, confidence, review status.
3. Search email, domain, business name, person name, or JSONB findings.
4. Open job detail.
5. Inspect AI report, social/marketplace evidence, role evidence, and cost.
6. Set review status.

Review status values:

- `unreviewed`
- `reviewed`
- `false_positive`
- `high_value`
- `needs_retry`

---

## 5. Slack Alert Policy

Slack is for important detections only.

```text
IF classification = possible_company_affiliated
AND confidence_score >= 75
THEN send Slack alert
ELSE keep in DB/dashboard only
```

This policy is designed to keep Slack useful while preserving all investigation history in the dashboard.

---

## 6. Webhook Workflow

The platform register integration target uses:

```text
POST /webhook/check
```

Current status: service and response contract exist, but production DB persistence is still final-phase work. The validated storage path is currently `finish_investigation.sh -> db_writer.js`.

Final webhook must:

- validates shared secret,
- runs deterministic Go check,
- saves result,
- write the matching request result to the database,
- returns JSON result and dashboard URL.

Queue/worker is future work for higher volume.

---

## 7. Remaining Product Work

- Validate Telegram E2E.
- Finalize webhook DB path and validate from Komerce register.
- Improve `db_writer.js` extraction quality.
- Finalize Slack hook with smart routing.
- Add queue/worker and retries when traffic requires it.
