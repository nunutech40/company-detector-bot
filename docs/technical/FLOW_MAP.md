# Flow Map

Dokumen ini adalah peta alur sistem. Tujuannya supaya flow tetap gampang dibaca walaupun nanti jumlah tool, enrichment, dashboard, dan multi-agent bertambah.

Gunakan dokumen ini untuk menjelaskan sistem ke orang lain dan untuk menilai impact sebelum mengubah flow.

## 1. Mental Model

Sistem ini bukan satu script besar yang bebas menebak. Sistem ini adalah investigation pipeline yang punya kontrak jelas:

```text
Input
-> Normalize
-> Collect evidence
-> Score
-> Decide action
-> Store
-> Notify if important
```

Versi MVP masih single orchestrator. Multi-agent nanti hanya memecah tahap evidence collection, bukan mengubah keputusan produk dasar.

## 2. Current MVP Flow

```text
Telegram / CLI input
  |
  v
company_check.js
  |
  +-> email_intelligence.js
  |
  +-> if custom domain:
  |     +-> domain_checker.js
  |     +-> website_crawler_router.js
  |
  +-> serp_query_builder.js
  |
  +-> ddg_search.js
  |
  +-> if active URL exists:
  |     +-> free_scraper.js
  |
  +-> scoring_engine.js
  |
  +-> report_formatter.js
  |
  +-> if --save:
  |     +-> evidence_store.js
  |
  +-> if --send-slack or env enabled:
        +-> slack_reporter.js
```

Current entry command:

```bash
node scripts/company_check.js <email> --save
```

Current register-package command:

```bash
node scripts/company_check.js <email> --full-name "Person Name" --no-hp "08123456789" --brand-name "Acme Studio" --save
```

## 3. Decision Points

### D1: Is the input a valid email?

Owner:

```text
email_intelligence.js
```

If invalid:

```text
classification = suspicious_or_invalid
domain/web/search steps should not create business claims
```

### D2: Is the domain a known free provider?

Owner:

```text
email_intelligence.js
```

If free provider:

```text
skip domain_checker
skip website_crawler_router
build public-profile query from email local-part
classification usually likely_personal_email unless later evidence changes it
```

If custom domain:

```text
run domain_checker
run website_crawler_router
build company/domain queries
```

### D3: Was lightweight website evidence found?

Owners:

```text
domain_checker.js
website_crawler_router.js
free_scraper.js
```

If yes:

```text
browser skipped reason = skipped_not_needed_for_mvp
```

If no:

```text
browser skipped reason = optional_fallback_disabled_for_mvp
```

Browser is not automatic in MVP.

### D4: Did a fallback tool really run?

Owners:

```text
company_check.js
ddg_search.js
free_scraper.js
```

Rules:

```text
success -> tools_used
failure -> tool_errors
not applicable -> tools_skipped
```

Never put a failed or not-called tool in `tools_used`.

### D5: What classification should be returned?

Owner:

```text
scoring_engine.js
```

Current rules:

```text
invalid/disposable -> suspicious_or_invalid
free email + weak evidence -> likely_personal_email
custom domain + active website -> possible_company_affiliated
custom domain + enough evidence -> possible_company_affiliated
otherwise -> unknown_needs_more_evidence
```

### D6: Should Slack be notified?

Current MVP:

```text
Only if explicitly enabled with --send-slack or COMPANY_DETECTION_SEND_SLACK=true.
```

Future production:

Use alert decision rules from [Product Workflow and Storage Plan](../product/PRODUCT_WORKFLOW_AND_STORAGE_PLAN.md).

## 4. Data Flow

### Input

Current MVP input:

```json
{
  "email": "contact@komerce.id",
  "full_name": "Nurul Hida",
  "no_hp": "081393707778",
  "brand_name": "Montclair"
}
```

Current platform input contract:

```json
{
  "email": "person@gmail.com",
  "full_name": "Person Name",
  "no_hp": "08123456789",
  "brand_name": "Acme Studio"
}
```

Field rules:

- `email` is required and remains the primary routing signal.
- `full_name` is optional and can help personal-to-business discovery.
- `brand_name` is optional and is the strongest non-email business hint.
- `no_hp` is optional and privacy-sensitive; use it for internal matching/dedup only, not public web search by default.
- `username`, `signup_source`, `referrer`, and `country/ip_country` are not trusted inputs in the current contract because platform registration cannot provide them reliably.

### Evidence

Every tool should contribute evidence only when it has a real observation:

```json
{
  "source_type": "company_website",
  "source_url": "https://komerce.id/",
  "claim": "Domain website is active and has a readable title.",
  "value": "Komerce - End-to-end e-commerce enabler",
  "reliability": "medium",
  "confidence_delta": 20
}
```

### Output

MVP output:

```json
{
  "classification": "possible_company_affiliated",
  "confidence_score": 100,
  "automation_action": "route_company_associated",
  "tools_used": [],
  "tools_skipped": [],
  "tool_errors": [],
  "evidence": [],
  "telegram_report": "..."
}
```

Next-level output will add:

```json
{
  "company_profile": {},
  "person_profile": {},
  "business_relationship": "founder_or_owner_candidate"
}
```

## 5. How To Change The Flow Safely

Before changing a tool:

1. Find the tool in [Tools and Algorithms Reference](TOOLS_AND_ALGORITHMS.md).
2. Check which decision point uses it in this file.
3. Check whether it affects `tools_used`, `tools_skipped`, `tool_errors`, or `evidence`.
4. Check whether scoring changes are needed in `scoring_engine.js`.
5. Update docs and tests together.

Safe change examples:

- Add a new free email domain in `email_intelligence.js`.
- Add a candidate crawl path in `website_crawler_router.js`.
- Add a new low-confidence evidence type from DDG snippets.

Risky change examples:

- Raising confidence deltas.
- Moving failed tools into evidence.
- Auto-enabling Slack alerts for every check.
- Making browser default for all jobs.
- Claiming founder/owner from one weak snippet.

## 6. Future Multi-Agent Flow

Multi-agent should not make the product logic harder to understand. It should map to the same stages:

```text
Orchestrator Agent
  |
  +-> Email/Identity Agent
  +-> Company Website Agent
  +-> Web Research Agent
  +-> Public Profile Agent
  +-> Scoring Agent
  +-> Report Agent
```

Agent responsibilities:

- Orchestrator: owns job state and stop/continue decision.
- Email/Identity Agent: parses email, full_name, brand_name, no_hp-safe metadata, and identity hints.
- Company Website Agent: checks domain, website pages, schema, social links.
- Web Research Agent: performs SERP/search discovery.
- Public Profile Agent: checks LinkedIn via SERP, X, GitHub, Product Hunt, personal sites.
- Scoring Agent: converts evidence graph into classification/confidence/action.
- Report Agent: formats Telegram/Slack/dashboard summaries.

Rule:

```text
Sub-agents collect evidence. Scoring and final claims stay centralized.
```

That prevents each agent from making conflicting final decisions.

## 7. Document Map

- [Root README](../../README.md): project entry point.
- [Docs Index](../README.md): reading order and documentation map.
- [High Level Business Flow](../product/HIGH_LEVEL_BUSINESS_FLOW.md): business-level current vs level-2 flow.
- [Flow Map](FLOW_MAP.md): readable end-to-end flow and decision points.
- [Tools and Algorithms Reference](TOOLS_AND_ALGORITHMS.md): detailed tool and algorithm reference.
- [Next Level Enrichment Plan](../product/NEXT_LEVEL_ENRICHMENT_PLAN.md): future enrichment design.
- [Product Workflow and Storage Plan](../product/PRODUCT_WORKFLOW_AND_STORAGE_PLAN.md): Postgres, Slack, dashboard workflow.
- [Backlog](../../BACKLOG.md): implementation tasks.
- [OpenClaw Agent Prompt](../../openclaw_workspace/AGENTS.md): runtime behavior contract for OpenClaw agent.
- [Tool Notes](../../openclaw_workspace/TOOLS.md): runtime tool notes.
- [Tool Catalog](../../openclaw_workspace/config/tool_catalog.yaml): tool registry.
- [Scoring Rules](../../openclaw_workspace/config/scoring_rules.yaml): scoring reference.
