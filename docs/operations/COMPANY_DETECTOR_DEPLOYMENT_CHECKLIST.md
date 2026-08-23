# Company Detector Deployment Checklist

Panduan ini adalah urutan deploy untuk sysadmin/server engineer. Jalankan semua
command dari root repository. Panduan ini sengaja dibuat agar deployment dapat
dikerjakan manual oleh sysadmin; tidak membutuhkan AI agent untuk menjalankan
langkah deployment.

## 1. Komponen Yang Dideploy

Company Detector terdiri dari enam service jangka panjang dan satu migration
container sekali jalan:

| Urutan | Service | Fungsi | Wajib |
|---:|---|---|---|
| 1 | `postgres` | Database `company_detection` | Ya |
| 2 | `migrate` | Membuat/update schema database, lalu exit `0` | Ya |
| 3 | `dashboard` | Dashboard dan Sales Sheet, port internal `3001` | Ya |
| 4 | `webhook` | Menerima register dari platform, port internal `3002` | Ya |
| 5 | `worker` | Queue worker, Go tools, OpenClaw AI investigator | Ya |
| 6 | `digest` | Slack daily digest jam 09:00 WIB | Ya |
| 7 | `gateway` | OpenClaw Telegram inbound/manual chat | Ya untuk cutover Telegram |

Service optional:

- `review-monitor`: Google Business Profile monitor.
- `feedback-monitor-ingress` dan `feedback-monitor-worker`: Meta feedback monitor.

OpenClaw tidak dideploy sebagai container terpisah. Binary OpenClaw ada di
image `worker` dan `gateway`. AI model tetap diakses melalui provider eksternal
yang dikonfigurasi pada `.env`.

## 2. Dependency Dan Urutan Start

```text
postgres
  -> migrate
      -> dashboard
      -> webhook
      -> worker
      -> digest
      -> gateway (final cutover saja)
```

Jangan menjalankan `gateway` jika gateway Telegram lama masih aktif menggunakan
bot token yang sama.

## 3. Persiapan Server

Kebutuhan minimum:

- Docker Engine dan Docker Compose plugin.
- Git dan akses clone repository.
- Outbound HTTPS ke provider AI, Telegram, Slack, search provider, dan Docker registry.
- Reverse proxy HTTPS untuk dashboard dan webhook.
- Backup database dan policy backup volume.
- Recommended: minimal 4 GB RAM untuk full stack dengan OpenClaw; 2 GB hanya cocok untuk staging/pre-cutover dengan monitoring ketat.

Buat direktori deployment:

```bash
sudo install -d -m 750 -o "$USER" -g "$USER" /opt/company-detector
git clone --branch main --single-branch \
  https://github.com/nunutech40/company-detector-bot.git \
  /opt/company-detector
cd /opt/company-detector
```

Pastikan source yang dipakai memiliki file berikut:

```bash
test -f go-service/go.mod
test -f go-service/internal/evidence/evidence.go
test ! -d go-services
```

`go-service/internal/evidence/evidence.go` wajib ada. Jangan memakai checkout
lama yang memakai path `go-services`.

## 4. Isi `.env`

```bash
cp .env.docker.example .env
chmod 600 .env
```

Edit `.env`. Nilai `CHANGE_ME` wajib diganti.

### Runtime Dan URL

```env
DASHBOARD_BASE_URL=http://dashboard:3001
DASHBOARD_PUBLIC_BASE_URL=https://detector.example.com
PUBLIC_WEBHOOK_URL=https://detector.example.com/webhook/check
DASHBOARD_BIND_PORT=127.0.0.1:3001
WEBHOOK_BIND_PORT=127.0.0.1:3002
```

`PUBLIC_WEBHOOK_URL` adalah URL yang ditempelkan di platform Komerce. Jangan
gunakan `localhost` untuk URL public.

### Database Dan Webhook

```env
POSTGRES_PASSWORD=<password-database-kuat>
WEBHOOK_SECRET=<secret-yang-sama-dengan-platform-komerce>
```

Jika platform lama sudah memakai secret tertentu, pertahankan secret tersebut.
Jika secret dirotasi, update server dan platform dalam maintenance window yang
sama.

### OpenClaw Dan AI

```env
OPENCLAW_CONFIGURE=true
OPENCLAW_GATEWAY_AUTH_TOKEN=<random-token-kuat>
LLM_PROVIDER=9router
LLM_API=openai-completions
LLM_API_KEY=<api-key-9router>
LLM_BASE_URL=https://9router.komerce-tech.id/v1
LLM_PRIMARY_MODEL=9router/komerce-1.2
LLM_MODEL_ID=komerce-1.2
REGISTER_WORKER_MODE=agent
REGISTER_WORKER_DELIVER_TELEGRAM=true
```

### Telegram

```env
TELEGRAM_DEFAULT_BOT_TOKEN=<bot-token>
TELEGRAM_ALLOW_FROM=<chat-id-yang-diizinkan>
REGISTER_WORKER_TELEGRAM_TO=<chat-id-tujuan-report>
```

### Slack Dan Search

```env
SLACK_BOT_TOKEN=<slack-bot-token>
SLACK_REPORT_CHANNEL=<channel-id-atau-channel-yang-didukung>
BRAVE_SEARCH_API_KEY=<brave-api-key>
MINIMAX_API_KEY=<minimax-api-key>
DEEPSEEK_API_KEY=
```

`MINIMAX_API_KEY` dan `BRAVE_SEARCH_API_KEY` dibutuhkan untuk parity dengan
runtime VPS lama. Jangan menaruh nilai secret di Git, issue, chat umum, atau
output `docker compose config`.

## 5. Validasi Environment Dan Build

```bash
chmod 600 .env
docker compose config --quiet
docker compose build
```

Build membuat image yang sama untuk `dashboard`, `webhook`, `worker`, `digest`,
dan `gateway`. Itu tidak berarti semua container harus langsung dijalankan.

## 6. Start Pre-Cutover

Start database dan migration terlebih dahulu:

```bash
docker compose up -d postgres
docker compose run --rm migrate
```

Pastikan migration selesai dengan exit code `0`, kemudian start service utama:

```bash
docker compose up -d dashboard webhook worker digest
docker compose ps
```

Expected:

- `postgres`: healthy.
- `dashboard`: running.
- `webhook`: running.
- `worker`: running.
- `digest`: running.
- `gateway`: belum dijalankan.

Jika ingin satu command, dependency Compose juga mendukung:

```bash
docker compose up -d postgres migrate dashboard webhook worker digest
```

## 7. Verification Gate

Jalankan verification aman terlebih dahulu. Ini tidak menyalakan Telegram gateway
dan tidak menjalankan investigasi AI production:

```bash
./ops/docker/verify-precutover.sh
```

Health manual:

```bash
curl -fsS http://127.0.0.1:3002/health
curl -fsS http://127.0.0.1:3001/sales-sheet >/dev/null
docker compose exec -T worker openclaw --version
docker compose exec -T worker openclaw config validate
```

Pastikan reverse proxy meneruskan:

```text
https://detector.example.com/             -> dashboard:3001
https://detector.example.com/webhook/check -> webhook:3002/webhook/check
```

Jika reverse proxy juga berada di container, hubungkan service `dashboard` dan
`webhook` ke Docker network reverse proxy. Jika reverse proxy berjalan di host,
bind port ke loopback seperti contoh `.env` di atas.

## 8. Cutover Webhook Komerce

Sebelum mengubah platform:

1. Pastikan `verify-precutover.sh` PASS.
2. Pastikan `PUBLIC_WEBHOOK_URL` adalah URL server baru.
3. Test endpoint public memakai secret yang benar.
4. Pastikan webhook lama dan worker lama masih menjadi rollback path.

Kemudian ubah URL webhook di platform Komerce menjadi:

```text
https://detector.example.com/webhook/check
```

Payload lama tetap kompatibel. Field minimum:

```json
{
  "email": "user@example.com",
  "full_name": "Nama User",
  "brand_name": "Nama Brand",
  "no_hp": "08123456789",
  "external_id": "register-user-id",
  "idempotency_key": "platform_register:register-user-id",
  "secret": "WEBHOOK_SECRET"
}
```

Header `Authorization: Bearer <WEBHOOK_SECRET>` atau
`X-Webhook-Secret: <WEBHOOK_SECRET>` juga didukung.

Webhook hanya memasukkan data ke queue. Investigasi berat dijalankan oleh
`worker` secara asynchronous.

## 9. Telegram Cutover

Jangan menyalakan gateway baru saat gateway lama masih polling bot token yang
sama.

Pada maintenance window:

```bash
# Di server lama: stop gateway/poller Telegram
# Setelah benar-benar berhenti, di server baru:
docker compose up -d gateway
docker compose ps
docker compose exec -T gateway openclaw gateway health
./ops/docker/verify-deployment.sh
```

`verify-deployment.sh` menjalankan acceptance test AI dan menunggu report masuk.
Gunakan hanya setelah secret, provider AI, Telegram, dan Slack sudah dikonfirmasi.

## 10. Migrasi Database Lama

Jika history production harus dipertahankan:

```bash
pg_dump -Fc "$OLD_DATABASE_URL" -f company_detection.dump
```

Salin dump ke server baru, lalu sebelum worker memproses job:

```bash
docker compose stop worker gateway digest webhook dashboard
docker compose cp company_detection.dump postgres:/tmp/company_detection.dump
docker compose exec -T postgres pg_restore \
  -U company_detection \
  -d company_detection \
  --clean --if-exists \
  /tmp/company_detection.dump
docker compose run --rm migrate
docker compose up -d dashboard webhook worker digest
```

Jangan menjalankan `docker compose down -v` pada production karena akan
menghapus volume database.

## 11. Rollback

Jika acceptance test gagal:

1. Kembalikan URL webhook Komerce ke URL server lama.
2. Pastikan worker baru tidak memproses traffic production yang sama.
3. Hidupkan kembali service lama.
4. Simpan log dan status queue untuk investigasi.

Jangan menjalankan dua worker production pada database/queue yang sama.

## 12. Optional Services

Aktifkan hanya jika credential dan acceptance test sudah siap:

```bash
docker compose --profile review-monitor up -d review-monitor
docker compose --profile feedback-monitor up -d \
  feedback-monitor-ingress feedback-monitor-worker
```

Fitur optional tidak diperlukan untuk cutover register detector utama.

## 13. Post-Deploy Checklist

- [ ] Semua secret di `.env` sudah diisi dan file mode `600`.
- [ ] `docker compose config --quiet` PASS.
- [ ] `postgres` healthy.
- [ ] Migration exit code `0`.
- [ ] Dashboard, webhook, worker, dan digest running.
- [ ] OpenClaw config validate PASS.
- [ ] `/health` public dapat diakses melalui reverse proxy.
- [ ] Test webhook menghasilkan `202 Accepted` dan queue row masuk.
- [ ] Worker menyelesaikan satu acceptance investigation.
- [ ] Report masuk Telegram.
- [ ] Slack text dan digest dry-run berhasil.
- [ ] Backup database terjadwal dan diuji restore.
- [ ] Gateway lama baru dimatikan setelah gateway baru siap.
- [ ] URL webhook Komerce menunjuk ke server baru.
