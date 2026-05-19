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
    
    # Cost per model (per 1M tokens)
    cost_map = {
        'deepseek/deepseek-chat': {'input': 0.27, 'output': 1.10},
        'minimax/MiniMax-M2.7': {'input': 0.30, 'output': 1.20},
        'anthropic/claude-3-5-haiku': {'input': 0.80, 'output': 4.00},
        'anthropic/claude-3-5-sonnet': {'input': 3.00, 'output': 15.00},
        'openai/gpt-4o-mini': {'input': 0.15, 'output': 0.60},
        'openai/gpt-4o': {'input': 2.50, 'output': 10.00},
    }
    costs = cost_map.get(key, {'input': 0, 'output': 0})
    
    if key not in by_model:
        by_model[key] = {
            'model': model,
            'provider': provider,
            'input_tokens': 0,
            'output_tokens': 0,
            'total_tokens': 0,
            'sessions': 0,
            'context_window': s.get('contextTokens', 0),
            'cost_input': costs['input'],
            'cost_output': costs['output']
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
        
        # Estimasi biaya
        cost_input = m['input_tokens'] * m.get('cost_input', 0) / 1_000_000
        cost_output = m['output_tokens'] * m.get('cost_output', 0) / 1_000_000
        cost_total = cost_input + cost_output
        
        print(f"Model    : {m['provider']}/{m['model']}")
        print(f"Sessions : {m['sessions']}")
        print(f"Input    : {m['input_tokens']:,} tokens")
        print(f"Output   : {m['output_tokens']:,} tokens")
        print(f"Total    : {total:,} / {ctx:,} ({pct}% context used)")
        if cost_total > 0:
            print(f"Est. cost: ${cost_total:.4f} USD (input ${cost_input:.4f} + output ${cost_output:.4f})")
        print("-" * 50)
PYEOF
