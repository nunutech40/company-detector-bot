# Go Transition Execution Checklist

Checklist ini dipakai untuk mengerjakan transisi Go satu langkah kecil per satu langkah kecil. Jangan centang item sebelum code/docs/test terkait benar-benar selesai.

Legend:

- `[ ]` belum dikerjakan
- `[x]` selesai
- `Gate` berarti checkpoint; jangan lanjut phase berikutnya sebelum gate pass

## Phase 0: Spec Freeze

Goal: Go rewrite tidak mengejar target yang bergerak.

- [ ] Confirm input canonical fields: `email`, `full_name`, `no_hp`, `brand_name`.
- [ ] Confirm `username`, `signup_source`, `referrer`, `country/ip_country` are not trusted core inputs.
- [ ] Confirm `no_hp` is internal matching/dedup only and masked in outputs.
- [ ] Define `Classification` enum:
  - `possible_company_affiliated`
  - `unknown_needs_more_evidence`
  - `likely_personal_email`
  - `suspicious_or_invalid`
- [ ] Define `AutomationAction` enum:
  - `route_company_associated`
  - `continue_as_personal_or_unknown`
  - `risk_or_format_review`
  - `store_unknown_retry_later`
- [ ] Define `EvidenceItem` schema.
- [ ] Define `ToolSkipped` schema.
- [ ] Define `ToolError` schema.
- [ ] Define `CompanyCheckResult` schema.
- [ ] Define Slack send policy: explicit flag/env only.
- [ ] Define public search policy: do not search phone by default.
- [ ] Define report claim policy: no founder/owner without explicit source evidence.
- [ ] Add contract examples to docs if missing.

Gate:

- [ ] Docs clearly say JS is reference prototype and Go is production target.
- [ ] Docs clearly say current trusted input is 4 fields only.
- [ ] No core spec depends on trusted `username`.

## Phase 0.5: Golden Fixtures

Goal: create expected behavior before porting.

- [ ] Create `test-fixtures/inputs/email_custom_domain.json`.
- [ ] Create `test-fixtures/inputs/email_free_only.json`.
- [ ] Create `test-fixtures/inputs/email_free_with_brand.json`.
- [ ] Create `test-fixtures/inputs/email_invalid.json`.
- [ ] Create `test-fixtures/inputs/email_disposable.json`.
- [ ] Create `test-fixtures/inputs/role_mailbox.json`.
- [ ] Create `test-fixtures/inputs/input_with_ignored_username.json`.
- [ ] Create `test-fixtures/expected/*.json` from current accepted JS behavior.
- [ ] Normalize expected outputs so timestamps/network flaky fields do not make tests brittle.
- [ ] Document which fields must match exactly and which fields are allowed to differ.

Suggested exact-match fields:

- `ok`
- `classification`
- `automation_action`
- `owner_claim_allowed`
- `input.email`
- `input.full_name`
- `input.brand_name`
- `input.phone_masked`
- `tools_skipped[].tool/reason` for deterministic skips

Suggested loose-match fields:

- `observed_at`
- live website status
- live search results
- network latency
- final report wording, unless explicitly tested

Gate:

- [ ] At least 8 golden fixture cases exist.
- [ ] Fixtures cover custom domain, free email, invalid email, brand hint, phone masking, ignored username.

## Phase 1: Go Skeleton

Goal: Go project exists and test command works.

- [ ] Create `go-service/go.mod`.
- [ ] Create `go-service/cmd/company-check/main.go`.
- [ ] Create `go-service/internal/model` or equivalent shared types package.
- [ ] Add `Input`, `EvidenceItem`, `ToolSkipped`, `ToolError`, `CompanyCheckResult` structs.
- [ ] Add typed constants for classification and automation actions.
- [ ] Add CLI flags:
  - `--email`
  - `--full-name`
  - `--no-hp`
  - `--brand-name`
  - `--input-json`
  - `--json`
  - `--save`
  - `--send-slack`
- [ ] Add `go test ./...` baseline.
- [ ] Add `go fmt ./...` formatting baseline.
- [ ] Add README command examples for Go CLI, marked as future/in-progress until ready.

Gate:

- [ ] `cd go-service && go test ./...` passes.
- [ ] `cd go-service && go run ./cmd/company-check --email test@gmail.com --json` returns valid JSON skeleton.

## Phase 2: Pure Logic Port

Goal: port deterministic logic first, without network.

### Input Normalizer

- [ ] Port input normalization.
- [ ] Port email lowercase behavior.
- [ ] Port phone cleanup.
- [ ] Port phone masking.
- [ ] Port ignored fields reporting.
- [ ] Unit test email-only input.
- [ ] Unit test full package input.
- [ ] Unit test alias input if supported.
- [ ] Unit test ignored username.

### Email Intelligence

- [ ] Port free domain set.
- [ ] Port disposable hints.
- [ ] Port role mailbox set.
- [ ] Port email validation.
- [ ] Unit test custom domain.
- [ ] Unit test free provider.
- [ ] Unit test role mailbox.
- [ ] Unit test disposable domain.
- [ ] Unit test invalid email.

### Query Builder

- [ ] Port custom-domain queries.
- [ ] Port brand-name queries.
- [ ] Port full-name queries.
- [ ] Port local-part query.
- [ ] Ensure free email does not generate Gmail/company domain queries.
- [ ] Ensure username is not used as trusted query source.
- [ ] Unit test custom domain query ordering.
- [ ] Unit test free email + brand primary query.
- [ ] Unit test free email + full_name fallback.

### Scoring

- [ ] Port score clamp.
- [ ] Port confidence labels.
- [ ] Port classification logic.
- [ ] Port automation action mapping.
- [ ] Ensure brand_name alone on free email does not claim company affiliation.
- [ ] Unit test every classification.

### Report Formatter

- [ ] Port Telegram/text report formatter.
- [ ] Include email.
- [ ] Include full_name only when present.
- [ ] Include brand_name only when present.
- [ ] Include masked phone only when present.
- [ ] Unit test phone never appears unmasked.
- [ ] Unit test failed tools appear under failures.
- [ ] Unit test skipped tools appear under skipped.

Gate:

- [ ] Pure logic packages pass unit tests.
- [ ] Pure logic golden fixtures pass for network-free fields.

## Phase 3: Network Tool Port

Goal: network tools behave predictably and are testable with mocks.

### Domain Checker

- [ ] Implement DNS MX lookup.
- [ ] Implement A/AAAA lookup if needed.
- [ ] Implement HTTP website probe with timeout.
- [ ] Unit test active website with mock server.
- [ ] Unit test dead website.
- [ ] Unit test timeout.
- [ ] Unit test DNS failure does not crash whole job.

### Website Crawler Router

- [ ] Implement candidate paths.
- [ ] Implement per-page HTTP timeout.
- [ ] Extract title/meta/short content if needed.
- [ ] Unit test active candidate page.
- [ ] Unit test no active pages.
- [ ] Unit test business-signal page.

### Search Adapter

- [ ] Decide whether to port DDG fallback or replace with provider adapter.
- [ ] Define `SearchResult` struct.
- [ ] Implement timeout.
- [ ] Unit test successful search with mocked HTML/API.
- [ ] Unit test provider failure.
- [ ] Ensure failure goes to `tool_errors`.
- [ ] Ensure failed search does not create evidence.

### Free Scraper

- [ ] Implement HTTP fetch with timeout.
- [ ] Strip/extract readable text enough for MVP.
- [ ] Unit test business-like text.
- [ ] Unit test non-business text.
- [ ] Unit test timeout/error.

### Slack Reporter

- [ ] Implement Slack API `chat.postMessage`.
- [ ] Read `SLACK_BOT_TOKEN`.
- [ ] Read `SLACK_REPORT_CHANNEL`.
- [ ] Support explicit-only send.
- [ ] Unit test mocked success.
- [ ] Unit test mocked `channel_not_found`.
- [ ] Unit test missing token returns clean false/error.

Gate:

- [ ] Network tools pass mocked unit tests.
- [ ] No network unit test depends on live internet.
- [ ] All HTTP calls have timeouts.

## Phase 4: Orchestrator Port

Goal: Go CLI runs the full MVP flow.

- [ ] Implement orchestrator sequence:
  - email intelligence
  - custom domain domain check
  - custom domain crawler
  - query builder
  - search adapter
  - scrape active URL
  - scoring
  - report
  - save if explicit
  - Slack if explicit
- [ ] Implement `tools_used` policy: only successful tools.
- [ ] Implement `tool_errors` policy: failed tools.
- [ ] Implement `tools_skipped` policy: disabled/not-applicable tools.
- [ ] Implement browser skip reason.
- [ ] Implement paid provider skip reasons.
- [ ] Implement `--save`.
- [ ] Implement `--send-slack`.
- [ ] Implement `--json`.
- [ ] Implement exit code convention.

Gate:

- [ ] Go CLI can run email-only custom domain.
- [ ] Go CLI can run free email + full_name + brand_name.
- [ ] Go CLI can run `--input-json`.
- [ ] Go CLI output is automation-safe JSON.

## Phase 5: Storage Strategy

Goal: decide safe persistence path.

Option A: Keep file evidence writer first.

- [ ] Port file evidence writer.
- [ ] Preserve retention policy.
- [ ] Unit test file path generation.
- [ ] Unit test retention cleanup.

Option B: Jump to Postgres writer.

- [ ] Define migrations.
- [ ] Implement DB connection config.
- [ ] Implement insert `investigation_jobs`.
- [ ] Implement insert `tool_runs`.
- [ ] Implement insert `evidence_items`.
- [ ] Implement insert `final_reports`.
- [ ] Add DB integration tests with test database or container.

Recommended initial choice:

- [ ] Use file writer first for parity, then add Postgres in a separate phase.

Gate:

- [ ] Storage decision is documented before implementation.

## Phase 6: Integration Tests

Goal: controlled real-world verification.

- [ ] Add `make test` or documented equivalent.
- [ ] Add `make integration-test` or documented equivalent.
- [ ] Integration tests are opt-in, not run by default.
- [ ] Test custom domain sample.
- [ ] Test free email + brand sample.
- [ ] Test invalid email.
- [ ] Test Slack send with env token/channel.
- [ ] Test timeout behavior from VPS.
- [ ] Test OpenClaw command invocation locally.

Gate:

- [ ] `go test ./...` passes.
- [ ] At least 10 manual/real cases tested and recorded.
- [ ] Slack sends only with explicit flag/env.
- [ ] No failed tool is recorded as evidence.

## Phase 7: Side-By-Side Parity

Goal: compare JS and Go before cutover.

- [ ] Create script or command doc for running JS and Go on same input.
- [ ] Compare classification.
- [ ] Compare confidence score range.
- [ ] Compare automation action.
- [ ] Compare tools used/skipped/errors policy.
- [ ] Compare evidence count and source types.
- [ ] Record known acceptable differences.

Gate:

- [ ] Go matches JS on core decisions for golden fixtures.
- [ ] Any intentional behavior differences are documented.

## Phase 8: VPS Deploy

Goal: deploy Go without breaking current bot.

- [ ] Confirm Go version on VPS or build binary locally for VPS target.
- [ ] Build binary:

```bash
cd go-service
go build -o bin/company-check ./cmd/company-check
```

- [ ] Copy binary to VPS workspace.
- [ ] Run binary on VPS manually.
- [ ] Configure env vars:
  - `SLACK_BOT_TOKEN`
  - `SLACK_REPORT_CHANNEL`
  - model/AI env if needed later
- [ ] Add Go command note to OpenClaw docs.
- [ ] Keep Node command available for rollback.

Gate:

- [ ] VPS manual Go check succeeds.
- [ ] VPS Slack test succeeds if enabled.
- [ ] Node fallback still works.

## Phase 9: OpenClaw Cutover

Goal: switch Telegram runtime carefully.

- [ ] Update `openclaw_workspace/AGENTS.md` command from Node to Go only after parity.
- [ ] Update `openclaw_workspace/TOOLS.md`.
- [ ] Update `tool_catalog.yaml`.
- [ ] Restart OpenClaw/Gateway if needed.
- [ ] Test Telegram `/check contact@komerce.id`.
- [ ] Test Telegram free email + available metadata path if supported.
- [ ] Test `/tool_status`.
- [ ] Test `/last_report` or Go replacement.

Gate:

- [ ] Telegram bot returns Go-generated report.
- [ ] Rollback command is documented.

## Phase 10: Production Hardening

Goal: make Go implementation production-worthy.

- [ ] Add structured logging.
- [ ] Add request/job id.
- [ ] Add config validation at startup.
- [ ] Add timeout config.
- [ ] Add retry/backoff policy for selected tools.
- [ ] Add rate limit policy.
- [ ] Add metrics plan.
- [ ] Add error taxonomy.
- [ ] Add secrets rotation notes.
- [ ] Add release/build instructions.

Gate:

- [ ] Production runbook exists.
- [ ] Failure modes are documented.
- [ ] Tests pass before release.

## Final Done Criteria

Transisi dianggap selesai kalau:

- [ ] Go implementation is the primary runtime.
- [ ] Node implementation remains only as archived reference or rollback.
- [ ] `go test ./...` passes.
- [ ] Real integration tests have been run from VPS.
- [ ] Telegram check works.
- [ ] Slack explicit send works.
- [ ] Evidence/report output is auditable.
- [ ] Docs point to Go as production implementation.
- [ ] Backlog items for Go transition are checked or moved to future hardening.
