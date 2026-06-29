# Systemd Units

Example user-level systemd units for Company Detector.

The server should also use nginx on port 80/443 as a public reverse proxy to the
dashboard on port 3001 and webhook on port 3002. This keeps Slack and platform
links simple:

```text
https://<server-domain>/sales-sheet
https://<server-domain>/webhook/check
```

The nginx config is stored at `ops/nginx/company-detector.conf`. UFW must allow
`80/tcp`.

These files are templates for VPS deployment. Install under:

```text
~/.config/systemd/user/
```

Units:

- `company-dashboard.service` runs the internal dashboard.
- `company-webhook.service` runs the register intake webhook API.
- `company-register-worker.service` runs the sequential queue worker.
- `company-ops-health.timer` checks both feature workers and queues every two
  minutes without calling AI. Confirmed incidents and recoveries are sent once
  to each feature's Slack channel.
- `company-register-backlog-replay.timer` returns at most 25 historical AI
  failures to the low-priority queue every six hours.
- `company-slack-digest.service` runs one digest send.
- `company-slack-digest.timer` triggers digest daily at 09:00.

Before enabling the timer, confirm the user manager timezone or host timezone.
The timer uses `02:00 UTC`, equivalent to `09:00 Asia/Jakarta`. The digest
service itself also sets `TZ=Asia/Jakarta` for message formatting.

Example commands on the server:

```bash
mkdir -p ~/.config/systemd/user
cp company-register-worker.service ~/.config/systemd/user/
cp company-ops-health.service ~/.config/systemd/user/
cp company-ops-health.timer ~/.config/systemd/user/
cp company-register-backlog-replay.service ~/.config/systemd/user/
cp company-register-backlog-replay.timer ~/.config/systemd/user/
cp company-dashboard.service ~/.config/systemd/user/
cp company-webhook.service ~/.config/systemd/user/
cp company-slack-digest.service ~/.config/systemd/user/
cp company-slack-digest.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now company-dashboard.service
systemctl --user enable --now company-webhook.service
systemctl --user enable --now company-register-worker.service
systemctl --user enable --now company-ops-health.timer
systemctl --user enable --now company-register-backlog-replay.timer
systemctl --user enable --now company-slack-digest.timer
systemctl --user list-timers
```

Queue operations:

```bash
cd ~/.openclaw/webhook
node worker.js status
node worker.js replay-provider-failures --since-hours 72 --limit 25
node worker.js replay-provider-failures --all --limit 25
```

Replay updates the original rows to `retry_pending`; it does not create duplicate
jobs. Replayed legacy rows use priority 10 while new registrations use priority
100, so live registrations always take precedence.

Provider timeouts and HTTP 5xx remain `retry_pending` with exponential backoff.
Authentication, credit, and model errors become `blocked_provider`. Changing the
active OpenClaw provider/model/key fingerprint and restarting the worker requeues
those blocked jobs automatically. The manual replay command also migrates legacy
`failed` rows caused by provider errors.
