# Requirements Document

## Introduction

Fitur ini menambahkan lapisan penyimpanan database dan web dashboard ke sistem Company Detection yang sudah ada. Saat ini, hasil investigasi AI disimpan sebagai file JSON flat di VPS (`evidence/*.json`). Tujuan fitur ini adalah:

1. Menyimpan setiap hasil investigasi ke PostgreSQL secara terstruktur — per field, bukan hanya blob JSON.
2. Tetap menyimpan narasi teks lengkap dari AI (telegram_report) sebagai history.
3. Menyediakan web dashboard internal untuk melihat daftar semua investigasi dan detail per investigasi.

Sistem yang ada: Go backend, AI agent (Qwen via Sumopod), output berupa `CompanyCheckResult` JSON yang sudah terdefinisi di `internal/model/model.go`. File evidence sudah ditulis oleh `internal/evidence/evidence.go`. Fitur ini menambah DB writer di samping file writer yang sudah ada, tanpa menghapus file writer.

---

## Glossary

- **Investigation**: Satu siklus pengecekan Company Detection untuk satu email input, menghasilkan satu `CompanyCheckResult`.
- **CompanyCheckResult**: Struct Go yang merepresentasikan output lengkap satu investigasi, termasuk classification, confidence, evidence items, dan narasi AI.
- **DB Writer**: Komponen Go baru yang menyimpan `CompanyCheckResult` ke PostgreSQL setelah investigasi selesai.
- **Dashboard**: Web UI internal (read-only di MVP) untuk melihat daftar dan detail investigasi.
- **Evidence Item**: Satu unit bukti dari satu tool call, berisi source_type, claim, value, reliability, dan confidence_delta.
- **Classification**: Label hasil investigasi: `possible_company_affiliated`, `likely_personal_email`, `unknown_needs_more_evidence`, `suspicious_or_invalid`.
- **Confidence Score**: Angka 0–100 yang merepresentasikan keyakinan sistem terhadap classification.
- **AI Narrative**: Teks laporan lengkap yang dihasilkan AI, disimpan di field `telegram_report` pada `CompanyCheckResult`.
- **Structured Fields**: Field-field individual dari hasil investigasi yang disimpan sebagai kolom terpisah di database (bukan satu blob JSON).
- **API Server**: HTTP server Go baru yang melayani request dari Dashboard.
- **Postgres**: Database PostgreSQL yang menjadi source of truth untuk semua hasil investigasi.

---

## Requirements

### Requirement 1: Definisi Output AI yang Lengkap (AI Output Schema)

**User Story:** Sebagai developer, saya ingin mendefinisikan semua field yang bisa dihasilkan AI investigasi sebelum membuat schema DB, sehingga schema DB mencakup semua data yang relevan tanpa perlu migrasi besar di kemudian hari.

#### Acceptance Criteria

1. THE System SHALL mendefinisikan schema output AI yang mencakup semua field berikut dari `CompanyCheckResult`:
   - **Job metadata**: `job_type`, `observed_at`, `ok`
   - **Input fields**: `email`, `full_name`, `no_hp` (phone_hash), `brand_name`
   - **Classification fields**: `classification`, `company_detected`, `confidence_score`, `confidence_label`, `automation_action`, `owner_claim_allowed`
   - **Scoring breakdown**: `base_score`, `evidence_delta`, `final_score`, `rejected_evidence`
   - **Email intelligence**: `is_free_email`, `is_disposable`, `is_role_email`, `email_local`, `email_domain`, `email_tld`, `initial_suspicion`, `email_tags[]`
   - **Domain check**: `domain_mx_status`, `domain_website_active`, `domain_has_address_records`
   - **Business profile** (dari AI enrichment): `business_name`, `business_domain`, `business_website`, `business_description`, `business_industry`
   - **Person profile** (dari AI enrichment): `person_name`, `person_role`, `phone_match_status`
   - **Marketplace** (dari AI enrichment): array of `{platform, url, rating, review_count, sold_count, product_category}`
   - **Social media** (dari AI enrichment): array of `{platform, url, bio}`
   - **Location** (dari AI enrichment): `city`, `address`, `maps_url`
   - **Role evidence** (dari AI enrichment): array of `{quote, source_url, reliability}`
   - **Tools metadata**: `tools_used[]`, `tools_skipped[]`, `tool_errors[]`
   - **Evidence items**: array of `{source_type, source_url, tool_call, reliability, claim, value, confidence_delta, verified}`
   - **Narrative**: `summary`, `recommendation`, `telegram_report` (teks AI lengkap)

2. THE System SHALL mendokumentasikan field mana yang dihasilkan oleh Go pipeline (deterministic) dan field mana yang dihasilkan oleh AI enrichment (dari llm-task normalize).

3. THE System SHALL mendefinisikan bahwa field AI enrichment (`business_name`, `person_name`, `marketplace`, `social_media`, `location`, `role_evidence`) bersifat nullable — tidak selalu ada di setiap investigasi.

---

### Requirement 2: Database Schema dan Migrasi

**User Story:** Sebagai developer, saya ingin schema database yang terstruktur untuk menyimpan hasil investigasi, sehingga data bisa di-query, difilter, dan ditampilkan di dashboard secara efisien.

#### Acceptance Criteria

1. THE DB Schema SHALL mendefinisikan tabel `investigations` sebagai tabel utama dengan kolom:
   - `id` (UUID, primary key)
   - `email` (text, not null)
   - `email_domain` (text)
   - `full_name` (text, nullable)
   - `brand_name` (text, nullable)
   - `phone_hash` (text, nullable — SHA-256 dari no_hp, bukan plaintext)
   - `classification` (text, not null)
   - `company_detected` (boolean)
   - `confidence_score` (integer)
   - `confidence_label` (text)
   - `automation_action` (text)
   - `owner_claim_allowed` (boolean)
   - `base_score` (integer)
   - `evidence_delta` (integer)
   - `is_free_email` (boolean)
   - `is_disposable` (boolean)
   - `is_role_email` (boolean)
   - `domain_website_active` (boolean)
   - `business_name` (text, nullable)
   - `business_domain` (text, nullable)
   - `business_website` (text, nullable)
   - `business_description` (text, nullable)
   - `business_industry` (text, nullable)
   - `person_name` (text, nullable)
   - `person_role` (text, nullable)
   - `phone_match_status` (text, nullable)
   - `location_city` (text, nullable)
   - `location_address` (text, nullable)
   - `ai_narrative` (text — isi `telegram_report`)
   - `ai_summary` (text — isi `summary`)
   - `ai_recommendation` (text — isi `recommendation`)
   - `raw_json` (jsonb — full `CompanyCheckResult` untuk fallback)
   - `observed_at` (timestamptz)
   - `created_at` (timestamptz, default now())

2. THE DB Schema SHALL mendefinisikan tabel `evidence_items` dengan kolom:
   - `id` (UUID, primary key)
   - `investigation_id` (UUID, foreign key ke `investigations.id`)
   - `source_type` (text)
   - `source_url` (text, nullable)
   - `tool_call` (text, nullable)
   - `reliability` (text)
   - `claim` (text)
   - `value` (text, nullable)
   - `confidence_delta` (integer)
   - `verified` (boolean)

3. THE DB Schema SHALL mendefinisikan tabel `marketplace_profiles` dengan kolom:
   - `id` (UUID, primary key)
   - `investigation_id` (UUID, foreign key)
   - `platform` (text — e.g. "tokopedia", "shopee")
   - `url` (text)
   - `rating` (numeric, nullable)
   - `review_count` (integer, nullable)
   - `sold_count` (integer, nullable)
   - `product_category` (text, nullable)

4. THE DB Schema SHALL mendefinisikan tabel `social_profiles` dengan kolom:
   - `id` (UUID, primary key)
   - `investigation_id` (UUID, foreign key)
   - `platform` (text — e.g. "instagram", "tiktok", "linkedin", "facebook")
   - `url` (text)
   - `bio` (text, nullable)

5. THE DB Schema SHALL mendefinisikan tabel `role_evidence` dengan kolom:
   - `id` (UUID, primary key)
   - `investigation_id` (UUID, foreign key)
   - `quote` (text)
   - `source_url` (text, nullable)
   - `reliability` (text)

6. THE DB Schema SHALL menyertakan index pada `investigations.email`, `investigations.classification`, `investigations.observed_at`, dan `investigations.company_detected` untuk mendukung query dashboard.

7. THE System SHALL menyediakan migration file SQL yang bisa dijalankan sekali untuk membuat semua tabel di atas.

---

### Requirement 3: DB Writer — Menyimpan Hasil Investigasi ke Database

**User Story:** Sebagai sistem, saya ingin setiap hasil investigasi otomatis tersimpan ke PostgreSQL setelah selesai, sehingga data tersedia di dashboard tanpa langkah manual.

#### Acceptance Criteria

1. WHEN investigasi selesai dan `--save` flag aktif, THE DB Writer SHALL menyimpan `CompanyCheckResult` ke tabel `investigations` beserta semua tabel relasi (`evidence_items`, `marketplace_profiles`, `social_profiles`, `role_evidence`).

2. THE DB Writer SHALL berjalan di samping file writer yang sudah ada — file evidence tetap ditulis, DB writer ditambahkan sebagai langkah tambahan.

3. IF koneksi database tidak tersedia saat investigasi selesai, THEN THE DB Writer SHALL mencatat error ke stderr dan melanjutkan tanpa menggagalkan proses investigasi utama.

4. THE DB Writer SHALL menggunakan environment variable `DATABASE_URL` (format: `postgres://user:pass@host:port/dbname`) untuk konfigurasi koneksi.

5. WHEN `DATABASE_URL` tidak di-set, THE DB Writer SHALL melewati penyimpanan ke DB tanpa error dan mencatat log "db storage skipped: DATABASE_URL not set".

6. THE DB Writer SHALL meng-hash `no_hp` menggunakan SHA-256 sebelum menyimpan ke kolom `phone_hash` — plaintext nomor HP tidak boleh tersimpan di database.

7. THE DB Writer SHALL menyimpan full `CompanyCheckResult` sebagai JSONB ke kolom `raw_json` sebagai fallback untuk field yang belum ter-mapping ke kolom terstruktur.

8. WHEN investigasi untuk email yang sama sudah ada di database, THE DB Writer SHALL menyimpan sebagai row baru (bukan update) — setiap investigasi adalah record independen dengan timestamp berbeda.

---

### Requirement 4: AI Enrichment Fields — Parsing dari Normalized JSON

**User Story:** Sebagai sistem, saya ingin field hasil AI enrichment (business profile, social media, marketplace, location) tersimpan ke kolom terstruktur di database, sehingga dashboard bisa menampilkan data ini tanpa parsing JSON manual.

#### Acceptance Criteria

1. THE DB Writer SHALL membaca field AI enrichment dari `CompanyCheckResult.Storage` atau dari field tambahan yang di-inject oleh AI agent setelah normalisasi llm-task.

2. THE System SHALL mendefinisikan struct Go `AIEnrichment` yang merepresentasikan output normalized dari llm-task:
   ```
   business: {name, domain, website, description, industry}
   person: {name, role, phone_confirmed}
   social_media: [{platform, url, bio}]
   marketplace: [{platform, url, rating, review_count, sold_count, product_category}]
   location: {city, address, maps_url}
   role_evidence: [{quote, source_url, reliability}]
   ```

3. WHEN `AIEnrichment` tersedia dalam `CompanyCheckResult`, THE DB Writer SHALL menyimpan field-field tersebut ke kolom terstruktur yang sesuai di tabel `investigations`, `marketplace_profiles`, `social_profiles`, dan `role_evidence`.

4. IF `AIEnrichment` tidak tersedia (investigasi tanpa AI enrichment), THEN THE DB Writer SHALL menyimpan field AI enrichment sebagai NULL tanpa error.

---

### Requirement 5: API Server — HTTP Endpoints untuk Dashboard

**User Story:** Sebagai dashboard, saya ingin HTTP API yang menyediakan data investigasi dari database, sehingga dashboard bisa menampilkan list dan detail investigasi.

#### Acceptance Criteria

1. THE API Server SHALL menyediakan endpoint `GET /api/investigations` yang mengembalikan daftar investigasi dengan pagination (query params: `page`, `limit`, default limit 20).

2. THE API Server SHALL mendukung filter pada endpoint `GET /api/investigations` melalui query params:
   - `classification` — filter by classification value
   - `company_detected` — filter by boolean (true/false)
   - `confidence_min` — filter confidence_score >= nilai
   - `confidence_max` — filter confidence_score <= nilai
   - `date_from` — filter observed_at >= tanggal (format ISO 8601)
   - `date_to` — filter observed_at <= tanggal (format ISO 8601)
   - `q` — full-text search pada email, business_name, person_name

3. THE API Server SHALL mengembalikan response `GET /api/investigations` dalam format JSON:
   ```json
   {
     "data": [{
       "id", "email", "email_domain", "classification",
       "company_detected", "confidence_score", "confidence_label",
       "automation_action", "business_name", "person_name",
       "location_city", "observed_at"
     }],
     "total": <integer>,
     "page": <integer>,
     "limit": <integer>
   }
   ```

4. THE API Server SHALL menyediakan endpoint `GET /api/investigations/:id` yang mengembalikan detail lengkap satu investigasi, termasuk:
   - Semua kolom dari tabel `investigations`
   - Array `evidence_items`
   - Array `marketplace_profiles`
   - Array `social_profiles`
   - Array `role_evidence`
   - Field `ai_narrative` (teks AI lengkap)

5. THE API Server SHALL menyediakan endpoint `GET /api/investigations/by-email/:email` yang mengembalikan semua investigasi untuk email tertentu, diurutkan dari terbaru.

6. THE API Server SHALL mengembalikan HTTP 404 dengan body `{"error": "not found"}` ketika investigasi dengan ID atau email yang diminta tidak ditemukan.

7. THE API Server SHALL mengembalikan HTTP 400 dengan pesan error yang deskriptif ketika query params tidak valid (misalnya format tanggal salah, nilai non-integer untuk confidence).

8. THE API Server SHALL membaca port dari environment variable `API_PORT` (default: 8080).

9. THE API Server SHALL menambahkan CORS header `Access-Control-Allow-Origin: *` pada semua response untuk mendukung akses dari browser dashboard.

---

### Requirement 6: Web Dashboard — Halaman List Investigasi

**User Story:** Sebagai operator internal, saya ingin melihat daftar semua investigasi di web browser, sehingga saya bisa memonitor hasil Company Detection tanpa harus SSH ke VPS dan membaca file JSON.

#### Acceptance Criteria

1. THE Dashboard SHALL menampilkan halaman list investigasi yang memuat tabel dengan kolom: tanggal, email, domain, classification, confidence score, company detected, business name, dan automation action.

2. THE Dashboard SHALL menampilkan badge warna berbeda untuk setiap classification:
   - `possible_company_affiliated` → hijau
   - `likely_personal_email` → abu-abu
   - `unknown_needs_more_evidence` → kuning
   - `suspicious_or_invalid` → merah

3. THE Dashboard SHALL mendukung filter di halaman list: classification, company_detected, confidence range, dan date range.

4. THE Dashboard SHALL mendukung search box yang memfilter berdasarkan email, business name, atau person name.

5. THE Dashboard SHALL menampilkan pagination dengan navigasi halaman sebelumnya/berikutnya.

6. WHEN user mengklik satu baris di tabel, THE Dashboard SHALL menavigasi ke halaman detail investigasi tersebut.

7. THE Dashboard SHALL menampilkan total jumlah investigasi yang sesuai filter aktif.

---

### Requirement 7: Web Dashboard — Halaman Detail Investigasi

**User Story:** Sebagai operator internal, saya ingin melihat detail lengkap satu investigasi termasuk narasi AI, sehingga saya bisa memahami reasoning di balik classification tanpa membuka file JSON secara manual.

#### Acceptance Criteria

1. THE Dashboard SHALL menampilkan halaman detail yang memuat section-section berikut:
   - **Header**: email, classification badge, confidence score, tanggal investigasi
   - **Input Snapshot**: email, full_name, brand_name, phone_hash (jika ada)
   - **Classification Result**: classification, company_detected, confidence_score, confidence_label, automation_action, owner_claim_allowed
   - **Business Profile**: business_name, business_domain, business_website, business_description, business_industry (jika ada)
   - **Person Profile**: person_name, person_role, phone_match_status (jika ada)
   - **Marketplace**: tabel marketplace_profiles (jika ada)
   - **Social Media**: daftar social_profiles dengan link (jika ada)
   - **Location**: city, address, maps_url (jika ada)
   - **Role Evidence**: daftar role_evidence quotes (jika ada)
   - **Evidence Items**: tabel semua evidence_items dengan source_type, claim, reliability, confidence_delta
   - **AI Narrative**: teks lengkap `ai_narrative` dalam pre-formatted block
   - **AI Summary & Recommendation**: `ai_summary` dan `ai_recommendation`

2. THE Dashboard SHALL menampilkan link yang bisa diklik untuk semua URL (source_url, marketplace URL, social media URL, maps_url).

3. THE Dashboard SHALL menampilkan tombol "Back to List" yang kembali ke halaman list dengan filter yang sebelumnya aktif.

4. WHEN section tidak memiliki data (misalnya tidak ada marketplace_profiles), THE Dashboard SHALL menyembunyikan section tersebut atau menampilkan pesan "Tidak ada data".

5. THE Dashboard SHALL menampilkan confidence score sebagai progress bar visual di samping angka numerik.

---

### Requirement 8: Integrasi dengan Pipeline Go yang Ada

**User Story:** Sebagai developer, saya ingin DB writer terintegrasi ke pipeline Go yang sudah ada dengan perubahan minimal, sehingga investigasi yang sudah berjalan tetap berfungsi dan DB storage adalah tambahan opsional.

#### Acceptance Criteria

1. THE System SHALL menambahkan flag `--save-db` pada command `company-check` yang mengaktifkan DB writer (terpisah dari `--save` yang sudah ada untuk file writer).

2. WHEN `--save-db` flag aktif dan `DATABASE_URL` tersedia, THE System SHALL menyimpan hasil ke DB setelah file evidence ditulis.

3. THE System SHALL menambahkan field `db_id` ke `StoredPaths` struct yang berisi UUID dari row yang disimpan di database (jika DB write berhasil).

4. THE System SHALL menyediakan command baru `cmd/api-server/main.go` yang menjalankan HTTP API server secara terpisah dari command `company-check`.

5. THE System SHALL menggunakan library `pgx/v5` untuk koneksi PostgreSQL (tidak menggunakan ORM).

6. THE System SHALL menyertakan file `go.sum` yang ter-update setelah penambahan dependency baru.

---

### Requirement 9: Keamanan dan Data Privacy

**User Story:** Sebagai operator, saya ingin data sensitif pengguna ditangani dengan aman, sehingga sistem mematuhi prinsip data minimization.

#### Acceptance Criteria

1. THE System SHALL menyimpan nomor HP hanya sebagai SHA-256 hash di kolom `phone_hash` — plaintext nomor HP tidak boleh ada di database.

2. THE Dashboard SHALL tidak menampilkan `phone_hash` di UI — field ini hanya untuk keperluan matching internal.

3. THE API Server SHALL tidak mengekspos endpoint yang memungkinkan search berdasarkan nomor HP.

4. THE Dashboard SHALL hanya dapat diakses dari jaringan internal (tidak ada autentikasi di MVP, tapi deployment harus di-bind ke localhost atau internal network, bukan 0.0.0.0 tanpa firewall).

5. THE API Server SHALL tidak menyertakan plaintext `no_hp` dari input dalam response JSON apapun.

---

### Requirement 10: Observability dan Error Handling

**User Story:** Sebagai developer, saya ingin sistem mencatat error DB dengan jelas tanpa mengganggu alur investigasi utama, sehingga kegagalan DB tidak menyebabkan investigasi gagal.

#### Acceptance Criteria

1. IF DB write gagal karena koneksi error, THEN THE DB Writer SHALL mencatat error ke stderr dengan format `[db-writer] error: <detail>` dan melanjutkan eksekusi tanpa panic.

2. THE DB Writer SHALL mencatat log sukses ke stdout dengan format `[db-writer] saved investigation <uuid> for <email>` setelah berhasil menyimpan.

3. THE API Server SHALL mengembalikan HTTP 500 dengan body `{"error": "internal server error"}` (tanpa detail internal) ketika terjadi error database pada saat melayani request.

4. THE API Server SHALL mencatat semua request ke stdout dengan format: `<method> <path> <status_code> <latency_ms>ms`.

5. WHEN API Server gagal terhubung ke database saat startup, THE API Server SHALL mencetak error ke stderr dan exit dengan kode 1.

