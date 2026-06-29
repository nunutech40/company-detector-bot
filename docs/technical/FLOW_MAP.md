# Flow Map

**Project:** AI Company Detection Agent  
**Audience:** Developer / AI agent penerus  
**Status:** Active runtime map  
**Last updated:** 17 Juni 2026

---

## 1. Fungsi Dokumen Ini

Ini adalah **satu-satunya dokumen flow aktif**.

Source of truth:

- `PRD.md` untuk arah produk.
- `TRD.md` untuk arsitektur teknis.
- `FLOW_MAP.md` untuk alur dari input sampai output.

Dokumen plan, review, checklist, dan flow lama ada di `docs/archive/` dan tidak dipakai sebagai acuan aktif.

---

## 2. Reality Check

Status yang sesuai kondisi project sekarang:

| Area | Status Aktual |
|---|---|
| Input manual / Telegram | Jalur utama yang dipakai untuk investigasi |
| Go deterministic pipeline | Sudah jalan |
| OpenClaw AI reasoning loop | Sudah jalan sebagai layer investigasi |
| Finalizer `finish_investigation.sh` | Jalur valid untuk save evidence, DB writer, token usage |
| PostgreSQL + Dashboard | Sudah jalan |
| Webhook | Enqueue-only API sudah jalan dengan PostgreSQL `register_intake_jobs` |
| Queue worker | Sequential worker sudah jalan; satu job per waktu |
| Telegram delivery | Wajib untuk tiap investigasi queue/manual |
| Slack routing | Daily prospect digest jam 09:00 sudah jalan; realtime raw report disabled |
| Google review monitor | Current implementation deterministic; scheduler tersedia tetapi belum diaktifkan sampai authenticated API collect valid |
| Negative feedback monitor | Meta Graph polling MVP aktif; webhook optional/future; Google path menunggu API approval |

Jalur persistence yang sudah divalidasi:

```text
Manual/Telegram input
  -> OpenClaw / Investigation Orchestra
  -> Go deterministic baseline
  -> AI reasoning loop
  -> finish_investigation.sh
  -> db_writer.js
  -> PostgreSQL
  -> Dashboard

Platform register
  -> webhook intake
  -> queue
  -> sequential worker
  -> OpenClaw agent + Telegram delivery
  -> same investigation path
  -> DB/dashboard
  -> Slack digest jam 09:00
```

Review monitor adalah flow kedua yang terpisah:

```text
Google Business Profile API
  -> isolated API collector jam 21:00
  -> filter review 1-3 + dedupe
  -> dedicated review-monitor state
  -> Slack report jam 09:00
```

Negative feedback monitor aktif sekarang:

```text
Meta Graph API polling setiap 15 menit
  -> Facebook Page + Instagram Business comments
  -> normalized feedback inbox
  -> structured AI classifier hanya untuk komentar baru/berubah
  -> Telegram result selalu
  -> Slack hanya jika negatif

Optional/future:
  -> Meta Webhook kalau callback/subscription Meta App sudah aktif
  -> Google Business Profile rating 1-3 deterministic setelah API access approved
```

---

## 3. Actor Boundaries

| Boundary | Isi | Tanggung Jawab |
|---|---|---|
| Human / Platform | Operator Telegram, manual check, platform register webhook | Mengirim data akun |
| Webhook / Queue | Webhook service, PostgreSQL table `register_intake_jobs`, sequential worker | Menampung payload platform dan memproses satu per satu |
| OpenClaw AI | Telegram session, agent prompt, investigation orchestra, reasoning loop | Memutuskan langkah investigasi dan final report; tidak menulis storage langsung |
| Machine / Go Tools | Go CLI, email/domain/search/crawler/scoring/report/evidence packages | Mengeksekusi check deterministik dan menghasilkan evidence |
| Finalization | `finish_investigation.sh`, `db_writer.js`, token usage | Menutup investigasi dan menyimpan hasil |
| Storage / Output | PostgreSQL, file evidence, dashboard | Menjadi tempat review dan source data operasional |
| Slack Digest | Cron/digest script, Slack channel | Mengirim ringkasan prospect jam 09:00 dari data final di DB |
| Feedback Monitor | Google connector, Meta connector, dedicated classifier/queues/schema, Telegram + Slack APIs | Google rating 1-3 tanpa AI; Meta comments dengan structured AI; Telegram selalu; Slack hanya negatif |

## 3.1 Active Negative Feedback Monitor

```mermaid
flowchart LR
  Timer["15-minute Meta polling"] --> MetaAI["Structured AI classifier"]
  MetaWebhook["Optional future Meta Webhook"] -.-> MetaAI
  Google["Future Google API/PubSub"] -.-> GoogleRule["Rating 1-3 rule"]
  GoogleRule --> Inbox["Normalized feedback inbox"]
  MetaAI --> Inbox
  Inbox --> Telegram["Telegram: every completed result"]
  Inbox -->|negative only| Slack["Slack monitor-negatif-company"]
```

Detail source contract, queues, schema, classifier output, failure handling, dan
implementation phases ada di
`docs/technical/NEGATIVE_FEEDBACK_MONITOR_ARCHITECTURE.md`.

## 3.2 Current And Target Feature Boundary Flowchart

```mermaid
flowchart TB
  subgraph shared["Shared Project Infrastructure"]
    Docker["Docker image / Compose"]
    OAuth["Google OAuth credential"]
    SlackBot["Shared Slack bot credential"]
  end

  subgraph investigation["Company Investigation Feature"]
    Intake["Register / manual input"]
    Agent["OpenClaw agent + LLM"]
    Tools["Go investigation tools"]
    InvestigationDB["Investigation PostgreSQL tables"]
  end

  subgraph currentReviews["Current: Google Review Monitor"]
    ReviewScheduler["Independent scheduler"]
    Collector["Google Business Profile API polling"]
    ReviewState["Dedicated review-monitor state volume"]
    ReviewReport["Daily Slack review report"]
  end

  subgraph targetFeedback["Target: Unified Negative Feedback Monitor"]
    GoogleEvents["Google Pub/Sub + optional recovery reconciliation"]
    GoogleRule["Deterministic rating 1-3 rule"]
    MetaEvents["Meta Webhooks + optional recovery reconciliation"]
    MetaClassifier["Dedicated structured AI classifier"]
    FeedbackDB["Dedicated normalized feedback schema"]
    TelegramDelivery["Telegram: every result"]
    SlackDelivery["Slack: negative only"]
  end

  Docker --> Agent
  Docker --> ReviewScheduler
  OAuth --> Collector
  SlackBot --> ReviewReport
  Intake --> Agent --> Tools --> InvestigationDB
  ReviewScheduler --> Collector --> ReviewState --> ReviewReport
  GoogleEvents --> GoogleRule --> FeedbackDB
  MetaEvents --> MetaClassifier --> FeedbackDB
  FeedbackDB --> TelegramDelivery
  FeedbackDB -->|negative only| SlackDelivery
  SlackBot --> SlackDelivery

  Collector -. "must not call" .-> Agent
  ReviewState -. "must not write" .-> InvestigationDB
  GoogleRule -. "must not call AI" .-> MetaClassifier
  FeedbackDB -. "must not write" .-> InvestigationDB
```

## 3.3 Google Review Monitor Sequence

Current active polling implementation before optional webhook migration:

```mermaid
sequenceDiagram
  autonumber
  participant Scheduler as Review Monitor Scheduler
  participant OAuth as Google OAuth
  participant API as Business Profile Reviews API
  participant State as Dedicated Review State
  participant Slack as Slack channel monitor-negatif-company

  Note over Scheduler,Slack: Separate from OpenClaw investigation flow

  Scheduler->>OAuth: Refresh access token at 21:00 WIB
  OAuth-->>Scheduler: Access token
  Scheduler->>API: List reviews for configured account/location

  alt Authenticated review list available
    API-->>Scheduler: Verified reviews
    Scheduler->>Scheduler: Filter reviews and rating 1-3
    Scheduler->>State: Store deduplicated reviews and healthy collect status
  else OAuth or API failure
    Scheduler->>State: Store unhealthy collect status
  end

  Scheduler->>State: send at 09:00 WIB
  alt Latest collect status healthy
    State-->>Scheduler: Unsent negative reviews or verified empty result
    Scheduler->>Slack: Send daily review report
    Scheduler->>State: Mark review fingerprints sent
  else Latest collect unhealthy or stale
    State-->>Scheduler: Failure detail
    Scheduler->>Slack: Send monitoring failure alert
  end
```

## 3.4 Target Feedback Monitoring Sequence

```mermaid
sequenceDiagram
  autonumber
  participant Platform as Google Pub/Sub / Meta Webhook
  participant Ingress as Feedback Ingress
  participant DB as Feedback PostgreSQL Queue
  participant Worker as Sequential Feedback Worker
  participant API as Google / Meta API
  participant AI as Meta Structured Classifier
  participant Telegram
  participant Slack as Slack monitor-negatif-company

  Platform->>Ingress: Review/comment created or updated
  Ingress->>DB: Validate and insert idempotent event
  Ingress-->>Platform: Technical ACK after durable insert
  Note over Platform,Ingress: ACK prevents platform retry; it is not a monitoring report

  Worker->>DB: Lock oldest pending event
  Worker->>API: Fetch current feedback and minimum context
  API-->>Worker: Review/comment detail

  alt Google review
    Worker->>Worker: Rating 1-3 deterministic rule
  else Meta comment
    Worker->>AI: Fixed prompt + structured output
    alt AI request succeeds
      AI-->>Worker: negative / non_negative / needs_review
    else Provider/auth/model/timeout/output failure
      AI-->>Worker: Retryable failure
      Worker->>DB: retry_pending or blocked_provider
      Note over Worker,DB: Requeue after provider health/config change; no result assumed safe
      break Classification incomplete; await replay
        Worker->>DB: Do not enqueue normal Telegram/Slack result
      end
    end
  end

  Worker->>DB: Store classification and enqueue Telegram
  DB-->>Telegram: Send every completed monitoring result

  alt Result is negative
    Worker->>DB: Enqueue Slack negative alert
    DB-->>Slack: Send immediately
  else Result is non-negative or needs-review
    Worker->>DB: No Slack delivery
  end
```

---

## 4. End-To-End Sequence Dengan Pemisah Area

```mermaid
sequenceDiagram
  autonumber
  box Human Platform Input
    actor Human as Operator / Manual
    participant Platform as Platform Register
  end

  box Webhook Queue Layer
    participant Webhook as Webhook Intake
    participant Worker as Sequential Worker
  end

  box OpenClaw AI Layer
    participant AI as OpenClaw Agent
    participant Orchestra as Investigation Orchestra
  end

  box Machine Go Tools
    participant Go as Go company-check
    participant Tools as Tools + Scoring
  end

  box Finalization
    participant Finalizer as finish_investigation.sh
    participant Writer as db_writer.js
  end

  box Storage Output
    participant DB as PostgreSQL company_detection
    participant Dashboard as Dashboard
  end

  box Slack Digest
    participant Digest as Daily Digest
    participant Slack as Slack Channel
  end

  Human->>AI: /check atau manual input data akun
  Note over Human,AI: Minimum email atau data akun lengkap

  Platform->>Webhook: POST register payload
  Webhook->>DB: Insert into register_intake_jobs
  DB-->>Webhook: intake_job_id
  Webhook-->>Platform: Accepted queued
  Worker->>DB: Lock oldest pending register_intake_jobs row
  Worker->>AI: Start queued investigation

  AI->>Orchestra: Start investigation
  Orchestra->>Go: Run deterministic baseline
  Go->>Tools: email domain crawler search scoring
  Tools-->>Go: evidence skipped tool_errors
  Go-->>Orchestra: baseline classification confidence

  loop AI reasoning rounds
    Orchestra->>Orchestra: Evaluate evidence gaps and confidence
    alt Butuh evidence lagi
      Orchestra->>Tools: Call selected safe tool
      Tools-->>Orchestra: new evidence skipped error
      Orchestra->>Orchestra: Re-score deterministically
    else Confidence cukup atau budget habis
      Orchestra->>Orchestra: Stop loop
    end
  end

  Orchestra-->>AI: Final classification and AI report
  AI-->>Worker: Return final report
  Worker->>Finalizer: Execute finalizer with source=webhook
  Note over AI,Finalizer: AI decides report. Worker/finalizer writes output.
  Finalizer->>Writer: Insert result
  Writer->>DB: Insert investigation_jobs final_reports llm_calls
  DB-->>Dashboard: Job visible for review

  loop Daily at 09:00
    Digest->>DB: Read unsent prospect jobs and digest tables
    DB-->>Digest: Prospect list or empty result
    Digest->>Digest: Build Sales Sheet link and prospect summaries
    alt Prospects found
      Digest->>Slack: Send prospect digest
      Digest->>DB: Mark sent digest items
    else No prospects found
      Digest->>Slack: Send heartbeat digest
      Digest->>DB: Mark empty digest run
    end
  end
```

---

## 5. Area Map Tambahan

Diagram ini cuma peta ringkas area. Sequence utama tetap ada di section 4.

```mermaid
flowchart TB
  subgraph human["Human / Platform Input"]
    H1["Operator Telegram / manual check"]
    H2["Platform register webhook"]
    H3["Data akun: email wajib; full_name, brand_name, no_hp opsional"]
  end

  subgraph intake["Webhook / Queue"]
    Q1["Webhook intake"]
    Q2["PostgreSQL table: register_intake_jobs"]
    Q3["Sequential worker"]
  end

  subgraph openclaw["OpenClaw AI Layer"]
    O1["OpenClaw session"]
    O2["Investigation Orchestra"]
    O3["AI reasoning loop"]
    O4{"Stop atau lanjut?"}
  end

  subgraph machine["Machine / Go Tools"]
    G1["company_check_go.sh"]
    G2["Go company-check"]
    G3["emailintel / domaincheck / crawler / search / scraper"]
    G4["scoring + evidence + report"]
  end

  subgraph finalization["Finalization"]
    F1["finish_investigation.sh"]
    F2["db_writer.js"]
    F3["token_usage.sh"]
  end

  subgraph output["Storage / Output"]
    S1["evidence/*.json + reports/*.txt"]
    S2["PostgreSQL: investigation_jobs, final_reports, llm_calls"]
    S3["Dashboard"]
    S4["Slack daily digest jam 09:00"]
    S5["Telegram/report delivery"]
  end

  H1 --> H3 --> O1
  H2 --> Q1 --> Q2 --> Q3 --> O1
  O1 --> O2 --> G1 --> G2 --> G3 --> G4 --> O2
  O2 --> O3 --> O4
  O4 -- "butuh evidence lagi" --> G3
  O4 -- "confidence cukup / budget habis / no gain" --> F1
  F1 --> S1
  F1 --> F2 --> S2 --> S3
  F1 --> F3
  F1 --> S5
  S2 --> S4
```

---

## 6. Sequence Detail — Input Masuk

```mermaid
sequenceDiagram
  autonumber
  box Human Platform
    actor Operator as Operator / Manual
    participant Platform as Platform Register
  end

  box OpenClaw AI
    participant Session as OpenClaw Session
    participant Orchestra as Investigation Orchestra
  end

  box Webhook Queue
    participant Webhook as Webhook Intake
    participant DB as PostgreSQL company_detection
    participant Worker as Sequential Worker
  end

  Operator->>Session: /check atau manual input
  Note over Operator,Session: Bisa email saja atau data akun lengkap
  Platform->>Webhook: POST register payload
  Webhook->>DB: Insert into register_intake_jobs
  DB-->>Webhook: intake_job_id
  Webhook-->>Platform: accepted
  Worker->>DB: Lock oldest pending register_intake_jobs row
  Worker->>Session: Start queued investigation
  Session->>Orchestra: Start investigation with account data
```

Input contract:

| Field | Required | Runtime Rule |
|---|---:|---|
| `email` | Yes | Primary signal; bisa `--email`, positional arg, atau JSON |
| `full_name` | No | Identity hint; alias: `fullName`, `name`, `nama` |
| `brand_name` | No | Business hint; alias: `brandName`, `company_field`, `company`, `brand` |
| `no_hp` | No | Confirmation only; alias: `noHp`, `phone`, `hp`; dimasking di report |

Accepted modes:

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

## 7. Sequence Detail — Baseline Go Check

```mermaid
sequenceDiagram
  autonumber
  box OpenClaw AI
    participant Orchestra as Investigation Orchestra
  end

  box Machine / Go Tools
    participant Wrapper as company_check_go.sh
    participant Go as Go company-check
    participant Tools as Deterministic Tools
    participant Scoring as Scoring Engine
  end

  Orchestra->>Wrapper: Run baseline check
  Wrapper->>Go: Pass RegisterInput
  Go->>Tools: Run email domain crawler search scraper
  Tools-->>Go: evidence plus skipped tools plus tool errors
  Go->>Scoring: Score valid evidence only
  Scoring-->>Go: classification + confidence
  Go-->>Orchestra: baseline result
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

## 8. Sequence Detail — AI / Orchestra Loop

```mermaid
sequenceDiagram
  autonumber
  box OpenClaw AI
    participant Orchestra as Investigation Orchestra
    participant Catalog as Tool Catalog
  end

  box Machine / External
    participant External as Search / Fetch / Tools
    participant Scoring as Scoring Engine
  end

  loop Reasoning rounds
    Orchestra->>Orchestra: Observe score account fields and evidence gaps
    Orchestra->>Catalog: Check available tools cost and limits

    alt confidence target reached
      Orchestra->>Orchestra: Stop enough evidence
    else tool budget exhausted
      Orchestra->>Orchestra: Stop preserve current result
    else no useful information gain
      Orchestra->>Orchestra: Stop avoid wasting tools
    else evidence gap remains
      Orchestra->>External: Call selected safe tool/search/fetch
      External-->>Orchestra: evidence OR tool_error OR skipped
      Orchestra->>Scoring: Add only valid evidence
      Scoring-->>Orchestra: updated classification + confidence
    end
  end
```

Rules:

- AI boleh memilih tool dan merangkum evidence.
- AI tidak boleh mengarang evidence.
- Failed tools masuk `tool_errors`, bukan evidence negatif.
- Skipped tools masuk `tools_skipped`.
- `no_hp` hanya untuk konfirmasi, bukan public search seed.
- Classification final tetap evidence-based dan deterministik.

---

## 9. Sequence Detail — Finalization, DB, Dashboard

```mermaid
sequenceDiagram
  autonumber
  box OpenClaw AI
    participant Agent as OpenClaw Agent
  end

  box Queue Runtime
    participant Worker as Sequential Worker
  end

  box Finalization
    participant Finalizer as finish_investigation.sh
    participant Writer as db_writer.js
    participant Token as token_usage.sh
  end

  box Storage Output
    participant Files as evidence/ + reports/
    participant DB as PostgreSQL
    participant Dashboard as Dashboard
  end

  Agent-->>Worker: Final report + classification narrative
  Worker->>Finalizer: email + optional account fields + report + source
  Finalizer->>Files: Save ai_report_latest.txt
  Finalizer->>Files: Save latest evidence/report snapshot
  Finalizer->>Writer: Insert investigation result
  Writer->>DB: investigation_jobs + final_reports + llm_calls
  DB-->>Dashboard: Job visible for review
  Finalizer->>Token: Print model token/cost summary
```

Important boundary:

- AI/OpenClaw Agent produces reasoning, classification narrative, and final report.
- Telegram manual flow may let OpenClaw execute the finalizer directly.
- Webhook queue flow lets the sequential worker execute the finalizer after OpenClaw returns the final report.
- `finish_investigation.sh` and `db_writer.js` perform file and database writes.
- Slack digest later reads from PostgreSQL; AI does not write directly to Slack or storage.

Command wajib setelah investigasi:

```bash
cd openclaw_workspace
scripts/finish_investigation.sh --email <email>
```

---

## 10. Storage Map

```text
File evidence/report
  openclaw_workspace/evidence/latest.json
  openclaw_workspace/reports/ai_report_latest.txt
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

PostgreSQL adalah source of truth operasional. File evidence tetap dipakai untuk audit/debug.

---

## 11. Webhook Queue Path

Webhook adalah jalur platform register aktif. Targetnya bukan direct check, tetapi DB-backed queue lewat PostgreSQL table `register_intake_jobs`.

```mermaid
sequenceDiagram
  autonumber
  box Platform
    participant Platform as Platform Register
  end

  box Webhook Service
    participant Webhook as company-webhook
    participant Worker as Queue Worker
  end

  box Investigation
    participant OpenClaw as OpenClaw Runtime
    participant Finalizer as Finalizer
  end

  box Storage Output
    participant DB as PostgreSQL company_detection
    participant Dashboard as Dashboard
  end

  Platform->>Webhook: POST /webhook/check
  Webhook->>Webhook: Validate secret + sanitize input
  Webhook->>DB: Insert into register_intake_jobs
  DB-->>Webhook: intake_job_id
  Webhook-->>Platform: queued response + dashboard_url
  Worker->>DB: Lock highest-priority due row (live=100, replay=10)
  Worker->>OpenClaw: Run investigation one by one
  alt Provider timeout / HTTP 5xx
    OpenClaw-->>Worker: Provider transient error
    Worker->>DB: retry_pending + next_attempt_at
    Worker->>DB: Persist provider failure evidence
  else Provider auth / credit / model error
    OpenClaw-->>Worker: Provider blocked error
    Worker->>DB: blocked_provider + config fingerprint
  else Investigation succeeds
    OpenClaw->>OpenClaw: Deliver final report to Telegram
    OpenClaw-->>Worker: Return final report
    Worker->>Finalizer: Execute finalizer
    Finalizer->>DB: Persist investigation_jobs final_reports llm_calls
    Worker->>DB: Persist successful real job
  end
  DB-->>Dashboard: Job visible
```

Worker rule:

- Default concurrency is one job at a time.
- One job is processed at a time. A delayed retry does not block newer due jobs.
- Transient provider failures remain retryable; they are not converted to false results.
- Provider-blocked jobs replay automatically after an AI config fingerprint change,
  or manually with `node worker.js replay-provider-failures --all --limit 25`.
- A six-hour timer admits at most 25 legacy failures at priority 10. New
  registrations at priority 100 preempt the backlog.
- Around 100 register payloads per day is small enough for sequential processing.
- Queue rows are persistent in PostgreSQL; they do not disappear daily.

### Operational alert sequence

```mermaid
sequenceDiagram
  autonumber
  participant Timer as Ops Health Timer (2 min)
  participant Systemd as systemd user services
  participant DB as PostgreSQL queues/incidents
  participant SlackProspect as Slack Brands Prospect
  participant SlackMonitor as Slack Negative Monitor

  Timer->>Systemd: Check both worker states
  Timer->>DB: Read queue progress and real AI failure evidence
  Note over Timer,DB: No AI request and no token usage
  alt Investigation incident confirmed
    Timer->>DB: Open/dedupe brands_prospect incident
    Timer->>SlackProspect: Send one alert
  else Negative monitor incident confirmed
    Timer->>DB: Open/dedupe negative_comment_monitor incident
    Timer->>SlackMonitor: Send one alert
  end
  Timer->>DB: Require confirmed service health or 2 real AI successes
  DB-->>Timer: Recovery confirmed
  Timer->>SlackProspect: One recovery for investigation incident
  Timer->>SlackMonitor: One recovery for monitor incident
```

---

## 12. Slack Daily Digest Flow

Slack bukan output raw investigasi. Slack hanya daily handoff untuk sales/stakeholders.

```mermaid
sequenceDiagram
  autonumber
  box Scheduler
    participant Cron as 09:00 Cron
  end

  box Storage
    participant DB as PostgreSQL company_detection
  end

  box Slack
    participant Digest as Digest Script
    participant Channel as Slack Channel
  end

  Cron->>Digest: Run daily prospect digest
  Digest->>DB: Query unsent prospect jobs and digest tables
  DB-->>Digest: prospect list or empty result
  Digest->>Digest: Build Sales Sheet link and prospect summaries

  alt Prospect list found
    Digest->>Channel: Send prospect list and links
    Digest->>DB: Mark digest run and sent items
  else No prospect found
    Digest->>Channel: Send no prospect heartbeat
    Digest->>DB: Mark empty digest run
  end
```

Slack content rule:

- Include browser Sales Sheet link in every digest (`/sales-sheet`).
- Do not include dashboard detail link per prospect in Slack.
- Include Hot/Warm priority, not internal scoring explanation.
- Include available website, marketplace, and social media summary per prospect.
- Show business-friendly summary only.
- Hide raw evidence, AI reasoning detail, scraping flow, tool errors, and scoring internals.

Prospect rule:

- `possible_company_affiliated` with confidence `>= 60`.
- `>= 75` is Hot prospect.
- `60-74` is Warm prospect.
- `--test-run` can send a `[TEST]` preview without marking production digest rows.

---

## 13. Classification Outputs

| Classification | Meaning |
|---|---|
| `possible_company_affiliated` | Business/company signal strong enough |
| `likely_personal_email` | Personal signal stronger, no business evidence |
| `unknown_needs_more_evidence` | Not enough evidence |
| `suspicious_or_invalid` | Invalid/disposable/risky |

---

## 14. Current Status

Validated:

- Manual/Telegram input path.
- Go deterministic baseline.
- OpenClaw reasoning loop.
- `finish_investigation.sh`.
- PostgreSQL storage through finalizer.
- Dashboard.
- Webhook intake queue.
- Sequential worker.
- Slack daily prospect digest at 09:00.

Pending external validation:

- Platform register validation.
