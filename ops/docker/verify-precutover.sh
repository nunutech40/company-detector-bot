#!/usr/bin/env bash
set -euo pipefail

COMPOSE="${COMPOSE_COMMAND:-docker compose}"
ENV_FILE="${ENV_FILE:-.env}"
TEST_ID="docker_precutover:$(date +%Y%m%d%H%M%S)"
TEST_EMAIL="docker-precutover-$(date +%s)@example.com"

pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1" >&2; exit 1; }
env_value() { awk -F= -v key="$1" '$1==key{sub(/^[^=]*=/,""); print; exit}' "$ENV_FILE"; }

[[ -f "$ENV_FILE" ]] || fail "${ENV_FILE} is missing"
$COMPOSE config --quiet || fail "Compose configuration invalid"
pass "Compose configuration valid"

required_services=(postgres dashboard webhook digest)
for service in "${required_services[@]}"; do
  [[ "$($COMPOSE ps --status running --services | grep -Fx "$service" || true)" == "$service" ]] \
    || fail "Service ${service} is not running"
done
pass "Non-Telegram services are running"

curl -fsS http://localhost:3002/health >/dev/null || fail "Webhook health failed"
curl -fsS http://localhost:3001/sales-sheet >/dev/null || fail "Dashboard failed"
pass "Webhook and dashboard reachable"

WEBHOOK_SECRET="$(env_value WEBHOOK_SECRET)"
[[ -n "$WEBHOOK_SECRET" ]] || fail "WEBHOOK_SECRET is missing"

worker_was_running="$($COMPOSE ps --status running --services | grep -Fx worker || true)"
cleanup() {
  if [[ "$worker_was_running" == "worker" ]]; then
    $COMPOSE up -d worker >/dev/null
  fi
}
trap cleanup EXIT

$COMPOSE stop worker >/dev/null

payload="$(node -e '
const [email, id] = process.argv.slice(1);
process.stdout.write(JSON.stringify({
  email,
  full_name: "Docker Precutover",
  brand_name: "Docker Precutover",
  no_hp: "08123456789",
  source: "docker_precutover",
  external_id: id,
  idempotency_key: id
}));
' "$TEST_EMAIL" "$TEST_ID")"

curl -fsS -X POST http://localhost:3002/webhook/check \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${WEBHOOK_SECRET}" \
  --data "$payload" >/dev/null || fail "Unable to enqueue deterministic test"
pass "Test register queued"

$COMPOSE run --rm -T \
  -e REGISTER_WORKER_MODE=deterministic \
  -e REGISTER_WORKER_DELIVER_TELEGRAM=false \
  worker node webhook/worker.js --once >/dev/null \
  || fail "Deterministic worker test failed"
pass "Deterministic worker completed"

row="$($COMPOSE exec -T postgres psql -U company_detection -d company_detection -At -F '|' -c \
  "select status,coalesce(investigation_job_id::text,'') from register_intake_jobs where idempotency_key='${TEST_ID}' limit 1;")"
[[ "${row%%|*}" == "completed" ]] || fail "Test register did not complete: ${row}"
pass "Result persisted to PostgreSQL"

curl -fsS "http://localhost:3001/search?q=${TEST_EMAIL}" | grep -Fq "$TEST_EMAIL" \
  || fail "Result not visible in dashboard search"
pass "Result visible in dashboard"

$COMPOSE exec -T digest node openclaw_workspace/scripts/slack_daily_digest.js --dry-run --window-hours 24 >/dev/null \
  || fail "Slack digest dry-run failed"
pass "Slack digest dry-run"

echo
echo "PRE-CUTOVER PASS"
echo "Telegram gateway and full AI behavior were intentionally not tested."
