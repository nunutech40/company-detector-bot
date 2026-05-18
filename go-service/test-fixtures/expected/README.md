# Expected Fixture Policy

Expected behavior is currently covered by Go unit tests rather than static full-result JSON files.

Exact-match fields:

- `ok`
- `classification`
- `automation_action`
- `owner_claim_allowed`
- `input.email`
- `input.full_name`
- `input.brand_name`
- `input.phone_masked`
- deterministic `tools_skipped` for network-disabled runs

Loose-match fields:

- `observed_at`
- live website status
- live search results
- network latency
- final report wording

Static full JSON fixtures should be added only after JS vs Go parity is frozen, because live DNS/search/scrape fields are intentionally unstable.
