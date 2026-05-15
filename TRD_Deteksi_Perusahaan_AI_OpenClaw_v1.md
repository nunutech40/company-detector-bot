**Technical Requirements Document (TRD)**

**AI Company Detection Agent berbasis OpenClaw**

Versi: 1.0 | Status: Draft Teknis | Bahasa: Indonesia  
Disusun untuk kebutuhan implementasi perusahaan berdasarkan PRD Deteksi Perusahaan v6

*Tujuan teknis: membangun sistem yang dapat menginvestigasi data register, mengidentifikasi apakah akun punya/mewakili/terafiliasi perusahaan, menyimpan bukti, menghitung confidence, dan mengirim laporan naratif ke Slack.*

# Daftar Isi

- 1\. Ringkasan Teknis

- 2\. Scope dan Non-Scope

- 3\. Prinsip Arsitektur

- 4\. Target Architecture

- 5\. Komponen Sistem

- 6\. OpenClaw Tools & Provider Plan

- 7\. Multi-Agent Design

- 8\. Data Model dan Evidence Store

- 9\. API Contract dan Job Lifecycle

- 10\. Deployment Docker

- 11\. Security, Privacy, dan Compliance Guardrails

- 12\. Observability dan Operasional

- 13\. Roadmap Implementasi

- 14\. Risiko Teknis dan Mitigasi

- 15\. Referensi Teknis

# 1. Ringkasan Teknis

Dokumen ini menerjemahkan PRD Deteksi Perusahaan menjadi kebutuhan teknis implementasi. Sistem yang dibangun adalah AI Company Detection Agent: sebuah agent berbasis OpenClaw yang menerima data register, membentuk hipotesis awal, memilih tools investigasi secara fleksibel, mengumpulkan bukti, menghitung confidence, lalu mengirim laporan ke Slack dalam gaya naratif asisten kerja.

OpenClaw digunakan sebagai orchestration layer karena tools di OpenClaw memang berfungsi sebagai typed functions yang dapat dipanggil agent, misalnya exec, browser, web_search, web_fetch, x_search, message, code_execution, dan subagents. Skill boleh dipakai sebagai instruksi, tetapi TRD ini fokus pada tools, runtime, data model, deployment, dan integration contract.

| **Area**        | **Keputusan Teknis**                                                                         |
|-----------------|----------------------------------------------------------------------------------------------|
| Primary runtime | OpenClaw Gateway + custom investigation worker                                               |
| Execution model | Bounded agentic investigation loop, bukan pipeline kaku                                      |
| Deployment awal | Docker Compose di VPS atau cloud VM                                                          |
| Queue           | Redis + BullMQ/Celery, atau Temporal untuk versi lebih serius                                |
| Database        | Postgres sebagai evidence store dan result store                                             |
| Search/scrape   | OpenClaw web_search, x_search, web_fetch, browser, Firecrawl, Tavily/Brave/Exa jika tersedia |
| Slack report    | OpenClaw message tool atau Slack Web API melalui custom tool                                 |
| Fallback budget | Tool yang belum ada API key/budget ditandai disabled/skipped, bukan menghambat sistem        |

# 2. Scope dan Non-Scope

## 2.1 Scope

- Menerima job investigasi dari backend platform saat user register.

- Melakukan normalisasi identitas: email, domain, name, username, signup source, dan metadata lain.

- Memberikan AI goal, aturan, batas tools, retry budget, dan stop condition.

- Menggunakan tools OpenClaw dan custom tools untuk mencari evidence publik.

- Menyimpan semua evidence, tool run, confidence update, dan alasan keputusan.

- Menghasilkan internal JSON dan Slack narrative report.

- Mendukung tools yang belum aktif dengan status disabled/waiting_budget tanpa merusak flow.

## 2.2 Non-Scope Awal

- Tidak membangun dashboard CRM penuh di fase MVP.

- Tidak melakukan bypass login, CAPTCHA, paywall, atau anti-bot system.

- Tidak menjadikan scraping LinkedIn langsung sebagai dependency utama.

- Tidak membuat klaim “owner/founder” tanpa evidence kuat dan traceable.

- Tidak memakai semua tools secara wajib; tools dipilih berdasarkan suspicion dan expected value.

# 3. Prinsip Arsitektur

| **Prinsip**                       | **Implikasi Teknis**                                                                                                                                                                      |
|-----------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Goal-first agent                  | Agent selalu menerima tujuan eksplisit sebelum tools: deteksi apakah akun merupakan individu biasa, terafiliasi perusahaan, mewakili perusahaan, founder/owner, suspicious, atau unknown. |
| Suspicion-based routing           | Agent memilih tools berdasarkan kecurigaan, evidence sementara, source reliability, biaya, dan risiko; bukan alur fixed A lalu B lalu C.                                                  |
| Early stop with proof             | Agent boleh berhenti setelah 2 tools jika klaim sudah aman, confidence tinggi, dan evidence cukup.                                                                                        |
| Evidence over guess               | Setiap conclusion wajib punya evidence item, source, timestamp, dan confidence contribution.                                                                                              |
| Tool availability aware           | Jika API key belum ada atau budget belum tersedia, tool diberi status disabled/waiting_budget dan dilewati dengan alasan.                                                                 |
| Human-readable + machine-readable | Slack report dibuat naratif, sementara JSON internal disimpan untuk audit dan automation.                                                                                                 |

# 4. Target Architecture

Arsitektur target memisahkan platform backend, queue, OpenClaw gateway, custom worker, evidence store, external tools, dan Slack delivery. OpenClaw menjadi tool orchestration surface, sedangkan custom worker menangani kontrak job, persistence, dan integrasi business logic yang spesifik ke perusahaan.

<img src="/mnt/data/md_conversion_media/trd/media/image1.png" style="width:6.6in;height:0.95481in" />

Gambar 1. Arsitektur logis AI Company Detection Agent.

# 5. Komponen Sistem

| **Komponen**                | **Fungsi**                                                              | **Teknologi**                    |
|-----------------------------|-------------------------------------------------------------------------|----------------------------------|
| Registration Event Producer | Backend platform mengirim event user_registered ke queue/webhook.       | App backend                      |
| Investigation Job API       | Menerima payload register dan membuat job_id/idempotency_key.           | FastAPI/Express/NestJS           |
| Queue                       | Menjamin job async, retry, rate limit, dan backpressure.                | Redis BullMQ / Celery / Temporal |
| OpenClaw Gateway            | Runtime agent, channel Slack, tool access, web/browser/message.         | OpenClaw Docker/Gateway          |
| Investigation Worker        | Mengatur lifecycle job, memanggil OpenClaw, custom tools, DB writes.    | Node.js/Python service           |
| Tool Catalog                | Registry tools yang available/disabled/cost/risk.                       | YAML/DB config                   |
| Evidence Store              | Menyimpan evidence graph, source URL, raw snippet, screenshot metadata. | Postgres + object storage        |
| Scoring Engine              | Menghitung classification dan confidence.                               | Rules + LLM structured output    |
| Slack Reporter              | Membentuk laporan naratif dan mengirim ke Slack.                        | OpenClaw message / Slack API     |

# 6. OpenClaw Tools & Provider Plan

Tools di bawah dipetakan berdasarkan kebutuhan produk. Tidak semua harus aktif di MVP. Agent harus membaca availability matrix sebelum memilih tool.

| **Tool**                 | **Type**            | **Dipakai untuk**                                                    | **Prioritas** | **Catatan**                            |
|--------------------------|---------------------|----------------------------------------------------------------------|---------------|----------------------------------------|
| web_search               | Built-in            | Cari kandidat company/person/profile lewat web dan SERP-like result. | MVP: wajib    | Low-medium cost                        |
| x_search                 | Built-in            | Cari sinyal dari X/Twitter, terutama signup dari X campaign.         | MVP: optional | Gunakan jika data username/handle kuat |
| web_fetch                | Built-in            | Fetch konten URL spesifik untuk halaman ringan/static.               | MVP: wajib    | Tidak untuk JS-heavy                   |
| browser                  | Built-in UI         | Render halaman JS-heavy, klik, screenshot, validasi visual.          | Phase 2       | Lebih mahal dan lebih lambat           |
| code_execution           | Built-in runtime    | Normalisasi data, scoring, dedup, validation script.                 | MVP: wajib    | Sandboxed                              |
| message                  | Built-in messaging  | Kirim report ke Slack/channel lain.                                  | MVP: wajib    | Butuh Slack channel configured         |
| sessions_spawn/subagents | Built-in sessions   | Investigasi paralel: website, public profiles, enrichment.           | Phase 2       | Gunakan untuk job kompleks             |
| read/write/edit          | Built-in FS         | Simpan draft report, configs, temporary evidence.                    | MVP: optional | Jangan jadi DB utama                   |
| cron/gateway             | Built-in automation | Scheduled re-check, gateway config, operational tasks.               | Phase 2       | Owner-only untuk config sensitif       |
| Firecrawl                | Provider/plugin     | Search/scrape/crawl web page menjadi markdown/structured data.       | MVP/Phase 2   | Butuh API key/budget                   |
| Tavily                   | Provider/plugin     | AI-friendly search/extract dengan filters/domain control.            | Phase 2       | Butuh API key                          |
| Brave/Exa/Perplexity     | Search providers    | Alternatif provider web_search sesuai budget dan kualitas.           | Phase 2       | Provider selection by config           |
| llm-task                 | Plugin tool         | JSON-only structured scoring/report fields.                          | Phase 2       | Bagus untuk schema validation          |

## 6.1 Custom Tools yang Perlu Dibuat

| **Custom Tool**                      | **Contract Ringkas**                                                                       | **Fase**     |
|--------------------------------------|--------------------------------------------------------------------------------------------|--------------|
| email_intelligence                   | Input: email. Output: domain, free_provider, disposable, mx_valid, role_email, risk flags. | MVP          |
| domain_checker                       | Input: domain. Output: website_active, redirects, title, meta, detected_company_name.      | MVP          |
| serp_query_builder                   | Input: identity. Output: query variants + target sources.                                  | MVP          |
| evidence_store.write                 | Input: evidence item. Output: evidence_id.                                                 | MVP          |
| scoring_engine.score                 | Input: evidence graph. Output: classification, confidence, reasons.                        | MVP          |
| slack_report_formatter               | Input: internal JSON. Output: human narrative Slack text.                                  | MVP          |
| enrichment_api.lookup_person/company | Input: email/name/domain. Output: vendor signals.                                          | Phase 2/paid |
| github_public_checker                | Input: username/name. Output: profile/company/blog/org evidence.                           | Phase 2      |
| producthunt_checker                  | Input: username/name/company. Output: maker/product evidence.                              | Phase 2      |

# 7. Multi-Agent Design

MVP dapat berjalan dengan single orchestrator agent. Multi-agent digunakan saat volume, latensi, atau kompleksitas evidence meningkat. Multi-agent tidak wajib dari awal, tetapi desainnya perlu disiapkan.

| **Agent**             | **Tanggung Jawab**                                                   | **Kapan Dipakai**                             |
|-----------------------|----------------------------------------------------------------------|-----------------------------------------------|
| Orchestrator Agent    | Menetapkan goal, suspicion, tool selection, stop/continue decision.  | Selalu                                        |
| Web Research Agent    | Search SERP, LinkedIn via SERP signal, source discovery.             | Jika email tidak cukup atau butuh cross-check |
| Company Website Agent | Scrape company domain, about/team/contact/pricing/legal pages.       | Jika ada domain kandidat                      |
| Public Profile Agent  | Cek X/GitHub/Product Hunt/Crunchbase/Wellfound signal.               | Jika username/handle kuat                     |
| Scoring Agent         | Membaca evidence graph dan menghasilkan classification + confidence. | Setiap job                                    |
| Report Agent          | Membuat Slack report naratif dan internal JSON final.                | Setiap job                                    |

## 7.1 Agent Loop

<img src="/mnt/data/md_conversion_media/trd/media/image2.png" style="width:5.9in;height:8.91609in" />

Gambar 2. Bounded agentic investigation loop.

# 8. Data Model dan Evidence Store

Evidence store adalah pusat audit. Semua tool run harus menghasilkan record yang bisa ditelusuri ulang. Jangan hanya menyimpan final conclusion.

| **Tabel**          | **Fungsi**                                         | **Kolom Kunci**                                                                           |
|--------------------|----------------------------------------------------|-------------------------------------------------------------------------------------------|
| investigation_jobs | Menyimpan status job per user register.            | job_id, user_id, status, started_at, finished_at, final_classification, confidence        |
| register_snapshots | Menyimpan snapshot data register saat investigasi. | job_id, email, name, username, signup_source, metadata_json                               |
| tool_runs          | Log setiap tool call.                              | tool_run_id, job_id, tool_name, status, started_at, latency_ms, cost_estimate, error      |
| evidence_items     | Unit bukti yang sudah diekstrak.                   | evidence_id, job_id, source_type, source_url, claim, value, reliability, confidence_delta |
| entity_candidates  | Kandidat company/person yang ditemukan.            | candidate_id, job_id, entity_type, name, domain, match_score                              |
| confidence_updates | Riwayat perubahan confidence.                      | job_id, prior_score, delta, posterior_score, reason                                       |
| final_reports      | Report internal dan Slack report.                  | job_id, json_result, slack_text, sent_at, slack_ts                                        |

{  
"job_id": "job_123",  
"classification": "founder_verified",  
"company_detected": true,  
"company_name": "Acme AI",  
"company_domain": "acme.ai",  
"confidence": 91,  
"tools_used": \["email_intelligence", "firecrawl_scrape", "scoring_engine"\],  
"tools_skipped": \[  
{"tool": "tavily_search", "reason": "stop_condition_met"},  
{"tool": "enrichment_api", "reason": "not_needed_to_save_cost"}  
\],  
"evidence": \[  
{  
"source_type": "email_domain",  
"claim": "Corporate email domain detected",  
"value": "alex@acme.ai",  
"confidence_delta": 25  
},  
{  
"source_type": "company_website",  
"source_url": "https://acme.ai/about",  
"claim": "User appears as Founder",  
"value": "Alex Rivera - Founder",  
"confidence_delta": 45  
}  
\],  
"recommendation": "Route to B2B Founder / High Intent Lead segment"  
}

# 9. API Contract dan Job Lifecycle

## 9.1 Job Input Contract

POST /internal/company-detection/jobs  
{  
"user_id": "u_123",  
"email": "alex@acme.ai",  
"name": "Alex Rivera",  
"username": "alexbuilds",  
"signup_source": "x_campaign",  
"country": "US",  
"metadata": {  
"plan": "free",  
"utm_campaign": "x_launch"  
}  
}

## 9.2 Job State Machine

| **State**    | **Arti**                                      | **Next**                        |
|--------------|-----------------------------------------------|---------------------------------|
| queued       | Job masuk antrean.                            | running / failed                |
| running      | Agent sedang investigasi.                     | waiting_tool / scoring / failed |
| waiting_tool | Menunggu tool eksternal/API.                  | running / skipped / failed      |
| scoring      | Evidence sudah cukup untuk scoring.           | reporting / running             |
| reporting    | Slack report sedang dibentuk/dikirim.         | completed / failed              |
| completed    | Report berhasil dibuat dan disimpan.          | \-                              |
| inconclusive | Tidak cukup evidence setelah batas percobaan. | completed                       |
| failed       | Error teknis.                                 | retry / dead_letter             |

# 10. Deployment Docker

Deployment awal disarankan memakai Docker Compose di VPS/cloud VM. Komponen minimum: openclaw-gateway, investigation-worker, postgres, redis. Provider API keys disimpan sebagai environment variables atau secret manager.

<img src="/mnt/data/md_conversion_media/trd/media/image3.png" style="width:6.6in;height:1.29778in" />

Gambar 3. Deployment topology Docker/VPS.

services:  
openclaw-gateway:  
image: openclaw/openclaw:latest  
restart: unless-stopped  
env_file: .env  
volumes:  
- ./openclaw:/workspace  
ports:  
- "3000:3000"  
  
investigation-worker:  
build: ./worker  
restart: unless-stopped  
env_file: .env  
depends_on:  
- redis  
- postgres  
- openclaw-gateway  
  
postgres:  
image: postgres:16  
restart: unless-stopped  
environment:  
POSTGRES_DB: company_detection  
POSTGRES_USER: company_detection  
POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}  
volumes:  
- pgdata:/var/lib/postgresql/data  
  
redis:  
image: redis:7-alpine  
restart: unless-stopped  
  
volumes:  
pgdata:

## 10.1 Environment Variables

| **Variable**         | **Fungsi**                                             | **Status**                               |
|----------------------|--------------------------------------------------------|------------------------------------------|
| OPENCLAW_BASE_URL    | Endpoint gateway OpenClaw.                             | Required                                 |
| SLACK_BOT_TOKEN      | Kirim report ke Slack jika memakai Slack API langsung. | Required jika tidak via OpenClaw channel |
| SLACK_REPORT_CHANNEL | Channel report seperti \#company-detection.            | Required                                 |
| DATABASE_URL         | Koneksi Postgres.                                      | Required                                 |
| REDIS_URL            | Koneksi queue/cache.                                   | Required                                 |
| BRAVE_API_KEY        | Search provider.                                       | Optional                                 |
| FIRECRAWL_API_KEY    | Scrape/crawl provider.                                 | Optional/paid                            |
| TAVILY_API_KEY       | AI search/extract provider.                            | Optional/paid                            |
| EXA_API_KEY          | Neural search provider.                                | Optional/paid                            |
| PDL_API_KEY          | People/company enrichment.                             | Optional/paid                            |

# 11. Security, Privacy, dan Compliance Guardrails

- Tool allowlist harus eksplisit. Deny exec/process untuk agent yang tidak perlu shell access.

- Browser dan scraping tidak boleh digunakan untuk bypass login, CAPTCHA, paywall, atau anti-bot.

- Evidence yang disimpan harus relevan dengan tujuan company detection, bukan profiling bebas.

- Raw scraped content sebaiknya dibatasi, direduksi menjadi evidence claim, dan diberi TTL jika tidak diperlukan.

- API keys harus disimpan di secret manager/.env server, bukan di prompt, Slack, atau repo.

- Slack report tidak boleh memuat data sensitif yang tidak relevan.

- Setiap classification harus punya source dan timestamp agar bisa diaudit/diperbaiki.

- Tool marketplace/community plugin perlu security review sebelum diinstall di production.

| **Risk**                     | **Mitigasi**                                                                                                                        |
|------------------------------|-------------------------------------------------------------------------------------------------------------------------------------|
| AI overclaiming              | Gunakan classification levels: company_affiliated, business_owner_candidate, founder_verified, unknown; require evidence threshold. |
| Cost blow-up                 | Tool budget per job, max attempts, provider priority, caching.                                                                      |
| Bad/ambiguous identity match | Entity matching score, conflicting evidence penalty, manual review status.                                                          |
| Tool abuse                   | OpenClaw allow/deny tools, restricted exec, no untrusted plugins.                                                                   |
| Rate limits                  | Queue backoff, provider rotation, graceful skip/waiting_budget.                                                                     |

# 12. Observability dan Operasional

| **Metric/Log**              | **Tujuan**                                         |
|-----------------------------|----------------------------------------------------|
| jobs_completed_total        | Jumlah investigasi selesai.                        |
| jobs_inconclusive_rate      | Mengukur kualitas data/register dan tool coverage. |
| avg_tools_used_per_job      | Kontrol cost dan efisiensi early stop.             |
| avg_confidence_by_source    | Menilai source mana yang paling berguna.           |
| tool_error_rate             | Deteksi provider down/API limit.                   |
| slack_delivery_success_rate | Memastikan report terkirim.                        |
| manual_review_rate          | Mengukur kasus ambigu.                             |

# 13. Roadmap Implementasi

| **Fase**                  | **Deliverables**                                                                   | **Tools Aktif**                                             |
|---------------------------|------------------------------------------------------------------------------------|-------------------------------------------------------------|
| Phase 0 - Design          | Finalisasi PRD/TRD, schema DB, tool catalog, Slack report format.                  | Tidak perlu                                                 |
| Phase 1 - MVP             | Queue, Postgres, email_intelligence, web_search, web_fetch, scoring, Slack report. | web_search, web_fetch, code_execution/message, custom tools |
| Phase 2 - Scraping+       | Firecrawl/Tavily, browser fallback, GitHub/X/Product Hunt checks.                  | Firecrawl, Tavily, x_search, browser                        |
| Phase 3 - Multi-agent     | Subagents untuk parallel investigation dan advanced scoring.                       | sessions_spawn/subagents                                    |
| Phase 4 - Paid enrichment | People/company enrichment vendor, cost-based routing.                              | PDL/Apollo/Clearbit-like custom tools                       |
| Phase 5 - Ops Dashboard   | Review dashboard, evidence viewer, feedback loop, metrics.                         | Internal admin app                                          |

# 14. Risiko Teknis dan Mitigasi

| **Risiko**                                    | **Dampak**             | **Mitigasi**                                                                |
|-----------------------------------------------|------------------------|-----------------------------------------------------------------------------|
| Provider belum bisa diakses/belum ada dana    | Coverage rendah        | Tool availability matrix; skipped reason; start dengan free/built-in tools. |
| Data register minim                           | Banyak inconclusive    | Gunakan search based on username/name; tambahkan metadata signup source.    |
| False positive company owner                  | Salah segmentasi lead  | Pisahkan affiliation vs ownership; require founder evidence.                |
| Scrape gagal karena JS-heavy                  | Evidence tidak terbaca | Fallback dari web_fetch ke browser/Firecrawl.                               |
| Report terlalu panjang di Slack               | Sulit dibaca           | Gunakan summary + evidence bullets + link ke full JSON/internal report.     |
| LLM membuat alasan yang tidak sesuai evidence | Audit gagal            | Report generator hanya boleh memakai evidence_items yang tersimpan.         |

# 15. Referensi Teknis

- [OpenClaw Tools and Plugins](https://docs.openclaw.ai/tools)

- [OpenClaw Web Search / Web Tools](https://docs.openclaw.ai/tools/web)

- [OpenClaw Firecrawl Tool](https://docs.openclaw.ai/tools/firecrawl)

- [OpenClaw Tavily Tool](https://docs.openclaw.ai/tools/tavily)

- [OpenClaw Slack Channel](https://docs.openclaw.ai/channels/slack)

- [OpenClaw Sub-Agents](https://docs.openclaw.ai/tools/subagents)

- [OpenClaw LLM Task](https://docs.openclaw.ai/tools/llm-task)

- [Bounded Rationality - Herbert Simon Nobel Lecture](https://www.nobelprize.org/uploads/2018/06/simon-lecture.pdf)

- [ReAct: Synergizing Reasoning and Acting in Language Models](https://arxiv.org/abs/2210.03629)

- [OODA Loop overview](https://en.wikipedia.org/wiki/OODA_loop)
