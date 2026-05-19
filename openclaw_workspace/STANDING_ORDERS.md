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
2. Jalankan `finish_investigation.sh` dengan semua parameter yang ditemukan:
   ```bash
   bash scripts/finish_investigation.sh \
     --email <email> \
     [--full-name "<name>"] \
     [--no-hp "<phone>"] \
     [--brand-name "<brand_yang_ditemukan>"] \
     --report "<isi report>"
   ```
3. Verifikasi: pastikan `finish_investigation.sh` selesai tanpa error
4. Tambahkan token usage di akhir report: `bash scripts/token_usage.sh`

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
2. Tampilkan di akhir reply ke user dalam format:
   ```
   ───
   LLM   : [model]
   Token : [input] input + [output] output = [total] total
   Biaya : ~$[estimasi USD]
   ```
