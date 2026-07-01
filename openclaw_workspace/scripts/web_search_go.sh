#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_DIR="$(cd "${WORKSPACE_DIR}/.." && pwd)"
GO_SERVICE_DIR="${REPO_DIR}/go-service"
BINARY="${GO_SERVICE_DIR}/bin/web-search"
export GOCACHE="${GOCACHE:-/private/tmp/company-detector-go-cache}"

if [[ -x "${BINARY}" ]]; then
  exec "${BINARY}" "$@"
fi

if command -v go >/dev/null 2>&1; then
  cd "${GO_SERVICE_DIR}"
  exec go run ./cmd/web-search "$@"
fi

echo "web_search_go: binary not found and go command is unavailable" >&2
exit 127
