#!/usr/bin/env bash
# token_usage.sh — tampilkan penggunaan token AI untuk session aktif
# Pricing dibaca dinamis dari openclaw.json — otomatis update kalau model diganti.
# Usage: bash scripts/token_usage.sh [--json]

set -euo pipefail

JSON_MODE=false
[[ "${1:-}" == "--json" ]] && JSON_MODE=true

OPENCLAW="/home/nunuopc/.npm-global/bin/openclaw"
OPENCLAW_CONFIG="/home/nunuopc/.openclaw/openclaw.json"

# Ambil session data
SESSION_DATA=$("${OPENCLAW}" sessions --json 2>/dev/null)

if [[ -z "${SESSION_DATA}" ]]; then
  echo "token_usage: no session data available" >&2
  exit 0
fi

# Baca config untuk pricing + model aktif
CONFIG_DATA=""
if [[ -f "${OPENCLAW_CONFIG}" ]]; then
  CONFIG_DATA=$(cat "${OPENCLAW_CONFIG}")
fi

# Parse dengan python3
python3 << PYEOF
import json, sys

session_raw = '''${SESSION_DATA}'''
config_raw  = '''${CONFIG_DATA}'''

data     = json.loads(session_raw)
sessions = data.get('sessions', [])

if not sessions:
    print("No active sessions")
    sys.exit(0)

# ── Baca pricing dari openclaw.json secara dinamis ──────────────────────────
# Struktur: models.providers.<provider>.models[].{id, cost.{input, output}}
# Fallback: cost_map statis untuk provider yang tidak ada di config
cost_map = {
    # fallback statis — dipakai kalau provider tidak ada di openclaw.json
    'deepseek/deepseek-chat':        {'input': 0.27,  'output': 1.10},
    'minimax/MiniMax-M2.7':          {'input': 0.30,  'output': 1.20},
    'anthropic/claude-3-5-haiku':    {'input': 0.80,  'output': 4.00},
    'anthropic/claude-3-5-sonnet':   {'input': 3.00,  'output': 15.00},
    'openai/gpt-4o-mini':            {'input': 0.15,  'output': 0.60},
    'openai/gpt-4o':                 {'input': 2.50,  'output': 10.00},
}

# Override dengan data dari openclaw.json (source of truth)
primary_model = None
if config_raw.strip():
    try:
        cfg = json.loads(config_raw)

        # Baca model primary dari agents.defaults.model.primary
        primary_model = (
            cfg.get('agents', {})
               .get('defaults', {})
               .get('model', {})
               .get('primary')
        )

        # Baca pricing dari models.providers
        providers = cfg.get('models', {}).get('providers', {})
        for provider_name, provider_cfg in providers.items():
            for m in provider_cfg.get('models', []):
                model_id = m.get('id', '')
                cost     = m.get('cost', {})
                if model_id and cost:
                    key = f"{provider_name}/{model_id}"
                    cost_map[key] = {
                        'input':  cost.get('input', 0),
                        'output': cost.get('output', 0),
                    }
    except Exception:
        pass  # config parse error — pakai fallback

# ── Aggregate token usage per model ─────────────────────────────────────────
by_model = {}
for s in sessions:
    model    = s.get('model', 'unknown')
    provider = s.get('modelProvider', 'unknown')
    key      = f"{provider}/{model}"
    costs    = cost_map.get(key, {'input': 0, 'output': 0})

    if key not in by_model:
        by_model[key] = {
            'model':          model,
            'provider':       provider,
            'input_tokens':   0,
            'output_tokens':  0,
            'total_tokens':   0,
            'sessions':       0,
            'context_window': s.get('contextTokens', 0),
            'cost_input':     costs['input'],
            'cost_output':    costs['output'],
            'is_primary':     (key == primary_model),
        }
    by_model[key]['input_tokens']  += s.get('inputTokens', 0)
    by_model[key]['output_tokens'] += s.get('outputTokens', 0)
    by_model[key]['total_tokens']  += s.get('totalTokens', 0)
    by_model[key]['sessions']      += 1

json_mode = '${JSON_MODE}' == 'true'

if json_mode:
    print(json.dumps(list(by_model.values()), indent=2))
else:
    # Urutkan: model primary duluan
    sorted_models = sorted(by_model.values(), key=lambda x: (not x['is_primary'], x['provider']))

    for m in sorted_models:
        ctx   = m['context_window']
        total = m['total_tokens']
        pct   = round(total / ctx * 100, 1) if ctx > 0 else 0

        cost_input  = m['input_tokens']  * m['cost_input']  / 1_000_000
        cost_output = m['output_tokens'] * m['cost_output'] / 1_000_000
        cost_total  = cost_input + cost_output

        label = " [ACTIVE]" if m['is_primary'] else ""
        print(f"LLM      : {m['provider']}/{m['model']}{label}")
        print(f"Token    : {m['input_tokens']:,} input + {m['output_tokens']:,} output = {total:,} total")
        if ctx > 0:
            print(f"Context  : {total:,} / {ctx:,} ({pct}% used)")
        if cost_total > 0:
            print(f"Biaya    : ~\${cost_total:.4f} USD  (input \${cost_input:.4f} + output \${cost_output:.4f})")
        elif m['cost_input'] == 0 and m['cost_output'] == 0:
            print(f"Biaya    : tidak diketahui (pricing tidak ada di config)")
        print("─" * 50)
PYEOF
