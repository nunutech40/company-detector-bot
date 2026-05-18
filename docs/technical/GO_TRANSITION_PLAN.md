# Go Transition Plan

Dokumen ini adalah building plan untuk memindahkan Company Detector dari Node.js script prototype menuju Go production service/worker.

Keputusan arah:

```text
Node.js sekarang = reference prototype
Go nanti = production implementation
```

Alasan utama pindah ke Go bukan performa mentah. Bottleneck sistem tetap network, AI request, search/scrape, dan rate limit. Alasan utama Go adalah maintainability production: typed contract, unit test standar, single binary deploy, worker/service yang lebih rapi, dan kemungkinan lebih mudah diteruskan oleh tim yang familiar dengan Go.

## 1. Prinsip Transisi

- Jangan rewrite semua sebelum contract stabil.
- Jangan port bug dari JS ke Go tanpa test.
- JS tetap dipakai sebagai reference behavior sampai Go punya parity test.
- Go implementation harus mengikuti input/output/evidence/scoring spec, bukan menebak ulang.
- Queue boleh disiapkan untuk durability, tapi initial processing tetap sequential/concurrency=1.
- `no_hp` tetap privacy-sensitive: internal matching/dedup only, bukan public search default.
- Platform `username` tidak trusted dan tidak boleh jadi basis algoritma.

## 2. Target Input Contract

Input trusted saat ini:

```json
{
  "email": "person@gmail.com",
  "full_name": "Person Name",
  "no_hp": "08123456789",
  "brand_name": "Acme Studio"
}
```

Rules:

- `email`: wajib, primary routing signal.
- `full_name`: optional identity hint.
- `brand_name`: optional business hint.
- `no_hp`: optional internal matching/dedup, masked in output.

Backward-compatible aliases boleh diterima di adapter, tapi internal Go struct harus pakai nama canonical di atas.

## 3. Target Output Contract

Minimal output parity dengan MVP:

```json
{
  "ok": true,
  "job_type": "company_detection_mvp",
  "observed_at": "...",
  "input": {
    "email": "...",
    "full_name": null,
    "no_hp": null,
    "phone_masked": null,
    "brand_name": null,
    "ignored_fields": []
  },
  "classification": "possible_company_affiliated",
  "company_detected": true,
  "confidence_score": 55,
  "confidence_label": "medium",
  "automation_action": "route_company_associated",
  "owner_claim_allowed": false,
  "tools_used": [],
  "tools_skipped": [],
  "tool_errors": [],
  "evidence": [],
  "summary": "...",
  "recommendation": "...",
  "telegram_report": "..."
}
```

Go output harus stabil untuk automation. Report text boleh berubah kecil, tapi JSON contract jangan berubah tanpa versioning.

## 4. Proposed Go Structure

Target folder:

```text
go-service/
  go.mod
  cmd/
    company-check/
      main.go
    worker/
      main.go
  internal/
    input/
    emailintel/
    domaincheck/
    crawler/
    search/
    scraper/
    scoring/
    report/
    evidence/
    slack/
    orchestrator/
  testdata/
```

Awal cukup CLI parity:

```bash
go run ./cmd/company-check --email contact@komerce.id --json
```

Setelah stabil baru service/worker:

```text
HTTP API / queue consumer -> orchestrator -> tools -> scoring -> storage -> optional Slack
```

## 5. Porting Order

### Phase 0: Spec Freeze

Goal: memastikan Go tidak mengejar target bergerak.

Tasks:

- Finalkan input contract `email/full_name/no_hp/brand_name`.
- Finalkan classification enum.
- Finalkan automation action enum.
- Finalkan evidence item schema.
- Finalkan `tools_used/tools_skipped/tool_errors` policy.
- Finalkan fallback/error policy.
- Buat golden test cases dari JS output untuk beberapa input utama.

Exit criteria:

- Docs contract jelas.
- Minimal 8-12 test cases siap.
- Tidak ada field lama seperti trusted `username` di core spec.

### Phase 1: Go Skeleton

Goal: Go project bisa build dan punya CLI minimal.

Tasks:

- Buat `go-service/go.mod`.
- Buat typed structs untuk input, evidence, result, tool status.
- Buat CLI `cmd/company-check`.
- Implement JSON input/output.
- Tambah `go test ./...` baseline.

Exit criteria:

- CLI menerima input.
- CLI mengeluarkan JSON valid.
- CI/local test command jelas.

### Phase 2: Pure Logic Port

Goal: port logic yang tidak butuh network dulu.

Tasks:

- Port `input_normalizer`.
- Port `email_intelligence`.
- Port `serp_query_builder`.
- Port `scoring_engine`.
- Port `report_formatter`.
- Tambah unit test untuk setiap package.

Exit criteria:

- Pure logic parity dengan JS untuk golden cases.
- No network needed.
- Coverage tinggi untuk decision logic.

### Phase 3: Network Tools Port

Goal: port tools yang butuh network dengan timeout dan error policy yang benar.

Tasks:

- Port `domain_checker`.
- Port `website_crawler_router`.
- Port `ddg_search` atau provider search adapter.
- Port `free_scraper`.
- Port `slack_reporter`.
- Semua HTTP client pakai timeout.
- Semua failure masuk `tool_errors`, bukan evidence.

Exit criteria:

- Network tools punya unit test dengan mocked HTTP.
- Integration test bisa dinyalakan manual.
- Error behavior sama dengan policy docs.

### Phase 4: Orchestrator Parity

Goal: Go `company-check` menghasilkan keputusan setara JS untuk MVP.

Tasks:

- Port `company_check` orchestration.
- Implement sequential tool order.
- Implement register input hints.
- Implement Slack explicit-only behavior.
- Implement file evidence writer jika masih dibutuhkan.

Exit criteria:

- Go CLI bisa menggantikan `node scripts/company_check.js`.
- Golden test cases pass.
- Telegram report tetap readable.

### Phase 5: Unit Test And Golden Test

Goal: bikin rewrite aman dan gampang diteruskan.

Test groups:

- Input normalization:
  - email-only
  - full package
  - alias fields
  - ignored username
  - phone masking

- Email intelligence:
  - custom domain
  - free provider
  - role mailbox
  - disposable domain
  - invalid email

- Query builder:
  - custom domain
  - free email + brand_name
  - free email + full_name
  - no username dependency

- Scoring:
  - custom domain company
  - free email personal
  - free email + brand hint remains unknown until evidence exists
  - suspicious invalid

- Report formatter:
  - input fields appear correctly
  - phone is masked
  - no fake evidence

- Slack:
  - no send unless explicit
  - mocked success
  - mocked error

Exit criteria:

```bash
go test ./...
```

must pass before any deploy.

### Phase 6: Real Testing

Goal: test against real environment, but controlled.

Manual test cases:

```bash
go run ./cmd/company-check --email contact@komerce.id --json
go run ./cmd/company-check --email person@gmail.com --full-name "Person Name" --brand-name "Acme Studio" --json
go run ./cmd/company-check --input-json '{"email":"person@gmail.com","full_name":"Person Name","no_hp":"08123456789","brand_name":"Acme Studio"}' --json
```

Real integration checks:

- DNS works from VPS.
- Website fetch timeout works.
- Search provider behavior recorded correctly.
- Slack test sends only when env/flag enabled.
- Evidence output is auditable.

Exit criteria:

- At least 10 known emails tested.
- No false `tools_used`.
- No failed tool becomes evidence.
- Slack sends successfully with current token/channel env.

### Phase 7: Deployment And Cutover

Initial cutover should be reversible.

Steps:

1. Build Go binary:

```bash
go build -o bin/company-check ./cmd/company-check
```

2. Deploy binary to VPS workspace.

3. Add OpenClaw command option:

```bash
./bin/company-check --email <email> --json
```

4. Run side-by-side mode:

```text
JS result vs Go result
```

5. Switch Telegram agent prompt from Node command to Go command only after parity is good.

6. Keep JS scripts for rollback/reference until Go has production confidence.

Rollback:

```bash
node scripts/company_check.js <email> --save
```

## 6. Production Shape After Go

Recommended final shape:

```text
Platform register event
-> Go API / job creator
-> durable queue
-> Go worker with concurrency=1 initially
-> Postgres evidence store
-> Slack alert decision
-> dashboard/API result
```

Concurrency policy:

- Start with `concurrency=1`.
- Increase only after rate limits, cost, and evidence quality are stable.
- Multi-agent/parallelism is a later optimization, not first production requirement.

## 7. What Not To Do Yet

- Do not rewrite dashboard before core detection contract is stable.
- Do not add parallel workers before sequential path is reliable.
- Do not use phone for public scraping by default.
- Do not trust username from register.
- Do not make Slack alert every result.
- Do not use LLM output as evidence unless backed by tool/source evidence.

## 8. Suggested Implementation Sequence

Recommended order:

1. Freeze docs/spec.
2. Add golden test fixtures from current JS behavior.
3. Create Go skeleton.
4. Port pure logic.
5. Port network tools.
6. Port orchestrator.
7. Add unit tests.
8. Add integration tests.
9. Deploy side-by-side.
10. Cut over OpenClaw command.
11. Keep JS as rollback until stable.

## 9. Open Questions

- Should Go service live in this repo under `go-service/` or become a separate repo?
- Should file evidence writer remain during Go MVP, or jump directly to Postgres?
- Should OpenClaw call Go CLI directly, or call an HTTP endpoint?
- How many golden fixtures are enough before cutover?
- Who owns Slack token/env rotation for production?
