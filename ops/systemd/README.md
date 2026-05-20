# Systemd Units

Example user-level systemd units for the webhook queue and Slack daily digest.

These files are templates for VPS deployment. Install under:

```text
~/.config/systemd/user/
```

Units:

- `company-register-worker.service` runs the sequential queue worker.
- `company-slack-digest.service` runs one digest send.
- `company-slack-digest.timer` triggers digest daily at 09:00.

Before enabling the timer, confirm the VPS user manager timezone or host timezone is Asia/Jakarta. The digest service itself also sets `TZ=Asia/Jakarta` for message formatting.

Example commands on VPS:

```bash
mkdir -p ~/.config/systemd/user
cp company-register-worker.service ~/.config/systemd/user/
cp company-slack-digest.service ~/.config/systemd/user/
cp company-slack-digest.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now company-register-worker.service
systemctl --user enable --now company-slack-digest.timer
systemctl --user list-timers
```
