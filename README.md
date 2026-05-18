# Company Detector Bot

AI Company Detection Agent berbasis OpenClaw untuk mengecek apakah email/register input kemungkinan terkait perusahaan, personal, suspicious, atau butuh evidence tambahan.

MVP saat ini berjalan lewat Telegram: user mengirim `/check email@domain.com`, agent menjalankan investigation flow, lalu mengembalikan classification, confidence, evidence summary, tool status, dan automation recommendation.

## Current Status

Yang sudah aktif:

- Telegram bot command flow via OpenClaw.
- Deterministic `company_check.js` orchestrator.
- Email intelligence, DNS/domain check, lightweight website crawler.
- DuckDuckGo HTML search fallback dan lightweight scraper fallback.
- Rules-first scoring engine.
- Telegram report formatter.
- File-based evidence store dengan retention.
- `/tool_status` dan `/last_report`.

Yang belum production:

- Next-level company/social enrichment.
- Personal-to-business relationship discovery.
- Postgres, queue, dashboard, dan platform register API.
- Slack alert routing production.
- Multi-agent parallel investigation.

## Read The Docs

Mulai dari sini: [Documentation Index](docs/README.md).

Urutan baca paling enak:

1. [High Level Business Flow](docs/product/HIGH_LEVEL_BUSINESS_FLOW.md) - gambar besar input sampai output, current vs level 2.
2. [Flow Map](docs/technical/FLOW_MAP.md) - alur runtime dan decision point yang lebih teknis.
3. [Tools and Algorithms Reference](docs/technical/TOOLS_AND_ALGORITHMS.md) - kamus semua script/tool dan algoritmanya.
4. [Backlog](BACKLOG.md) - apa yang sudah selesai dan apa yang belum.

## Run Locally

```bash
cd openclaw_workspace
node scripts/company_check.js contact@komerce.id --save
```

JSON output:

```bash
cd openclaw_workspace
node scripts/company_check.js contact@komerce.id --json
```

Tool status:

```bash
cd openclaw_workspace
node scripts/tool_status.js
```

Last saved report:

```bash
cd openclaw_workspace
node scripts/last_report.js contact@komerce.id
```

Optional Slack send:

```bash
cd openclaw_workspace
COMPANY_DETECTION_SEND_SLACK=true node scripts/company_check.js contact@komerce.id --send-slack
```

## Runtime Contract

For every valid `/check <email>` request, OpenClaw should run:

```bash
cd ~/.openclaw/workspace
node scripts/company_check.js <email> --save
```

The final result must stand on its own for automation. It must not ask the user for feedback or clarification when a valid email exists.

Current classifications:

- `possible_company_affiliated`
- `unknown_needs_more_evidence`
- `likely_personal_email`
- `suspicious_or_invalid`

Fallback policy:

- A tool enters `tools_used` only when it actually runs successfully.
- Failed DDG/free scraper calls go to `tool_errors`, not evidence.
- Skipped paid/unavailable tools go to `tools_skipped`.
- Slack delivery is explicit only via `--send-slack` or `COMPANY_DETECTION_SEND_SLACK=true`.

## Repo Map

```text
.
+-- README.md
+-- BACKLOG.md
+-- docs/
|   +-- README.md
|   +-- product/
|   +-- technical/
|   +-- operations/
|   +-- reviews/
+-- openclaw_workspace/
    +-- AGENTS.md
    +-- TOOLS.md
    +-- config/
    +-- scripts/
    +-- skills/
```

Operational VPS details, passwords, tokens, `evidence/`, `reports/`, and `.env` are intentionally not tracked in git.
