# Flow Map

**Project:** AI Company Detection Agent  
**Audience:** Developer / AI agent penerus  
**Status:** Active runtime map  
**Last updated:** 20 Mei 2026

---

## 1. Fungsi Dokumen Ini

Dokumen ini menjelaskan **alur runtime teknis**: komponen mana yang dipanggil, bagaimana orchestrator melakukan loop investigasi, kapan stop, dan bagaimana finalizer menyimpan report ke DB.

Bedanya dengan [High Level Business Flow](../product/HIGH_LEVEL_BUSINESS_FLOW.md):

| Dokumen | Fokus | Pembaca |
|---|---|---|
| High Level Business Flow | Alur bisnis dari input akun sampai dashboard/Slack | Product, operator, business |
| Flow Map | Runtime teknis, orchestrator, loop, stop condition, storage path | Developer, AI agent |

---

## 2. Runtime Sequence Utama

```mermaid
sequenceDiagram
  autonumber
  actor User as Manual / Telegram Input
  participant Account as Account Input Normalizer
  participant OpenClaw as OpenClaw Agent
  participant Orchestra as Investigation Orchestra
  participant Go as Go company-check
  participant Catalog as Tool Catalog
  participant External as External Sources
  participant Scoring as Scoring Engine
  participant Finalizer as finish_investigation.sh
  participant Writer as db_writer.js
  participant DB as PostgreSQL
  participant Dashboard as Dashboard

  User->>Account: email only OR email + full_name + brand_name + no_hp
  Account->>Account: Normalize aliases and mask no_hp
  Account->>OpenClaw: RegisterInput
  OpenClaw->>Orchestra: Start investigation goal with account data

  Orchestra->>Go: Baseline deterministic check
  Go->>Scoring: emailintel + input evidence + domain/search/scoring
  Scoring-->>Go: baseline result + evidence
  Go-->>Orchestra: classification, confidence, evidence, tool status

  loop AI reasoning rounds
    Orchestra->>Orchestra: Observe score, account fields, evidence, missing facts
    Orchestra->>Catalog: Check available tools and cost

    alt confidence >= target threshold
      Orchestra->>Orchestra: Stop: enough confidence
    else tool budget exhausted
      Orchestra->>Orchestra: Stop: budget exhausted
    else no new information gain
      Orchestra->>Orchestra: Stop: no useful next step
    else evidence gap remains
      Orchestra->>External: Call selected tool/search/fetch using safe signals
      External-->>Orchestra: tool result / skipped / error
      Orchestra->>Scoring: Add valid evidence only
      Scoring-->>Orchestra: updated score + classification
    end
  end

  Orchestra-->>OpenClaw: Final finding + AI report text
  OpenClaw->>Finalizer: Run finalization command
  Finalizer->>Go: Save latest evidence/report snapshot
  Finalizer->>Writer: Insert investigation result
  Writer->>DB: investigation_jobs + final_reports + llm_calls
  DB-->>Dashboard: Job visible for review
  Finalizer-->>OpenClaw: Token/cost summary + delivery result
```

---

## 3. Current Validated Path

```text
OpenClaw/Telegram/manual input: email only or full account data
  -> Investigation Orchestra
  -> Go deterministic baseline
  -> AI reasoning loop
  -> finish_investigation.sh
  -> db_writer.js
  -> PostgreSQL
  -> Dashboard
```

This is the currently validated persistence path.

---

## 4. Input Contract

| Field | Required | Runtime Rule |
|---|---:|---|
| `email` | Yes | Primary signal; can be passed as `--email`, positional arg, or JSON |
| `full_name` | No | Identity hint; can also arrive as `fullName`, `name`, or `nama` |
| `brand_name` | No | Business hint; can also arrive as `brandName`, `company_field`, `company`, or `brand` |
| `no_hp` | No | Confirmation only; can also arrive as `noHp`, `phone`, or `hp`; stored masked in reports |

Accepted input modes:

```bash
company-check --email user@gmail.com
company-check user@gmail.com

company-check \
  --email user@gmail.com \
  --full-name "Nama User" \
  --brand-name "Nama Brand" \
  --no-hp "08123456789"

company-check --input-json '{"email":"user@gmail.com","full_name":"Nama User","brand_name":"Nama Brand","no_hp":"08123456789"}'
```

---

## 5. Deterministic Baseline

The baseline runs through Go:

```text
openclaw_workspace/scripts/company_check_go.sh
  -> go-service/cmd/company-check
```

Main Go components:

| Component | Role |
|---|---|
| `emailintel` | free/custom/disposable/role email signals |
| `domaincheck` | DNS, MX, website status |
| `crawler` | lightweight website crawl |
| `search` | Google CSE if configured, Brave, Bing, DDG |
| `scraper` | page fetch/extraction |
| `brandhint` | brand-like local-part detection |
| `sociallinks` | social URL extraction |
| `rolesignal` | founder/owner/CEO signal detection |
| `scoring` | deterministic classification and confidence |
| `evidence` | JSON evidence snapshots |
| `report` | fallback human report |

---

## 6. AI Reasoning Loop

The AI loop is controlled by OpenClaw and `AGENTS.md`.

Each round:

1. Observe current result.
2. Identify evidence gaps.
3. Decide whether another tool is worth the cost.
4. Call tool if useful.
5. Accept only valid evidence.
6. Re-score deterministically.
7. Stop or loop.

Stop branches:

| Stop Branch | Meaning |
|---|---|
| Confidence target reached | Enough evidence to classify |
| Tool budget exhausted | Stop to control cost |
| No new information gain | More tools likely wasteful |
| Evidence remains weak | Classify as `unknown_needs_more_evidence` |
| Suspicious/invalid signal found | Classify as `suspicious_or_invalid` |

Rules:

- Failed tools are `tool_errors`, not evidence.
- Skipped tools are `tools_skipped`.
- AI must not invent evidence.
- `no_hp` must not be used for public search.

---

## 7. Finalization Sequence

```mermaid
sequenceDiagram
  autonumber
  participant Agent as OpenClaw Agent
  participant Finalizer as finish_investigation.sh
  participant Go as company_check_go.sh
  participant Files as evidence/ + reports/
  participant Writer as db_writer.js
  participant DB as PostgreSQL
  participant Slack as Slack

  Agent->>Finalizer: --email + optional fields + AI report
  Finalizer->>Files: Save ai_report_latest.txt
  Finalizer->>Go: Run --save
  Go->>Files: Write latest.json and per-email evidence/report
  Finalizer->>Finalizer: Evaluate classification + confidence

  alt possible_company_affiliated and confidence >= 75 and Slack enabled
    Finalizer->>Slack: Send alert
  else not high-confidence business or Slack finalization pending
    Finalizer->>Finalizer: Skip Slack
  end

  Finalizer->>Writer: Run DB writer
  Writer->>DB: Insert job/report/llm cost
  Finalizer-->>Agent: Print token usage and completion
```

Command:

```bash
cd openclaw_workspace
scripts/finish_investigation.sh --email <email>
```

---

## 8. Storage Map

```text
Go evidence/report files
  evidence/latest.json
  reports/ai_report_latest.txt
        |
        v
db_writer.js
        |
        v
PostgreSQL
  investigation_jobs
  final_reports
  llm_calls
        |
        v
Dashboard
```

PostgreSQL is the operational source of truth. File evidence remains the audit/debug artifact.

---

## 9. Webhook Path Status

Webhook is a final integration path, not the currently validated persistence path.

```mermaid
sequenceDiagram
  autonumber
  participant Platform as Platform Register
  participant Webhook as company-webhook
  participant Go as Go company-check
  participant DB as PostgreSQL
  participant Dashboard as Dashboard

  Platform->>Webhook: POST /webhook/check
  Webhook->>Webhook: Validate secret + sanitize input
  Webhook->>Go: Run deterministic check
  Go-->>Webhook: Fast classification response
  Webhook-->>Platform: JSON classification + dashboard_url

  Note over Webhook,DB: Final-phase work: align evidence path and persist exact webhook result
  Webhook-->>DB: Pending final integration
  DB-->>Dashboard: Pending final integration
```

---

## 10. Classification Outputs

| Classification | Meaning |
|---|---|
| `possible_company_affiliated` | Business/company signal strong enough |
| `likely_personal_email` | Personal signal stronger, no business evidence |
| `unknown_needs_more_evidence` | Not enough evidence |
| `suspicious_or_invalid` | Invalid/disposable/risky |

---

## 11. Current Status

Validated:

- Go baseline.
- OpenClaw reasoning loop.
- `finish_investigation.sh`.
- PostgreSQL storage through finalizer.
- Dashboard.

Final integration pending:

- Webhook DB persistence path.
- Slack high-confidence routing.
- Platform register validation.
