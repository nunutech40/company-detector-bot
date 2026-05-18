**PRODUCT REQUIREMENTS DOCUMENT**

**AI Company Detection Agent**

Deteksi akun yang punya, mewakili, atau terafiliasi dengan perusahaan dari data register menggunakan OpenClaw sebagai AI Orchestrator

| **Field**        | **Value**                                    |
|------------------|----------------------------------------------|
| Versi            | v5 - Serious / Company Grade                 |
| Bahasa           | Indonesia                                    |
| Owner            | Nunu Nugraha / Product & Engineering         |
| Tanggal          | 14 Mei 2026                                  |
| Status           | Planning Draft untuk implementasi perusahaan |
| Delivery Channel | Slack report + internal JSON audit record    |

Prinsip utama: AI tidak bekerja “sekarepe”. AI diberi tujuan, rules, batasan, tool catalog, scoring rubric, retry budget, dan stop condition. AI hanya fleksibel dalam memilih rute investigasi berdasarkan evidence dan kecurigaan sementara.

# 1. Executive Summary

Goal utama produk ini adalah **mendeteksi apakah akun yang mendaftar di platform merupakan individu biasa, pekerja yang terafiliasi dengan perusahaan, pemilik/founder bisnis, agency/freelancer bisnis, akun tidak jelas, atau spam/suspicious.** Input awal berasal dari data register, lalu AI/OpenClaw menjalankan investigasi berbasis tools secara fleksibel, bukan flow linear yang kaku.

Sistem akan menghasilkan dua output:

- Slack report naratif: laporan seperti asisten kepada bos/team, berisi apa yang dicek, hasil, bukti, confidence, tools yang dipakai, tools yang dilewati, dan rekomendasi.

- Internal JSON result: data terstruktur untuk database, audit, dashboard, retry, segmentasi, dan automation lanjutan.

Dokumen ini sengaja memasukkan tools yang mungkin belum langsung dapat diakses karena butuh API key, dana, atau approval. Saat eksekusi, tools tersebut boleh di-skip dengan alasan yang dicatat di report.

# 2. Problem Statement

Data register sering tidak cukup untuk memahami nilai bisnis sebuah akun. Email Gmail bisa saja milik founder, corporate email bisa saja milik employee biasa, dan nama/username bisa memiliki banyak identity collision. Tanpa investigasi terstruktur, sistem mudah salah mengklasifikasikan user.

Masalah utama yang ingin diselesaikan:

- Mendeteksi apakah akun memiliki company signal tanpa menambah friction register.

- Membedakan “terafiliasi dengan perusahaan” vs “punya/mendirikan perusahaan”.

- Menghasilkan laporan yang bisa dipercaya oleh manusia, bukan hanya skor mentah.

- Membuat proses investigasi fleksibel, tetapi tetap audit-able, bounded, dan cost-aware.

- Menyediakan mekanisme skip kalau tool belum tersedia atau belum layak dipakai secara biaya/risiko.

# 3. Goals dan Non-Goals

| **ID** | **Goal**                                                                                                                         |
|--------|----------------------------------------------------------------------------------------------------------------------------------|
| G1     | Deteksi company association dari data register dan evidence publik.                                                              |
| G2     | Membedakan classification: individual, company_affiliated, business_owner_candidate, founder_verified, unknown, suspicious_spam. |
| G3     | AI dapat memilih tools berdasarkan kecurigaan dan evidence, bukan urutan tetap.                                                  |
| G4     | Slack report harus human-readable dan actionable untuk internal team.                                                            |
| G5     | Semua evidence disimpan dengan source, timestamp, tool_used, dan reliability.                                                    |
| G6     | Tools mahal/berisiko bisa dipakai hanya jika diperlukan dan budget tersedia.                                                     |

| **ID** | **Non-Goal**                                                       |
|--------|--------------------------------------------------------------------|
| NG1    | Bukan sistem doxxing atau enrichment personal yang tidak relevan.  |
| NG2    | Bukan scraping agresif ke platform yang melarang automation.       |
| NG3    | Bukan sistem yang selalu harus memakai semua tools.                |
| NG4    | Bukan klaim absolut tanpa confidence dan evidence.                 |
| NG5    | Bukan pengganti human review untuk kasus high-value tetapi ambigu. |

# 4. Pendekatan Ilmiah: AI Jangan Sekarepe

AI orchestrator tidak boleh langsung “dilempar aja ke AI” tanpa framework. Pendekatan yang disarankan adalah Bounded Agentic Investigation, yaitu kombinasi beberapa prinsip yang sudah umum dalam sistem agentic dan decision science:

| **Pendekatan**                  | **Implementasi dalam produk**                                                                                                                     |
|---------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------|
| Goal-driven planning            | AI mulai dari tujuan eksplisit, bukan dari tool. Semua tindakan harus menjawab pertanyaan: apakah akun ini punya/mewakili/terafiliasi perusahaan? |
| Hypothesis-driven investigation | AI membuat hipotesis awal, misalnya corporate_email, founder_candidate, company_affiliated, unknown, atau suspicious_spam.                        |
| ReAct loop                      | AI melakukan loop Reason/Observe -> Act -> Observe -> Update. AI tidak hanya berpikir, tetapi memanggil tool lalu membaca hasilnya.            |
| OODA loop                       | Observe, Orient, Decide, Act. Cocok untuk investigasi fleksibel karena AI harus menyesuaikan strategi dengan evidence terbaru.                    |
| Evidence graph                  | Semua evidence disimpan sebagai node/edge: person, email, domain, company, source, role, timestamp, reliability.                                  |
| Bayesian-style updating         | Confidence di-update bertahap berdasarkan evidence. Evidence kuat menaikkan confidence, konflik menurunkan confidence.                            |
| Information gain per cost       | AI memilih tool berikutnya berdasarkan potensi informasi yang paling besar dibanding biaya/risiko/waktu.                                          |
| Confidence calibration          | Sistem tidak hanya memberi skor tinggi/rendah, tapi skor per classification dan alasan kenapa skor tersebut masuk akal.                           |
| Audit trail                     | Setiap tool call, query, evidence, skip reason, dan keputusan stop harus bisa dibaca manusia.                                                     |

Kesimpulan arsitektural: Jangan biarkan AI bebas total. Beri AI decision framework. AI boleh memilih rute investigasi, tetapi pilihan itu harus dijelaskan, dibatasi budget, dan dievaluasi lewat evidence rubric.

## 4.1 Penjelasan Istilah: Bounded Agentic Investigation

Bounded Agentic Investigation bukan nama teori akademik tunggal. Ini adalah istilah desain arsitektur untuk sistem ini: AI agent boleh fleksibel dalam memilih langkah investigasi, tetapi tetap dibatasi oleh tujuan bisnis, allowed tools, source policy, budget, retry limit, confidence threshold, stop condition, dan audit trail. Dengan kata lain, AI tidak bekerja bebas atau sekarepe; AI bekerja seperti investigator yang punya SOP dan dapat dipertanggungjawabkan.

Framework ini dipakai karena masalah deteksi perusahaan dari data register bersifat tidak pasti. Kadang email sudah cukup kuat, kadang harus mencari jejak publik, kadang perlu scraping, kadang perlu enrichment API, dan kadang sistem harus berhenti dengan status inconclusive. Karena itu, pendekatan yang paling aman adalah agentic tetapi bounded.

## 4.2 Landasan Teori yang Dipakai

### 1. Bounded Rationality / Satisficing

Herbert A. Simon menjelaskan bahwa pengambil keputusan sering bekerja dengan informasi, waktu, dan kapasitas komputasi yang terbatas. Karena itu, sistem tidak harus mencari hasil “sempurna” dengan semua tools, tetapi mencari keputusan yang cukup baik, cukup terbukti, dan sesuai threshold. Dalam produk ini, prinsipnya berarti AI boleh berhenti ketika evidence sudah cukup kuat, confidence sudah melewati threshold, dan biaya tambahan tidak lagi sepadan.

- Sumber: [Nobel Prize - Herbert A. Simon Prize Lecture](https://www.nobelprize.org/uploads/2018/06/simon-lecture.pdf)

- Sumber: [MIT Press - Models of Bounded Rationality](https://mitpress.mit.edu/9780262192057/models-of-bounded-rationality-volume-1/)

### 2. ReAct: Reasoning + Acting

ReAct adalah paradigma agent AI yang menggabungkan reasoning dan action secara bergantian. Agent tidak hanya berpikir, dan tidak hanya memanggil tools. Agent melihat kondisi, membuat dugaan, memilih tool, membaca hasil tool, memperbarui rencana, lalu memutuskan langkah berikutnya. Ini cocok untuk OpenClaw karena tools seperti web_search, web_fetch, browser, Firecrawl, code_execution, dan message dapat dipanggil berdasarkan kebutuhan evidence.

- Sumber: [arXiv - ReAct: Synergizing Reasoning and Acting in Language Models](https://arxiv.org/abs/2210.03629)

- Sumber: [Google Research Blog - ReAct](https://research.google/blog/react-synergizing-reasoning-and-acting-in-language-models/)

### 3. OODA Loop: Observe, Orient, Decide, Act

OODA membantu menjelaskan siklus kerja agent: Observe data register dan evidence, Orient untuk memahami konteks serta kecurigaan, Decide tool terbaik berikutnya, lalu Act dengan menjalankan tool. Setelah hasil baru masuk, loop diulang. Ini membuat flow tidak kaku A ke B ke C, tetapi tetap disiplin karena setiap aksi harus berasal dari orientasi terhadap evidence.

- Sumber: [US Air University - Discussion of OODA in strategic decision process](https://www.airuniversity.af.edu/Portals/10/ASPJ/journals/Chronicles/Hill.pdf)

- Sumber: [Boyd - A Discourse on Winning and Losing](https://media.defense.gov/2018/May/22/2001920668/-1/-1/0/B_0151_Boyd_Discourse_WINNING_LOSING.PDF)

### 4. Bayesian-style Confidence Updating

Sistem tidak perlu memakai Bayes murni secara matematis di MVP, tetapi memakai prinsipnya: confidence awal diperbarui setiap kali evidence baru masuk. Corporate email menaikkan confidence untuk company affiliation. Nama user di halaman founder menaikkan confidence untuk business ownership. Evidence konflik menurunkan confidence. Hasil akhirnya bukan feeling AI, tetapi confidence berbasis evidence.

- Sumber: [Stanford Encyclopedia of Philosophy - Bayesian Epistemology](https://plato.stanford.edu/entries/epistemology-bayesian/)

- Sumber: [NIH/PMC - A Gentle Introduction to Bayesian Analysis](https://pmc.ncbi.nlm.nih.gov/articles/PMC4158865/)

### 5. Value of Information / Information Gain

AI tidak perlu memakai tool mahal hanya karena tool itu tersedia. Tool berikutnya dipilih kalau informasi yang mungkin didapat berpotensi mengubah keputusan. Misalnya, enrichment API tidak perlu dipanggil kalau email corporate + halaman founder sudah cukup kuat. Sebaliknya, enrichment API masuk akal jika hasil search dan scraping masih ambigu tetapi kandidat company bernilai tinggi.

- Sumber: [PMC - Value of Information Analysis in Models to Inform Health Policy](https://pmc.ncbi.nlm.nih.gov/articles/PMC7612603/)

- Sumber: [Targeted Active Learning for Bayesian Decision-Making](https://arxiv.org/abs/2106.04193)

### 6. Evidence Graph / Audit Trail

Setiap klaim harus punya evidence yang dapat ditelusuri: sumber, URL, timestamp, tool yang dipakai, hasil ekstraksi, dan alasan scoring. Ini membuat Slack report bisa menjelaskan pekerjaan seperti asisten melapor ke bos, sementara internal JSON tetap bisa diaudit dan dipakai ulang. Pendekatan knowledge graph/evidence graph membantu menghubungkan user, email, domain, company, role, dan sumber bukti.

- Sumber: [ScienceDirect - Knowledge Graphs for AI System Auditing and Transparency](https://www.sciencedirect.com/science/article/pii/S1570826824000350)

- Sumber: [IBM - What is a ReAct Agent?](https://www.ibm.com/think/topics/react-agent)

## 4.3 Prinsip Operasional untuk Produk Ini

- AI harus memulai dari goal: menentukan apakah akun register punya, mewakili, atau terafiliasi dengan perusahaan.

- AI boleh memilih tool secara fleksibel berdasarkan kecurigaan, tetapi hanya dari tool catalog yang diizinkan.

- AI harus menyimpan evidence sebelum membuat klaim.

- AI boleh stop lebih cepat jika confidence dan evidence requirement sudah terpenuhi.

- AI harus lanjut investigasi jika klaim yang akan dibuat lebih kuat daripada evidence yang tersedia.

- AI harus menurunkan confidence jika ada konflik identitas, company, domain, atau role.

- AI harus membuat Slack report dalam bahasa manusia, plus internal JSON untuk audit.

- AI harus melaporkan tools yang dipakai, tools yang tidak dipakai, dan alasan kenapa tools lain di-skip.

## 4.4 Ringkasan Pendekatan

Kesimpulannya, pendekatan yang dipakai bukan “langsung lempar ke AI”, dan bukan juga pipeline kaku. Produk ini memakai AI sebagai orchestrator yang fleksibel tetapi terikat aturan. AI melakukan investigasi seperti analis: membentuk hipotesis, memilih alat, mengumpulkan bukti, memperbarui confidence, memutuskan apakah perlu lanjut, lalu melaporkan hasil secara transparan.

# 5. High-Level Architecture

<img src="/mnt/data/md_conversion_media/prd/media/image1.png" style="width:7.1in;height:0.62372in" />

Diagram di atas menunjukkan bahwa tools bukan alur wajib. Tools adalah action surface yang dipilih AI sesuai kecurigaan dan evidence sementara.

| **Komponen**         | **Peran**                                                                                                       |
|----------------------|-----------------------------------------------------------------------------------------------------------------|
| Register Data API    | Menerima event user baru register dan metadata awal.                                                            |
| OpenClaw Agent       | AI orchestrator yang membuat hipotesis, memilih tools, membaca evidence, dan membuat report.                    |
| Tool Catalog         | Daftar tools OpenClaw built-in, provider plugin, dan custom business tools.                                     |
| Evidence Store       | Database/log untuk menyimpan evidence, source URL, timestamp, reliability, query, dan tool result.              |
| Scoring Engine       | Mengubah evidence menjadi confidence per classification. Bisa rules-first, lalu ditambah LLM structured output. |
| Slack Reporter       | Mengirim human-readable report ke Slack channel/DM.                                                             |
| Internal JSON Result | Output terstruktur untuk audit, dashboard, retry, CRM/lead scoring, dan analytics.                              |

# 6. OpenClaw Tools yang Dipakai

Berikut tool catalog yang disiapkan. Saat implementasi awal, semua tools tidak wajib aktif. Jika API key, dana, atau approval belum tersedia, tool boleh marked as disabled dan AI harus menulis skip reason di report.

| **Tool**           | **Jenis**        | **Fungsi**                                                                                                          | **Prioritas**                    |
|--------------------|------------------|---------------------------------------------------------------------------------------------------------------------|----------------------------------|
| web_search         | Built-in         | Mencari kandidat company/profile/personal site/LinkedIn via SERP. Provider bisa Brave, Tavily, Exa, Firecrawl, dll. | MVP wajib                        |
| x_search           | Built-in         | Mencari sinyal dari X/Twitter terutama jika signup_source dari X campaign atau username kuat.                       | MVP opsional tapi sangat relevan |
| web_fetch          | Built-in         | Fetch URL ringan dan extract readable content untuk homepage/about/team/profile page.                               | MVP wajib                        |
| browser            | Built-in         | Render halaman JS-heavy, klik, screenshot, validasi visual evidence.                                                | Phase 2                          |
| firecrawl_search   | Plugin/provider  | Search dengan kontrol Firecrawl. Berguna untuk discovery dan scrape results.                                        | Phase 2 / budget                 |
| firecrawl_scrape   | Plugin/provider  | Scrape halaman company/personal website jadi konten bersih. Core untuk website evidence.                            | MVP jika ada budget              |
| tavily_search      | Provider/plugin  | AI-friendly search dengan domain/filter. Bagus untuk investigasi candidate sources.                                 | Phase 2                          |
| tavily_extract     | Provider/plugin  | Extract konten dari URL hasil search.                                                                               | Phase 2                          |
| code_execution     | Built-in         | Normalize data, dedup, hitung scoring, compare evidence, generate summary table.                                    | MVP wajib                        |
| read/write/edit    | Built-in         | Menyimpan draft evidence/report dalam workspace jika DB belum siap.                                                 | MVP wajib                        |
| message            | Built-in         | Mengirim laporan ke Slack/channel lain.                                                                             | MVP wajib                        |
| sessions/subagents | Built-in         | Paralelisasi investigasi untuk kasus berat: website, X/GitHub, SERP, enrichment.                                    | Phase 3                          |
| cron/gateway       | Built-in         | Scheduled retry, gateway operations, recurring review.                                                              | Phase 2                          |
| exec/process       | Built-in runtime | Menjalankan DNS/MX checker, script enrichment, atau job custom. Harus dibatasi allowlist/approval.                  | Restricted only                  |

# 7. Custom Business Tools yang Perlu Dibuat

| **Custom Tool**          | **Input**                     | **Output**                                                                                              | **Catatan**                                                               |
|--------------------------|-------------------------------|---------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------|
| email_intelligence       | email, name                   | domain, is_free_email, is_disposable, is_role_email, mx_status, suspicion_tags                          | Tool pertama yang murah untuk mayoritas kasus.                            |
| domain_checker           | domain                        | website_active, redirects, title, meta, mx, organization_schema, confidence_signal                      | Validasi apakah domain terlihat seperti company domain.                   |
| website_crawler_router   | domain/url + target intent    | candidate_pages: /about, /team, /founders, /contact, /pricing, /careers, /privacy, /terms               | Menentukan halaman mana yang layak di-scrape.                             |
| public_profile_search    | name, username, email prefix  | candidate_profiles dari GitHub, Product Hunt, Indie Hackers, Crunchbase/Wellfound, X, LinkedIn via SERP | Mencari sumber non-email untuk Gmail/free email.                          |
| linkedin_via_serp_signal | name/company/username queries | LinkedIn URL/title/snippet dari SERP, bukan direct scraping LinkedIn page                               | Sinyal pendukung, wajib cross-check.                                      |
| enrichment_api_adapter   | person/company identifiers    | PDL/Apollo/Clearbit-like result jika API tersedia                                                       | Fallback mahal; dipakai jika evidence publik belum cukup.                 |
| evidence_store           | evidence object               | persist evidence + query + source + tool result + timestamp + reliability                               | Wajib untuk audit.                                                        |
| scoring_engine           | evidence graph                | classification_scores, confidence, conflicts, recommended_action                                        | Rules-first; LLM bisa membantu reasoning tapi tidak satu-satunya penentu. |
| slack_report_formatter   | internal JSON result          | human-readable Slack report                                                                             | Agar report konsisten dan bisa dibaca bos/team.                           |

# 8. Tool Availability & Skip Policy

Karena sebagian tools butuh dana/API key/approval, sistem harus mendukung status tool: enabled, disabled, degraded, budget_exceeded, rate_limited, risky_source, atau manual_only.

| **Status**      | **Arti**                                                                                    |
|-----------------|---------------------------------------------------------------------------------------------|
| enabled         | Tool aktif dan boleh dipakai AI.                                                            |
| disabled        | Tool belum tersedia. AI harus skip dan menulis alasan.                                      |
| degraded        | Tool ada tapi hasil kurang lengkap/limit. AI boleh pakai tapi confidence source diturunkan. |
| budget_exceeded | Tool mahal tidak boleh dipakai untuk kasus low-priority.                                    |
| rate_limited    | Tool sementara tidak tersedia; AI boleh retry nanti atau gunakan alternatif.                |
| risky_source    | Tool/sumber berisiko compliance; hanya boleh dipakai sesuai policy atau manual review.      |
| manual_only     | Tool hanya dipakai atas approval human.                                                     |

> Contoh skip reason di Slack report:
>
> \- Enrichment API tidak dipakai karena tool_status = disabled_waiting_budget.
>
> \- Browser tidak dipakai karena web_fetch + Firecrawl sudah cukup membaca halaman /about.
>
> \- LinkedIn direct scraping tidak dipakai karena policy membatasi direct automation ke platform tersebut.

## 8.1 Alternatif Tools Gratis (Workaround)

Jika tools berbayar (seperti Firecrawl, Tavily, atau Enrichment API) masih berstatus `disabled_waiting_budget`, AI diharapkan untuk menggunakan alternatif gratis melalui *Custom Tools* yang disediakan di VPS:
- **Pengganti `firecrawl_scrape`**: AI dapat memanggil *Free Scraper Tool* berbasis script Node.js (menggunakan `axios` + `cheerio` atau `readability`) untuk membaca isi teks murni dari sebuah website secara gratis.
- **Pengganti `tavily_search` / API Search Berbayar**: AI dapat memanggil *Free Search Tool* yang menggunakan *scraping* DuckDuckGo HTML atau Brave Search API (yang memiliki *free tier* besar).
- **Pengganti `enrichment_api`**: Alih-alih membayar untuk API pihak ketiga, AI dapat melakukan pencarian *SERP Dorking* (contoh: `site:linkedin.com/in/ "Nama Lengkap"`) dan membaca "teks snippet" dari hasil pencarian Google/DuckDuckGo untuk mengekstrak informasi *Role* dan *Company*.

# 9. AI Orchestrator Operating Policy

OpenClaw agent harus diberi operating policy seperti di bawah. Ini bukan sekadar prompt bebas, tetapi kontrak perilaku agent.

> GOAL:
>
> Tentukan apakah akun yang register merupakan individu biasa, terafiliasi dengan perusahaan,
>
> mewakili perusahaan, pemilik/founder bisnis, agency/freelancer bisnis, unknown, atau suspicious.
>
> PRIMARY OBJECTIVE:
>
> Buat klasifikasi berbasis evidence. Jangan membuat klaim lebih kuat dari bukti.
>
> DECISION STYLE:
>
> Gunakan bounded agentic investigation:
>
> Observe -> Form hypothesis -> Choose tool -> Collect evidence -> Update confidence -> Decide next action.
>
> TOOL SELECTION RULE:
>
> Pilih tool berdasarkan kecurigaan, expected information gain, biaya, reliability, dan risiko.
>
> Jangan memakai semua tools secara berurutan kecuali memang diperlukan.
>
> CLAIM SAFETY:
>
> \- Corporate email cukup untuk company_affiliated, tetapi belum cukup untuk owns_business.
>
> \- Founder/owner claim butuh evidence role yang eksplisit atau minimal dua sumber independen.
>
> \- LinkedIn via SERP snippet adalah supporting signal, bukan proof final tanpa cross-check.
>
> \- Jika source conflict, turunkan confidence dan lanjut validasi jika budget masih ada.
>
> STOP CONDITIONS:
>
> Stop jika confidence untuk klaim spesifik >= threshold, evidence cukup, tidak ada konflik besar,
>
> atau retry/cost/time budget habis.
>
> REPORTING:
>
> Selalu keluarkan Slack report naratif + internal JSON.
>
> Report harus mencantumkan tools used, tools skipped, evidence, confidence, dan rekomendasi.

# 10. Suspicion-Based Tool Routing

<img src="/mnt/data/md_conversion_media/prd/media/image2.png" style="width:7.1in;height:2.30165in" />

AI tidak menjalankan tools A -> B -> C secara tetap. AI membentuk hipotesis awal, lalu memilih tool yang paling informatif.

| **Kecurigaan AI**          | **Trigger**                                                            | **Tools yang mungkin dipilih**                                                           | **Output potensial**                                |
|----------------------------|------------------------------------------------------------------------|------------------------------------------------------------------------------------------|-----------------------------------------------------|
| Corporate email            | email domain bukan free provider, domain terlihat valid                | email_intelligence, domain_checker, web_fetch/firecrawl_scrape, search same name+company | company_affiliated atau founder jika role ditemukan |
| Free email + username kuat | Gmail/iCloud tapi username unik, signup source dari X/GitHub           | web_search, x_search, public_profile_search, personal website scrape, LinkedIn via SERP  | business_owner_candidate / unknown                  |
| Company field/website ada  | User mengisi company atau website saat register                        | domain_checker, website_scraper, company enrichment, role extraction                     | company_detected / company_affiliated               |
| Agency/freelancer signal   | kata kunci agency, studio, consultant, clients, portfolio              | personal website scrape, X/GitHub, search product/client pages                           | agency_business_candidate                           |
| Low signal                 | email free, nama umum, username tidak unik                             | broad SERP, enrichment if budget, then manual review/unknown                             | unknown / inconclusive                              |
| Suspicious                 | disposable email, domain mati, inconsistent identity, spam-like source | email/disposable checker, domain_checker, minimal search                                 | suspicious_spam                                     |

# 11. Classification Model

<img src="/mnt/data/md_conversion_media/prd/media/image3.png" style="width:6.6in;height:2.9371in" />

| **Classification**        | **Definisi**                                                        | **Evidence umum**                                                                       | **Aksi bisnis**                 |
|---------------------------|---------------------------------------------------------------------|-----------------------------------------------------------------------------------------|---------------------------------|
| individual_user           | Tidak ada evidence company. Bisa user biasa.                        | Email personal + tidak ada company signal.                                              | Jangan masukkan ke B2B lead.    |
| company_affiliated        | Akun terhubung dengan perusahaan, tetapi belum tentu owner/founder. | Corporate email, domain company valid, profile menunjukkan employee.                    | Bisa masuk B2B lead ringan.     |
| business_owner_candidate  | Kemungkinan punya bisnis, tetapi belum verified.                    | Bio “building X”, personal site, Product Hunt, company mention, tapi belum final.       | Butuh review/validasi tambahan. |
| founder_verified          | Evidence kuat user adalah founder/owner/maker/CEO.                  | User muncul di /about sebagai founder, Product Hunt maker, enrichment confirms founder. | High intent lead / VIP segment. |
| agency_business_candidate | User kemungkinan menjalankan agency/studio/consulting business.     | Portfolio clients, studio domain, service/pricing page.                                 | B2B service/agency segment.     |
| unknown/inconclusive      | Evidence tidak cukup atau terlalu ambigu.                           | Nama umum, hasil SERP bertabrakan, tidak ada source kuat.                               | Jangan klaim. Bisa retry nanti. |
| suspicious_spam           | Sinyal spam/fraud.                                                  | Disposable email, domain mati, pattern bot, conflicting data.                           | Flag/risk review.               |

# 12. Scoring Rubric

Scoring harus per classification. Jangan hanya satu angka “company score”. Contoh: akun bisa punya score tinggi untuk company_affiliated tetapi rendah untuk founder_verified.

| **Evidence**                                          | **Score Impact**             | **Catatan**                                      |
|-------------------------------------------------------|------------------------------|--------------------------------------------------|
| Corporate email domain valid                          | +25 company_affiliated       | Tidak cukup untuk founder.                       |
| Company website aktif dan relevan dengan domain email | +20 company_affiliated       | Naik jika ada legal/about/pricing.               |
| Nama user muncul di company website                   | +25 entity_match             | Harus cocok nama/role/context.                   |
| Nama user muncul dekat Founder/CEO/Owner/Maker        | +35 founder_verified         | Evidence kuat.                                   |
| Personal site menyebut “Founder of X”                 | +30 founder_verified         | Cross-check domain X.                            |
| Product Hunt/Indie profile menunjukkan maker          | +25 business_owner_candidate | Naik jika sama dengan company/product.           |
| X bio menyebut founder/building company               | +15 business_owner_candidate | Sinyal lemah-menengah; perlu cross-check.        |
| LinkedIn via SERP title/snippet menyebut role/company | +15 supporting signal        | Tidak final tanpa cross-check.                   |
| Vendor enrichment mengonfirmasi employment/company    | +20 sampai +35               | Tergantung reliability vendor dan match quality. |
| Conflicting company names                             | -25 sampai -50               | Turunkan confidence, minta validasi tambahan.    |
| Disposable email                                      | -50 trust                    | Bisa suspicious.                                 |
| Nama sangat umum tanpa unique identifier              | -15 identity_match           | Butuh sumber tambahan.                           |

| **Output**               | **Threshold**     | **Kondisi**                                                                     |
|--------------------------|-------------------|---------------------------------------------------------------------------------|
| founder_verified         | >= 85            | Butuh role evidence eksplisit atau dua sumber independen yang saling mendukung. |
| business_owner_candidate | 70 - 84           | Evidence kuat tapi belum cukup untuk founder_verified.                          |
| company_affiliated       | 65 - 84           | Corporate/company evidence jelas, tapi ownership tidak terbukti.                |
| unknown/inconclusive     | 35 - 64           | Ada sinyal, tapi terlalu ambigu.                                                |
| no_company_found         | \< 35             | Sudah dicek sesuai budget, tidak ada company signal reliable.                   |
| suspicious_spam          | risk score >= 70 | Diproses terpisah dari company confidence.                                      |

# 13. Early Stop dan Retry Budget

AI boleh berhenti setelah 2 tools jika klaim sudah aman. Namun AI tidak boleh berhenti cepat untuk klaim yang lebih kuat dari evidence.

| **Keputusan**     | **Contoh**                                                                                                  |
|-------------------|-------------------------------------------------------------------------------------------------------------|
| Stop cepat        | Corporate email + user ditemukan sebagai Founder di /about. Confidence >= 90.                              |
| Lanjut validasi   | Corporate email valid, tapi user tidak ditemukan di website. Cukup untuk company_affiliated, belum founder. |
| Lanjut validasi   | LinkedIn SERP snippet menyebut Founder, tapi company website tidak mengonfirmasi.                           |
| Stop inconclusive | Sudah max attempts, tidak ada kandidat source reliable, nama terlalu umum.                                  |
| Manual review     | High-value lead tapi evidence conflict atau role penting belum jelas.                                       |

Default budget per investigasi:

| **Parameter**                       | **Default**                                                                 |
|-------------------------------------|-----------------------------------------------------------------------------|
| max_tool_calls                      | 8 untuk normal lead, 15 untuk high-value lead                               |
| max_paid_calls                      | 1-2 paid tools per normal lead, lebih banyak hanya untuk high-value         |
| max_runtime                         | 60-120 detik normal, 5-10 menit untuk batch/asynchronous                    |
| min_evidence_for_founder            | 1 source sangat kuat atau 2 source independen menengah-kuat                 |
| min_evidence_for_company_affiliated | corporate email valid + active company domain cukup untuk status affiliated |

# 14. Slack Report Format

Report ke Slack harus text naratif, bukan JSON mentah. Gaya bahasa: seperti asisten yang melaporkan pekerjaan kepada bos/team.

> 🔎 Company Detection Report
>
> Saya sudah memeriksa akun baru berikut:
>
> Nama: Alex Rivera
>
> Email: alex@acme.ai
>
> Username: alexbuilds
>
> Signup source: X campaign
>
> Kesimpulan:
>
> Akun ini terverifikasi sebagai founder/owner dari Acme AI.
>
> Status:
>
> ✅ founder_verified
>
> Company detected: Yes
>
> Company: Acme AI
>
> Domain: acme.ai
>
> Confidence: 91%
>
> Apa yang saya cek:
>
> 1\. Email Intelligence
>
> \- Email menggunakan domain acme.ai.
>
> \- Domain bukan free email provider.
>
> \- Domain memiliki MX dan website aktif.
>
> 2\. Website Scraping
>
> \- Saya memeriksa acme.ai, /about, dan /team.
>
> \- Nama Alex Rivera ditemukan di halaman /about sebagai Founder.
>
> Tools yang tidak saya pakai:
>
> \- SERP Search
>
> \- LinkedIn via SERP
>
> \- GitHub checker
>
> \- Product Hunt checker
>
> \- Enrichment API
>
> Alasan tools dilewati / diganti:
>
> \- Firecrawl menunggu budget → diganti menggunakan Free Scraper
>
> \- Enrichment API menunggu budget → diganti menggunakan pencarian SERP Dorking
>
> \- SERP Search tidak dipakai karena bukti awal dari web scraping sudah sangat kuat (confidence terpenuhi).
>
> Evidence utama:
>
> \- alex@acme.ai menggunakan domain perusahaan acme.ai.
>
> \- acme.ai aktif sebagai website perusahaan.
>
> \- Alex Rivera ditemukan sebagai Founder di halaman /about.
>
> Rekomendasi:
>
> Masukkan akun ini ke segment: B2B Founder / High Intent Lead.

# 15. Internal JSON Format

> {
>
> "user_id": "u_123",
>
> "classification": "founder_verified",
>
> "company_detected": true,
>
> "company_name": "Acme AI",
>
> "company_domain": "acme.ai",
>
> "role_guess": "Founder",
>
> "confidence": 91,
>
> "risk_score": 8,
>
> "tools_used": \["email_intelligence", "domain_checker", "firecrawl_scrape"\],
>
> "tools_skipped": \[
>
> {"tool": "web_search", "reason": "strong evidence already found"},
>
> {"tool": "enrichment_api", "reason": "paid tool not needed"}
>
> \],
>
> "evidence": \[
>
> {
>
> "source_type": "email_domain",
>
> "source": "registration_email",
>
> "value": "alex@acme.ai",
>
> "reliability": "high",
>
> "observed_at": "2026-05-14T10:00:00+07:00"
>
> },
>
> {
>
> "source_type": "company_website",
>
> "source_url": "https://acme.ai/about",
>
> "value": "Alex Rivera listed as Founder",
>
> "reliability": "high",
>
> "observed_at": "2026-05-14T10:00:31+07:00"
>
> }
>
> \],
>
> "final_reason": "Corporate email domain and company website role evidence support founder_verified.",
>
> "slack_report_sent": true
>
> }

# 16. Contoh Skenario Eksekusi

## 16.1 Corporate Email, Founder Found Quickly

1.  AI melihat email alex@acme.ai dan membentuk hipotesis corporate_domain.

2.  AI memanggil email_intelligence dan domain_checker.

3.  AI memanggil web_fetch atau firecrawl_scrape untuk acme.ai/about dan acme.ai/team.

4.  AI menemukan Alex sebagai Founder.

5.  Confidence founder_verified melewati threshold; AI berhenti setelah 2-3 tools.

6.  Slack report menyebut tools yang dipakai dan tools yang dilewati.

## 16.2 Gmail, Username Kuat dari X Campaign

7.  AI melihat email Gmail, tetapi username alexbuilds dan signup_source X campaign.

8.  AI membentuk hipotesis founder_candidate_from_public_identity.

9.  AI memanggil web_search dan x_search dengan query berbasis username.

10. Jika ditemukan personal site atau product page, AI memakai web_fetch/firecrawl_scrape.

11. Jika ditemukan LinkedIn URL/snippet di SERP, AI menyimpan sebagai supporting signal dan mencari cross-check.

12. Jika evidence tidak cukup, AI boleh pakai enrichment_api jika tool enabled dan budget tersedia.

13. Jika tetap ambigu, report = inconclusive, bukan memaksa klaim.

## 16.3 Tools Mahal Belum Aktif

14. AI mencoba melihat tool catalog dan menemukan enrichment_api status disabled_waiting_budget.

15. AI tidak memanggil tool tersebut.

16. AI memakai alternatif: web_search, web_fetch, public profile search.

17. Di report, AI menulis bahwa enrichment_api tidak dipakai karena belum tersedia/dana belum ada.

18. Jika hasil belum kuat, output = possible / inconclusive sesuai evidence.

# 17. Privacy, Compliance, dan Security Boundaries

- Gunakan data register dan sumber publik yang relevan untuk tujuan company detection saja.

- Jangan mengumpulkan data sensitif yang tidak relevan dengan tujuan bisnis.

- Jangan direct scrape platform yang melarang automation tanpa izin; untuk LinkedIn, gunakan SERP URL/title/snippet sebagai supporting signal dan cross-check dengan sumber lain.

- Simpan source dan timestamp agar setiap klaim bisa diaudit.

- Gunakan allowlist/denylist tools di OpenClaw. exec/process harus restricted dan idealnya memerlukan approval untuk operasi berisiko.

- Paid enrichment harus dikontrol budget dan hanya dipakai saat expected information gain tinggi.

- Report tidak boleh berisi data personal yang tidak diperlukan oleh team penerima Slack.

- Slack channel harus dibatasi untuk team yang memang membutuhkan report.

# 18. Implementation Roadmap

| **Phase**                          | **Scope**                                                                                                     | **Estimasi** |
|------------------------------------|---------------------------------------------------------------------------------------------------------------|--------------|
| Phase 0 - Design                   | Finalisasi PRD, legal/privacy review, definisi thresholds, Slack report template.                             | 1 minggu     |
| Phase 1 - MVP                      | OpenClaw agent + Slack channel + email_intelligence + web_search + web_fetch + evidence JSON + basic scoring. | 2-3 minggu   |
| Phase 2 - Scraping Upgrade         | Firecrawl, x_search, website crawler router, LinkedIn via SERP signal, better report formatter.               | 2-4 minggu   |
| Phase 3 - Enrichment & Parallelism | Paid enrichment APIs, subagents, retry jobs, manual review dashboard.                                         | 4-6 minggu   |
| Phase 4 - Optimization             | Cost routing, model routing, memory/evidence recall, feedback loop from human reviewers.                      | ongoing      |

# 19. Acceptance Criteria

| **ID** | **Acceptance Criteria**                                                                                                                  |
|--------|------------------------------------------------------------------------------------------------------------------------------------------|
| AC1    | Untuk setiap user baru, sistem menghasilkan internal JSON result dengan classification, confidence, evidence, tools_used, tools_skipped. |
| AC2    | Sistem mengirim Slack report naratif yang bisa dibaca non-engineer.                                                                      |
| AC3    | AI tidak wajib menggunakan semua tools; AI harus menjelaskan alasan tools dilewati.                                                      |
| AC4    | Founder/owner classification tidak boleh keluar tanpa role evidence yang memadai.                                                        |
| AC5    | Jika tools mahal/berisiko disabled, sistem tetap bisa jalan dan mencatat skip reason.                                                    |
| AC6    | Setiap evidence memiliki source, timestamp, reliability, dan relation ke classification.                                                 |
| AC7    | Kasus ambiguous menghasilkan unknown/inconclusive, bukan klaim palsu.                                                                    |
| AC8    | Slack delivery berhasil ke channel/DM yang dikonfigurasi.                                                                                |

# 20. Referensi Implementasi OpenClaw

| **Referensi**            | **Catatan**                                                                                                                                                                                                        | **URL**                                  |
|--------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------|
| OpenClaw Tools & Plugins | Tools adalah typed functions yang agent bisa invoke; built-in tools termasuk exec/process, code_execution, browser, web_search/x_search/web_fetch, read/write/edit, message, cron/gateway, dan sessions/subagents. | https://docs.openclaw.ai/tools           |
| OpenClaw Web Tools       | web_search mencari web via provider; x_search untuk X posts; web_fetch untuk fetch URL ringan; untuk JS-heavy pakai browser.                                                                                       | https://docs.openclaw.ai/tools/web       |
| OpenClaw Firecrawl       | Firecrawl bisa dipakai sebagai web_search provider, explicit tools firecrawl_search/firecrawl_scrape, dan fallback extractor untuk web_fetch.                                                                      | https://docs.openclaw.ai/tools/firecrawl |
| OpenClaw Slack Channel   | Slack production-ready untuk DM dan channels via Slack app; bisa socket mode atau HTTP request URLs.                                                                                                               | https://docs.openclaw.ai/channels/slack  |
| OpenClaw Index           | Aggregator komunitas untuk tools/extensions; bukan official docs dan tidak semua item relevan/production-ready.                                                                                                    | https://openclawindex.com/tools          |

# 21. Appendix: Initial Tool Configuration Draft

> // Conceptual direction, not final production config.
>
> {
>
> "tools.allow": \["web_search", "x_search", "web_fetch", "browser", "code_execution", "message", "read", "write", "edit", "sessions_spawn"\],
>
> "tools.deny": \["exec"\],
>
> "channels.slack": {
>
> "enabled": true,
>
> "mode": "socket",
>
> "appToken": "SLACK_APP_TOKEN",
>
> "botToken": "SLACK_BOT_TOKEN"
>
> },
>
> "plugins.firecrawl": {
>
> "enabled": true,
>
> "webFetch.apiKey": "FIRECRAWL_API_KEY",
>
> "webFetch.onlyMainContent": true,
>
> "webFetch.timeoutSeconds": 60
>
> }
>
> }
