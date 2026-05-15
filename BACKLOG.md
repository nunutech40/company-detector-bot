# AI Company Detection Agent - Production Backlog

Berikut adalah daftar fitur dan komponen yang perlu dibangun untuk membawa sistem dari fase MVP Telegram menuju Production-Grade sesuai PRD dan TRD:

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
- [ ] **Web Search Provider**: Konfigurasi provider search (saat ini `not_configured`).
- [ ] **Scraping Engine**: Implementasi crawler/scraper yang bisa membaca konten *website* secara mendalam (saat ini bergantung pada domain_checker sederhana).
- [ ] **Social & Public Profile Checker**: Buat skrip pencarian LinkedIn via SERP snippet, GitHub, X (Twitter), atau Product Hunt.

## 4. Arsitektur Multi-Agent & Ops
- [ ] **Aktifkan Sub-agents**: Gunakan `sessions_spawn` di OpenClaw untuk investigasi paralel (satu sub-agent cek SERP, sub-agent lain cek website).
- [ ] **Dashboard Internal**: Bangun UI sederhana untuk admin mereview hasil yang `inconclusive` atau `business_owner_candidate` dengan confidence menengah.
- [ ] **Error & Cost Tracking**: Pantau rate limit API dan error jika memakai provider eksternal.
