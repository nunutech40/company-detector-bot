# Sales Sheet Sync Plan

**Status:** implemented; retained as field-mapping reference
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

For the current Docker workflow, the public Sales Sheet URL comes from
`DASHBOARD_PUBLIC_BASE_URL`:

```text
<DASHBOARD_PUBLIC_BASE_URL>/sales-sheet
```

The daily Slack digest links to that page as `Open Sales Sheet`, so sales users do not need Excel. The digest still generates a fresh `.xlsx` export from the same PostgreSQL rows as a fallback/internal artifact, but Slack does not rely on Excel download as the main path.

## Sync Rule

Only sync rows that are prospect-ready:

- `classification = possible_company_affiliated`
- `confidence_score >= 60`

Everything else stays in DB/dashboard only.

## Sheet Columns

| Sheet column | Source | Rule |
| --- | --- | --- |
| Tanggal Masuk | `investigation_jobs.finished_at` or sync time | Human-readable Jakarta time, e.g. `21 Mei 2026, 09:00 WIB` |
| Prioritas | `confidence_score` | Hot >= 75, Warm 60-74 |
| Status Follow Up | Sheet/manual | Default `New`; sales can edit |
| Nama Prospect | DB fields | Prefer `brand_name`, then clean `business_name`, then `full_name`, then email |
| Email | `investigation_jobs.email` | Register email |
| No HP | `register_intake_jobs.payload_json.no_hp` | If available |
| Brand / Toko | `investigation_jobs.brand_name` | Register brand field |
| Kategori | `investigation_jobs.business_industry` | Human-readable business category if available |
| Kota / Area | `investigation_jobs.business_city` | If available |
| Marketplace | `investigation_jobs.marketplace_json` | Join all valid platform + URL pairs as multiline text, e.g. `Tokopedia: https://...` |
| Sosial Media | `investigation_jobs.social_media_json` | Join all valid platform + URL pairs as multiline text, e.g. `Instagram: https://...` |
| Website | `investigation_jobs.business_website` | If clean URL exists |
| Sumber Data | `investigation_jobs.source` | Human label, e.g. `Register platform` |
| PIC Sales | Sheet/manual | Filled by sales |
| Jadwal Follow Up | Sheet/manual | Filled by sales |
| Catatan Sales | Sheet/manual | Filled by sales |
| Detail Lengkap | `DASHBOARD_BASE_URL + /jobs/:id` | Link to full internal detail |

## Do Not Sync

- Token/cost usage.
- Raw evidence.
- AI reasoning transcript.
- Tool logs.
- Internal scoring breakdown.
- Full report text.

## Link Handling

The database remains the complete source of truth. If one prospect has multiple marketplace or social media profiles, store all valid entries in PostgreSQL JSON fields.

The Sheet should not collapse those links into one winner. For sales, join all usable links into the `Marketplace` or `Sosial Media` cell with one link per line. This keeps the sheet compact while still giving sales every public channel they can inspect before follow-up.

## Idempotency

Preferred behavior:

- Dedupe by lowercased email.
- If existing row is found and new confidence is higher, update sales-facing fields.
- Do not overwrite manual columns: `Status Follow Up`, `PIC Sales`, `Jadwal Follow Up`, `Catatan Sales`.
- Always keep `Detail Lengkap` pointing to the latest accepted job if row is updated.

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

Use the browser Sales Sheet for the current Slack handoff. After the columns are approved and a permanent Google Sheet is available, `SALES_SHEET_WEB_URL` can point to that sheet, while `.xlsx` export remains optional fallback.
