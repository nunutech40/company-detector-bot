# Register Webhook API

**Status:** implemented  
**Runtime:** VPS webhook service on port `3002`  
**Purpose:** menerima data register dari platform, menaruhnya ke antrian PostgreSQL, lalu diproses worker satu per satu.

---

## Base URL

```text
http://103.226.139.107:3002
```

Health check:

```text
GET /health
```

Register intake:

```text
POST /webhook/check
```

Webhook ini tidak menjalankan investigasi berat di dalam HTTP request. Response hanya memastikan payload sudah diterima/masuk antrian. Investigasi berjalan async lewat worker.

---

## Authentication

Gunakan salah satu header berikut:

```http
Authorization: Bearer <WEBHOOK_SECRET>
```

atau:

```http
X-Webhook-Secret: <WEBHOOK_SECRET>
```

`secret` di body masih diterima untuk kompatibilitas, tapi header lebih disarankan.

---

## Request Body

Field canonical yang disarankan:

```json
{
  "email": "buyer@example.com",
  "full_name": "Nama User",
  "brand_name": "Nama Toko",
  "no_hp": "08123456789",
  "source": "platform_register",
  "external_id": "register-user-id-123",
  "idempotency_key": "platform_register:register-user-id-123"
}
```

Required:

- `email`

Optional tapi sangat berguna:

- `full_name`
- `brand_name`
- `no_hp`
- `source`
- `external_id`
- `idempotency_key`

Alias yang diterima runtime:

| Canonical | Alias diterima |
|---|---|
| `email` | `Email`, `mail` |
| `full_name` | `fullName`, `name`, `nama` |
| `brand_name` | `brandName`, `company_field`, `company`, `brand` |
| `no_hp` | `noHp`, `phone`, `hp` |
| `external_id` | `externalId`, `id`, `user_id`, `userId` |
| `idempotency_key` | `idempotencyKey` |

Payload boleh membawa metadata tambahan dari register. Metadata itu disimpan di `payload_json` untuk traceability, selama ukurannya wajar.

---

## Response

Payload baru:

```json
{
  "ok": true,
  "queued": true,
  "duplicate": false,
  "intake_job_id": "0c3c2f66-2df5-4c7a-a2a4-4b4f9f5eac1e",
  "status": "pending",
  "email": "buyer@example.com",
  "dashboard_url": "http://103.226.139.107:3001"
}
```

HTTP status:

- `202 Accepted` untuk payload baru yang berhasil masuk antrian.
- `200 OK` jika payload duplicate berdasarkan `idempotency_key`.
- `400 Bad Request` jika `email` kosong/tidak valid.
- `401 Unauthorized` jika secret salah.
- `503 Service Unavailable` jika database webhook belum terkonfigurasi.

---

## Idempotency

Register sebaiknya mengirim `idempotency_key` stabil per event/user.

Rekomendasi:

```text
platform_register:<external_id>
```

Jika `idempotency_key` tidak dikirim, sistem membuat fallback:

```text
<source>:<email>:<tanggal>
```

Fallback ini cukup untuk mencegah spam harian, tapi tidak sepresisi ID register asli.

---

## Processing Behavior

Alur setelah request diterima:

```text
Platform Register
-> POST /webhook/check
-> PostgreSQL register_intake_jobs status=pending
-> sequential worker ambil satu job
-> OpenClaw investigation
-> provider transient error: retry_pending + exponential backoff
-> provider auth/credit/model error: blocked_provider sampai config diperbaiki
-> finish_investigation.sh
-> PostgreSQL result tables + dashboard
-> Telegram report wajib terkirim
-> Sales Sheet web ter-update dari DB
-> Slack digest jam 09:00 mengarah ke Sales Sheet
```

Volume target sekitar 100 register/hari, jadi worker sengaja jalan sequential supaya lebih mudah dipantau dan tidak membanjiri tool/search/LLM.

Queue tidak membuang job saat AI bermasalah. Worker mengirim satu Telegram alert
saat insiden provider dibuka dan satu recovery alert setelah investigasi real
berhasil lagi. Timer `company-register-worker-health.timer` mengirim alert terpisah
jika service worker mati dan recovery ketika service aktif kembali.

Operasi manual:

```bash
cd ~/.openclaw/webhook
node worker.js status
node worker.js replay-provider-failures --since-hours 72
```

Nomor HP disimpan masked di kolom queue utama, tetapi raw payload tetap disimpan di `payload_json`. Sales Sheet memakai raw phone dari payload jika tersedia, karena sales butuh nomor penuh untuk follow-up.

---

## cURL Example

```bash
curl -X POST http://103.226.139.107:3002/webhook/check \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <WEBHOOK_SECRET>" \
  -d '{
    "email": "buyer@example.com",
    "full_name": "Nama User",
    "brand_name": "Nama Toko",
    "no_hp": "08123456789",
    "source": "platform_register",
    "external_id": "register-user-id-123",
    "idempotency_key": "platform_register:register-user-id-123"
  }'
```
