#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_DIR="$(cd "${WORKSPACE_DIR}/.." && pwd)"
GO_SERVICE_DIR="${REPO_DIR}/go-service"
BINARY="${GO_SERVICE_DIR}/bin/last-report"
export GOCACHE="${GOCACHE:-/private/tmp/company-detector-go-cache}"

if [[ -x "${BINARY}" ]]; then
  cd "${GO_SERVICE_DIR}"
  exec "${BINARY}" --base-dir "${WORKSPACE_DIR}" "$@"
fi

if command -v go >/dev/null 2>&1; then
  cd "${GO_SERVICE_DIR}"
  exec go run ./cmd/last-report --base-dir "${WORKSPACE_DIR}" "$@"
fi

echo "last_report_go: Go binary not found and go command is unavailable" >&2
echo "Build first with: cd go-service && go build -o bin/last-report ./cmd/last-report" >&2
exit 127
