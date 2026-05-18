# Go Transition Execution Checklist

Checklist ini dipakai untuk mengerjakan transisi Go satu langkah kecil per satu langkah kecil. Jangan centang item sebelum code/docs/test terkait benar-benar selesai.

Current status as of 2026-05-18:

- Go CLI MVP exists in `go-service/cmd/company-check`.
- Pure logic, network adapters, orchestrator, Slack adapter, and file evidence writer are implemented.
- `cd go-service && env GOCACHE=/private/tmp/company-detector-go-cache go test ./...` passes locally.
- Real network smoke test against `contact@komerce.id` succeeded for DNS/domain/crawler/scraper; DuckDuckGo HTML search was blocked by local network filtering (`internetpositif.id` certificate), so search provider replacement remains future work.
- Local OpenClaw workspace command/prompt has been cut over to Go through `openclaw_workspace/scripts/company_check_go.sh`.
- VPS binary deployment and Telegram restart/live test remain pending.

Legend:

- `[ ]` belum dikerjakan
- `[x]` selesai
- `Gate` berarti checkpoint; jangan lanjut phase berikutnya sebelum gate pass

## Phase 0: Spec Freeze

Goal: Go rewrite tidak mengejar target yang bergerak.

- [x] Confirm input canonical fields: `email`, `full_name`, `no_hp`, `brand_name`.
- [x] Confirm `username`, `signup_source`, `referrer`, `country/ip_country` are not trusted core inputs.
- [x] Confirm `no_hp` is internal matching/dedup only and masked in outputs.
- [x] Define `Classification` enum:
  - `possible_company_affiliated`
  - `unknown_needs_more_evidence`
  - `likely_personal_email`
  - `suspicious_or_invalid`
- [x] Define `AutomationAction` enum:
  - `route_company_associated`
  - `continue_as_personal_or_unknown`
  - `risk_or_format_review`
  - `store_unknown_retry_later`
- [x] Define `EvidenceItem` schema.
- [x] Define `ToolSkipped` schema.
- [x] Define `ToolError` schema.
- [x] Define `CompanyCheckResult` schema.
- [x] Define Slack send policy: explicit flag/env only.
- [x] Define public search policy: do not search phone by default.
- [x] Define report claim policy: no founder/owner without explicit source evidence.
- [x] Add contract examples to docs if missing.

Gate:

- [x] Docs clearly say JS is reference prototype and Go is production target.
- [x] Docs clearly say current trusted input is 4 fields only.
- [x] No core spec depends on trusted `username`.

## Phase 0.5: Golden Fixtures

Goal: create expected behavior before porting.

- [x] Create `test-fixtures/inputs/email_custom_domain.json`.
- [x] Create `test-fixtures/inputs/email_free_only.json`.
- [x] Create `test-fixtures/inputs/email_free_with_brand.json`.
- [x] Create `test-fixtures/inputs/email_invalid.json`.
- [x] Create `test-fixtures/inputs/email_disposable.json`.
- [x] Create `test-fixtures/inputs/role_mailbox.json`.
- [x] Create `test-fixtures/inputs/input_with_ignored_username.json`.
- [ ] Create `test-fixtures/expected/*.json` from current accepted JS behavior.
- [x] Normalize expected outputs so timestamps/network flaky fields do not make tests brittle.
- [x] Document which fields must match exactly and which fields are allowed to differ.

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

- [x] At least 8 golden fixture cases exist.
- [x] Fixtures cover custom domain, free email, invalid email, brand hint, phone masking, ignored username.

## Phase 1: Go Skeleton

Goal: Go project exists and test command works.

- [x] Create `go-service/go.mod`.
- [x] Create `go-service/cmd/company-check/main.go`.
- [x] Create `go-service/internal/model` or equivalent shared types package.
- [x] Add `Input`, `EvidenceItem`, `ToolSkipped`, `ToolError`, `CompanyCheckResult` structs.
- [x] Add typed constants for classification and automation actions.
- [x] Add CLI flags:
  - `--email`
  - `--full-name`
  - `--no-hp`
  - `--brand-name`
  - `--input-json`
  - `--json`
  - `--save`
  - `--send-slack`
- [x] Add `go test ./...` baseline.
- [x] Add `go fmt ./...` formatting baseline.
- [x] Add README command examples for Go CLI.

Gate:

- [x] `cd go-service && go test ./...` passes.
- [x] `cd go-service && go run ./cmd/company-check --email test@gmail.com --json` returns valid JSON skeleton.

## Phase 2: Pure Logic Port

Goal: port deterministic logic first, without network.

### Input Normalizer

- [x] Port input normalization.
- [x] Port email lowercase behavior.
- [x] Port phone cleanup.
- [x] Port phone masking.
- [x] Port ignored fields reporting.
- [x] Unit test email-only input.
- [x] Unit test full package input.
- [x] Unit test alias input if supported.
- [x] Unit test ignored username.

### Email Intelligence

- [x] Port free domain set.
- [x] Port disposable hints.
- [x] Port role mailbox set.
- [x] Port email validation.
- [x] Unit test custom domain.
- [x] Unit test free provider.
- [x] Unit test role mailbox.
- [x] Unit test disposable domain.
- [x] Unit test invalid email.

### Query Builder

- [x] Port custom-domain queries.
- [x] Port brand-name queries.
- [x] Port full-name queries.
- [x] Port local-part query.
- [x] Ensure free email does not generate Gmail/company domain queries.
- [x] Ensure username is not used as trusted query source.
- [x] Unit test custom domain query ordering.
- [x] Unit test free email + brand primary query.
- [x] Unit test free email + full_name fallback.

### Scoring

- [x] Port score clamp.
- [x] Port confidence labels.
- [x] Port classification logic.
- [x] Port automation action mapping.
- [x] Ensure brand_name alone on free email does not claim company affiliation.
- [x] Unit test every classification.

### Report Formatter

- [x] Port Telegram/text report formatter.
- [x] Include email.
- [x] Include full_name only when present.
- [x] Include brand_name only when present.
- [x] Include masked phone only when present.
- [x] Unit test phone never appears unmasked.
- [x] Unit test failed tools appear under failures.
- [x] Unit test skipped tools appear under skipped.

Gate:

- [x] Pure logic packages pass unit tests.
- [x] Pure logic golden fixtures pass for network-free fields.

## Phase 3: Network Tool Port

Goal: network tools behave predictably and are testable with mocks.

### Domain Checker

- [x] Implement DNS MX lookup.
- [x] Implement A/AAAA lookup if needed.
- [x] Implement HTTP website probe with timeout.
- [ ] Unit test active website with mock server/fake transport.
- [ ] Unit test dead website.
- [ ] Unit test timeout.
- [x] Unit test DNS/invalid failure does not crash whole job.

### Website Crawler Router

- [x] Implement candidate paths.
- [x] Implement per-page HTTP timeout.
- [x] Extract title/meta/short content if needed.
- [x] Unit test active candidate page.
- [ ] Unit test no active pages.
- [x] Unit test business-signal page.

### Search Adapter

- [x] Decide whether to port DDG fallback or replace with provider adapter.
- [x] Define `SearchResult` struct.
- [x] Implement timeout.
- [x] Unit test successful search with mocked HTML/API.
- [x] Unit test provider failure.
- [x] Ensure failure goes to `tool_errors`.
- [x] Ensure failed search does not create evidence.

### Free Scraper

- [x] Implement HTTP fetch with timeout.
- [x] Strip/extract readable text enough for MVP.
- [x] Unit test business-like text.
- [ ] Unit test non-business text.
- [x] Unit test timeout/error.

### Slack Reporter

- [x] Implement Slack API `chat.postMessage`.
- [x] Read `SLACK_BOT_TOKEN`.
- [x] Read `SLACK_REPORT_CHANNEL`.
- [x] Support explicit-only send.
- [x] Unit test mocked success.
- [x] Unit test mocked `channel_not_found`.
- [x] Unit test missing token returns clean false/error.

Gate:

- [x] Network tools pass mocked unit tests.
- [x] No network unit test depends on live internet.
- [x] All HTTP calls have timeouts.

## Phase 4: Orchestrator Port

Goal: Go CLI runs the full MVP flow.

- [x] Implement orchestrator sequence:
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
- [x] Implement `tools_used` policy: only successful tools.
- [x] Implement `tool_errors` policy: failed tools.
- [x] Implement `tools_skipped` policy: disabled/not-applicable tools.
- [x] Implement browser skip reason.
- [x] Implement paid provider skip reasons.
- [x] Implement `--save`.
- [x] Implement `--send-slack`.
- [x] Implement `--json`.
- [x] Implement exit code convention.

Gate:

- [x] Go CLI can run email-only custom domain.
- [x] Go CLI can run free email + full_name + brand_name.
- [x] Go CLI can run `--input-json`.
- [x] Go CLI output is automation-safe JSON.

## Phase 5: Storage Strategy

Goal: decide safe persistence path.

Option A: Keep file evidence writer first.

- [x] Port file evidence writer.
- [ ] Preserve retention policy.
- [x] Unit test file path generation.
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

- [x] Use file writer first for parity, then add Postgres in a separate phase.

Gate:

- [x] Storage decision is documented before implementation.

## Phase 6: Integration Tests

Goal: controlled real-world verification.

- [ ] Add `make test` or documented equivalent.
- [ ] Add `make integration-test` or documented equivalent.
- [ ] Integration tests are opt-in, not run by default.
- [x] Test custom domain sample.
- [x] Test free email + brand sample.
- [x] Test invalid email.
- [ ] Test Slack send with env token/channel.
- [ ] Test timeout behavior from VPS.
- [ ] Test OpenClaw command invocation locally.

Gate:

- [x] `go test ./...` passes.
- [ ] At least 10 manual/real cases tested and recorded.
- [x] Slack sends only with explicit flag/env.
- [x] No failed tool is recorded as evidence.

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

- [x] Go matches intended core decisions for network-free golden fixtures.
- [ ] Any intentional behavior differences are documented.

## Phase 8: VPS Deploy

Goal: deploy Go without breaking current bot.

- [ ] Confirm Go version on VPS or build binary locally for VPS target.
- [x] Build binary locally:

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
- [x] Add Go command note to OpenClaw docs.
- [x] Keep Node command available for rollback.

Gate:

- [ ] VPS manual Go check succeeds.
- [ ] VPS Slack test succeeds if enabled.
- [x] Node fallback still exists in repo.

## Phase 9: OpenClaw Cutover

Goal: switch Telegram runtime carefully.

- [x] Update `openclaw_workspace/AGENTS.md` command from Node to Go after local parity.
- [x] Update `openclaw_workspace/TOOLS.md`.
- [x] Update `tool_catalog.yaml`.
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
- [x] `go test ./...` passes.
- [ ] Real integration tests have been run from VPS.
- [ ] Telegram check works.
- [ ] Slack explicit send works.
- [x] Evidence/report output is auditable.
- [ ] Docs point to Go as production implementation.
- [ ] Backlog items for Go transition are checked or moved to future hardening.
