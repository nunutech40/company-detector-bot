# Product Requirements Document

**Project:** AI Company Detection Agent  
**Version:** v9
**Status:** Active product source of truth  
**Last updated:** 15 Juni 2026

---

## 1. Executive Summary

AI Company Detection Agent membantu Komerce mendeteksi apakah user yang register adalah personal biasa, pemilik bisnis, perusahaan, agency/freelancer, atau akun mencurigakan. Output utama dipakai untuk segmentasi otomatis: user bisnis diarahkan ke jalur B2B atau sales alert, sedangkan user personal tetap masuk flow reguler.

Sistem memakai dua lapisan:

1. **Deterministic Go pipeline** untuk hasil cepat, repeatable, dan auditable.
2. **AI reasoning loop via OpenClaw + Qwen** untuk investigasi lebih dalam saat sinyal awal belum cukup.

Hasil investigasi disimpan dalam dua bentuk:

- File evidence JSON sebagai artefak audit.
- PostgreSQL sebagai source of truth operasional untuk dashboard, review, dan integrasi lanjutan.

---

## 2. Product Goals

- Mendeteksi akun bisnis dari data register minimal: `email`, `full_name`, `no_hp`, dan `brand_name`.
- Mengurangi false positive dengan evidence-based scoring, bukan tebakan AI.
- Menyimpan semua hasil investigasi supaya bisa dilihat, difilter, dan direview.
- Menyediakan dashboard internal untuk tim Komerce.
- Menyediakan Webhook API agar platform register bisa memicu investigasi otomatis.
- Menjaga biaya AI tetap terkendali dengan stop condition, token tracking, dan fallback deterministik.
- Memantau review Google Business Komerce berbintang 1-3 melalui fitur
  deterministic yang terisolasi dari investigation flow.
- Memantau komentar negatif Facebook Page, Instagram Professional Account,
  dan komentar iklan yang dapat diakses melalui Meta API menggunakan AI
  classifier terstruktur yang terisolasi.

## 3. Non-Goals

- Bukan pengganti KYC legal.
- Bukan sistem credit scoring atau fraud decision final.
- Tidak melakukan public search memakai nomor HP. `no_hp` hanya dipakai sebagai konfirmasi jika ditemukan dari sumber publik lain.
- Tidak mengizinkan AI membuat klaim tanpa evidence dari tool output.

---

## 4. Current Product Status

Status per 15 Juni 2026:

| Area | Status | Catatan |
|---|---|---|
| Go deterministic pipeline | Done | Email intelligence, domain check, crawler, search cascade, scraper, scoring, report |
| AI reasoning loop | Done | OpenClaw + 9Router `komerce-1.2`, controlled by AGENTS.md and STANDING_ORDERS.md |
| Telegram flow | Active | Channel testing dan operasional AI loop |
| PostgreSQL storage | Done | 3-table MVP schema |
| Dashboard | Done | Express + EJS, port 3001 |
| Webhook API | Done | Express API port 3002, enqueue-only ke PostgreSQL `register_intake_jobs` |
| Queue worker | Done | Sequential worker memproses satu job per waktu via OpenClaw agent dan finalizer |
| Slack delivery | Done | Daily prospect digest jam 09:00 WIB; realtime raw report disabled |
| End-to-end validation | Partial | Queue simulation 14 data selesai; Komerce platform register flow masih next validation |
| Google review monitor | Waiting approval | Service/API client/OAuth bootstrap selesai; Google Business Profile API access masih menunggu approval |
| Meta negative comment monitor | Planned | Architecture defined; waiting Meta Business/App access and implementation |

### Google Review Monitor Product Requirement

Review monitor adalah fitur dalam repository dan deployment Company Detector,
tetapi bukan bagian dari AI company investigation.

```text
Google Pub/Sub review event
-> durable queue
-> rating 1-3 deterministic classification
-> Telegram result for every review
-> Slack monitoring only when rating 1-3
```

Requirements:

- Tidak menggunakan AI agent untuk collect, filter, deduplicate, atau delivery.
- Tidak membaca/menulis investigation jobs, scoring, atau prospect digest.
- Boleh berbagi Docker image, Slack credential, dan helper
  infrastructure.
- Tidak boleh menyimpulkan "tidak ada review negatif" ketika OAuth/API gagal
  atau hasil collect stale.
- AI enrichment, sentiment summary, dan response draft hanya boleh menjadi
  fitur opsional setelah raw review terverifikasi.

### Unified Negative Feedback Monitor Requirement

Google review monitor dan Meta comment monitor berada dalam satu operational
feature dengan normalized feedback inbox dan Slack destination yang sama,
tetapi memakai decision path berbeda:

```text
Google review -> rating 1-3 -> negative, tanpa AI
Meta comment -> structured AI classifier -> negative/non-negative/needs-review
```

Requirements:

- Event-driven melalui Google Pub/Sub dan Meta Webhooks, dengan optional
  scheduled reconciliation hanya sebagai recovery backup.
- Tidak memakai OpenClaw agent atau investigation tools.
- AI hanya digunakan untuk klasifikasi komentar Meta.
- Duplicate event tidak boleh menghasilkan duplicate alert.
- AI/API/provider failure tidak boleh dianggap non-negative atau empty.
- Komentar Meta yang gagal diklasifikasikan karena API key expired, provider
  outage, model unavailable, timeout, rate limit, atau invalid provider output
  harus tetap tersimpan sebagai antrean replayable.
- Setelah key/model/provider diperbaiki, sistem harus dapat melakukan
  sweep/requeue dan mengklasifikasikan ulang seluruh job monitoring AI yang
  gagal tanpa membuat duplicate alert.
- Retry/replay monitoring tidak boleh menyentuh antrean investigasi.
- Setiap hasil monitoring yang selesai dikirim langsung ke Telegram.
- Hanya feedback negatif yang langsung dikirim ke Slack monitoring.
- Pemrosesan normal dipicu event, bukan jadwal hourly/daily. Scheduled
  reconciliation hanya optional recovery untuk event yang terlewat.
- Data, queue, secret, dan health monitoring terpisah dari Company Detector
  investigation flow.

---

## 5. Inputs

| Field | Required | Source | Product Meaning |
|---|---:|---|---|
| `email` | Yes | Register form / Telegram / webhook | Primary signal untuk domain, local-part, dan search |
| `full_name` | No | Register form | Identity hint, dipakai untuk disambiguasi |
| `brand_name` | No | Register form | Strong business hint jika diisi |
| `no_hp` | No | Register form | Confirmation only, bukan search seed publik |

---

## 6. Classifications

| Classification | Meaning | Default Product Action |
|---|---|---|
| `possible_company_affiliated` | Evidence cukup kuat bahwa user terkait bisnis/perusahaan | Route ke company/B2B segment dan kandidat Slack digest jika confidence >= 60 |
| `likely_personal_email` | Sinyal lebih cocok personal, tidak ada business evidence kuat | Continue personal flow |
| `unknown_needs_more_evidence` | Data belum cukup untuk keputusan aman | Store, review, retry/enrich later |
| `suspicious_or_invalid` | Email invalid, disposable, atau pola risk tinggi | Risk review |

Confidence score memakai rentang `0-100`:

- `75-100`: high confidence.
- `45-74`: medium confidence.
- `0-44`: low confidence.

---

## 7. Product Flow

```text
Input manual / Telegram
        |
        v
Deterministic Go pipeline
        |
        +--> enough evidence? --> classification + report
        |
        +--> needs more evidence? --> AI reasoning loop
                                      |
                                      v
                               tool calls + evidence
                                      |
                                      v
                        deterministic scoring + final report
        |
        v
File evidence + PostgreSQL + dashboard
        |
        +--> Telegram response
        +--> Slack daily digest reads prospect results at 09:00

Platform register webhook
        |
        v
PostgreSQL table: register_intake_jobs
        |
        v
Sequential worker
        |
        +--> AI transient failure: retry_pending
        +--> AI auth/credit/model failure: blocked_provider
        |
        v
Same investigation + finalization path above
```

Webhook production target adalah menerima data register cepat, menyimpan ke queue, lalu worker memproses satu per satu. Webhook tidak langsung menjalankan investigasi karena volume register harian sekitar 100 data dan Slack hanya mengirim digest sekali sehari.

Jalur yang sudah valid:

- Manual/Telegram investigation.
- Webhook queue -> sequential worker -> OpenClaw agent -> Telegram delivery -> finalizer -> DB/dashboard.
- Provider failures remain replayable; transient failures use backoff and blocked provider jobs resume after configuration recovery.
- Slack daily prospect digest dari row final PostgreSQL.

---

## 8. Evidence Rules

AI boleh menyimpulkan, tetapi tidak boleh mengarang. Setiap klaim harus berasal dari:

- Output Go tool.
- Search result atau scraped page.
- Domain/DNS/website check.
- Social/marketplace link yang ditemukan.
- AI extraction dari report/evidence yang sudah ada.

Rules:

- Tool gagal tidak boleh dihitung sebagai evidence negatif.
- Evidence harus masuk `tools_used`, `tools_skipped`, atau `tool_errors` dengan jelas.
- Scoring dan classification final tetap deterministik.
- AI boleh mengusulkan next action, tetapi tidak boleh override scoring tanpa evidence.

---

## 9. Tool Capability

### Deterministic Go Packages

| Package | Function |
|---|---|
| `emailintel` | Parse local-part/domain, free email, disposable, role account |
| `domaincheck` | DNS, MX, website active, address records |
| `crawler` | Lightweight website crawl |
| `search` | Search cascade: Google CSE if configured, Brave, Bing, DDG |
| `scraper` | Fetch and extract page content |
| `scoring` | Deterministic score and classification |
| `report` | Human-readable report |
| `evidence` | Save evidence JSON |
| `brandhint` | Detect likely brand/store name from email local-part |
| `sociallinks` | Extract social media links from HTML |
| `rolesignal` | Detect owner/founder/CEO role signals |

### OpenClaw Runtime

| Component | Function |
|---|---|
| `AGENTS.md` | Agent behavior contract |
| `STANDING_ORDERS.md` | Persistent instructions injected into sessions |
| `tool_catalog.yaml` | Tool availability and cost tiers |
| `scoring_rules.yaml` | Scoring thresholds and classification rules |
| `finish_investigation.sh` | Mandatory finalization: save, DB write, delivery routing, token usage |

---

## 10. Outputs

### User/Operator Output

- Telegram report for interactive investigation.
- Dashboard list and detail views.
- Slack daily prospect digest for sales/stakeholders.
- Webhook JSON acknowledgement for platform integration.

### Stored Output

- `openclaw_workspace/evidence/*.json`
- `openclaw_workspace/reports/ai_report_latest.txt`
- PostgreSQL tables:
  - `investigation_jobs`
  - `final_reports`
  - `llm_calls`

Dashboard must show:

- Email, name, brand, classification, confidence.
- Business/person/location signals.
- Marketplace and social media links.
- Role evidence.
- Full AI narrative/report.
- LLM token usage and estimated cost.
- Review status.

---

## 11. Database Product Requirements

The database is required because file evidence is not enough for operation. Operators need filtering, review, audit trail, cost visibility, and fast search.

MVP schema uses a pragmatic 3-table design:

- `investigation_jobs`: one row per investigation, fat table with key columns and JSONB fields.
- `final_reports`: full Telegram/Slack text and raw JSON.
- `llm_calls`: model, token, and cost tracking.

Structured social media, marketplace, and role evidence are stored as JSONB arrays in `investigation_jobs` for faster implementation and future backfill.

---

## 12. Dashboard Requirements

Dashboard is read-mostly internal tooling.

Must support:

- List all investigations, newest first.
- Filter by classification, confidence, review status.
- Search by email, domain, business name, person name, social/marketplace JSON.
- Pagination.
- Detail page with raw AI report and structured findings.
- Review actions: `unreviewed`, `reviewed`, `false_positive`, `high_value`, `needs_retry`.
- LLM cost display.

Authentication is not part of current MVP; access is controlled at VPS/network level for now.

---

## 13. Webhook Requirements

Webhook API enables platform register integration. The final product requirement is **async intake**, not direct investigation on request.

Current endpoints:

- `GET /health`
- `POST /webhook/check`

Final webhook integration must:

- Validate shared secret.
- Accept register payload with at least `email` or another agreed identifier.
- Accept optional `full_name`, `no_hp`, and `brand_name`.
- Normalize and sanitize input.
- Store payload in PostgreSQL table `register_intake_jobs` with status `pending`.
- Return fast JSON acknowledgement with queue/job ID.
- Avoid running investigation inside the HTTP request.
- Let a background worker process queued data sequentially.
- Keep AI provider failures replayable; never turn them into false investigation results.
- Notify Telegram once when an AI incident opens and once when processing recovers.
- Notify Telegram when the register worker goes down and when it becomes active again.
- Store completed investigation output through the existing DB/dashboard path.
- Deliver each queued investigation result to Telegram as part of the workflow.

The webhook must support around 100 register submissions per day without burst-processing all of them at once. Queue processing uses PostgreSQL-backed status rows and must be one-at-a-time by default, with scheduled retry, provider-blocked recovery, idempotency, incident notification, and failure tracking.

---

## 14. Slack Prospect Digest Policy

Slack is for sales/stakeholder handoff, not debugging and not raw investigation output.

Target behavior:

```text
Every day at 09:00 Asia/Jakarta
=> send one prospect digest to Slack
```

Digest content:

- Always send a daily message, even when there are no prospects.
- Include browser Sales Sheet link in every digest; sales users should be able to open it without Excel.
- If prospects exist, include a list of prospect-ready accounts from the previous window.
- Each prospect item may include available website, marketplace, and social media summary.
- Do not include dashboard detail links in Slack; sales should continue from the Sales Sheet.
- Hide raw evidence, tool logic, AI reasoning, scraping details, and internal scoring explanation from Slack.
- Keep full investigation detail in dashboard and DB.

Prospect filter target:

```text
classification = possible_company_affiliated
AND confidence_score >= 60
AND not yet included in a previous digest
```

Priority tiers:

```text
75-100 => Hot prospect
60-74  => Warm prospect
```

If no prospects exist, Slack should still send an operational heartbeat:

```text
No new prospects in the last window.
Pipeline is still running.
Sales Sheet: <sales-sheet-url>
```

This keeps Slack clean for sales while still confirming to stakeholders and developers that the pipeline is alive.

---

## 15. Success Metrics

- High-confidence business detections are surfaced in the daily 09:00 prospect digest.
- Medium-confidence business detections appear as Warm prospects.
- Personal/unknown users do not spam Slack.
- Operators can inspect every investigation in dashboard.
- AI reports include enough evidence to justify classification.
- Token/cost tracking exists for each investigation.
- Platform register can enqueue data through webhook without needing Telegram.
- Webhook ingestion can handle around 100 register payloads per day without losing jobs.

---

## 16. Roadmap

### Done

- Phase A: AI reasoning loop on top of deterministic Go pipeline.
- Phase B: PostgreSQL + dashboard.
- Phase C: Webhook enqueue queue, sequential worker, Telegram delivery, and Slack daily prospect digest.

### Next

- Validate with Komerce register flow.
- Improve `db_writer.js` extraction for social/marketplace/role evidence.
- Add dashboard queue visibility if operationally needed.

### Later

- Google CSE key, Firecrawl, Tavily, enrichment APIs.
- Multi-agent parallel investigation.
- Auth layer for dashboard.
- More normalized analytics tables if JSONB MVP becomes limiting.
