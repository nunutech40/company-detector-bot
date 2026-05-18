#!/usr/bin/env bash
# token_usage.sh — tampilkan penggunaan token AI untuk session aktif
# Usage: bash scripts/token_usage.sh [--json]

set -euo pipefail

JSON_MODE=false
[[ "${1:-}" == "--json" ]] && JSON_MODE=true

OPENCLAW="/home/nunuopc/.npm-global/bin/openclaw"

# Ambil session data
SESSION_DATA=$("${OPENCLAW}" sessions --json 2>/dev/null)

if [[ -z "${SESSION_DATA}" ]]; then
  echo "token_usage: no session data available" >&2
  exit 0
fi

# Parse dengan python3
python3 << PYEOF
import json, sys

data = json.loads('''${SESSION_DATA}''')
sessions = data.get('sessions', [])

if not sessions:
    print("No active sessions")
    sys.exit(0)

# Aggregate per model
by_model = {}
for s in sessions:
    model = s.get('model', 'unknown')
    provider = s.get('modelProvider', 'unknown')
    key = f"{provider}/{model}"
    if key not in by_model:
        by_model[key] = {
            'model': model,
            'provider': provider,
            'input_tokens': 0,
            'output_tokens': 0,
            'total_tokens': 0,
            'sessions': 0,
            'context_window': s.get('contextTokens', 0)
        }
    by_model[key]['input_tokens']  += s.get('inputTokens', 0)
    by_model[key]['output_tokens'] += s.get('outputTokens', 0)
    by_model[key]['total_tokens']  += s.get('totalTokens', 0)
    by_model[key]['sessions']      += 1

json_mode = '${JSON_MODE}' == 'true'

if json_mode:
    print(json.dumps(list(by_model.values()), indent=2))
else:
    print("AI Token Usage")
    print("=" * 50)
    for key, m in by_model.items():
        ctx = m['context_window']
        total = m['total_tokens']
        pct = round(total / ctx * 100, 1) if ctx > 0 else 0
        print(f"Model    : {m['provider']}/{m['model']}")
        print(f"Sessions : {m['sessions']}")
        print(f"Input    : {m['input_tokens']:,} tokens")
        print(f"Output   : {m['output_tokens']:,} tokens")
        print(f"Total    : {total:,} / {ctx:,} ({pct}% context used)")
        print("-" * 50)
PYEOF
