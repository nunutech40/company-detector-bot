# Company Detector Bot

AI Company Detection Agent berbasis OpenClaw untuk mengecek apakah email/register input kemungkinan terkait perusahaan. MVP saat ini berjalan lewat Telegram: user mengirim `/check email@domain.com`, agent menjalankan tool-backed investigation, lalu mengembalikan report berisi klasifikasi, confidence, evidence, tool yang dipakai, tool yang gagal, tool yang dilewati, dan rekomendasi automation.

## Status Singkat

MVP Telegram sudah berjalan di VPS dengan OpenClaw Gateway dan model MiniMax. Flow sekarang masih file-based untuk evidence store, belum Postgres/queue production.

Yang sudah aktif:
- Telegram bot command flow via OpenClaw.
- Deterministic company check script.
- Email intelligence.
- DNS/domain/website check.
- Lightweight website crawler.
- Free DuckDuckGo HTML search fallback.
- Lightweight free scraper fallback.
- Rules-first scoring engine.
- Report formatter untuk Telegram.
- File evidence store dengan retention.
- `/tool_status` dan `/last_report`.

Yang belum production:
- Next-level enrichment untuk company profile, social footprint, dan personal-to-business discovery.
- Postgres evidence store.
- Redis/BullMQ job queue.
- Worker API endpoint.
- Dedicated paid search/scrape providers seperti Firecrawl/Tavily.
- Paid enrichment vendor.
- Browser fallback otomatis untuk JS-heavy pages.
- Slack delivery production.
- Multi-agent parallel investigation.

## Dokumentasi Utama

- [PRD Deteksi Perusahaan v6](PRD_Deteksi_Perusahaan_v6_AI_OpenClaw_Serious_With_Theory.md): product goal, principles, classifications, tool philosophy, reporting expectations.
- [TRD AI Company Detection Agent](TRD_Deteksi_Perusahaan_AI_OpenClaw_v1.md): technical architecture, custom tools, data model, multi-agent design, deployment notes.
- [Building Plan OpenClaw Telegram MVP](BUILDING_PLAN_OpenClaw_Telegram_MVP_From_VPS.md): implementation plan from VPS setup to Telegram MVP.
- [Next Level Enrichment Plan](NEXT_LEVEL_ENRICHMENT_PLAN.md): email-first plan for company enrichment, social footprint discovery, and personal-to-business relationship detection.
- [Backlog](BACKLOG.md): remaining production work and stabilization status.
- [OpenClaw Agent Prompt](openclaw_workspace/AGENTS.md): behavior contract used by the Telegram agent.
- [Tool Notes](openclaw_workspace/TOOLS.md): current runtime, tool availability, operational rules.
- [Tool Catalog](openclaw_workspace/config/tool_catalog.yaml): machine-readable-ish registry of enabled/disabled/optional tools.
- [Scoring Rules](openclaw_workspace/config/scoring_rules.yaml): classification and evidence weighting notes.

## Current Runtime Flow

For every valid `/check <email>` request, OpenClaw should run:

```bash
cd ~/.openclaw/workspace
node scripts/company_check.js <email> --save
```

High-level flow:

1. `email_intelligence.js`
   Parses the email, detects free providers, disposable hints, role mailboxes, and custom domains.

2. `domain_checker.js`
   Checks DNS MX/A/AAAA/TXT and tries lightweight website fetch.

3. `website_crawler_router.js`
   Crawls candidate paths such as `/`, `/about`, `/team`, `/founders`, and `/contact` using lightweight fetch.

4. `serp_query_builder.js`
   Builds search queries for domain/company or public-profile checks.

5. `ddg_search.js`
   Free DuckDuckGo HTML fallback. Reliability is low and evidence weight is intentionally small.

6. `free_scraper.js`
   Lightweight fetch/scrape fallback for active URLs. Reliability is low and evidence weight is intentionally small.

7. `scoring_engine.js`
   Rules-first scoring and classification.

8. `report_formatter.js`
   Telegram-safe human report.

9. `evidence_store.js`
   Saves JSON evidence and text report snapshots.

## Commands

Run a company check:

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

## Output Contract

The final result must stand on its own for automation. It must not ask the user for feedback or clarification when a valid email exists.

Current classifications:
- `possible_company_affiliated`
- `unknown_needs_more_evidence`
- `likely_personal_email`
- `suspicious_or_invalid`

Every result should include:
- `classification`
- `confidence_score`
- `confidence_label`
- `automation_action`
- `tools_used`
- `tools_skipped`
- `tool_errors`
- `evidence`
- `telegram_report`

Claim safety:
- Custom/corporate-looking email can support `possible_company_affiliated`.
- Never claim founder/owner without explicit role evidence.
- Free email without additional evidence should remain personal/unknown.

## Fallback And Error Policy

Fallbacks are intentionally conservative:
- A tool enters `tools_used` only when it actually runs successfully.
- Failed DDG/free scraper calls go to `tool_errors`, not evidence.
- Skipped paid/unavailable tools go to `tools_skipped`.
- DDG/free scraper evidence is low reliability and low score impact.
- Browser is not a default step. If lightweight web evidence is available, browser is `skipped_not_needed_for_mvp`; if lightweight web evidence fails, browser is `optional_fallback_disabled_for_mvp`.
- Slack delivery is not automatic. It only runs with `--send-slack` or `COMPANY_DETECTION_SEND_SLACK=true`.

## Evidence Storage

MVP stores audit artifacts in files:
- `evidence/*.json`
- `reports/*.txt`
- `evidence/audit.jsonl`
- `evidence/latest.json`
- `reports/latest.txt`

Retention defaults:
- evidence JSON latest 1000 files
- report TXT latest 1000 files
- audit JSONL latest 5000 lines

Override with:
- `COMPANY_DETECTION_MAX_EVIDENCE_FILES`
- `COMPANY_DETECTION_MAX_REPORT_FILES`
- `COMPANY_DETECTION_MAX_AUDIT_LINES`

## Deployment Notes

The VPS runtime workspace is:

```bash
/home/nunuopc/.openclaw/workspace
```

OpenClaw Gateway should stay loopback-only. The Control UI is intended to be accessed through SSH tunnel, not exposed publicly.

Operational VPS details, passwords, and tokens are intentionally not tracked in git. Local `info`, `evidence/`, `reports/`, and `.env` are ignored.

## Next Work

See [BACKLOG.md](BACKLOG.md). The next sensible production steps are:
- Email-first company/social enrichment as described in [NEXT_LEVEL_ENRICHMENT_PLAN.md](NEXT_LEVEL_ENRICHMENT_PLAN.md).
- Postgres schema for jobs/tool runs/evidence/final reports.
- Queue worker with Redis/BullMQ.
- Worker API endpoint for platform registration integration.
- Dedicated provider search/scrape if budget is available.
- Better public profile checkers.
- Multi-agent investigation for high-value or ambiguous leads.
