# Tools And Algorithms Reference

Dokumen ini adalah kamus semua tool, skill, dan algoritma yang dipakai agent. Baca dokumen ini setelah melihat [Flow Map](FLOW_MAP.md).

## 1. AI Reasoning Layer

### OpenClaw Agent (Phase A)

File:

```text
openclaw_workspace/AGENTS.md
```

Role:

- Menerima pesan Telegram atau request natural-language.
- **Primary mode:** menjalankan reasoning loop — observe, orient, decide, act, iterate.
- Memilih tool berdasarkan information gain, bukan urutan tetap.
- Menjalankan two-phase investigation: Phase 1 (business/personal), Phase 2 (business relationship).
- Menghasilkan narasi investigasi langsung (bukan dari Go report formatter).
- Mengembalikan report yang didasarkan pada tool output, bukan mengarang evidence.

**Yang AI handle (bukan Go):**
- Query selection — AI yang memilih query berdasarkan context dan temuan sebelumnya
- Iterative discovery — AI bisa round 2, round 3 dari temuan sebelumnya
- Brand hint detection — AI detect apakah local-part email adalah brand atau nama orang
- Narasi investigasi — AI yang menulis reasoning log dan structured findings
- Stop decision — AI yang decide kapan evidence sudah cukup

**Anti-hallucination rule:**
```text
Setiap klaim harus punya source URL dari tool output.
Scoring engine menolak evidence tanpa source_url.
Kalau tool gagal → tulis "tidak ditemukan", bukan tebakan.
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

---

## 2. Orchestrator Tool

### Go `company-check`

File:

```text
openclaw_workspace/scripts/company_check_go.sh
go-service/cmd/company-check
```

Role:

- **Fallback mode:** orchestrator deterministik ketika AI tidak tersedia.
- **Primary mode:** dipakai AI sebagai baseline tool (selalu dijalankan pertama).
- Mengatur urutan tool deterministik.
- Menggabungkan evidence.
- Memanggil scoring.
- Membuat fallback report (tools used/failed/skipped + scoring summary).
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

Algorithm (fallback mode):

1. Normalize input: `email`, `full_name`, `no_hp`, `brand_name`.
2. Run `email_intelligence`.
3. If email custom domain and not disposable:
   - run `domain_checker`
   - run `website_crawler_router`
4. Build simple fallback query (inline, no separate package):
   - custom domain: `"<domain>" company`
   - free email with full_name: `"<local>" OR "<fullname>"`
   - free email without full_name: `"<local>"`
5. Run search cascade (Google CSE → Brave → Bing → DDG).
6. Choose active URL from domain checker or crawler.
7. Run `free_scraper` if active URL exists.
8. Run `scoring_engine`.
9. Run `report_formatter` (fallback mode only).
10. If `--save`, run `evidence_store`.
11. If `--send-slack`, run Go Slack reporter.

Important input rule:

- `brand_name` may add a business hint and search query.
- `full_name` may add identity/profile queries.
- `no_hp` is retained/masked for internal matching only — not used for public search.
- `username` is intentionally not part of the trusted algorithm.

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

---

## 3. Input And Identity Tools

### `email_intelligence` (Go `internal/emailintel`)

Role:

- Normalize and validate email.
- Extract local part/domain/TLD.
- Detect free provider.
- Detect disposable hints.
- Detect role/contact mailbox.
- Produce first evidence items and initial hypothesis for AI.

Algorithm:

```text
normalize email
-> validate regex
-> split local/domain
-> check FREE_DOMAINS
-> check DISPOSABLE_HINTS
-> check ROLE_LOCALS
-> assign tags
-> emit evidence + initial hypothesis
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

---

## 4. Domain And Website Tools

### `domain_checker` (Go `internal/domaincheck`)

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

### `website_crawler_router` (Go `internal/crawler`)

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

---

## 5. Search And Scrape Tools

### Search Cascade (Go `internal/search`)

Role:

- Multi-provider search dengan automatic fallback.
- Provider order: Google CSE → Brave → Bing HTML → DDG HTML.
- Setiap provider dicoba sampai ada yang berhasil.

Provider status:

| Provider | Status | Cost | Notes |
|---|---|---|---|
| Google CSE | not_configured | Free (100/day) | Reliable, tidak diblokir ISP |
| Brave Search API | not_configured | ~$5/month | Reliable, structured results |
| Bing HTML | fallback | Free | Fragile, bisa diblokir |
| DDG HTML | last_resort | Free | Paling fragile, sering diblokir ISP |

**Query selection:** AI yang memilih query di primary mode. Go hanya menyediakan simple fallback query (inline di orchestrator) untuk fallback mode.

### `free_scraper` (Go `internal/scraper`)

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

### OpenClaw `web_fetch`

Role:

- Fetch dan extract content dari URL spesifik.
- Dipakai AI untuk: /about pages, /team pages, social profiles, marketplace pages.
- Lebih dalam dari `free_scraper` — bisa extract structured content.
- Fallback: `browser` jika `web_fetch` return empty/incomplete.

### OpenClaw `web_search`

Role:

- OpenClaw built-in search.
- Dipakai AI untuk query yang berbeda angle dari Go search cascade.
- Bisa dipakai untuk: social media search, marketplace search, role search.

### OpenClaw `browser`

Role:

- Render JS-heavy pages.
- Dipakai AI hanya ketika `web_fetch` return empty atau incomplete.
- Lebih mahal — dicatat di report.

---

## 6. Scoring And Classification

### `scoring_engine` (Go `internal/scoring`)

Role:

- Rules-first classification and confidence scoring.
- Central place for final classification logic.
- **Selalu deterministik** — AI tidak boleh langsung set classification.

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
Evidence tanpa source_url ditolak.
```

Change impact:

- This file controls final classification.
- Any scoring threshold change should update `scoring_rules.yaml`, docs, and tests.

---

## 7. Reporting And Storage Tools

### `report_formatter` (Go `internal/report`)

Role:

- Convert JSON result into Telegram-safe text.
- **Fallback mode only** — digunakan ketika AI reasoning tidak aktif.
- Di primary mode, AI reasoning loop yang menghasilkan narasi investigasi langsung.

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

- Narasi investigasi step-by-step sudah dihapus — AI yang handle di primary mode.
- `looksLikeBrand()` dan `initialHypothesis()` sudah dihapus — AI yang detect ini.
- Query selection sudah dihapus dari report — AI yang handle query selection.

### `evidence_store` (Go `internal/evidence`)

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

### Go Slack reporter (Go `internal/slack`)

Role:

- Optional Slack sender.
- Uses webhook or Slack bot token if configured.

Important:

- Not automatic.
- `company_check` calls it when `--send-slack` is present, for **all classification results**.
- After a database is available, routing will be split: personal/unknown saved to DB only, company-associated to both Telegram and Slack.

---

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
- Should stay aligned with `scoring_engine` (Go `internal/scoring`).

---

## 9. Analysis Tools (Go packages, deterministik)

Tools ini dipakai AI untuk menganalisis konten yang sudah di-fetch. Semua gratis, selalu tersedia.

### `brandhint` (Go `internal/brandhint`)

Role:

- Deteksi apakah string (biasanya email local part) adalah brand/toko/bisnis atau nama orang.
- Dipakai AI untuk decide strategi pencarian: search sebagai brand atau sebagai person.

Algorithm:

```text
lowercase input
-> cek brand keywords: store, shop, toko, mart, studio, design, tech, media, agency, dll
-> cek person name patterns: titik di tengah (r.fajarnugraha), underscore (john_doe)
-> return Result{IsBrand, Confidence, Signals, Suggestion}
```

Output:

```json
{
  "is_brand": true,
  "confidence": "high",
  "signals": ["store"],
  "suggestion": "search sebagai brand/toko"
}
```

Examples:

- `nawaystore` → IsBrand=true, high (mengandung "store")
- `tokobaju` → IsBrand=true, high (mengandung "toko")
- `r.fajarnugraha` → IsBrand=false, high (pola nama orang dengan titik)
- `uitdiedos` → IsBrand=false, low (ambigu)

### `sociallinks` (Go `internal/sociallinks`)

Role:

- Extract social media links dari HTML atau plain text.
- Dipakai AI setelah fetch halaman website untuk menemukan semua sosial media bisnis.

Algorithm:

```text
cari href yang mengandung domain sosmed
-> instagram.com, linkedin.com, facebook.com, twitter.com, x.com, tiktok.com, youtube.com, tokopedia.com, shopee.co.id
-> cari juga @username di text
-> cari og:url dan og:site_name meta tags
-> deduplicate berdasarkan URL
-> return []SocialLink{Platform, URL, Source}
```

Platforms yang dideteksi: instagram, linkedin, facebook, twitter, tiktok, youtube, tokopedia, shopee.

### `rolesignal` (Go `internal/rolesignal`)

Role:

- Deteksi sinyal role bisnis (founder, CEO, owner, dll) dari teks snippet.
- Dipakai AI untuk extract role evidence dari search results atau halaman yang di-fetch.

Algorithm:

```text
lowercase text
-> cari kata kunci role dengan context:
   High confidence owner: founder, co-founder, owner, pemilik, pendiri, direktur utama, CEO
   Medium confidence owner: direktur, komisaris, managing director
   Employee: manager, staff, karyawan, bekerja di, works at
   Freelancer: freelancer, konsultan, consultant, independent
-> extract evidence: 50 karakter sebelum dan sesudah kata kunci
-> return []Signal{Role, Confidence, Evidence, IsOwner}
```

Examples:

- "harga dari owner langsung" → Signal{Role: "owner", IsOwner: true, Confidence: "high"}
- "Tatak Subekti - Founder at Naway Store" → Signal{Role: "founder", IsOwner: true, Confidence: "high"}
- "bekerja di PT XYZ" → Signal{Role: "employee", IsOwner: false, Confidence: "medium"}

---

## 10. Planned Tool Catalog Expansion

Tools yang belum diimplementasi:

### Go Packages (deterministik, gratis)

- **`company_name_normalizer`**: Normalize nama perusahaan dari berbagai format (PT X, CV X, X Inc, dll).
- **`marketplace_url_detector`**: Deteksi URL Tokopedia/Shopee/Bukalapak dari teks atau search results.

### Network Tools (perlu konfigurasi/budget)

- **Google CSE** (free 100/day): Reliable search, tidak diblokir ISP. Setup: `GOOGLE_CSE_KEY` + `GOOGLE_CSE_ID`.
- **Brave Search API** (~$5/month): Reliable search, structured results. Setup: `BRAVE_SEARCH_API_KEY`.
- **Firecrawl** ($16/month): Scrape JS-heavy pages, structured extraction.
- **Tavily** ($20/month): AI-friendly search dengan domain filter.
- **LinkedIn Enrichment API** (~$9-50/month): Full LinkedIn profile data (name, role, company, experience). Options: LinkdAPI, Bright Data, Scrapin.io. **Catatan:** Direct scraping LinkedIn tidak bisa — LinkedIn block bot dan ban IP. SERP dorking (`site:linkedin.com/in/ "nama"`) adalah alternatif gratis yang aman untuk dapat snippet role/company.

Rule untuk setiap tool baru:

```text
Setiap tool baru harus declare:
- input
- output
- evidence type
- reliability
- failure behavior
- apakah mempengaruhi score
```

---

## 11. OpenClaw Built-in Tools — Terpasang, Implementasi Besok

Tools ini sudah dikonfigurasi di `openclaw.json` dan siap dipakai. Implementasi detail besok.

### `llm-task` — JSON-only Structured Extraction

**Status:** ✅ Plugin enabled di `openclaw.json`

**Fungsi:** Jalankan LLM task terpisah yang return JSON terstruktur (schema-validated). Ideal untuk extract data dari teks mentah hasil `web_search` atau `web_fetch`.

**Use case untuk app ini:**
- Extract `{name, role, company, location, phone}` dari teks mentah search results
- Validate dan normalize data sebelum disimpan ke evidence
- Data langsung bisa disimpan ke DB karena sudah structured JSON

**Rencana implementasi:**
```
llm-task(
  prompt: "Extract business entity from this text. Return only JSON.",
  input: "<teks dari search/fetch>",
  schema: {name, role, company, location, phone, confidence}
)
```

**Keuntungan:** Output selalu valid JSON, bisa pakai model berbeda dari main model, tidak ada hallucination karena input adalah teks nyata dari tool.

---

### `hooks` — Event-driven Delivery

**Status:** ✅ Hooks enabled di `openclaw.json`, workspace hooks directory dibuat

**Fungsi:** Trigger script otomatis saat event tertentu terjadi di gateway.

**Use case untuk app ini:**
- `message:sent` → trigger `deliver_report_with_env.sh` setiap kali AI kirim reply ke Telegram
- Memastikan Slack selalu dapat report yang sama dengan Telegram tanpa bergantung AI

**Rencana implementasi:**
- Buat `workspace/hooks/deliver-on-message-sent/handler.ts`
- Filter: hanya trigger kalau message mengandung "Company Detection Report"
- Action: jalankan `deliver_report_with_env.sh` di background

**File placeholder:** `openclaw_workspace/hooks/deliver-on-message-sent/HOOK.md`

---

### `Standing Orders` — Persistent Instructions

**Status:** ✅ File `STANDING_ORDERS.md` dibuat di workspace

**Fungsi:** Instruksi yang selalu di-inject ke setiap session. Lebih reliable dari instruksi di AGENTS.md karena tidak bisa di-override session context.

**Use case untuk app ini:**
- Pastikan AI selalu jalankan `finish_investigation.sh` di akhir investigasi
- Pastikan AI selalu report token usage setelah selesai

**Rencana implementasi:**
- Tambahkan referensi ke `STANDING_ORDERS.md` dari `AGENTS.md`
- Atau rename ke salah satu bootstrap filename yang auto-injected

**File placeholder:** `openclaw_workspace/STANDING_ORDERS.md`

---

### `x_search` — Search X/Twitter

**Status:** ⏳ Butuh `XAI_API_KEY` (berbayar) — belum dikonfigurasi

**Fungsi:** Search X/Twitter posts menggunakan xAI Grok.

**Use case untuk app ini:**
- Cari profil `@naway.inc` di X
- Lihat bio dan posts untuk role evidence

**Catatan:** Butuh xAI API key. Kalau tidak mau bayar, bisa pakai `web_search("site:x.com @naway.inc")` sebagai alternatif gratis.

---

### `llm-task` untuk DB-ready Output

**Status:** ⏳ Implementasi besok

**Konsep:** Setelah AI selesai investigasi, jalankan `llm-task` untuk normalize semua temuan ke JSON schema yang konsisten. Output ini langsung bisa di-INSERT ke Postgres tanpa parsing tambahan.

```json
{
  "email": "nawaystore@yahoo.com",
  "classification": "business_owner_candidate",
  "confidence": 80,
  "business": {
    "name": "Naway.inc",
    "domain": "nawaystore.id",
    "marketplace": ["tokopedia.com/nawaystore"],
    "social_media": ["instagram.com/naway.inc", "tiktok.com/@naway.inc"]
  },
  "person": {
    "name": "Tatak Subekti",
    "role": "owner",
    "phone_confirmed": true
  },
  "location": {
    "city": "Jakarta Utara"
  }
}
```

---

## 10. Change Impact Map

If changing:

- free email logic → check `email_intelligence`, fallback query (orchestrator), `scoring_engine`.
- domain/website logic → check `domain_checker`, `website_crawler_router`, `free_scraper`, browser skip reason.
- search behavior → check search cascade (orchestrator), evidence reliability, AI tool catalog.
- scoring → check `scoring_engine`, `scoring_rules.yaml`, report examples.
- report wording → check `report_formatter` (fallback mode), `AGENTS.md`, Telegram screenshots/results.
- storage → check `evidence_store`, [TRD](TRD.md), and [Flow Map](FLOW_MAP.md).
- Slack → check `slack_reporter`, alert decision rules, [PRD](../product/PRD.md), and [Flow Map](FLOW_MAP.md).
- AI reasoning behavior → check `AGENTS.md`, stop conditions, evidence chain examples.
- tool catalog → check `tool_catalog.yaml`, `TOOLS.md`, [Flow Map](FLOW_MAP.md).
- multi-agent → check [Flow Map](FLOW_MAP.md), [Next Level Enrichment Plan](../product/NEXT_LEVEL_ENRICHMENT_PLAN.md), and [TRD](TRD.md).
