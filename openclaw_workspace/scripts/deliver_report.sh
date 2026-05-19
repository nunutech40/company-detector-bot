#!/usr/bin/env bash
# deliver_report.sh — kirim report ke Slack
# Hanya kirim AI report (reports/ai_report_latest.txt)
# TIDAK kirim Go fallback — Go fallback terlalu sering salah/incomplete
# Kalau AI report tidak ada → skip, jangan kirim apapun

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
AI_REPORT="${WORKSPACE_DIR}/reports/ai_report_latest.txt"

# Hanya kirim kalau ada AI report
if [[ ! -f "${AI_REPORT}" ]]; then
  echo "deliver_report: no AI report found, skipping (Go fallback not sent to Slack)" >&2
  exit 0
fi

REPORT_TEXT=$(cat "${AI_REPORT}")

if [[ -z "${REPORT_TEXT}" ]]; then
  echo "deliver_report: AI report is empty, skipping" >&2
  exit 0
fi

echo "deliver_report: sending AI report to Slack"

# Kirim ke Slack
if [[ -n "${SLACK_BOT_TOKEN:-}" && -n "${SLACK_REPORT_CHANNEL:-}" ]]; then
  ESCAPED=$(echo "${REPORT_TEXT}" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))")
  RESULT=$(curl -s -X POST "https://slack.com/api/chat.postMessage" \
    -H "Authorization: Bearer ${SLACK_BOT_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"channel\":\"${SLACK_REPORT_CHANNEL}\",\"text\":${ESCAPED}}")
  OK=$(echo "${RESULT}" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('ok','false'))" 2>/dev/null || echo "false")
  if [[ "${OK}" == "True" || "${OK}" == "true" ]]; then
    echo "deliver_report: Slack sent OK (AI report)"
  else
    ERR=$(echo "${RESULT}" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error','unknown'))" 2>/dev/null || echo "unknown")
    echo "deliver_report: Slack failed — ${ERR}" >&2
  fi
else
  echo "deliver_report: SLACK_BOT_TOKEN or SLACK_REPORT_CHANNEL not set, skipping" >&2
fi

echo "deliver_report: done"
