# AI Company Detection Agent — Backlog

Status per 2026-05-18. Urutan dari yang paling prioritas.

---

## ✅ Selesai

### Go MVP + VPS
- [x] Go CLI MVP deployed di VPS (`/home/nunuopc/.openclaw/go-service/bin/company-check`)
- [x] VPS live test: `contact@komerce.id` → 100/100, Slack delivery ok
- [x] `go test ./...` semua pass
- [x] Input contract: `email`, `full_name`, `no_hp`, `brand_name`
- [x] Email intelligence, domain checker, crawler, scraper, scoring, evidence store
- [x] Search cascade: Google CSE → Brave → Bing → DDG (automatic fallback)
- [x] Slack sends untuk semua classification (bukan hanya company)
- [x] File-based evidence store dengan retention
- [x] deploy.sh: satu command untuk sync semua ke VPS
- [x] deliver_report.sh: kirim AI report ke Slack (prioritas ai_report_latest.txt)

### Arsitektur & Refactoring
- [x] Query package dihapus — AI yang handle query selection
- [x] Report formatter disederhanakan ke fallback mode only
- [x] Anti-hallucination: scoring engine reject AI evidence tanpa source URL/tool_call
- [x] `no_hp` sebagai confirmation tool (bukan search signal)
- [x] `looksLikeBrand()` ada di report.go (perlu dipindah ke package tersendiri)

### Phase A: AI Reasoning Loop
- [x] AGENTS.md rewrite: two-phase investigation, reasoning rounds, structured findings
- [x] Tool catalog: tier 1 (Go), tier 2 (OpenClaw built-in), tier 3 (paid/not configured)
- [x] Stop conditions: confidence >= 75, max 10 tool calls, 3 rounds tanpa temuan baru
- [x] Information gain check sebelum setiap tool call
- [x] Evidence chain: setiap temuan membuka jalur lebih spesifik
- [x] Tool failure reporting: setiap tool call dilaporkan dengan dampak dan harga setup
- [x] Structured findings: sosial media, lokasi, phone confirmation, role evidence
- [x] Anti-hallucination rules di AGENTS.md

### Dokumentasi
- [x] Flow Map: arsitektur dua layer, AI reasoning loop, fallback mode
- [x] PRD v6: Agentic Company Detector framing
- [x] TRD: execution model diupdate ke agentic + deterministik fallback
- [x] Semua docs sinkron dengan implementasi aktual

---

## 🔜 Next Priority

### 1. Test Phase A dari Telegram (paling penting sekarang)
- [ ] Kirim `/check nawaystore@yahoo.com --full-name "Tatak Subekti"` dari Telegram
- [ ] Verifikasi AI benar-benar memanggil tools (bukan hallucinate)
- [ ] Verifikasi reasoning rounds muncul di report
- [ ] Verifikasi structured findings (sosial media, lokasi, dll)
- [ ] Verifikasi tool failure reporting (Google CSE tidak dikonfigurasi, dll)
- [ ] Verifikasi anti-hallucination: kalau AI karang klaim → score tidak naik

### 2. Setup Search Provider (prerequisite Phase A yang optimal)
- [ ] **Google CSE** (gratis, 100/hari): daftar di programmablesearchengine.google.com, set `GOOGLE_CSE_KEY` + `GOOGLE_CSE_ID` di VPS
- [ ] **Brave Search API** (opsional, ~$5/bulan): set `BRAVE_SEARCH_API_KEY` di VPS
- [ ] Test search cascade dari VPS setelah konfigurasi

### 3. Tool Catalog Expansion (Go packages, gratis)
- [ ] **brand_hint_detector**: pindah `looksLikeBrand()` dari report.go ke package tersendiri, perluas keyword list
- [ ] **social_link_extractor**: extract social links dari HTML (Instagram, LinkedIn, TikTok, Facebook, YouTube)
- [ ] **role_signal_extractor**: deteksi CEO/founder/owner/direktur dari teks snippet
- [ ] **marketplace_url_detector**: deteksi URL Tokopedia/Shopee/Bukalapak dari teks

### 4. Otomasi Slack Delivery
- [ ] Slack delivery otomatis tanpa perlu AI jalankan deliver_report_with_env.sh secara manual
- [ ] Trigger otomatis setelah investigation selesai

---

## 📋 Planned (belum prioritas)

### Postgres + Queue (Phase B)
- [ ] Install PostgreSQL di VPS
- [ ] Schema: `investigation_jobs`, `tool_runs`, `evidence_items`, `final_reports`
- [ ] DB writer bertahap (tetap pertahankan file writer dulu)
- [ ] Redis + BullMQ queue
- [ ] API endpoint `POST /internal/company-detection/jobs`

### Slack Alert Routing (setelah DB)
- [ ] Alert decision function: personal/unknown → DB only, company → Telegram + Slack
- [ ] Slack Block Kit formatter

### Dashboard (setelah DB)
- [ ] Job list view dengan filter
- [ ] Job detail view
- [ ] Search by email/domain/company
- [ ] Review actions: mark reviewed, false positive, high-value lead

### Paid Tools (setelah ada budget)
- [ ] Firecrawl ($16/bulan): deep scrape, JS-heavy pages
- [ ] Tavily ($20/bulan): AI-friendly search
- [ ] Enrichment API ($99+/bulan): direct company/role lookup

### Multi-Agent (Phase D, setelah volume naik)
- [ ] Sub-agents paralel via `sessions_spawn`
- [ ] Error & cost tracking
- [ ] Dashboard internal untuk review inconclusive cases
