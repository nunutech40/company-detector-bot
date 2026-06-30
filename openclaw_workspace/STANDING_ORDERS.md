# Standing Orders — Company Detection Agent

Standing orders ini di-inject ke setiap session via referensi dari AGENTS.md.
AI wajib mengikutinya tanpa perlu diingatkan.

---

## Program: Investigation Completion

**Authority:** Setelah selesai investigasi, simpan evidence dan trigger delivery.
**Trigger:** Setiap kali investigasi `/check` selesai.
**Approval gate:** Tidak ada — jalankan otomatis.

### Execution steps (wajib, tidak boleh di-skip)

1. Jalankan investigasi sampai selesai (confidence cukup atau budget habis)
2. Jalankan `finish_investigation.sh` untuk save evidence:
   ```bash
   bash scripts/finish_investigation.sh \
     --email <email> \
     [--full-name "<name>"] \
     [--no-hp "<phone>"] \
     [--brand-name "<brand_yang_ditemukan>"] \
     --report "<isi report>"
   ```
3. Verifikasi: pastikan selesai tanpa error
4. Untuk queue register, jangan menambahkan token usage sendiri. Worker mengirim
   usage file per-job ke finalizer dan finalizer menambahkan satu blok token yang
   hanya berisi model/job tersebut.

> **Note:** Slack delivery sekarang otomatis dengan smart routing — bisnis confidence >= 75 → kirim Slack, personal/unknown → DB only. Tidak perlu setting manual.

### Execute-Verify-Report

Setiap task harus:
- **Execute** — jalankan, jangan hanya acknowledge
- **Verify** — konfirmasi selesai (cek output, tidak ada error)
- **Report** — laporkan ke user apa yang sudah dilakukan

"Done" tanpa verifikasi tidak acceptable.

### What NOT to do

- Jangan skip `finish_investigation.sh` — evidence tidak tersimpan dan Slack tidak terkirim
- Jangan karang evidence tanpa tool output
- Jangan claim founder/owner tanpa 2+ sumber independen
- Jangan retry lebih dari 3x kalau tool gagal — laporkan dan lanjut

### Escalation

- Kalau `finish_investigation.sh` gagal → report error ke user, jangan diam
- Kalau semua search provider gagal → laporkan di report dengan harga setup

---

## Program: Token Tracking

**Authority:** Token usage final harus berasal dari usage job yang sedang selesai,
bukan agregasi seluruh session OpenClaw.
**Trigger:** Otomatis oleh queue worker/finalizer.

### Execution steps

1. Queue worker menjalankan `token_usage.sh --usage-file <job-usage.json>`.
2. Tampilkan hanya satu blok provider/model yang dipakai job tersebut.
3. `bash scripts/token_usage.sh` tanpa usage file hanya untuk diagnosis session
   model aktif. Gunakan `--all-sessions` hanya saat audit historis.
   Contoh output:
   Contoh output (isi sesuai model yang benar-benar dipakai):
   ```
   ───
   LLM       : 9router/komerce-1.2 [ACTIVE]
   Token job : 12,450 input + 3,210 output = 15,660 total
   Scope     : job investigasi ini
   Biaya     : tidak diketahui (pricing tidak ada di config)
   ──────────────────────────────────────────────────
   ```
   Jangan tampilkan provider/model historis pada report job baru.
