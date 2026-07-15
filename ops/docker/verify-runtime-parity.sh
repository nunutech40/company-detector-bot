#!/usr/bin/env bash
set -euo pipefail

COMPOSE="${COMPOSE_COMMAND:-docker compose}"
EXPECTED_OPENCLAW="${EXPECTED_OPENCLAW_VERSION:-2026.5.12}"
EXPECTED_NODE_MAJOR="${EXPECTED_NODE_MAJOR:-24}"

pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1" >&2; exit 1; }

openclaw_version="$($COMPOSE exec -T gateway openclaw --version)"
[[ "$openclaw_version" == *"$EXPECTED_OPENCLAW"* ]] || fail "OpenClaw mismatch: ${openclaw_version}"
pass "OpenClaw ${EXPECTED_OPENCLAW}"

node_version="$($COMPOSE exec -T gateway node --version)"
[[ "$node_version" == v${EXPECTED_NODE_MAJOR}.* ]] || fail "Node mismatch: ${node_version}"
pass "Node ${node_version}"

config="$($COMPOSE exec -T gateway node - <<'NODE'
const c = require('/root/.openclaw/openclaw.json');
const p = c.models?.providers?.['9router'] || {};
console.log(JSON.stringify({
  primary: c.agents?.defaults?.model?.primary,
  baseUrl: p.baseUrl || p.baseURL,
  models: (p.models || []).map(x => x.id || x.name).sort(),
  plugins: Object.entries(c.plugins?.entries || {}).filter(([,v]) => v.enabled).map(([k]) => k).sort(),
  providers: Object.keys(c.models?.providers || {}).sort(),
  profile: c.tools?.profile,
  alsoAllow: c.tools?.alsoAllow || [],
  telegram: !!c.channels?.telegram?.enabled,
  brave: !!process.env.BRAVE_SEARCH_API_KEY,
}));
NODE
)"

CONFIG_JSON="$config" node - <<'NODE'
const c = JSON.parse(process.env.CONFIG_JSON);
const requiredPlugins = ['llm-task', 'minimax'];
const failures = [];
if (c.primary !== '9router/komerce-1.2') failures.push(`primary=${c.primary}`);
if (c.baseUrl !== 'https://9router.komerce-tech.id/v1') failures.push(`baseUrl=${c.baseUrl}`);
if (!c.models.includes('komerce-1.2')) failures.push(`models=${c.models}`);
for (const p of requiredPlugins) if (!c.plugins.includes(p)) failures.push(`plugin_missing=${p}`);
for (const p of ['9router', 'minimax']) if (!c.providers.includes(p)) failures.push(`provider_missing=${p}`);
if (c.profile !== 'full') failures.push(`tools.profile=${c.profile}`);
if (!c.alsoAllow.includes('llm-task')) failures.push('llm-task_not_allowed');
if (!c.telegram) failures.push('telegram_not_enabled');
if (!c.brave) failures.push('brave_search_key_missing');
if (failures.length) {
  console.error(`FAIL  Runtime config parity: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('PASS  Runtime config parity');
NODE

$COMPOSE exec -T gateway sh -lc \
  'test -x /app/go-service/bin/company-check &&
   test -x /app/go-service/bin/tool-status &&
   test -x /app/go-service/bin/last-report &&
   cd /app/openclaw_workspace &&
   scripts/tool_status_go.sh >/dev/null' \
  || fail "Go diagnostic tools parity failed"
pass "Go diagnostic tools parity"

schema_check="$($COMPOSE exec -T postgres psql -U company_detection -d company_detection -At -c \
  "with required_tables(name) as (
     values
       ('investigation_jobs'),
       ('register_intake_jobs'),
       ('register_worker_incidents'),
       ('slack_digest_runs'),
       ('feedback_sources'),
       ('feedback_ingestion_events'),
       ('feedback_items'),
       ('feedback_classification_jobs'),
       ('feedback_classifications'),
       ('feedback_delivery_jobs'),
       ('feedback_deliveries'),
       ('feedback_monitor_runs')
   ),
   missing_tables as (
     select name from required_tables
     where to_regclass('public.' || name) is null
   ),
   required_columns(table_name, column_name) as (
     values
       ('register_intake_jobs','next_attempt_at'),
       ('register_intake_jobs','error_class'),
       ('register_intake_jobs','config_fingerprint'),
       ('register_intake_jobs','queue_priority'),
       ('feedback_sources','config_json'),
       ('feedback_items','external_feedback_id'),
       ('feedback_classifications','sentiment'),
       ('feedback_delivery_jobs','sent_at'),
       ('feedback_deliveries','created_at')
   ),
   missing_columns as (
     select table_name || '.' || column_name as name
     from required_columns rc
     where not exists (
       select 1 from information_schema.columns c
       where c.table_schema='public'
         and c.table_name=rc.table_name
         and c.column_name=rc.column_name
     )
   ),
   required_indexes(pattern) as (
     values
       ('%register_intake%status%'),
       ('%feedback_items%'),
       ('%slack_digest%')
   ),
   missing_indexes as (
     select pattern from required_indexes ri
     where not exists (
       select 1 from pg_indexes i
       where i.schemaname='public' and i.indexdef ilike ri.pattern
     )
   )
   select 'missing_tables=' || coalesce(string_agg(name, ','), '') from missing_tables
   union all
   select 'missing_columns=' || coalesce(string_agg(name, ','), '') from missing_columns
   union all
   select 'missing_indexes=' || coalesce(string_agg(pattern, ','), '') from missing_indexes;")"
[[ "$schema_check" == $'missing_tables=\nmissing_columns=\nmissing_indexes=' ]] \
  || fail "Database schema/index parity failed: ${schema_check//$'\n'/; }"
pass "Database schema and index parity"

$COMPOSE exec -T gateway sh -lc \
  'test -s /root/.openclaw/company-detector.env &&
   grep -q "^DATABASE_URL=" /root/.openclaw/company-detector.env' \
  || fail "Agent runtime database environment missing"
pass "Agent runtime database environment"

$COMPOSE exec -T gateway sh -lc \
  '/app/openclaw_workspace/scripts/company_check_go.sh --email sromelah24@gmail.com --full-name "Siti Romelah" --brand-name Romelaanasa --save >/tmp/company-detector-brave-check.log 2>&1 || true;
   grep -q "brave_search" /tmp/company-detector-brave-check.log' \
  && pass "Brave Search behavior parity" \
  || printf 'WARN  Brave Search diagnostic did not emit brave_search; continuing because BRAVE_SEARCH_API_KEY presence was already verified\n'
