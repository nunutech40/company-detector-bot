# Tools And Algorithms Reference

Dokumen ini adalah kamus semua tool, skill, dan algoritma yang dipakai agent. Baca dokumen ini setelah melihat [Flow Map](FLOW_MAP.md).

## 1. Agent And Skill Layer

### OpenClaw Agent

File:

```text
openclaw_workspace/AGENTS.md
```

Role:

- Menerima pesan Telegram atau request natural-language.
- Jika ada email valid, menjalankan Go wrapper `scripts/company_check_go.sh`.
- Tidak bertanya ulang untuk `/check <email>`.
- Mengembalikan report yang dibuat tool, bukan mengarang evidence.

Important rule:

```text
For every valid email check, run:
scripts/company_check_go.sh --email <email> --save --send-slack
```

### Company Detection Skill

File:

```text
openclaw_workspace/skills/company-detection/SKILL.md
```

Role:

- Instruksi singkat untuk tugas company detection.
- Menegaskan no-feedback behavior.
- Menjelaskan `/tool_status` dan `/last_report`.

## 2. Orchestrator Tool

### Go `company-check`

File:

```text
openclaw_workspace/scripts/company_check_go.sh
go-service/cmd/company-check
```

Role:

- Orchestrator deterministik untuk MVP.
- Mengatur urutan tool.
- Menggabungkan evidence.
- Memanggil scoring.
- Membuat report.
- Menyimpan hasil jika `--save`.
- Mengirim Slack hanya jika eksplisit.

Inputs:

```bash
scripts/company_check_go.sh --email <email> [--full-name "..."] [--no-hp "..."] [--brand-name "..."] [--json] [--save] [--send-slack]
scripts/company_check_go.sh --input-json '{"email":"...","full_name":"...","no_hp":"...","brand_name":"..."}' [--json] [--save]
```

Go MVP equivalent:

```bash
cd go-service
go run ./cmd/company-check --email contact@komerce.id --brand-name Komerce --json
go run ./cmd/company-check --input-json '{"email":"...","full_name":"...","no_hp":"...","brand_name":"..."}' --json --save
```

Current runtime note:

- OpenClaw workspace now points to the Go wrapper.
- Node.js scripts remain as rollback/reference helpers.
- Telegram `/check` includes `--send-slack`; Go posts Slack for **all results** regardless of classification, as long as Slack env is configured.

Algorithm:

1. Normalize current input package: `email`, `full_name`, `no_hp`, `brand_name`.
2. Run `email_intelligence`.
3. If email custom domain and not disposable:
   - run `domain_checker`
   - run `website_crawler_router`
4. Build simple fallback query (inline, no separate package):
   - custom domain: `"<domain>" company`
   - free email with full_name: `"<local>" OR "<fullname>"`
   - free email without full_name: `"<local>"`
   - Note: Query selection sekarang dilakukan oleh AI reasoning loop. Go hanya menyediakan simple fallback query.
5. Run `ddg_search` if query exists.
6. Choose active URL from domain checker or crawler.
7. Run `free_scraper` if active URL exists.
8. Push browser skip reason:
   - `skipped_not_needed_for_mvp` if lightweight evidence exists
   - `optional_fallback_disabled_for_mvp` otherwise
9. Run `scoring_engine`.
10. Run `report_formatter` (fallback mode only — AI handles narrative in Phase A).
11. If `--save`, run `evidence_store`.
12. If `--send-slack` is present and action routes company-associated, run Go Slack reporter.

Important input rule:

- `brand_name` may add a business hint and search query.
- `full_name` may add identity/profile queries.
- `no_hp` is retained/masked for internal matching only and is not used for public search.
- `username` is intentionally not part of the trusted algorithm because platform username is not reliable.

### `batch_csv_check.js`

Role:

- Sequential CSV runner for platform exports.
- Expects headers: `email`, `full_name`, `no_hp`, `brand_name`.
- Processes one row at a time; no parallelism by default.
- Emits one JSON line summary per row.

Inputs:

```bash
node scripts/batch_csv_check.js <csv_file> [--limit N] [--save] [--send-slack]
```

Algorithm:

1. Parse CSV locally.
2. Convert each row into the current register input contract.
3. Run `company_check` for each row sequentially.
4. Optionally save evidence/report.
5. Optionally send Slack if explicitly enabled.

Failure behavior:

- Tool success goes to `tools_used`.
- Tool skipped goes to `tools_skipped`.
- Tool failure goes to `tool_errors`.
- Failed tools do not create evidence.

## 3. Input And Identity Tools

### `email_intelligence.js`

Role:

- Normalize and validate email.
- Extract local part/domain/TLD.
- Detect free provider.
- Detect disposable hints.
- Detect role/contact mailbox.
- Produce first evidence items.

Algorithm:

```text
normalize email
-> validate regex
-> split local/domain
-> check FREE_DOMAINS
-> check DISPOSABLE_HINTS
-> check ROLE_LOCALS
-> assign tags
-> emit evidence
```

Evidence:

- `email_domain`
- `email_local_part`
- `input_validation`

Scoring deltas:

- custom domain: `+30`
- free provider: `-30`
- role mailbox: `+10`
- disposable hint: `-40`

Change impact:

- Adding free domains affects classification for many emails.
- Adding role locals can increase score for custom-domain addresses.

## 4. Domain And Website Tools

### `domain_checker.js`

Role:

- Validate domain format.
- Resolve MX/A/AAAA/TXT.
- Fetch website via HTTPS, fallback HTTP.
- Extract title and body sample.
- Emit domain/website evidence.

Algorithm:

```text
validate domain
-> resolve MX, A, AAAA, TXT in parallel
-> fetch https://domain
-> if HTTPS inactive, fetch http://domain
-> choose best result
-> emit evidence
```

Evidence:

- `dns_mx`
- `dns_address`
- `company_website`
- `domain_validation`

Scoring deltas:

- MX present: `+10`
- address records present: `+5`
- website active with title: `+20`
- website active without title: `+15`
- website inactive: `-20`

Change impact:

- Timeout and HTTP handling affect many custom domains.
- Increasing negative website inactive weight may punish real companies with blocked sites.

### `website_crawler_router.js`

Role:

- Lightweight crawl of likely company pages.
- Current paths:
  - `/`
  - `/about`
  - `/about-us`
  - `/team`
  - `/founders`
  - `/contact`
  - `/pricing`
  - `/careers`
  - `/privacy`
  - `/terms`

Algorithm:

```text
select first N candidate paths
-> fetch pages in parallel
-> dedupe final URLs
-> detect active pages
-> detect business/team/legal/contact signals
-> emit evidence
```

Evidence:

- `website_crawler`

Scoring deltas:

- readable active pages: up to `+15`
- business/company signals: up to `+20`

Change impact:

- Adding paths increases runtime and remote requests.
- Signal regex changes affect confidence.

## 5. Search And Scrape Fallback Tools

### Fallback Query (inline, Go `internal/orchestrator`)

> **Note:** Query selection sekarang dilakukan oleh AI reasoning loop (Phase A). Go hanya menyediakan simple fallback query yang digunakan ketika AI tidak tersedia.

Role:

- Build a single simple search query for fallback mode.
- Inline logic in orchestrator — tidak ada package terpisah.

Algorithm:

```text
if custom domain:
  query = "<domain>" company

if free email + full_name:
  query = "<local>" OR "<fullname>"

if free email, no full_name:
  query = "<local>"
```

`no_hp` is not used for public search.

### `ddg_search.js`

Role:

- Free DuckDuckGo HTML search fallback.
- Low reliability.
- Should not be treated like a dedicated search API.

Algorithm:

```text
fetch https://html.duckduckgo.com/html/?q=<query>
-> parse title/url/snippet with regex
-> decode DDG redirect URL if possible
-> return top 5 results
```

Evidence:

- `free_serp_search`

Scoring delta:

- public candidate results: `+5`

Failure behavior:

- If fetch/parsing fails, return `ok: false`.
- `company_check` records failure in `tool_errors`.

Change impact:

- Regex parsing is fragile because DuckDuckGo HTML can change.
- Keep reliability `low`.

### `free_scraper.js`

Role:

- Lightweight HTML-to-text scraper for active URLs.
- Low reliability fallback, not deep crawling.

Algorithm:

```text
fetch URL
-> remove script/style
-> strip HTML tags
-> collapse whitespace
-> keep snippet
```

Evidence:

- `free_scraper`

Scoring delta:

- business-like page content: `+5`

Failure behavior:

- No URL: `tools_skipped`.
- Fetch failure: `tool_errors`.
- Successful scrape without business terms: tool used, no confidence evidence.

## 6. Scoring And Classification

### `scoring_engine.js`

Role:

- Rules-first classification and confidence scoring.
- Central place for final classification logic.

Algorithm:

```text
base_score = 35
evidence_delta = sum(confidence_delta)
confidence_score = clamp(base_score + evidence_delta, 0, 100)

if invalid/disposable:
  suspicious_or_invalid
else if free email:
  likely_personal_email unless score >= 45
else if domain website active:
  possible_company_affiliated
else if score >= 45:
  possible_company_affiliated
else:
  unknown_needs_more_evidence
```

Confidence label:

```text
>= 75: high
>= 45: medium
else: low
```

Automation actions:

- `route_company_associated`
- `continue_as_personal_or_unknown`
- `risk_or_format_review`
- `store_unknown_retry_later`

Guardrail:

```text
owner_claim_allowed = false
```

Change impact:

- This file controls final classification.
- Any scoring threshold change should update `scoring_rules.yaml`, docs, and tests.

## 7. Reporting And Storage Tools

### `report_formatter` (Go `internal/report`)

Role:

- Convert JSON result into Telegram-safe text.
- **Fallback mode only** — digunakan ketika AI reasoning tidak aktif.
- Di Phase A, AI reasoning loop yang menghasilkan narasi investigasi langsung.

Sections (format fallback):

- Header: `[FALLBACK MODE — AI reasoning tidak aktif]`
- Kesimpulan (headline + alasan + gaps)
- Classification, Confidence, Automation
- Input
- Fallback summary:
  - Tools dijalankan (tools_used)
  - Tools gagal (tool_errors) dengan error message
  - Tools dilewati (tools_skipped) dengan alasan
  - Evidence count
  - Note: "[Fallback Mode] AI reasoning tidak aktif. Untuk investigasi lebih dalam, jalankan ulang saat AI tersedia."
- Scoring summary (deterministik)
- Rekomendasi automation

Note:

- Narasi investigasi step-by-step (investigationSteps) sudah dihapus — AI yang handle di Phase A.
- `looksLikeBrand()` dan `initialHypothesis()` sudah dihapus — AI yang detect ini.
- Query selection sudah dihapus dari report — AI yang handle query selection.

### `evidence_store.js`

Role:

- Store MVP file-based evidence/report snapshots.
- Prototype for future Postgres evidence store.

Writes:

- `evidence/<email>-<hash>.json`
- `reports/<email>-<hash>.txt`
- `evidence/audit.jsonl`
- `evidence/latest.json`
- `reports/latest.txt`

Retention:

- evidence JSON: latest 1000 files
- report TXT: latest 1000 files
- audit JSONL: latest 5000 lines

Environment overrides:

- `COMPANY_DETECTION_MAX_EVIDENCE_FILES`
- `COMPANY_DETECTION_MAX_REPORT_FILES`
- `COMPANY_DETECTION_MAX_AUDIT_LINES`

### Go `last-report`

Role:

- Reads `evidence/audit.jsonl`.
- Returns latest report, optionally filtered by email.

### Go `tool-status`

Role:

- Parses `config/tool_catalog.yaml`.
- Returns current tool status report.

Limit:

- YAML parser is simple line-based parser.
- Keep catalog indentation simple.

### Go Slack reporter

Role:

- Optional Slack sender.
- Uses webhook or Slack bot token if configured.

Important:

- Not automatic.
- `company_check` calls it when `--send-slack` is present, for **all classification results** — personal, company, unknown, suspicious.
- After a database is available, routing will be split: personal/unknown saved to DB only, company-associated to both Telegram and Slack.

## 8. Config Files

### `tool_catalog.yaml`

Purpose:

- Human/machine-readable registry of tools.
- Shows status, type, command, cost, priority.

Statuses:

- `enabled`
- `enabled_with_ddg`
- `check_runtime`
- `disabled_waiting_budget`
- `optional`

### `scoring_rules.yaml`

Purpose:

- Reference for scoring thresholds and weights.
- Should stay aligned with `scoring_engine.js`.

## 9. Future Tools From Enrichment Plan

Planned:

- `social_link_extractor`
- `company_profile_builder`
- `public_profile_search`
- `role_signal_extractor`
- `relationship_scorer`
- `maps_signal_search`
- Postgres DB writer
- Slack alert decision function

Rule:

```text
Each new tool must declare:
- input
- output
- evidence type
- reliability
- failure behavior
- whether it affects score
```

## 10. Change Impact Map

If changing:

- free email logic -> check `email_intelligence`, fallback query (orchestrator), `scoring_engine`.
- domain/website logic -> check `domain_checker`, `website_crawler_router`, `free_scraper`, browser skip reason.
- search behavior -> check fallback query (orchestrator), `ddg_search`, evidence reliability.
- scoring -> check `scoring_engine`, `scoring_rules.yaml`, report examples.
- report wording -> check `report_formatter` (fallback mode), `AGENTS.md`, Telegram screenshots/results.
- storage -> check `evidence_store` and [Product Workflow and Storage Plan](../product/PRODUCT_WORKFLOW_AND_STORAGE_PLAN.md).
- Slack -> check `slack_reporter`, alert decision rules, and [Product Workflow and Storage Plan](../product/PRODUCT_WORKFLOW_AND_STORAGE_PLAN.md).
- multi-agent -> check [Flow Map](FLOW_MAP.md), [Next Level Enrichment Plan](../product/NEXT_LEVEL_ENRICHMENT_PLAN.md), and [TRD](TRD.md).
