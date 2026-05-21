#!/usr/bin/env bash
# deploy.sh — sync semua dari repo ke VPS
# Usage: bash deploy.sh
# Jalankan dari root repo: /Users/nununugraha/Documents/Programming/My Project/PerusahaanDetector

set -euo pipefail

VPS_USER="nunuopc"
VPS_HOST="103.226.139.107"
VPS_PASS="IloveIndonesia123"
VPS_WORKSPACE="/home/nunuopc/.openclaw/workspace"
VPS_GO_BIN="/home/nunuopc/.openclaw/go-service/bin"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GO_SERVICE_DIR="${REPO_DIR}/go-service"

ssh_cmd() {
  expect << EXPECTEOF
set timeout 60
set pass "${VPS_PASS}"
spawn ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 ${VPS_USER}@${VPS_HOST} {$1}
expect "*password:"
send "\$pass\r"
expect eof
EXPECTEOF
}

scp_file() {
  local src="$1"
  local dst="$2"
  expect << EXPECTEOF
set timeout 60
set pass "${VPS_PASS}"
spawn scp -o StrictHostKeyChecking=accept-new "${src}" ${VPS_USER}@${VPS_HOST}:${dst}
expect "*password:"
send "\$pass\r"
expect eof
EXPECTEOF
}

echo "=== Deploy to VPS ==="
echo "Repo: ${REPO_DIR}"
echo "VPS:  ${VPS_USER}@${VPS_HOST}"
echo ""

# 1. Build Go binary for Linux
echo "[1/5] Building Go binary..."
cd "${GO_SERVICE_DIR}"
env GOCACHE=/private/tmp/company-detector-go-cache \
    GOOS=linux GOARCH=amd64 \
    go build -o /tmp/company-check-linux ./cmd/company-check
echo "      ✓ company-check built"

# 2. Deploy Go binary
echo "[2/5] Deploying Go binary..."
scp_file "/tmp/company-check-linux" "${VPS_GO_BIN}/company-check"
ssh_cmd "chmod +x ${VPS_GO_BIN}/company-check"
echo "      ✓ company-check deployed"

# 3. Deploy workspace files (AGENTS.md, TOOLS.md, config)
echo "[3/5] Deploying workspace files..."
scp_file "${REPO_DIR}/openclaw_workspace/AGENTS.md" "${VPS_WORKSPACE}/AGENTS.md"
scp_file "${REPO_DIR}/openclaw_workspace/TOOLS.md" "${VPS_WORKSPACE}/TOOLS.md"
scp_file "${REPO_DIR}/openclaw_workspace/STANDING_ORDERS.md" "${VPS_WORKSPACE}/STANDING_ORDERS.md"
scp_file "${REPO_DIR}/openclaw_workspace/config/tool_catalog.yaml" "${VPS_WORKSPACE}/config/tool_catalog.yaml"
scp_file "${REPO_DIR}/openclaw_workspace/config/scoring_rules.yaml" "${VPS_WORKSPACE}/config/scoring_rules.yaml"
echo "      ✓ workspace files deployed"

# 3b. Deploy hooks
echo "[3b] Deploying hooks..."
ssh_cmd "mkdir -p ${VPS_WORKSPACE}/hooks/deliver-on-message-sent"
scp_file "${REPO_DIR}/openclaw_workspace/hooks/deliver-on-message-sent/HOOK.md" "${VPS_WORKSPACE}/hooks/deliver-on-message-sent/HOOK.md"
scp_file "${REPO_DIR}/openclaw_workspace/hooks/deliver-on-message-sent/handler.ts" "${VPS_WORKSPACE}/hooks/deliver-on-message-sent/handler.ts"
echo "      ✓ hooks deployed"

# 4. Deploy scripts
echo "[4/5] Deploying scripts..."
scp_file "${REPO_DIR}/openclaw_workspace/package.json" "${VPS_WORKSPACE}/package.json"
if [[ -f "${REPO_DIR}/openclaw_workspace/package-lock.json" ]]; then
  scp_file "${REPO_DIR}/openclaw_workspace/package-lock.json" "${VPS_WORKSPACE}/package-lock.json"
fi
for script in \
  company_check_go.sh \
  tool_status_go.sh \
  last_report_go.sh \
  deliver_report.sh \
  deliver_report_with_env.sh \
  finish_investigation.sh \
  token_usage.sh \
  db_writer.js \
  sales_sheet_exporter.js \
  slack_reporter.js \
  slack_daily_digest.js; do
  if [[ -f "${REPO_DIR}/openclaw_workspace/scripts/${script}" ]]; then
    scp_file "${REPO_DIR}/openclaw_workspace/scripts/${script}" "${VPS_WORKSPACE}/scripts/${script}"
    ssh_cmd "chmod +x ${VPS_WORKSPACE}/scripts/${script}"
    echo "      ✓ ${script}"
  fi
done
ssh_cmd "cd ${VPS_WORKSPACE} && npm install --omit=dev"
echo "      ✓ workspace npm dependencies"

# 5. Restart gateway
echo "[5/5] Restarting OpenClaw gateway..."
ssh_cmd "systemctl --user restart openclaw-gateway"
sleep 5
ssh_cmd "/home/nunuopc/.npm-global/bin/openclaw status 2>&1 | grep -E 'Gateway|reachable' | head -2"

# 5b. Deploy dashboard
echo "[5b] Deploying dashboard..."
scp_file "${REPO_DIR}/dashboard/package.json" "/home/nunuopc/.openclaw/dashboard/package.json"
if [[ -f "${REPO_DIR}/dashboard/package-lock.json" ]]; then
  scp_file "${REPO_DIR}/dashboard/package-lock.json" "/home/nunuopc/.openclaw/dashboard/package-lock.json"
fi
scp_file "${REPO_DIR}/dashboard/app.js" "/home/nunuopc/.openclaw/dashboard/app.js"
scp_file "${REPO_DIR}/dashboard/views/layout.ejs" "/home/nunuopc/.openclaw/dashboard/views/layout.ejs"
scp_file "${REPO_DIR}/dashboard/views/index.ejs" "/home/nunuopc/.openclaw/dashboard/views/index.ejs"
scp_file "${REPO_DIR}/dashboard/views/job_detail.ejs" "/home/nunuopc/.openclaw/dashboard/views/job_detail.ejs"
scp_file "${REPO_DIR}/dashboard/views/search.ejs" "/home/nunuopc/.openclaw/dashboard/views/search.ejs"
ssh_cmd "cd /home/nunuopc/.openclaw/dashboard && npm install --omit=dev"
ssh_cmd "systemctl --user restart company-dashboard"
echo "      ✓ dashboard deployed"

# 5c. Deploy webhook
echo "[5c] Deploying webhook..."
scp_file "${REPO_DIR}/webhook/package.json" "/home/nunuopc/.openclaw/webhook/package.json"
if [[ -f "${REPO_DIR}/webhook/package-lock.json" ]]; then
  scp_file "${REPO_DIR}/webhook/package-lock.json" "/home/nunuopc/.openclaw/webhook/package-lock.json"
fi
scp_file "${REPO_DIR}/webhook/app.js" "/home/nunuopc/.openclaw/webhook/app.js"
scp_file "${REPO_DIR}/webhook/worker.js" "/home/nunuopc/.openclaw/webhook/worker.js"
ssh_cmd "chmod +x /home/nunuopc/.openclaw/webhook/worker.js"
ssh_cmd "cd /home/nunuopc/.openclaw/webhook && npm install --omit=dev"
ssh_cmd "systemctl --user restart company-webhook"
echo "      ✓ webhook deployed"

# 5d. Deploy user systemd units used by webhook queue and daily Slack digest
echo "[5d] Deploying systemd units..."
for unit in \
  company-register-worker.service \
  company-slack-digest.service \
  company-slack-digest.timer; do
  if [[ -f "${REPO_DIR}/ops/systemd/${unit}" ]]; then
    scp_file "${REPO_DIR}/ops/systemd/${unit}" "/home/nunuopc/.config/systemd/user/${unit}"
    echo "      ✓ ${unit}"
  fi
done
ssh_cmd "systemctl --user daemon-reload"
ssh_cmd "systemctl --user restart company-register-worker"
ssh_cmd "systemctl --user enable --now company-slack-digest.timer"
echo "      ✓ queue/digest units reloaded"
echo ""
echo "=== Deploy complete ==="
echo ""
echo "=== Post-deploy verification ==="

# Verifikasi 1: Gateway reachable
echo "[1/3] Gateway check..."
expect << VERIFYEOF
set timeout 20
set pass "${VPS_PASS}"
spawn ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 ${VPS_USER}@${VPS_HOST} {/home/nunuopc/.npm-global/bin/openclaw status 2>&1 | grep -E "reachable|running" | head -2}
expect "*password:"
send "\$pass\r"
expect eof
VERIFYEOF

# Verifikasi 2: deliver_report.sh tidak kirim Go fallback
echo "[2/3] Delivery flow check..."
expect << VERIFYEOF
set timeout 20
set pass "${VPS_PASS}"
spawn ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 ${VPS_USER}@${VPS_HOST} {grep -c "Go fallback not sent" /home/nunuopc/.openclaw/workspace/scripts/deliver_report.sh 2>/dev/null && echo "OK: deliver_report.sh hanya kirim AI report" || echo "WARN: cek deliver_report.sh"}
expect "*password:"
send "\$pass\r"
expect eof
VERIFYEOF

# Verifikasi 3: finish_investigation.sh hapus AI report lama
echo "[3/3] finish_investigation.sh check..."
expect << VERIFYEOF
set timeout 20
set pass "${VPS_PASS}"
spawn ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 ${VPS_USER}@${VPS_HOST} {grep -c "rm -f.*ai_report_latest" /home/nunuopc/.openclaw/workspace/scripts/finish_investigation.sh 2>/dev/null && echo "OK: finish_investigation.sh hapus report lama" || echo "WARN: cek finish_investigation.sh"}
expect "*password:"
send "\$pass\r"
expect eof
VERIFYEOF

# Verifikasi 4: Hook handler.ts ada
echo "[4/4] Hook check..."
expect << VERIFYEOF
set timeout 20
set pass "${VPS_PASS}"
spawn ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 ${VPS_USER}@${VPS_HOST} {test -f /home/nunuopc/.openclaw/workspace/hooks/deliver-on-message-sent/handler.ts && echo "OK: hook handler.ts ada" || echo "WARN: hook handler.ts tidak ditemukan"}
expect "*password:"
send "\$pass\r"
expect eof
VERIFYEOF

echo ""
echo "Delivery contract:"
echo "  Telegram: AI report (langsung dari AI)"
echo "  Slack   : daily prospect digest jam 09:00, bukan realtime raw report"
echo "  Go fallback: TIDAK dikirim ke Slack (hanya untuk debugging lokal)"
echo "  Standing Orders: aktif via STANDING_ORDERS.md"
echo ""
echo "=== All checks done ==="
