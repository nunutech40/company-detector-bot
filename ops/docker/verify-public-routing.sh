#!/usr/bin/env bash
set -euo pipefail

COMPOSE="${COMPOSE_COMMAND:-docker compose}"
ENV_FILE="${ENV_FILE:-.env}"
OLD_VPS_HOST="${OLD_VPS_HOST:-103.226.139.107}"
TEST_ID="public_route:$(date +%Y%m%d%H%M%S)"

pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1" >&2; exit 1; }
env_value() { awk -F= -v key="$1" '$1==key{sub(/^[^=]*=/,""); print; exit}' "$ENV_FILE"; }

[[ -f "$ENV_FILE" ]] || fail "${ENV_FILE} is missing"

PUBLIC_WEBHOOK_URL="${PUBLIC_WEBHOOK_URL:-$(env_value PUBLIC_WEBHOOK_URL)}"
WEBHOOK_SECRET="${WEBHOOK_SECRET:-$(env_value WEBHOOK_SECRET)}"

[[ -n "$PUBLIC_WEBHOOK_URL" ]] || fail "PUBLIC_WEBHOOK_URL is missing"
[[ -n "$WEBHOOK_SECRET" ]] || fail "WEBHOOK_SECRET is missing"

case "$PUBLIC_WEBHOOK_URL" in
  *"$OLD_VPS_HOST"*) fail "PUBLIC_WEBHOOK_URL still points to old VPS (${OLD_VPS_HOST})" ;;
  http://localhost:*|http://127.0.0.1:*|http://0.0.0.0:*) fail "PUBLIC_WEBHOOK_URL must be the public office URL, not localhost" ;;
esac
pass "PUBLIC_WEBHOOK_URL is not the old VPS or localhost"

for service in postgres webhook worker; do
  [[ "$($COMPOSE ps --status running --services | grep -Fx "$service" || true)" == "$service" ]] \
    || fail "Service ${service} is not running"
done
pass "Office queue services are running"

payload="$(node -e '
const id = process.argv[1];
process.stdout.write(JSON.stringify({
  email: `public-route-${Date.now()}@example.com`,
  full_name: "Public Route Probe",
  brand_name: "Public Route Probe",
  source: "public_route_probe",
  external_id: id,
  idempotency_key: id
}));
' "$TEST_ID")"

curl -fsS -X POST "$PUBLIC_WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${WEBHOOK_SECRET}" \
  --data "$payload" >/dev/null || fail "PUBLIC_WEBHOOK_URL did not accept the probe"
pass "Public webhook accepted probe"

row="$($COMPOSE exec -T postgres psql -U company_detection -d company_detection -At -F '|' -c \
  "select status from register_intake_jobs where idempotency_key='${TEST_ID}' limit 1;")"
[[ -n "$row" ]] || fail "Probe did not land in this office database"
pass "Probe landed in the office database (${row})"

echo
echo "PUBLIC ROUTING PASS"
