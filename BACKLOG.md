# AI Company Detection Agent - Production Backlog

Berikut adalah daftar fitur dan komponen yang perlu dibangun untuk membawa sistem dari fase MVP Telegram menuju Production-Grade sesuai PRD dan TRD:

## 0. Stabilization dari Perubahan Terakhir
- [x] Pastikan `ddg_search` tidak dicatat di `tools_used` kalau tidak benar-benar dipanggil/berhasil.
- [x] Pastikan kegagalan DDG/free scraper masuk `tool_errors`, bukan evidence palsu.
- [x] Pastikan `free_scraper` hanya dicatat dipakai jika ada active URL dan scrape berhasil.
- [x] Sinkronkan status tools antara `tool_catalog.yaml` dan `TOOLS.md`.
- [x] Jadikan Slack delivery eksplisit via `--send-slack` atau `COMPANY_DETECTION_SEND_SLACK=true`.
- [x] Test ulang DDG/free scraper dari VPS setelah deploy.

## 1. Database & Asynchronous Queue
- [ ] **Install PostgreSQL** di VPS untuk menyimpan relasi data.
- [ ] **Buat Skema Tabel**: `investigation_jobs`, `tool_runs`, `evidence_items`, `final_reports`.
- [ ] **Migrasi Evidence Store**: Ubah `evidence_store.js` yang tadinya menyimpan file JSON fisik menjadi operasi `INSERT` ke tabel Postgres.
- [ ] **Setup Queue (Redis + BullMQ)**: Implementasi antrean pekerjaan agar sistem bisa menerima banyak request bersamaan tanpa *bottleneck*.
- [ ] **Buat API Endpoint**: `POST /internal/company-detection/jobs` di server/worker Node.js.

## 2. Delivery ke Slack
- [ ] **Buat Slack App** di workspace perusahaan.
- [ ] **Konfigurasi Slack Token**: Masukkan `SLACK_BOT_TOKEN` dan `SLACK_APP_TOKEN` ke environment OpenClaw/VPS.
- [ ] **Modifikasi Report Formatter**: Pastikan `report_formatter.js` bisa mengirimkan JSON terstruktur untuk dikonversi menjadi *Block Kit* atau pesan Slack naratif.

## 3. Implementasi Tools & Scraping (Prioritas Berikutnya)
- [ ] **Web Search Provider Resmi**: Free fallback `ddg_search` sudah aktif, tapi dedicated provider seperti Brave/Tavily/Exa belum dikonfigurasi.
- [ ] **Scraping Engine Mendalam**: Lightweight crawler dan `free_scraper` sudah aktif; perlu engine lebih kuat untuk JS-heavy/deep crawl jika dibutuhkan.
- [ ] **Social & Public Profile Checker**: Buat skrip pencarian LinkedIn via SERP snippet, GitHub, X (Twitter), atau Product Hunt.

## 4. Arsitektur Multi-Agent & Ops
- [ ] **Aktifkan Sub-agents**: Gunakan `sessions_spawn` di OpenClaw untuk investigasi paralel (satu sub-agent cek SERP, sub-agent lain cek website).
- [ ] **Dashboard Internal**: Bangun UI sederhana untuk admin mereview hasil yang `inconclusive` atau `business_owner_candidate` dengan confidence menengah.
- [ ] **Error & Cost Tracking**: Pantau rate limit API dan error jika memakai provider eksternal.
