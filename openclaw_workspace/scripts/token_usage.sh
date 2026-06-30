#!/usr/bin/env bash
# token_usage.sh - report per-job usage or active-model stored sessions.
# Usage:
#   bash scripts/token_usage.sh --usage-file /path/to/job-usage.json
#   bash scripts/token_usage.sh [--json] [--all-sessions]

set -euo pipefail

JSON_MODE=false
ALL_SESSIONS=false
USAGE_FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --json) JSON_MODE=true; shift ;;
    --all-sessions) ALL_SESSIONS=true; shift ;;
    --usage-file) USAGE_FILE="${2:-}"; shift 2 ;;
    *) echo "token_usage: unknown argument: $1" >&2; exit 2 ;;
  esac
done

OPENCLAW="${OPENCLAW_BIN:-/home/nunuopc/.npm-global/bin/openclaw}"
OPENCLAW_CONFIG="${OPENCLAW_CONFIG_PATH:-/home/nunuopc/.openclaw/openclaw.json}"
CONFIG_FILE="${OPENCLAW_CONFIG}"
SESSION_FILE=""

cleanup() {
  [[ -n "${SESSION_FILE}" ]] && rm -f "${SESSION_FILE}"
}
trap cleanup EXIT

if [[ -z "${USAGE_FILE}" ]]; then
  SESSION_FILE=$(mktemp)
  if ! "${OPENCLAW}" sessions --json > "${SESSION_FILE}" 2>/dev/null; then
    echo "token_usage: no session data available" >&2
    exit 0
  fi
fi

python3 - "${CONFIG_FILE}" "${USAGE_FILE}" "${SESSION_FILE}" "${JSON_MODE}" "${ALL_SESSIONS}" <<'PYEOF'
import json
import os
import sys

config_file, usage_file, session_file, json_mode_raw, all_sessions_raw = sys.argv[1:]
json_mode = json_mode_raw.lower() == 'true'
all_sessions = all_sessions_raw.lower() == 'true'

cfg = {}
if config_file and os.path.isfile(config_file):
    try:
        with open(config_file, encoding='utf-8') as handle:
            cfg = json.load(handle)
    except Exception:
        cfg = {}

primary_model = (
    cfg.get('agents', {})
       .get('defaults', {})
       .get('model', {})
       .get('primary')
)

cost_map = {}
for provider_name, provider_cfg in cfg.get('models', {}).get('providers', {}).items():
    for model_cfg in provider_cfg.get('models', []):
        model_id = model_cfg.get('id', '')
        if not model_id:
            continue
        cost = model_cfg.get('cost', {})
        cost_map[f'{provider_name}/{model_id}'] = {
            'input': float(cost.get('input', 0) or 0),
            'output': float(cost.get('output', 0) or 0),
        }

models = []
scope = 'stored_sessions'

if usage_file:
    if not os.path.isfile(usage_file):
        print('token_usage: usage file not found', file=sys.stderr)
        sys.exit(0)
    with open(usage_file, encoding='utf-8') as handle:
        raw = json.load(handle)
    entries = raw if isinstance(raw, list) else [raw]
    scope = 'current_job'
    for item in entries:
        provider = str(item.get('model_provider') or item.get('provider') or 'unknown')
        model = str(item.get('model_name') or item.get('model') or 'unknown')
        input_tokens = int(item.get('prompt_tokens', item.get('input', 0)) or 0)
        output_tokens = int(item.get('completion_tokens', item.get('output', 0)) or 0)
        models.append({
            'provider': provider,
            'model': model,
            'input_tokens': input_tokens,
            'output_tokens': output_tokens,
            'total_tokens': input_tokens + output_tokens,
            'sessions': 1,
            'is_primary': f'{provider}/{model}' == primary_model,
        })
else:
    with open(session_file, encoding='utf-8') as handle:
        sessions = json.load(handle).get('sessions', [])
    by_model = {}
    for session in sessions:
        provider = str(session.get('modelProvider') or 'unknown')
        model = str(session.get('model') or 'unknown')
        key = f'{provider}/{model}'
        if not all_sessions and primary_model and key != primary_model:
            continue
        row = by_model.setdefault(key, {
            'provider': provider,
            'model': model,
            'input_tokens': 0,
            'output_tokens': 0,
            'total_tokens': 0,
            'sessions': 0,
            'is_primary': key == primary_model,
        })
        row['input_tokens'] += int(session.get('inputTokens', 0) or 0)
        row['output_tokens'] += int(session.get('outputTokens', 0) or 0)
        row['sessions'] += 1
    for row in by_model.values():
        row['total_tokens'] = row['input_tokens'] + row['output_tokens']
        models.append(row)

for row in models:
    key = f"{row['provider']}/{row['model']}"
    pricing = cost_map.get(key, {'input': 0, 'output': 0})
    row['cost_input'] = row['input_tokens'] * pricing['input'] / 1_000_000
    row['cost_output'] = row['output_tokens'] * pricing['output'] / 1_000_000
    row['cost_usd'] = row['cost_input'] + row['cost_output']
    row['scope'] = scope

models.sort(key=lambda row: (not row['is_primary'], row['provider'], row['model']))

if json_mode:
    print(json.dumps(models, indent=2))
    sys.exit(0)

if not models:
    print('No token usage available')
    sys.exit(0)

for row in models:
    label = ' [ACTIVE]' if row['is_primary'] else ''
    scope_label = 'job investigasi ini' if scope == 'current_job' else f"{row['sessions']} session OpenClaw tersimpan"
    print(f"LLM       : {row['provider']}/{row['model']}{label}")
    print(f"Token job : {row['input_tokens']:,} input + {row['output_tokens']:,} output = {row['total_tokens']:,} total")
    print(f"Scope     : {scope_label}")
    if row['cost_usd'] > 0:
        print(f"Biaya     : ~${row['cost_usd']:.4f} USD")
    else:
        print('Biaya     : tidak diketahui (pricing tidak ada di config)')
    print('-' * 50)
PYEOF
