#!/usr/bin/env bash
# deliver_report_with_env.sh — wrapper yang load env sebelum deliver
# Dipanggil oleh AI setelah selesai investigasi

set -a
source /home/nunuopc/.openclaw/gateway.systemd.env 2>/dev/null || true
set +a

cd /home/nunuopc/.openclaw/workspace
bash scripts/deliver_report.sh "$@"
