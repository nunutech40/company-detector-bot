#!/usr/bin/env bash
set -euo pipefail

COMPOSE="${COMPOSE_COMMAND:-docker compose}"
TIMEOUT_SEC="${VERIFY_TIMEOUT_SEC:-1200}"
POLL_SEC="${VERIFY_POLL_SEC:-10}"

read_value() {
  local name="$1" prompt="$2" default="${3:-}" value
  value="${!name:-}"
  if [[ -z "$value" ]]; then
    read -r -p "${prompt}${default:+ [${default}]}: " value
    value="${value:-$default}"
  fi
  printf -v "$name" '%s' "$value"
}

pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1" >&2; exit 1; }
env_value() { awk -F= -v key="$1" '$1==key{sub(/^[^=]*=/,""); print; exit}' .env; }

echo "Company Detector production acceptance test"
echo

$COMPOSE config --quiet || fail "Compose configuration invalid"
pass "Compose configuration valid"

[[ -f .env ]] || fail ".env is missing"
[[ "$(env_value REGISTER_WORKER_MODE)" == "agent" ]] || fail "REGISTER_WORKER_MODE must be agent"
[[ "$(env_value REGISTER_WORKER_DELIVER_TELEGRAM)" == "true" ]] || fail "REGISTER_WORKER_DELIVER_TELEGRAM must be true"
[[ -n "$(env_value LLM_API_KEY)" ]] || fail "LLM_API_KEY is missing"
[[ -n "$(env_value TELEGRAM_DEFAULT_BOT_TOKEN)" ]] || fail "TELEGRAM_DEFAULT_BOT_TOKEN is missing"
[[ -n "$(env_value REGISTER_WORKER_TELEGRAM_TO)" ]] || fail "REGISTER_WORKER_TELEGRAM_TO is missing"
pass "Required production secrets and worker mode configured"

required_services=(postgres dashboard webhook worker gateway digest)
for service in "${required_services[@]}"; do
  running="$($COMPOSE ps --status running --services | grep -Fx "$service" || true)"
  [[ "$running" == "$service" ]] || fail "Service ${service} is not running"
done
pass "Required services are running"

curl -fsS http://localhost:3002/health >/dev/null || fail "Webhook health failed"
curl -fsS http://localhost:3001/sales-sheet >/dev/null || fail "Dashboard Sales Sheet failed"
pass "Webhook and dashboard reachable"

$COMPOSE exec -T worker openclaw config validate >/dev/null || fail "OpenClaw config invalid"
$COMPOSE exec -T worker openclaw models list >/dev/null || fail "OpenClaw model unavailable"
pass "OpenClaw configuration and model available"

COMPOSE_COMMAND="${COMPOSE}" ./ops/docker/verify-runtime-parity.sh

$COMPOSE exec -T digest node openclaw_workspace/scripts/slack_daily_digest.js --dry-run --window-hours 24 >/dev/null \
  || fail "Slack digest dry-run failed"
pass "Slack digest dry-run"

read_value TEST_EMAIL "Test email"
read_value TEST_FULL_NAME "Full name"
read_value TEST_BRAND_NAME "Brand name (optional)"
read_value TEST_PHONE "Phone/WhatsApp (optional)"

[[ -n "$TEST_EMAIL" ]] || fail "Test email is required"
TEST_ID="office_acceptance:$(date +%Y%m%d%H%M%S)"

payload="$(node -e '
const [email, fullName, brandName, phone, id] = process.argv.slice(1);
process.stdout.write(JSON.stringify({
  email, full_name: fullName, brand_name: brandName, no_hp: phone,
  source: "office_acceptance", external_id: id, idempotency_key: id
}));
' "$TEST_EMAIL" "$TEST_FULL_NAME" "$TEST_BRAND_NAME" "$TEST_PHONE" "$TEST_ID")"

WEBHOOK_SECRET="$(env_value WEBHOOK_SECRET)"
[[ -n "$WEBHOOK_SECRET" ]] || fail "WEBHOOK_SECRET missing from .env"

curl -fsS -X POST http://localhost:3002/webhook/check \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${WEBHOOK_SECRET}" \
  --data "$payload" >/dev/null || fail "Unable to enqueue test register"
pass "Test register queued (${TEST_ID})"

deadline=$((SECONDS + TIMEOUT_SEC))
while (( SECONDS < deadline )); do
  row="$($COMPOSE exec -T postgres psql -U company_detection -d company_detection -At -F '|' -c \
    "select status,coalesce(investigation_job_id::text,''),coalesce(last_error,'') from register_intake_jobs where idempotency_key='${TEST_ID}' limit 1;")"
  status="${row%%|*}"
  if [[ "$status" == "completed" ]]; then
    pass "Agent investigation completed and saved to database"
    echo
    echo "FINAL CHECK: confirm the Company Detection Report arrived in the production Telegram bot."
    echo "Dashboard: http://localhost:3001/search?q=${TEST_EMAIL}"
    exit 0
  fi
  if [[ "$status" == "failed" ]]; then
    echo "$row" >&2
    fail "Agent investigation failed"
  fi
  printf 'WAIT  investigation status=%s\n' "${status:-not_found}"
  sleep "$POLL_SEC"
done

fail "Investigation did not finish within ${TIMEOUT_SEC}s"
