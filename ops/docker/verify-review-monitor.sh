#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${REVIEW_MONITOR_ENV_FILE:-.env.review-monitor}"
COMPOSE="${COMPOSE_COMMAND:-docker compose --profile review-monitor}"

pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1" >&2; exit 1; }
env_value() { awk -F= -v key="$1" '$1==key{sub(/^[^=]*=/,""); print; exit}' "$ENV_FILE"; }

[[ -f "$ENV_FILE" ]] || fail "${ENV_FILE} is missing; copy .env.review-monitor.example"
mode="$(stat -c '%a' "$ENV_FILE" 2>/dev/null || stat -f '%Lp' "$ENV_FILE" 2>/dev/null || true)"
[[ "$mode" == "600" ]] || fail "${ENV_FILE} permission must be 600, found ${mode:-unknown}"
grep -Eq '(^|=)CHANGE_ME($|_)' "$ENV_FILE" && fail "${ENV_FILE} still contains CHANGE_ME placeholders"
pass "Review monitor env exists, has no placeholders, and permission is 600"

for key in GBP_BUSINESS_NAME GBP_ACCOUNT_ID GBP_LOCATION_ID GBP_CLIENT_ID GBP_CLIENT_SECRET GBP_REFRESH_TOKEN REVIEW_MONITOR_TELEGRAM_TO TELEGRAM_DEFAULT_BOT_TOKEN; do
  [[ -n "$(env_value "$key")" ]] || fail "${key} is missing in ${ENV_FILE}"
done
pass "Required Google Business Profile and Telegram values configured"

$COMPOSE config --quiet || fail "Compose configuration invalid"
pass "Compose review-monitor profile valid"

$COMPOSE run --rm review-monitor node review_monitor/monitor.js collect
pass "Google Business Profile review collection succeeded"

$COMPOSE run --rm review-monitor node review_monitor/monitor.js test-send
pass "Telegram test-send succeeded"

echo
echo "Review monitor preflight PASS. Scheduler remains opt-in."
