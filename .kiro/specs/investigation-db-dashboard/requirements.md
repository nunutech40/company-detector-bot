# Requirements Document

## Introduction

Fitur ini menambahkan lapisan persistensi dan antarmuka web pada Company Detection Agent. Saat ini hasil investigasi disimpan sebagai file JSON di `/evidence/` dan dikirim ke Telegram sebagai teks panjang. Fitur ini memperkenalkan database relasional untuk menyimpan hasil investigasi per field (bukan satu blob JSON), serta web dashboard untuk menampilkan daftar investigasi, filter, dan detail lengkap termasuk narasi AI.

Dua komponen utama:
1. **Database Storage** — Go service menyimpan hasil investigasi ke database setelah setiap investigasi selesai.
2. **Web Dashboard** — antarmuka web untuk menelusuri, memfilter, dan melihat detail investigasi.

## Glossary

- **Investigation**: Satu sesi investigasi terhadap satu email, menghasilkan satu `CompanyCheckResult`. Diidentifikasi oleh `investigation_id` (UUID).
- **Subject**: Entitas yang diinvestigasi — email, nama, nomor HP.
- **Classification**: Hasil klasifikasi AI: `possible_company_affiliated`, `unknown_needs_more_evidence`, `likely_personal_email`, `suspicious_or_invalid`.
- **Confidence Score**: Nilai integer 0–100 yang merepresentasikan keyakinan sistem terhadap klasifikasi.
- **AI Report**: Teks naratif lengkap yang dihasilkan AI, disimpan di field `telegram_report` atau `ai_report` pada JSON output.
- **Evidence Item**: Satu butir bukti yang mendukung atau mengurangi confidence score, berisi `source_type`, `claim`, `reliability`, dan `confidence_delta`.
- **Audit Trail**: Riwayat semua investigasi terhadap email yang sama, diurutkan berdasarkan waktu.
- **Dashboard**: Antarmuka web yang menampilkan daftar dan detail investigasi.
- **DB Writer**: Komponen Go yang bertanggung jawab menyimpan hasil investigasi ke database.
- **API Server**: HTTP server Go yang menyajikan data investigasi ke Dashboard.
- **Marketplace Entry**: Satu entri platform marketplace (Tokopedia, Shopee, Lazada, dll) yang ditemukan selama investigasi.
- **Social Media Entry**: Satu entri platform media sosial (Instagram, LinkedIn, Facebook, TikTok, dll) yang ditemukan selama investigasi.

## Requirements

### Requirement 1: Penyimpanan Investigasi ke Database

**User Story:** Sebagai operator sistem, saya ingin setiap hasil investigasi disimpan ke database secara otomatis, sehingga data dapat di-query, difilter, dan ditampilkan di web tanpa bergantung pada file JSON.

#### Acceptance Criteria

1. WHEN sebuah investigasi selesai dan menghasilkan `CompanyCheckResult` yang valid, THE DB_Writer SHALL menyimpan hasil investigasi ke database dalam satu transaksi atomik.
2. THE DB_Writer SHALL menyimpan field-field berikut sebagai kolom terpisah pada tabel `investigations`: `investigation_id` (UUID), `email`, `full_name`, `no_hp_masked`, `classification`, `confidence_score`, `confidence_label`, `company_detected`, `automation_action`, `ai_report`, `summary`, `recommendation`, `observed_at`.
3. THE DB_Writer SHALL menyimpan data bisnis (`business_name`, `business_domain`, `business_website`, `business_description`, `business_industry`) sebagai kolom pada tabel `investigations`.
4. THE DB_Writer SHALL menyimpan setiap `Marketplace Entry` sebagai baris terpisah pada tabel `investigation_marketplaces` yang berelasi ke `investigation_id`.
5. THE DB_Writer SHALL menyimpan setiap `Social Media Entry` sebagai baris terpisah pada tabel `investigation_social_media` yang berelasi ke `investigation_id`.
6. THE DB_Writer SHALL menyimpan setiap `Evidence Item` sebagai baris terpisah pada tabel `investigation_evidence` yang berelasi ke `investigation_id`.
7. THE DB_Writer SHALL menyimpan data person (`person_name`, `person_role`, `phone_confirmed`) sebagai kolom pada tabel `investigations`.
8. THE DB_Writer SHALL menyimpan data lokasi (`location_city`, `location_address`, `location_maps_url`) sebagai kolom pada tabel `investigations`.
9. THE DB_Writer SHALL menyimpan daftar `tools_used`, `tools_skipped`, dan `tools_failed` sebagai JSON array pada kolom bertipe teks di tabel `investigations`.
10. IF penyimpanan ke database gagal, THEN THE DB_Writer SHALL mencatat error ke log dan TIDAK menghentikan pengiriman laporan ke Telegram — penyimpanan database bersifat non-blocking terhadap alur investigasi yang sudah ada.
11. THE DB_Writer SHALL menggunakan `email` + `observed_at` sebagai kombinasi unik untuk mencegah duplikasi data pada penyimpanan ulang.

---

### Requirement 2: API untuk Mengakses Data Investigasi

**User Story:** Sebagai Dashboard, saya ingin mengakses data investigasi melalui HTTP API, sehingga dapat menampilkan daftar dan detail investigasi tanpa akses langsung ke database.

#### Acceptance Criteria

1. THE API_Server SHALL menyediakan endpoint `GET /api/investigations` yang mengembalikan daftar investigasi dalam format JSON, diurutkan berdasarkan `observed_at` descending.
2. WHEN parameter query `classification` diberikan pada `GET /api/investigations`, THE API_Server SHALL memfilter hasil hanya untuk investigasi dengan classification yang sesuai.
3. WHEN parameter query `min_confidence` atau `max_confidence` diberikan, THE API_Server SHALL memfilter hasil berdasarkan rentang `confidence_score`.
4. WHEN parameter query `email` diberikan, THE API_Server SHALL memfilter hasil berdasarkan kecocokan parsial (case-insensitive) pada field email.
5. THE API_Server SHALL mendukung paginasi pada `GET /api/investigations` melalui parameter `page` dan `page_size`, dengan nilai default `page=1` dan `page_size=20`.
6. THE API_Server SHALL menyediakan endpoint `GET /api/investigations/{investigation_id}` yang mengembalikan detail lengkap satu investigasi, termasuk semua relasi (marketplace, social_media, evidence).
7. THE API_Server SHALL menyertakan field `ai_report` (teks naratif lengkap) pada response `GET /api/investigations/{investigation_id}`.
8. THE API_Server SHALL menyediakan endpoint `GET /api/investigations/by-email/{email}` yang mengembalikan semua investigasi untuk email tertentu, diurutkan berdasarkan `observed_at` descending, sebagai Audit Trail.
9. IF `investigation_id` tidak ditemukan pada `GET /api/investigations/{investigation_id}`, THEN THE API_Server SHALL mengembalikan HTTP 404 dengan body JSON `{"error": "not found"}`.
10. THE API_Server SHALL mengembalikan HTTP 200 dengan array kosong `[]` (bukan error) ketika query filter tidak menghasilkan data.
11. THE API_Server SHALL menyertakan header `Content-Type: application/json` pada semua response API.

---

### Requirement 3: Tampilan Daftar Investigasi (List View)

**User Story:** Sebagai operator, saya ingin melihat daftar semua investigasi di web dashboard, sehingga saya dapat dengan cepat menemukan dan meninjau investigasi yang relevan.

#### Acceptance Criteria

1. THE Dashboard SHALL menampilkan daftar investigasi dalam bentuk tabel atau kartu, dengan kolom: `email`, `full_name` (jika ada), `classification`, `confidence_score`, `company_detected`, dan `observed_at`.
2. THE Dashboard SHALL menampilkan badge berwarna untuk setiap nilai `classification`: hijau untuk `possible_company_affiliated`, abu-abu untuk `likely_personal_email`, kuning untuk `unknown_needs_more_evidence`, merah untuk `suspicious_or_invalid`.
3. THE Dashboard SHALL menyediakan filter dropdown untuk `classification` yang memungkinkan operator memilih satu atau lebih nilai classification.
4. THE Dashboard SHALL menyediakan filter rentang `confidence_score` (slider atau input min/max) untuk menyaring investigasi berdasarkan confidence.
5. THE Dashboard SHALL menyediakan input pencarian teks untuk memfilter berdasarkan `email`.
6. THE Dashboard SHALL menampilkan total jumlah investigasi yang sesuai dengan filter aktif.
7. THE Dashboard SHALL mendukung paginasi dengan navigasi halaman (previous/next dan nomor halaman).
8. WHEN operator mengklik satu baris investigasi, THE Dashboard SHALL menavigasi ke halaman detail investigasi tersebut.
9. THE Dashboard SHALL memuat ulang daftar secara otomatis ketika filter diubah, tanpa memerlukan reload halaman penuh.

---

### Requirement 4: Tampilan Detail Investigasi (Detail View)

**User Story:** Sebagai operator, saya ingin melihat semua informasi terstruktur dari satu investigasi beserta narasi AI lengkap, sehingga saya dapat memahami dasar pengambilan keputusan klasifikasi.

#### Acceptance Criteria

1. THE Dashboard SHALL menampilkan semua field terstruktur dari investigasi: data subject (email, nama, HP masked), klasifikasi, confidence score, data bisnis, data person, data lokasi.
2. THE Dashboard SHALL menampilkan daftar `Marketplace Entry` (platform + URL) sebagai daftar dengan tautan yang dapat diklik.
3. THE Dashboard SHALL menampilkan daftar `Social Media Entry` (platform + URL + bio) sebagai daftar dengan tautan yang dapat diklik.
4. THE Dashboard SHALL menampilkan daftar `Evidence Item` dengan field `source_type`, `claim`, `reliability`, dan `confidence_delta` (ditampilkan dengan tanda + atau - untuk menunjukkan arah pengaruh).
5. THE Dashboard SHALL menampilkan `ai_report` (narasi AI lengkap) dalam area teks yang dapat di-scroll, dengan format yang mempertahankan line break.
6. THE Dashboard SHALL menampilkan daftar `tools_used`, `tools_skipped`, dan `tools_failed` sebagai tiga kelompok terpisah.
7. THE Dashboard SHALL menyediakan tombol "Lihat Audit Trail" yang menavigasi ke tampilan semua investigasi untuk email yang sama.
8. THE Dashboard SHALL menampilkan `observed_at` dalam format tanggal dan waktu lokal yang dapat dibaca manusia (bukan ISO string mentah).
9. THE Dashboard SHALL menyediakan tombol kembali ke daftar investigasi.

---

### Requirement 5: Audit Trail per Email

**User Story:** Sebagai operator, saya ingin melihat riwayat semua investigasi untuk satu email tertentu, sehingga saya dapat melacak perubahan klasifikasi dari waktu ke waktu.

#### Acceptance Criteria

1. THE Dashboard SHALL menampilkan halaman Audit Trail yang menampilkan semua investigasi untuk satu email, diurutkan dari yang terbaru ke yang terlama.
2. THE Dashboard SHALL menampilkan perubahan `classification` dan `confidence_score` antar investigasi secara berurutan, sehingga operator dapat melihat tren.
3. WHEN hanya ada satu investigasi untuk email tersebut, THE Dashboard SHALL menampilkan satu entri tanpa indikator perubahan.
4. THE Dashboard SHALL menampilkan jumlah total investigasi untuk email tersebut di bagian atas halaman Audit Trail.
5. WHEN operator mengklik satu entri di Audit Trail, THE Dashboard SHALL menavigasi ke halaman detail investigasi tersebut.

---

### Requirement 6: Integrasi DB Writer ke Alur Investigasi Go CLI

**User Story:** Sebagai developer, saya ingin DB Writer terintegrasi ke alur `company-check` yang sudah ada, sehingga setiap investigasi otomatis tersimpan ke database tanpa mengubah perilaku CLI yang sudah berjalan.

#### Acceptance Criteria

1. WHEN `company-check` binary dijalankan dengan flag `--save`, THE DB_Writer SHALL dipanggil setelah penyimpanan file JSON yang sudah ada, secara non-blocking.
2. THE DB_Writer SHALL membaca konfigurasi koneksi database dari environment variable `DATABASE_URL`, bukan dari hardcoded string.
3. IF environment variable `DATABASE_URL` tidak di-set, THEN THE DB_Writer SHALL melewati penyimpanan database dan mencatat pesan info ke log — CLI tetap berjalan normal.
4. THE DB_Writer SHALL menggunakan connection pool dengan maksimum 10 koneksi untuk menghindari resource exhaustion.
5. THE DB_Writer SHALL menyelesaikan operasi penyimpanan dalam waktu tidak lebih dari 5 detik; IF melebihi batas waktu tersebut, THEN THE DB_Writer SHALL membatalkan operasi dan mencatat timeout error ke log.
