# Token Optimization Test Log

**Purpose:** record every token-efficiency experiment so future tests do not repeat failed approaches.

**Baseline comparator:** successful queue simulation rows from `queue_simulation_*`, not failed optimization runs.

**Standard AB sample set:**

| Email | Reason |
| --- | --- |
| `bagusmediajogja@gmail.com` | Stable prospect/company-like case |
| `rudihartono.amd@gmail.com` | High-token personal/free-email case |
| `nawaystore@yahoo.com` | Ambiguous brand/person relation case |

For broader validation, use the 5-row set:

| Email | Reason |
| --- | --- |
| `desymalachin@gmail.com` | Personal/free-email case with brand field |
| `rudihartono.amd@gmail.com` | High-token personal/free-email case |
| `bagusmediajogja@gmail.com` | Stable prospect/company-like case |
| `falasik@gmail.com` | Known business/name relation case |
| `nawaystore@yahoo.com` | Ambiguous brand/person relation case |

## Baseline Snapshot

Source: 14-row simulation after DB reset and full OpenClaw queue processing.

| Metric | Value |
| --- | ---: |
| Jobs | 14 |
| Input tokens | 538,126 |
| Output tokens | 20,067 |
| Total tokens | 558,193 |
| Estimated cost | ~$0.085005 |
| Average total/job | ~39,871 |

Selected 5-row baseline:

| Email | Classification | Confidence | Total tokens |
| --- | --- | ---: | ---: |
| `desymalachin@gmail.com` | `likely_personal_email` | 20 | 59,699 |
| `rudihartono.amd@gmail.com` | `likely_personal_email` | 60 | 55,471 |
| `bagusmediajogja@gmail.com` | `possible_company_affiliated` | 80 | 44,387 |
| `falasik@gmail.com` | `possible_company_affiliated` | 65 | 36,361 |
| `nawaystore@yahoo.com` | `unknown_needs_more_evidence` | 15 | 34,605 |

## Experiments

### 1. Prompt Slimming via `AGENTS.md`

**Source:** `optimization_prompt_slim`

**Change tested:** temporarily replaced VPS `AGENTS.md` with a shorter queue-oriented version while preserving investigation branches.

**Result:** rejected.

| Metric | Result |
| --- | --- |
| Total token saving | 8.4% |
| Quality impact | `desymalachin` classification changed; `bagusmediajogja` confidence dropped 80 -> 55; `rudihartono` token use increased |

**Decision:** do not repeat. Agent behavior is sensitive to `AGENTS.md` wording.

### 2. Compact Final Report Instruction

**Source:** `optimization_compact_report`

**Change tested:** kept original `AGENTS.md`, changed worker prompt to ask for shorter final reports only.

**Result:** rejected.

| Metric | Result |
| --- | --- |
| Total token saving | 17.1% |
| Quality impact | Multiple classification changes: `desymalachin`, `falasik`, `nawaystore`, `rudihartono` |

**Decision:** do not repeat. Shorter final-report wording changed reasoning/classification, not only output length.

### 3. Brief Deterministic Baseline Output

**Source:** `optimization_brief_baseline`

**Change tested:** added temporary compact output for `company_check_go.sh` while still saving raw evidence.

**Result:** rejected.

| Metric | Result |
| --- | --- |
| Total token saving | 2.1% |
| Quality impact | All 5 sample classifications changed |

**Decision:** do not repeat in this form. The AI depends on richer baseline output more than expected.

### 4. Lean OpenClaw Tool Profile

**Source:** `optimization_lean_tools`

**Change tested:** temporarily changed OpenClaw VPS config from:

```json
{
  "tools": {
    "profile": "full",
    "alsoAllow": ["llm-task"]
  }
}
```

to:

```json
{
  "tools": {
    "profile": "coding",
    "alsoAllow": ["browser", "llm-task"],
    "deny": [
      "canvas",
      "image",
      "image_generate",
      "music_generate",
      "video_generate",
      "tts",
      "sessions_spawn",
      "sessions_yield",
      "subagents"
    ]
  }
}
```

The queue prompt, `AGENTS.md`, baseline output, report format, and worker code were unchanged.

3-row AB sample:

| Email | Baseline | Candidate | Baseline conf | Candidate conf | Baseline tokens | Candidate tokens | Saving | Quality |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| `bagusmediajogja@gmail.com` | `possible_company_affiliated` | `possible_company_affiliated` | 80 | 85 | 44,387 | 29,872 | 32.7% | same/close |
| `rudihartono.amd@gmail.com` | `likely_personal_email` | `unknown_needs_more_evidence` | 60 | 35 | 55,471 | 91,627 | -65.2% | changed |
| `nawaystore@yahoo.com` | `unknown_needs_more_evidence` | `possible_company_affiliated` | 15 | 80 | 34,605 | 24,389 | 29.5% | changed |

Total: baseline 134,463 tokens vs candidate 145,888 tokens, **8.5% worse**.

Trajectory comparison:

| Metric | Full profile | Lean profile |
| --- | ---: | ---: |
| Tool count visible to model | 32 | 16 |
| Tool schema size | ~32.5k chars | ~11.0k chars |
| System prompt size | ~24.8k chars | ~23.1k chars |
| Non-project context size | ~12.4k chars | ~10.7k chars |

**Result:** rejected.

**Decision:** do not use lean profile directly. It successfully reduces schema overhead, but the changed tool environment changes the model's reasoning path and can increase tokens on hard cases.

## OpenClaw Runtime Observation

Trajectory export from a queue run showed:

| Item | Observation |
| --- | --- |
| OpenClaw version | `2026.5.12` |
| Tool profile | `full` |
| Tool count visible to model | 32 |
| System prompt size | ~24.8k chars |
| Project context size | ~12.4k chars |
| Non-project context size | ~12.4k chars |
| Tool schema size | ~32.5k chars |

This suggests a significant fixed overhead comes from OpenClaw's broad tool schema and injected runtime context. However, the lean-profile AB test shows that simply reducing visible generic tools changes model behavior and is not safe enough.

OpenClaw docs note:

- `tools.profile: "full"` means unrestricted tools.
- `tools.profile: "coding"` includes filesystem, runtime, web, sessions, memory, cron, and media tools.
- `tools.allow` / `tools.deny` can narrow the visible tool policy.
- Visible tools are sent to the model as structured function definitions, so fewer visible tools should reduce prompt/tool schema overhead.

## Current Best Hypothesis

Do not optimize by changing prompt wording, report length, baseline richness, or OpenClaw tool profile directly.

The safer next direction is a separate measurement and evidence-pack layer:

1. Keep current production behavior unchanged.
2. Export OpenClaw trajectory for each AB run.
3. Measure:
   - system prompt chars;
   - tool schema chars;
   - user prompt chars;
   - number of runtime/tool events;
   - per-run token usage from `llm_calls`.
4. Build a deterministic `evidence_pack` command that:
   - runs the same baseline/search/fetch steps outside the AI loop;
   - saves raw evidence unchanged;
   - returns a structured evidence pack with URLs/snippets/source labels;
   - does not ask AI to decide from a shortened narrative.
5. AB test only after the evidence pack contains the same claims/URLs as current baseline output.

Target future queue profile:

- Keep: `exec`, `process`, `web_search`, `web_fetch`, `browser`, `llm-task`.
- Remove from queue sessions: media generation, TTS, messaging tool, subagent/session orchestration, canvas, image tools, unrelated plugin tools.
- Do this only after a domain-specific evidence pack or custom queue agent proves stable; direct generic tool-profile reduction already failed.

Expected benefit: lower repeated context/tool-output overhead without forcing the AI to infer from less evidence.

Acceptance criteria:

- No classification change against baseline for the AB sample.
- Confidence shift <= 15 points.
- Token saving should be visible on at least 2 of 3 AB records.
- Telegram delivery and DB finalization must still work.

Rejection criteria:

- Any classification change on the 3-row AB sample.
- Worker/finalizer/Telegram delivery breaks.
- Token usage increases on most records.
