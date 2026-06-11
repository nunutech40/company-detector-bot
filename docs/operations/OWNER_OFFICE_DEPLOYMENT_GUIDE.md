# Panduan Pemilik Sistem: Pindah Company Detector ke Server Kantor

Dokumen ini adalah patokan untuk pemilik Company Detector. Gunakan dokumen ini
untuk menyiapkan kebutuhan, menyerahkan deployment ke engineer kantor, dan
memutuskan apakah server baru sudah layak menggantikan VPS lama.

## Dokumen yang Diserahkan ke Engineer Kantor

Serahkan file berikut:

```text
docs/handover/COMPANY_DETECTOR_DOCKER_DEPLOYMENT_HANDOVER.docx
```

Sebelum diserahkan, pastikan DOCX sudah diregenerasi dari runbook terbaru dan
tidak sedang terbuka/ter-lock di Word. Jika belum, serahkan
`docs/technical/DOCKER_DEPLOYMENT_RUNBOOK.md` sebagai sumber teknis utama.

Berikan juga akses read ke repository:

```text
https://github.com/nunutech40/company-detector-bot
branch: main
```

Jangan menyerahkan `.env` melalui Git, chat umum, screenshot, atau dokumen Word.
Secret diberikan melalui password manager atau secure channel yang disetujui.

## Yang Harus Kamu Siapkan

- [ ] Tentukan domain atau URL server kantor untuk dashboard dan webhook.
- [ ] Pastikan engineer kantor dapat clone repository.
- [ ] Siapkan nilai secret berdasarkan `docs/technical/DEPLOYMENT_SECRETS_HANDOVER.md`.
- [ ] Siapkan final PostgreSQL dump dari VPS lama agar data investigasi tidak hilang.
- [ ] Tentukan waktu cutover agar VPS lama dan server kantor tidak memproses job bersamaan.
- [ ] Siapkan satu data nyata untuk acceptance test: email wajib; nama, brand, dan nomor WA opsional.
- [ ] Putuskan apakah fitur opsional Google Review Monitor akan diaktifkan.
- [ ] Jika diaktifkan, siapkan direct Google Maps URL, target Telegram, dan
      authenticated browser storage-state melalui secure channel.

## Secret yang Harus Diberikan Secara Aman

- `POSTGRES_PASSWORD` atau credential database kantor.
- `WEBHOOK_SECRET`.
- `LLM_API_KEY`.
- `TELEGRAM_DEFAULT_BOT_TOKEN`.
- `REGISTER_WORKER_TELEGRAM_TO`.
- `SLACK_BOT_TOKEN`.
- `SLACK_REPORT_CHANNEL`.
- Search API key jika tersedia.
- `BRAVE_SEARCH_API_KEY` wajib agar kemampuan pencarian setara VPS.
- `DEEPSEEK_API_KEY` dan `MINIMAX_API_KEY` untuk fallback provider setara VPS.

Jangan menulis nilai secret asli di dokumen atau repository.

## Yang Harus Diminta dari Engineer Kantor

- [ ] Docker dan Docker Compose tersedia.
- [ ] Seluruh service berjalan: `postgres`, `dashboard`, `webhook`, `worker`, `gateway`, `digest`.
- [ ] Reverse proxy dan HTTPS tersedia untuk dashboard serta webhook.
- [ ] Backup database terjadwal dan diuji.
- [ ] Engineer menjalankan:

```bash
./ops/docker/verify-precutover.sh
./ops/docker/verify-deployment.sh
```

- [ ] Engineer mengirimkan output PASS/FAIL acceptance test.
- [ ] Engineer memberi URL dashboard dan webhook final.

## Acceptance Test yang Kamu Lakukan

Jangan menerima deployment hanya karena container berstatus running.

### Setup Telegram Server Kantor

Server kantor menggunakan bot Telegram production yang sama dengan VPS lama.
Berikan dua nilai berikut melalui secure channel:

```text
TELEGRAM_DEFAULT_BOT_TOKEN=<token bot Company Detector production>
REGISTER_WORKER_TELEGRAM_TO=<chat ID tujuan report>
```

Engineer memasukkan nilainya ke `.env`, lalu menjalankan:

```bash
docker compose up -d worker
# Gateway hanya dinyalakan saat poller VPS sudah dimatikan.
docker compose up -d gateway
```

Jangan menulis token atau chat ID ke Git maupun dokumen handover.

### Apakah VPS Lama Harus Dimatikan Saat Test?

Untuk acceptance test otomatis, VPS lama belum perlu dimatikan. Server kantor
hanya mengirim report keluar melalui bot yang sama. Gunakan data test yang jelas
agar report dari server kantor mudah dikenali.

Selama persiapan harian, jalankan `verify-precutover.sh`. Script ini tidak
menyalakan gateway Telegram dan tidak memanggil AI, sehingga VPS production
tetap aman. `verify-deployment.sh` dijalankan hanya pada jendela final test.

Namun, sebelum webhook platform dipindahkan ke server kantor:

- worker, webhook, dan digest VPS lama harus dimatikan;
- jangan menjalankan dua worker production untuk intake yang sama;
- jangan menjalankan dua Telegram gateway/poller untuk menerima chat manual
  menggunakan bot token yang sama.

Manual chat melalui Telegram hanya dapat diuji setelah Telegram gateway/poller
dipindahkan ke server kantor dan poller VPS lama dimatikan. Acceptance test
otomatis tetap dapat membuktikan outbound Telegram tanpa mematikan VPS.

1. Minta engineer menjalankan `./ops/docker/verify-deployment.sh`.
2. Berikan satu identitas nyata untuk dites.
3. Pastikan script berakhir dengan PASS.
4. Pastikan `Company Detection Report` masuk ke bot Telegram production yang benar.
5. Buka dashboard dan pastikan data test tampil.
6. Minta Slack digest `--test-run`; pastikan pesan masuk ke channel yang benar.
7. Uji investigasi manual melalui bot Telegram:

```text
Investigasi akun ini sampai selesai:
email: nama@example.com
full_name: Nama Lengkap
brand_name: Nama Brand
no_hp: 08123456789

Cari evidence bisnis dari public web dan social media yang tersedia.
Simpan hasil investigasi sesuai standing orders.
```

### Acceptance Opsional: Google Review Monitor

Review monitor tetap satu project, tetapi service, scheduler, state, dan
failure behavior-nya terisolasi dari investigation flow. Jangan menerimanya
hanya karena dummy Telegram berhasil.

- [ ] Engineer menjalankan authenticated collect dan collector melihat review cards.
- [ ] Review rating 1-3 tersimpan tanpa duplikasi.
- [ ] `test-send` masuk ke target Telegram yang benar.
- [ ] Limited view/CAPTCHA menghasilkan failure alert, bukan laporan kosong.
- [ ] Scheduler menunjukkan collect 21:00 dan send 09:00 WIB.
- [ ] Investigation worker dan OpenClaw tetap sehat setelah profile diaktifkan.

Fitur ini opt-in dan tidak menghalangi cutover Company Detector utama. Bila
authenticated Google Maps session belum siap, biarkan profile
`review-monitor` mati.

## Keputusan Cutover

Cutover hanya boleh dilakukan jika seluruh acceptance test berhasil.

Urutan:

1. Ambil final database dump dari VPS lama.
2. Restore dump ke server kantor.
3. Jalankan `verify-precutover.sh` dengan gateway kantor tetap mati.
4. Matikan gateway, worker, webhook, dan digest di VPS lama.
5. Nyalakan gateway kantor dan jalankan `verify-deployment.sh`.
6. Ubah URL webhook platform register ke server kantor.
7. Kirim satu register test terakhir.
8. Pastikan database, dashboard, Telegram, dan Slack berjalan.

Jika gagal setelah cutover, arahkan webhook kembali ke VPS lama dan hidupkan
kembali servicenya. Jangan menjalankan dua worker production bersamaan.

## Patokan Teknis Internal

Runbook teknis sumber utama di repository:

```text
docs/technical/DOCKER_DEPLOYMENT_RUNBOOK.md
docs/technical/DEPLOYMENT_SECRETS_HANDOVER.md
```

Dokumen tersebut dipakai untuk maintenance internal. File Word handover adalah
paket yang lebih nyaman untuk diserahkan kepada engineer kantor.
