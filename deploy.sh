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
scp_file "${REPO_DIR}/openclaw_workspace/config/tool_catalog.yaml" "${VPS_WORKSPACE}/config/tool_catalog.yaml"
scp_file "${REPO_DIR}/openclaw_workspace/config/scoring_rules.yaml" "${VPS_WORKSPACE}/config/scoring_rules.yaml"
echo "      ✓ workspace files deployed"

# 4. Deploy scripts
echo "[4/5] Deploying scripts..."
for script in \
  company_check_go.sh \
  tool_status_go.sh \
  last_report_go.sh \
  deliver_report.sh \
  deliver_report_with_env.sh; do
  if [[ -f "${REPO_DIR}/openclaw_workspace/scripts/${script}" ]]; then
    scp_file "${REPO_DIR}/openclaw_workspace/scripts/${script}" "${VPS_WORKSPACE}/scripts/${script}"
    ssh_cmd "chmod +x ${VPS_WORKSPACE}/scripts/${script}"
    echo "      ✓ ${script}"
  fi
done

# 5. Restart gateway
echo "[5/5] Restarting OpenClaw gateway..."
ssh_cmd "systemctl --user restart openclaw-gateway"
sleep 5
ssh_cmd "/home/nunuopc/.npm-global/bin/openclaw status 2>&1 | grep -E 'Gateway|reachable' | head -2"
echo ""
echo "=== Deploy complete ==="
