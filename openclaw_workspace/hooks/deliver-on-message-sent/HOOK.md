---
name: deliver-on-message-sent
description: "Trigger Slack delivery setiap kali AI mengirim Company Detection Report ke Telegram. Memastikan Slack selalu dapat report yang sama tanpa bergantung AI untuk jalankan script."
metadata:
  { "openclaw": { "emoji": "📤", "events": ["message:sent"] } }
---

# Deliver on Message Sent

Setiap kali AI mengirim pesan ke Telegram yang mengandung "Company Detection Report",
hook ini trigger `deliver_report_with_env.sh` di background untuk kirim ke Slack.

## Cara kerja

1. Event `message:sent` fire setiap kali AI kirim outbound message
2. Hook cek apakah content mengandung "Company Detection Report"
3. Kalau ya → jalankan `deliver_report_with_env.sh` di background (fire-and-forget)
4. Kalau tidak → skip (pesan biasa tidak trigger delivery)

## Filter

Hanya trigger untuk pesan yang mengandung "Company Detection Report" —
bukan setiap pesan biasa dari AI.

## Dependency

- `deliver_report_with_env.sh` harus ada di workspace/scripts/
- `reports/ai_report_latest.txt` harus sudah diisi oleh AI sebelum pesan dikirim
