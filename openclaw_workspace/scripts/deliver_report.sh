#!/usr/bin/env bash
# deliver_report.sh — kirim report ke Slack
# Prioritas: reports/ai_report_latest.txt (dari AI reasoning)
# Fallback: reports/latest.txt (dari Go pipeline)
# Tidak bergantung AI untuk delivery — deterministik.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
AI_REPORT="${WORKSPACE_DIR}/reports/ai_report_latest.txt"
GO_REPORT="${WORKSPACE_DIR}/reports/latest.txt"

# Pilih report: AI report lebih diutamakan
if [[ -f "${AI_REPORT}" ]]; then
  REPORT_TEXT=$(cat "${AI_REPORT}")
  REPORT_SOURCE="AI reasoning"
elif [[ -f "${GO_REPORT}" ]]; then
  REPORT_TEXT=$(cat "${GO_REPORT}")
  REPORT_SOURCE="Go fallback"
else
  echo "deliver_report: no report found, skipping" >&2
  exit 0
fi

if [[ -z "${REPORT_TEXT}" ]]; then
  echo "deliver_report: empty report, skipping" >&2
  exit 0
fi

echo "deliver_report: using ${REPORT_SOURCE} report"

# Kirim ke Slack
if [[ -n "${SLACK_BOT_TOKEN:-}" && -n "${SLACK_REPORT_CHANNEL:-}" ]]; then
  ESCAPED=$(echo "${REPORT_TEXT}" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))")
  RESULT=$(curl -s -X POST "https://slack.com/api/chat.postMessage" \
    -H "Authorization: Bearer ${SLACK_BOT_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"channel\":\"${SLACK_REPORT_CHANNEL}\",\"text\":${ESCAPED}}")
  OK=$(echo "${RESULT}" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('ok','false'))" 2>/dev/null || echo "false")
  if [[ "${OK}" == "True" || "${OK}" == "true" ]]; then
    echo "deliver_report: Slack sent OK (${REPORT_SOURCE})"
  else
    ERR=$(echo "${RESULT}" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error','unknown'))" 2>/dev/null || echo "unknown")
    echo "deliver_report: Slack failed — ${ERR}" >&2
  fi
else
  echo "deliver_report: SLACK_BOT_TOKEN or SLACK_REPORT_CHANNEL not set, skipping" >&2
fi

echo "deliver_report: done"
