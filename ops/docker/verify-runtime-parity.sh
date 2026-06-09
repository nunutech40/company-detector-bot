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
const s = c.models?.providers?.sumopod || {};
console.log(JSON.stringify({
  primary: c.agents?.defaults?.model?.primary,
  api: s.api,
  models: (s.models || []).map(x => x.id).sort(),
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
const requiredPlugins = ['deepseek', 'llm-task', 'minimax'];
const failures = [];
if (c.primary !== 'sumopod/kimi-k2.6') failures.push(`primary=${c.primary}`);
if (c.api !== 'openai-completions') failures.push(`api=${c.api}`);
if (!c.models.includes('kimi-k2.6') || !c.models.includes('komerce')) failures.push(`models=${c.models}`);
for (const p of requiredPlugins) if (!c.plugins.includes(p)) failures.push(`plugin_missing=${p}`);
for (const p of ['deepseek', 'minimax', 'sumopod']) if (!c.providers.includes(p)) failures.push(`provider_missing=${p}`);
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

schema_fingerprints="$($COMPOSE exec -T postgres psql -U company_detection -d company_detection -At -c \
  "select md5(string_agg(table_name||':'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,''), E'\\n' order by table_name,ordinal_position)) from information_schema.columns where table_schema='public';
   select md5(string_agg(tablename||':'||indexname||':'||indexdef, E'\\n' order by tablename,indexname)) from pg_indexes where schemaname='public';")"
[[ "$schema_fingerprints" == $'592b990ea17b587dafe3c32f569a0dc1\nb854f10b927a68423e3980159ed77797' ]] \
  || fail "Database schema/index parity failed: ${schema_fingerprints//$'\n'/,}"
pass "Database schema and index parity"

$COMPOSE exec -T gateway sh -lc \
  'test -s /root/.openclaw/company-detector.env &&
   grep -q "^DATABASE_URL=" /root/.openclaw/company-detector.env' \
  || fail "Agent runtime database environment missing"
pass "Agent runtime database environment"

$COMPOSE exec -T gateway sh -lc \
  '/app/openclaw_workspace/scripts/company_check_go.sh --email sromelah24@gmail.com --full-name "Siti Romelah" --brand-name Romelaanasa --save 2>&1 | grep -q "web_search(brave_search)"' \
  || fail "Brave Search behavior parity failed"
pass "Brave Search behavior parity"
