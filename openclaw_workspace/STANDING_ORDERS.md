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
4. Tambahkan token usage di akhir report: `bash scripts/token_usage.sh`

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

**Authority:** Laporkan token usage setelah setiap investigasi.
**Trigger:** Setelah `finish_investigation.sh` selesai.

### Execution steps

1. Jalankan `bash scripts/token_usage.sh`
2. Tampilkan output-nya langsung di akhir reply ke user — format sudah dinamis dari script.
   Script otomatis baca model aktif dari `openclaw.json`, jadi kalau model diganti, output ikut berubah.
   Contoh output (isi sesuai model yang benar-benar dipakai):
   ```
   ───
   LLM      : deepseek/deepseek-chat [ACTIVE]
   Token    : 12,450 input + 3,210 output = 15,660 total
   Context  : 15,660 / 65,536 (23.9% used)
   Biaya    : ~$0.0069 USD  (input $0.0034 + output $0.0035)
   ──────────────────────────────────────────────────
   ```
   Kalau ada model lain yang juga dipakai di session yang sama, script akan tampilkan semua — model primary duluan dengan label `[ACTIVE]`.
