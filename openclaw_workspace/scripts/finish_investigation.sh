#!/usr/bin/env bash
# finish_investigation.sh — wajib dijalankan AI di akhir setiap investigasi
#
# Usage:
#   bash scripts/finish_investigation.sh \
#     --email <email> \
#     [--full-name "<name>"] \
#     [--no-hp "<phone>"] \
#     [--brand-name "<brand>"] \
#     --report "<report_text>"
#
# Yang dilakukan:
#   1. Save report AI ke reports/ai_report_latest.txt
#   2. Run company_check --save untuk save evidence JSON
#   3. Trigger deliver_report_with_env.sh untuk kirim ke Slack

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
mkdir -p "${WORKSPACE_DIR}/reports" "${WORKSPACE_DIR}/evidence"

# Parse args
EMAIL=""
FULL_NAME=""
NO_HP=""
BRAND_NAME=""
REPORT_TEXT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --email)      EMAIL="$2";      shift 2 ;;
    --full-name)  FULL_NAME="$2";  shift 2 ;;
    --no-hp)      NO_HP="$2";      shift 2 ;;
    --brand-name) BRAND_NAME="$2"; shift 2 ;;
    --report)     REPORT_TEXT="$2"; shift 2 ;;
    *) shift ;;
  esac
done

if [[ -z "${EMAIL}" ]]; then
  echo "finish_investigation: --email is required" >&2
  exit 1
fi

echo "finish_investigation: saving for ${EMAIL}"

# Hapus AI report lama supaya tidak ada sisa dari investigasi sebelumnya
rm -f "${WORKSPACE_DIR}/reports/ai_report_latest.txt"

# Step 1: Save AI report ke file
if [[ -n "${REPORT_TEXT}" ]]; then
  echo "${REPORT_TEXT}" > "${WORKSPACE_DIR}/reports/ai_report_latest.txt"
  echo "finish_investigation: AI report saved to reports/ai_report_latest.txt"
else
  echo "finish_investigation: no --report provided, skipping AI report save" >&2
fi

# Step 2: Run company_check --save untuk save evidence JSON
ARGS=(--email "${EMAIL}" --save)
[[ -n "${FULL_NAME}" ]]  && ARGS+=(--full-name "${FULL_NAME}")
[[ -n "${NO_HP}" ]]      && ARGS+=(--no-hp "${NO_HP}")
[[ -n "${BRAND_NAME}" ]] && ARGS+=(--brand-name "${BRAND_NAME}")

echo "finish_investigation: running company_check --save"
bash "${SCRIPT_DIR}/company_check_go.sh" "${ARGS[@]}" 2>&1 | tail -3

# Step 3: Smart Slack alert routing
# Kirim ke Slack HANYA kalau: classification = bisnis DAN confidence >= 75
# Personal/unknown → DB only, tidak spam Slack
echo "finish_investigation: checking alert routing..."
LATEST_JSON="${WORKSPACE_DIR}/evidence/latest.json"
SHOULD_ALERT=false

if [[ -f "${LATEST_JSON}" ]]; then
  CLASSIFICATION=$(python3 -c "import json,sys; d=json.load(open('${LATEST_JSON}')); print(d.get('classification',''))" 2>/dev/null || echo "")
  CONFIDENCE=$(python3 -c "import json,sys; d=json.load(open('${LATEST_JSON}')); print(d.get('confidence_score',0))" 2>/dev/null || echo "0")

  # Override dengan hasil AI dari report kalau ada
  if [[ -f "${WORKSPACE_DIR}/reports/ai_report_latest.txt" ]]; then
    AI_CONF=$(grep -oP '(?:Confidence|confidence)[:\s]+\K\d+(?=/100)' "${WORKSPACE_DIR}/reports/ai_report_latest.txt" 2>/dev/null | head -1 || echo "")
    [[ -n "${AI_CONF}" ]] && CONFIDENCE="${AI_CONF}"
    AI_CLASS=$(grep -iP '(?:bisnis|business|company|BUSINESS)' "${WORKSPACE_DIR}/reports/ai_report_latest.txt" 2>/dev/null | head -1 || echo "")
    [[ -n "${AI_CLASS}" ]] && CLASSIFICATION="possible_company_affiliated"
  fi

  if [[ "${CLASSIFICATION}" == "possible_company_affiliated" ]] && [[ "${CONFIDENCE}" -ge 75 ]]; then
    SHOULD_ALERT=true
    echo "finish_investigation: alert → Slack (${CLASSIFICATION}, ${CONFIDENCE}/100)"
  else
    echo "finish_investigation: skip Slack (${CLASSIFICATION}, ${CONFIDENCE}/100) — DB only"
  fi
fi

if [[ "${SHOULD_ALERT}" == "true" ]]; then
  bash "${SCRIPT_DIR}/deliver_report_with_env.sh"
fi

echo "finish_investigation: done"

# Step 4: Insert ke Postgres
echo "finish_investigation: writing to database"
DB_ARGS=(--email "${EMAIL}")
[[ -n "${FULL_NAME}" ]]  && DB_ARGS+=(--full-name "${FULL_NAME}")
[[ -n "${BRAND_NAME}" ]] && DB_ARGS+=(--brand-name "${BRAND_NAME}")
node "${SCRIPT_DIR}/db_writer.js" "${DB_ARGS[@]}" 2>&1 | grep -E "db_writer:" || true

# Tampilkan token usage untuk session ini
echo ""
echo "--- AI Token Usage ---"
bash "${SCRIPT_DIR}/token_usage.sh" 2>/dev/null || true

# Append token info ke AI report jika ada
if [[ -f "${WORKSPACE_DIR}/reports/ai_report_latest.txt" ]]; then
  TOKEN_INFO=$(bash "${SCRIPT_DIR}/token_usage.sh" 2>/dev/null || echo "")
  if [[ -n "${TOKEN_INFO}" ]]; then
    echo "" >> "${WORKSPACE_DIR}/reports/ai_report_latest.txt"
    echo "───" >> "${WORKSPACE_DIR}/reports/ai_report_latest.txt"
    echo "${TOKEN_INFO}" >> "${WORKSPACE_DIR}/reports/ai_report_latest.txt"
  fi
fi
