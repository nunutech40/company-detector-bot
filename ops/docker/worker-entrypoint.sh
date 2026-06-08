#!/usr/bin/env bash
set -euo pipefail

if [[ "${OPENCLAW_CONFIGURE:-false}" == "true" || "${REGISTER_WORKER_MODE:-agent}" == "agent" ]]; then
  node /app/ops/docker/configure-openclaw.js
fi

exec "$@"
