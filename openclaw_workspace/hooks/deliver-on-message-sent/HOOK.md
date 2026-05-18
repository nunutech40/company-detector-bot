---
name: deliver-on-message-sent
description: "Trigger Slack delivery setiap kali AI mengirim reply ke Telegram. Memastikan Slack selalu dapat report yang sama dengan Telegram tanpa bergantung AI untuk jalankan script."
metadata:
  { "openclaw": { "emoji": "📤", "events": ["message:sent"] } }
---

# Deliver on Message Sent

Setiap kali AI mengirim pesan ke Telegram, hook ini trigger `deliver_report_with_env.sh`
untuk kirim report yang sama ke Slack.

## Status
⏳ PLACEHOLDER — implementasi besok

## Rencana implementasi
- Event: `message:sent`
- Trigger: setiap kali ada outbound message ke Telegram channel
- Action: jalankan `deliver_report_with_env.sh` di background
- Filter: hanya trigger kalau message mengandung "Company Detection Report"
  (bukan setiap pesan biasa)

## File yang perlu dibuat
- `handler.ts` — implementasi hook
