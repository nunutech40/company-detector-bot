# Panduan Pemilik Sistem: Pindah Company Detector ke Server Kantor

Dokumen ini adalah patokan untuk pemilik Company Detector. Gunakan dokumen ini
untuk menyiapkan kebutuhan, menyerahkan deployment ke engineer kantor, dan
memutuskan apakah server baru sudah layak menggantikan VPS lama.

## Dokumen yang Diserahkan ke Engineer Kantor

Serahkan file berikut:

```text
docs/handover/COMPANY_DETECTOR_DOCKER_DEPLOYMENT_HANDOVER.docx
```

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

## Secret yang Harus Diberikan Secara Aman

- `POSTGRES_PASSWORD` atau credential database kantor.
- `WEBHOOK_SECRET`.
- `LLM_API_KEY`.
- `TELEGRAM_DEFAULT_BOT_TOKEN`.
- `REGISTER_WORKER_TELEGRAM_TO`.
- `SLACK_BOT_TOKEN`.
- `SLACK_REPORT_CHANNEL`.
- Search API key jika tersedia.

Jangan menulis nilai secret asli di dokumen atau repository.

## Yang Harus Diminta dari Engineer Kantor

- [ ] Docker dan Docker Compose tersedia.
- [ ] Seluruh service berjalan: `postgres`, `dashboard`, `webhook`, `worker`, `digest`.
- [ ] Reverse proxy dan HTTPS tersedia untuk dashboard serta webhook.
- [ ] Backup database terjadwal dan diuji.
- [ ] Engineer menjalankan:

```bash
./ops/docker/verify-deployment.sh
```

- [ ] Engineer mengirimkan output PASS/FAIL acceptance test.
- [ ] Engineer memberi URL dashboard dan webhook final.

## Acceptance Test yang Kamu Lakukan

Jangan menerima deployment hanya karena container berstatus running.

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

## Keputusan Cutover

Cutover hanya boleh dilakukan jika seluruh acceptance test berhasil.

Urutan:

1. Ambil final database dump dari VPS lama.
2. Restore dump ke server kantor.
3. Jalankan acceptance test lagi.
4. Matikan worker, webhook, dan digest di VPS lama.
5. Ubah URL webhook platform register ke server kantor.
6. Kirim satu register test terakhir.
7. Pastikan database, dashboard, Telegram, dan Slack berjalan.

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
