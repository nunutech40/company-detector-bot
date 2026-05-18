# Project Implementation Review

Tanggal review: 2026-05-18 (updated)
Scope review: membandingkan implementasi saat ini dengan PRD v6, TRD, Building Plan, Next Level Enrichment Plan, Product Workflow and Storage Plan, Flow Map, dan Tools/Algorithms Reference.

## 1. Executive Summary

Project sudah mencapai **Phase A (AI Reasoning Loop) yang siap ditest**. Sistem sudah punya Go CLI deterministik sebagai tool catalog + fallback mode, AGENTS.md Phase A dengan two-phase investigation dan structured findings, anti-hallucination enforcement di scoring engine, dan search cascade 4 providers.

**Arah: Agentic Company Detector**

AI reasoning loop sebagai primary mode. Deterministik pipeline sebagai fallback. Sama seperti agentic coding — AI punya goal, punya tool catalog, dan dia iterate sampai goal tercapai atau budget habis.

Status saat ini:

```text
Go MVP Deterministik (Phase 1): DONE
  - Go CLI deployed di VPS, semua test pass
  - Search cascade: Google CSE → Brave → Bing → DDG
  - Anti-hallucination: scoring engine reject AI evidence tanpa source URL
  - no_hp sebagai confirmation tool
  - Report fallback mode only
  - deploy.sh: satu command sync ke VPS
  - deliver_report.sh: kirim AI report ke Slack (prioritas ai_report_latest.txt)

Phase A (AI Reasoning Loop): READY TO TEST
  - AGENTS.md sudah Phase A: two-phase investigation, reasoning rounds, structured findings
  - Tool catalog: Go tools + OpenClaw built-in + paid/not configured
  - Stop conditions, information gain check, evidence chain
  - Belum ditest end-to-end dari Telegram

Query package: DIHAPUS — AI yang handle query selection
Report formatter: DISEDERHANAKAN ke fallback mode only

Google CSE API key: BELUM DIKONFIGURASI (gratis, 100/hari)
Brave Search API: BELUM DIKONFIGURASI (~$5/bulan)
brand_hint_detector, social_link_extractor, role_signal_extractor: BELUM JADI GO PACKAGE
Slack delivery: MASIH MANUAL (AI perlu jalankan deliver_report_with_env.sh)

Postgres/queue/dashboard: DESIGNED, NOT IMPLEMENTED
Slack alert routing: DESIGNED (setelah DB)
Multi-agent: DESIGNED (Phase D)
```

## 2. Current Implemented System

Runtime MVP saat ini:

```text
Telegram / CLI input
-> scripts/company_check_go.sh
-> Go company-check orchestrator
-> internal/emailintel
-> internal/domaincheck, if custom domain
-> internal/crawler, if custom domain
-> internal/query
-> internal/search
-> internal/scraper, if active URL exists
-> internal/scoring
-> internal/report
-> internal/evidence, if --save
-> internal/slack, only if explicitly enabled
```

Implemented files:

- `openclaw_workspace/AGENTS.md`
- `openclaw_workspace/TOOLS.md`
- `openclaw_workspace/skills/company-detection/SKILL.md`
- `openclaw_workspace/config/tool_catalog.yaml`
- `openclaw_workspace/config/scoring_rules.yaml`
- `openclaw_workspace/scripts/company_check_go.sh`
- `go-service/cmd/company-check/main.go`
- `go-service/internal/*`
- `openclaw_workspace/scripts/company_check.js`
- `openclaw_workspace/scripts/email_intelligence.js`
- `openclaw_workspace/scripts/domain_checker.js`
- `openclaw_workspace/scripts/website_crawler_router.js`
- `openclaw_workspace/scripts/serp_query_builder.js`
- `openclaw_workspace/scripts/ddg_search.js`
- `openclaw_workspace/scripts/free_scraper.js`
- `openclaw_workspace/scripts/scoring_engine.js`
- `openclaw_workspace/scripts/report_formatter.js`
- `openclaw_workspace/scripts/evidence_store.js`
- `openclaw_workspace/scripts/last_report_go.sh`
- `openclaw_workspace/scripts/tool_status_go.sh`
- Go Slack reporter via `go-service/internal/slack`

Important docs already created:

- [Root README](../../README.md)
- [Docs Index](../README.md)
- [High Level Business Flow](../product/HIGH_LEVEL_BUSINESS_FLOW.md)
- [Flow Map](../technical/FLOW_MAP.md)
- [Tools and Algorithms Reference](../technical/TOOLS_AND_ALGORITHMS.md)
- [Next Level Enrichment Plan](../product/NEXT_LEVEL_ENRICHMENT_PLAN.md)
- [Product Workflow and Storage Plan](../product/PRODUCT_WORKFLOW_AND_STORAGE_PLAN.md)
- [Backlog](../../BACKLOG.md)

## 3. Comparison Against PRD

### 3.1 PRD Goal

PRD goal: mendeteksi apakah akun yang mendaftar merupakan individu biasa, pekerja perusahaan, pemilik/founder bisnis, agency/freelancer bisnis, suspicious, atau unknown.

Current status:

| PRD Area | Status | Notes |
|---|---:|---|
| Deteksi email perusahaan/custom domain | Done for MVP | Custom domain, MX, website, crawler, SERP fallback sudah ada. |
| Deteksi personal/free email | Partial | Free email diklasifikasi personal/unknown; local-part query sudah disiapkan. |
| Deteksi founder/owner | Not implemented | Guardrail sudah ada: tidak boleh klaim founder/owner tanpa explicit role evidence. |
| Deteksi agency/freelancer | Not implemented | Masuk next-level personal-to-business discovery. |
| Suspicious/disposable | Partial | Disposable hints ada, tapi risk scoring belum lengkap. |
| Unknown/inconclusive | Partial | Classification ada, tapi retry/review dashboard belum ada. |
| Evidence-based decision | Done for MVP | Evidence items disimpan di JSON. |
| Slack narrative report | Partial | Report text ada; Slack sender optional; alert rules belum production. |
| Internal JSON result | Done for MVP | `company_check --json` menghasilkan structured output. |
| Automation recommendation | Done for MVP | `automation_action` dan report recommendation ada. |

### 3.2 PRD Principles

| Principle | Status | Notes |
|---|---:|---|
| Goal-driven investigation | Partial | Saat ini deterministic orchestrator, bukan full agent planning. Namun goal dan tool policy jelas. |
| Tool catalog aware | Done | `tool_catalog.yaml`, `TOOLS.md`, dan `/tool_status` tersedia. |
| Skip disabled tools with reason | Done | Firecrawl/Tavily/enrichment/browser skip reasons ada. |
| Evidence over guess | Done for MVP | Failed tools tidak masuk evidence; tool errors dipisah. |
| Audit trail | Done for MVP | File evidence/report/audit JSONL. Belum DB. |
| Human-readable + machine-readable | Done for MVP | Telegram report + JSON result. |
| Cost-aware routing | Partial | Paid tools disabled; belum ada actual cost tracking. |

## 4. Comparison Against TRD

TRD target teknis meliputi OpenClaw Gateway, custom worker, queue, Postgres evidence store, tool catalog, scoring engine, Slack reporter, multi-agent, observability.

| TRD Component | Status | Notes |
|---|---:|---|
| OpenClaw Gateway | Done | VPS runtime sudah jalan. |
| Telegram channel | Done | MVP delivery via Telegram. |
| Investigation worker | Partial | Go CLI worker/orchestrator sudah ada; belum menjadi API/queue worker. |
| Queue | Not implemented | Redis/BullMQ belum ada. |
| Postgres evidence store | Not implemented | File-based evidence masih prototype. |
| Tool catalog | Done | YAML + docs + status script. |
| Email intelligence custom tool | Done | Script exists. |
| Domain checker custom tool | Done | Script exists. |
| SERP query builder | Done | Script exists. |
| DDG fallback search | Done | Free fallback, low reliability. |
| Website crawler router | Done for lightweight MVP | Not deep crawler. |
| Free scraper | Done for lightweight MVP | Not deep/JS scraper. |
| Scoring engine | Done for MVP | Rules-first; simple thresholds. |
| Report formatter | Done for Telegram | Slack Block Kit not implemented. |
| Slack reporter | Partial | Sender exists, explicit only. |
| Evidence tables | Not implemented | Designed in docs only. |
| Multi-agent | Not implemented | Designed only. |
| Observability/cost tracking | Not implemented | No metrics/rate/cost dashboard yet. |
| Security/privacy guardrails | Partial | No secrets in git; docs mention minimization; no production privacy controls yet. |

## 5. Comparison Against Building Plan

Building Plan target awal: VPS siap, OpenClaw jalan, Telegram bot aktif, `/check` bisa membalas report berisi success/failed/skipped, tool availability, dan evidence.

| Building Plan Item | Status | Notes |
|---|---:|---|
| VPS foundation | Done | Server prepared previously. |
| OpenClaw install/onboard | Done | Gateway and Telegram configured. |
| Telegram pairing | Done | Bot works for MVP. |
| Prompt/agent behavior | Done | `AGENTS.md` instructs `/check` behavior. |
| Email parser | Done | `email_intelligence.js`. |
| Free/corporate detection | Done | Free domains/custom domain logic. |
| Domain/website check | Done | DNS + HTTP fetch. |
| Tool status command | Done | Go wrapper `tool_status_go.sh`. |
| Last report command | Done | Go wrapper `last_report_go.sh`. |
| Evidence JSON | Done | File-based snapshots. |
| Report format | Done | Telegram-safe text. |
| Tool skipped reasons | Done | Paid/optional tools have reasons. |
| Avoid asking feedback | Done | Agent and report recommendation are automation-oriented. |
| Reset stale sessions after prompt changes | Done during previous deployment | Operationally done; not a permanent automation. |

## 6. Comparison Against Next Level Enrichment Plan

Next Level goal: setelah deteksi awal, memperkaya data perusahaan dan menemukan kemungkinan hubungan bisnis dari email personal.

| Next Level Feature | Status | Notes |
|---|---:|---|
| Company profile object | Not implemented | No `company_profile` object in runtime yet. |
| Social link extraction from official website | Not implemented | Crawler detects signals but does not extract social URLs. |
| Company name normalization | Partial | Domain checker gets title; no normalized company profile builder. |
| Business description/industry | Partial | Snippets exist; no structured field extraction. |
| Address/location | Not implemented | No Maps/local signal tool yet. |
| LinkedIn/company profile discovery | Partial | DDG can return LinkedIn result; not normalized as entity candidate. |
| Instagram/TikTok/X/Facebook/YouTube discovery | Not implemented | Planned. |
| Marketplace/app/product pages | Not implemented | Planned. |
| Personal-to-business discovery | Very partial | Free email local-part query exists; no profile/entity extraction. |
| Role signal extractor | Not implemented | No CEO/founder/owner extraction. |
| Relationship scorer | Not implemented | No `business_relationship` runtime field yet. |
| Source confidence per field | Not implemented | Evidence reliability exists, but no field-level confidence. |
| Enrichment report shape | Not implemented | Telegram report still MVP company detection format. |

Current best interpretation:

```text
The code has the low-level search/scrape primitives needed for enrichment, but not the enrichment layer itself.
```

## 7. Comparison Against Product Workflow and Storage Plan

Target plan: Postgres stores everything, Slack only important alerts, dashboard shows all checked data.

| Product Workflow Area | Status | Notes |
|---|---:|---|
| Postgres as source of truth | Not implemented | File evidence only. |
| DB schema | Designed | Tables documented, not created. |
| DB writer beside file writer | Not implemented | Next practical step. |
| Slack alert rules | Designed | No `should_send_slack_alert` function yet. |
| Slack only for important signals | Partial | Slack is explicit/off by default; no alert decision logic. |
| Web dashboard job list | Not implemented | Planned. |
| Web dashboard job detail | Not implemented | Planned. |
| Search/filter/review UI | Not implemented | Planned. |
| Platform registration ingestion | Not implemented | Telegram/CLI only. |
| Queue/retry/backpressure | Not implemented | Planned. |

## 8. Flow and Documentation Maintainability

Recent documentation improved maintainability:

- [High Level Business Flow](../product/HIGH_LEVEL_BUSINESS_FLOW.md) explains the business-level input-to-output model.
- [Flow Map](../technical/FLOW_MAP.md) explains runtime flow and decision points.
- [Tools and Algorithms Reference](../technical/TOOLS_AND_ALGORITHMS.md) explains each tool and change impact.
- [Next Level Enrichment Plan](../product/NEXT_LEVEL_ENRICHMENT_PLAN.md) explains enrichment direction.
- [Product Workflow and Storage Plan](../product/PRODUCT_WORKFLOW_AND_STORAGE_PLAN.md) explains DB/Slack/dashboard lifecycle.
- [Backlog](../../BACKLOG.md) groups remaining work.
- [Docs Index](../README.md) defines the reading order.
- [Root README](../../README.md) now acts as the entry point.

Remaining documentation risk:

- PRD/TRD still describe the broader target and may look more advanced than current runtime.
- Some older doc sections mention Slack as primary report channel, while actual MVP uses Telegram.
- Future multi-agent can make flow harder to follow unless every new agent is mapped back to [Flow Map](../technical/FLOW_MAP.md).

Recommended documentation rule:

```text
Any new tool or agent must update:
- docs/technical/FLOW_MAP.md
- docs/technical/TOOLS_AND_ALGORITHMS.md
- tool_catalog.yaml
- BACKLOG.md if it changes roadmap/status
```

## 9. Current Gaps By Priority

### P0: Before More Feature Work

These keep the system understandable and reliable.

1. Add lightweight tests for current scripts.
   - `company_check` for custom domain
   - `company_check` for Gmail/free email
   - invalid email
   - DDG failure path
   - free scraper skipped path

2. Add a structured fixture-based test mode.
   - Avoid relying only on live web results.
   - Freeze sample outputs for Komerce/Gmail-style cases.

3. Add a versioned result schema doc.
   - Current JSON shape is implicit in output.
   - Future enrichment and DB writer need stable fields.

### P1: Production Storage and Alerting

1. Create Postgres schema.
2. Add DB writer while keeping file writer.
3. Add `should_send_slack_alert(result)` decision function.
4. Add Slack alert formatter separate from Telegram formatter.
5. Store `alert_sent` and `review_status`.

### P2: Next Level Enrichment

1. Add `social_link_extractor`.
2. Add `company_profile_builder`.
3. Add `entity_candidates` in JSON result.
4. Add role signal extraction from snippets/pages.
5. Add `business_relationship` classification for personal emails.
6. Add field-level source confidence.

### P3: Dashboard and Platform Integration

1. Build job list view.
2. Build job detail view.
3. Add search/filter.
4. Add review actions.
5. Add platform registration ingestion.
6. Add queue/retry/backpressure.

### P4: Multi-Agent

Do this after DB/worker/job contracts are stable.

Recommended agent split:

- Orchestrator Agent
- Email/Identity Agent
- Company Website Agent
- Web Research Agent
- Public Profile Agent
- Scoring Agent
- Report Agent

Important rule:

```text
Sub-agents collect evidence. Final scoring and claims stay centralized.
```

## 10. Risk Review

### Risk: Flow becomes too hard to read

Status: mitigated by [Flow Map](../technical/FLOW_MAP.md), [Tools and Algorithms Reference](../technical/TOOLS_AND_ALGORITHMS.md), and [Docs Index](../README.md), but must be maintained.

Mitigation:

- Update flow docs with every new tool/agent.
- Keep final scoring centralized.
- Keep one source of truth for tool status.

### Risk: Overclaiming founder/owner

Status: currently controlled because founder/owner classification is not implemented and `owner_claim_allowed=false`.

Mitigation:

- Require explicit role evidence.
- Prefer two independent sources for founder/owner.
- Keep SERP snippets as medium/low confidence unless cross-checked.

### Risk: Slack becomes noisy

Status: controlled for now because Slack is off unless explicit.

Mitigation:

- Implement alert decision function before enabling Slack production.
- Send only company/high-value/personal-business/suspicious alerts.

### Risk: File evidence grows forever

Status: partially controlled with retention.

Mitigation:

- Move to Postgres.
- Keep file writer only as fallback/dev.

### Risk: Live web fallback is flaky

Status: partially controlled with `tool_errors` and low reliability evidence.

Mitigation:

- Add retry/backoff.
- Add official provider later.
- Add fixture tests.

## 11. Recommended Next Implementation Order

1. **Test Phase A dari Telegram** — kirim `/check nawaystore@yahoo.com` dan verifikasi AI benar-benar memanggil tools, reasoning rounds muncul, structured findings ada.
2. **Setup Google CSE API key** — gratis, 100/hari, langsung improve search reliability.
3. **brand_hint_detector package** — pindah `looksLikeBrand()` ke package tersendiri, perluas.
4. **social_link_extractor** — extract social links dari HTML.
5. **role_signal_extractor** — deteksi CEO/founder/owner dari teks.
6. **Postgres schema + DB writer** — setelah AI loop terbukti menghasilkan evidence lebih kaya.
7. **Slack alert decision** — setelah DB ada, split routing personal vs company.
8. **Dashboard** — setelah DB ada.
9. **Multi-agent** — setelah volume naik.

## 12. Overall Status

Approximate completion by layer:

| Layer | Completion | Comment |
|---|---:|---|
| VPS/OpenClaw/Telegram MVP | 95% | Go binary deployed, live test passed, Slack ok. deploy.sh dan deliver_report.sh aktif. |
| Go deterministik tool catalog | 90% | emailintel, domaincheck, crawler, scraper, search cascade, scoring, evidence. |
| Phase A — AI Reasoning Loop | 80% | AGENTS.md siap, belum ditest end-to-end dari Telegram. |
| Anti-hallucination enforcement | 90% | Scoring engine reject AI evidence tanpa source URL. |
| Search providers | 40% | Bing+DDG aktif; Google CSE dan Brave belum dikonfigurasi. |
| Tool catalog expansion | 10% | `looksLikeBrand()` ada tapi belum jadi package; social/role extractor belum. |
| Evidence/report audit | 60% | File-based done. Postgres missing. |
| Slack production workflow | 35% | Sender exists, all-classification; deliver_report.sh ada tapi masih manual; alert rules dan DB routing belum. |
| Dashboard | 0% | Designed only. |
| Queue/worker/platform integration | 0% | Designed only. |
| Multi-agent | 0% | Designed only. |
| Documentation | 95% | Semua docs sinkron dengan implementasi aktual. |

**Next turning point:** Test Phase A dari Telegram. Kalau AI benar-benar memanggil tools dan menghasilkan structured findings yang lebih kaya dari fallback mode → Phase A terbukti, lanjut ke tool catalog expansion dan Postgres.
