# AI Company Detection Agent - Production Backlog

Berikut adalah daftar fitur dan komponen yang perlu dibangun untuk membawa sistem dari fase MVP Telegram menuju Production-Grade sesuai PRD dan TRD:

## 0. Stabilization dari Perubahan Terakhir
- [x] Pastikan `ddg_search` tidak dicatat di `tools_used` kalau tidak benar-benar dipanggil/berhasil.
- [x] Pastikan kegagalan DDG/free scraper masuk `tool_errors`, bukan evidence palsu.
- [x] Pastikan `free_scraper` hanya dicatat dipakai jika ada active URL dan scrape berhasil.
- [x] Sinkronkan status tools antara `tool_catalog.yaml` dan `TOOLS.md`.
- [x] Jadikan Slack delivery eksplisit via `--send-slack` atau `COMPANY_DETECTION_SEND_SLACK=true`.
- [x] Test ulang DDG/free scraper dari VPS setelah deploy.
- [x] Buat flow map dan tools/algorithms reference supaya alur tetap gampang dibaca.
- [x] Buat high-level business flow dengan 2 flowchart dan 2 sequence diagram untuk current MVP vs level 2.
- [x] Rapikan dokumentasi ke folder `docs/product`, `docs/technical`, `docs/operations`, `docs/reviews`, dan tambahkan docs index/cara baca.
- [x] Selaraskan input contract ke field realistis `email`, `full_name`, `no_hp`, `brand_name` dan hilangkan dependency trusted pada `username`.

## 1. Database & Asynchronous Queue
- [ ] **Go Transition Spec Freeze**: finalkan input/output/evidence/scoring contract sebelum rewrite.
- [ ] **Go Golden Fixtures**: buat fixture input/expected output untuk parity JS vs Go.
- [ ] **Go Service Skeleton**: buat `go-service/` dengan CLI parity untuk `company-check`.
- [ ] **Go Unit Tests**: port pure logic dengan unit test dan golden fixtures.
- [ ] **Go Integration Tests**: test DNS/fetch/search/Slack dengan mock dan real opt-in tests.
- [ ] **Go Side-by-Side Cutover**: deploy Go di VPS, bandingkan dengan JS, lalu switch OpenClaw jika parity aman.
- [ ] **Install PostgreSQL** di VPS untuk menyimpan relasi data.
- [ ] **Buat Skema Tabel**: `investigation_jobs`, `tool_runs`, `evidence_items`, `final_reports`.
- [ ] **Migrasi Evidence Store**: Ubah `evidence_store.js` yang tadinya menyimpan file JSON fisik menjadi operasi `INSERT` ke tabel Postgres.
- [ ] **DB Writer Bertahap**: Tambahkan writer Postgres tanpa mematikan file evidence writer dulu.
- [ ] **Setup Queue (Redis + BullMQ)**: Implementasi antrean pekerjaan agar sistem bisa menerima banyak request bersamaan tanpa *bottleneck*.
- [ ] **Buat API Endpoint**: `POST /internal/company-detection/jobs` di server/worker Node.js.

## 2. Next Level Email-First Enrichment
- [ ] **Company Profile Builder**: Setelah custom/company domain terdeteksi, bangun `company_profile` berisi nama, website, deskripsi bisnis, industri, lokasi jika tersedia, dan source confidence.
- [ ] **Social Link Extractor**: Ambil social links dari website perusahaan dan halaman publik yang ditemukan.
- [ ] **SERP Social Discovery**: Cari LinkedIn company, Instagram, X, Facebook, YouTube, TikTok, marketplace/app/product pages via query builder + DDG/search provider.
- [ ] **Personal-To-Business Discovery**: Untuk free email, gunakan local-part sebagai low-confidence identity hint untuk mencari public profile/business relationship.
- [ ] **Role Signal Extractor**: Ekstrak sinyal seperti CEO, founder, owner, agency, consultant dari snippet/public pages dengan guardrail anti-overclaim.
- [ ] **Relationship Scorer**: Tambah `business_relationship` seperti `personal_with_business_affiliation`, `founder_or_owner_candidate`, atau `business_relationship_unknown`.
- [ ] **Maps/Local Signal**: Mulai dari SERP snippet untuk Google Maps/local business; official Places API bisa menyusul jika budget dan legal jelas.

Referensi detail: [NEXT_LEVEL_ENRICHMENT_PLAN.md](docs/product/NEXT_LEVEL_ENRICHMENT_PLAN.md).

## 3. Delivery ke Slack
- [ ] **Buat Slack App** di workspace perusahaan.
- [ ] **Konfigurasi Slack Token**: Masukkan `SLACK_BOT_TOKEN` dan `SLACK_APP_TOKEN` ke environment OpenClaw/VPS.
- [ ] **Alert Decision Function**: Slack hanya menerima alert untuk company/high-value/personal-business/suspicious signals, bukan semua check.
- [ ] **Modifikasi Report Formatter**: Pastikan `report_formatter.js` bisa mengirimkan JSON terstruktur untuk dikonversi menjadi *Block Kit* atau pesan Slack naratif.

## 4. Web Dashboard
- [ ] **Job List View**: Tampilkan semua checked emails dengan filter classification, confidence, alert sent, review status, dan date range.
- [ ] **Job Detail View**: Tampilkan input, company profile, person relationship, evidence, tool runs, errors, dan final report.
- [ ] **Search**: Cari by email, domain, company, person identity hint, dan social URL.
- [ ] **Review Actions**: Mark reviewed, false positive, high-value lead, needs retry, dan internal note.

Referensi detail DB/Slack/dashboard: [PRODUCT_WORKFLOW_AND_STORAGE_PLAN.md](docs/product/PRODUCT_WORKFLOW_AND_STORAGE_PLAN.md).

## 5. Implementasi Tools & Scraping (Prioritas Berikutnya)
- [ ] **Web Search Provider Resmi**: Free fallback `ddg_search` sudah aktif, tapi dedicated provider seperti Brave/Tavily/Exa belum dikonfigurasi.
- [ ] **Scraping Engine Mendalam**: Lightweight crawler dan `free_scraper` sudah aktif; perlu engine lebih kuat untuk JS-heavy/deep crawl jika dibutuhkan.
- [ ] **Social & Public Profile Checker**: Buat skrip pencarian LinkedIn via SERP snippet, GitHub, X (Twitter), atau Product Hunt.

## 6. Arsitektur Multi-Agent & Ops
- [ ] **Aktifkan Sub-agents**: Gunakan `sessions_spawn` di OpenClaw untuk investigasi paralel (satu sub-agent cek SERP, sub-agent lain cek website).
- [ ] **Dashboard Internal**: Bangun UI sederhana untuk admin mereview hasil yang `inconclusive` atau `business_owner_candidate` dengan confidence menengah.
- [ ] **Error & Cost Tracking**: Pantau rate limit API dan error jika memakai provider eksternal.
