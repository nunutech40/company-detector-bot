---
name: deliver-on-message-sent
description: "No-op guard. Telegram delivery stays active, but Slack realtime forwarding is disabled."
metadata:
  { "openclaw": { "emoji": "📤", "events": ["message:sent"] } }
---

# Deliver on Message Sent

Slack realtime forwarding sengaja dimatikan.

Telegram adalah delivery wajib untuk tiap investigasi, tetapi Slack hanya boleh
menerima digest prospect dari PostgreSQL:

- daily digest jam 09:00 WIB, atau
- manual digest khusus testing.

Hook ini tetap ada sebagai guard no-op supaya event `message:sent` tidak
mengirim raw AI report ke Slack.
