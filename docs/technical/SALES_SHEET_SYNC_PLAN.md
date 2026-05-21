# Sales Sheet Sync Plan

**Status:** proposed next improvement  
**Template:** [`docs/templates/company_detector_sales_sheet_template.xlsx`](../templates/company_detector_sales_sheet_template.xlsx)

## Purpose

Sales team needs a simple follow-up sheet, not a technical investigation database.

The system should continue saving complete investigation data to PostgreSQL. The Sheet is a second, curated output for sales workflow only.

## Runtime Position

```text
register_intake_jobs
-> worker
-> OpenClaw AI investigation
-> finish_investigation.sh
-> db_writer.js writes PostgreSQL
-> sheet_writer.js appends/updates Sales Sheet
```

Sheet sync must be deterministic code, not AI. It should not consume investigation tokens.

## Sync Rule

Only sync rows that are prospect-ready:

- `classification = possible_company_affiliated`
- `confidence_score >= 60`

Everything else stays in DB/dashboard only.

## Sheet Columns

| Sheet column | Source | Rule |
| --- | --- | --- |
| Synced At | `sheet_writer.js` runtime | Current timestamp |
| Finished At | `investigation_jobs.finished_at` | Investigation completion time |
| Priority | `confidence_score` | Hot >= 75, Warm 60-74 |
| Sales Status | Sheet/manual | Default `New`; sales can edit |
| Prospect Name | DB fields | Prefer `brand_name`, then clean `business_name`, then `full_name`, then email |
| Email | `investigation_jobs.email` | Register email |
| Phone | `register_intake_jobs.payload_json.no_hp` | If available |
| Brand | `investigation_jobs.brand_name` | Register brand field |
| Website | `investigation_jobs.business_website` | If clean URL exists |
| Source Register | `investigation_jobs.source` | Source label |
| Owner Sales | Sheet/manual | Filled by sales |
| Next Follow Up | Sheet/manual | Filled by sales |
| Sales Notes | Sheet/manual | Filled by sales |
| Dashboard Detail | `DASHBOARD_BASE_URL + /jobs/:id` | Link to full internal detail |
| Job ID | `investigation_jobs.id` | Internal reference |

## Do Not Sync

- Token/cost usage.
- Raw evidence.
- AI reasoning transcript.
- Tool logs.
- Internal scoring breakdown.
- Full report text.

## Idempotency

Preferred behavior:

- Dedupe by lowercased email.
- If existing row is found and new confidence is higher, update sales-facing fields.
- Do not overwrite manual columns: `Sales Status`, `Owner Sales`, `Next Follow Up`, `Sales Notes`.
- Always keep `Dashboard Detail` pointing to the latest accepted job if row is updated.

## Implementation Options

### Option A: Google Sheets API

Best for shared team workflow.

Needed env:

```text
GOOGLE_SHEET_ID=
GOOGLE_SERVICE_ACCOUNT_JSON=
SALES_SHEET_NAME=Sales Pipeline
```

Pros:

- Shared link for sales.
- Easy manual edits.
- Slack can include Sheet link.

Cons:

- Needs service account setup and sheet sharing.

### Option B: XLSX Export

Useful for test/demo only.

Pros:

- No Google credential.
- Easy local review.

Cons:

- Not good for ongoing sync because sales edits and automation can conflict.

## Recommended Next Step

Use the `.xlsx` template for review first. After columns are approved, create/import it as Google Sheet, share it with the service account, then implement `sheet_writer.js`.
