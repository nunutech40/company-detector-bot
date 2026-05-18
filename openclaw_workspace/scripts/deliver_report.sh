#!/usr/bin/env bash
# deliver_report.sh — baca latest report dan kirim ke Slack + Telegram
# Dipanggil otomatis setelah AI selesai (agentStop hook)
# Tidak bergantung pada AI untuk delivery — deterministik.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
EVIDENCE_FILE="${WORKSPACE_DIR}/evidence/latest.json"
REPORT_FILE="${WORKSPACE_DIR}/reports/latest.txt"

# Cek apakah ada evidence terbaru
if [[ ! -f "${EVIDENCE_FILE}" ]]; then
  echo "deliver_report: no evidence/latest.json found, skipping delivery" >&2
  exit 0
fi

# Baca report text dari latest.txt kalau ada, fallback ke telegram_report di JSON
if [[ -f "${REPORT_FILE}" ]]; then
  REPORT_TEXT=$(cat "${REPORT_FILE}")
else
  # Extract telegram_report dari JSON
  REPORT_TEXT=$(python3 -c "
import json, sys
with open('${EVIDENCE_FILE}') as f:
    d = json.load(f)
print(d.get('telegram_report', 'No report available'))
" 2>/dev/null || echo "No report available")
fi

if [[ -z "${REPORT_TEXT}" || "${REPORT_TEXT}" == "No report available" ]]; then
  echo "deliver_report: no report text found, skipping delivery" >&2
  exit 0
fi

# Kirim ke Slack jika token tersedia
if [[ -n "${SLACK_BOT_TOKEN:-}" && -n "${SLACK_REPORT_CHANNEL:-}" ]]; then
  REPO_DIR="$(cd "${WORKSPACE_DIR}/.." && pwd)"
  GO_SERVICE_DIR="${REPO_DIR}/go-service"
  BINARY="${GO_SERVICE_DIR}/bin/company-check"

  # Baca email dari latest.json untuk re-run dengan --send-slack
  EMAIL=$(python3 -c "
import json
with open('${EVIDENCE_FILE}') as f:
    d = json.load(f)
print(d.get('input', {}).get('email', ''))
" 2>/dev/null || echo "")

  if [[ -n "${EMAIL}" && -x "${BINARY}" ]]; then
    # Re-run company_check dengan --send-slack untuk trigger Go Slack delivery
    # Ini deterministik — tidak bergantung AI
    FULL_NAME=$(python3 -c "
import json
with open('${EVIDENCE_FILE}') as f:
    d = json.load(f)
print(d.get('input', {}).get('full_name', ''))
" 2>/dev/null || echo "")

    BRAND_NAME=$(python3 -c "
import json
with open('${EVIDENCE_FILE}') as f:
    d = json.load(f)
print(d.get('input', {}).get('brand_name', ''))
" 2>/dev/null || echo "")

    ARGS="--email ${EMAIL} --send-slack"
    [[ -n "${FULL_NAME}" ]] && ARGS="${ARGS} --full-name \"${FULL_NAME}\""
    [[ -n "${BRAND_NAME}" ]] && ARGS="${ARGS} --brand-name \"${BRAND_NAME}\""

    echo "deliver_report: sending Slack for ${EMAIL}"
    cd "${GO_SERVICE_DIR}"
    eval "${BINARY} --base-dir \"${WORKSPACE_DIR}\" ${ARGS}" 2>&1 | tail -5
  else
    # Fallback: kirim langsung via curl jika binary tidak ada
    echo "deliver_report: sending Slack via curl fallback"
    ESCAPED=$(echo "${REPORT_TEXT}" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))")
    curl -s -X POST "https://slack.com/api/chat.postMessage" \
      -H "Authorization: Bearer ${SLACK_BOT_TOKEN}" \
      -H "Content-Type: application/json" \
      -d "{\"channel\":\"${SLACK_REPORT_CHANNEL}\",\"text\":${ESCAPED}}" \
      | python3 -c "import sys,json; d=json.load(sys.stdin); print('Slack:', 'ok' if d.get('ok') else d.get('error','failed'))"
  fi
else
  echo "deliver_report: SLACK_BOT_TOKEN or SLACK_REPORT_CHANNEL not set, skipping Slack" >&2
fi

echo "deliver_report: done"
