# Product Workflow And Storage Plan

Dokumen ini menjembatani MVP Telegram saat ini dengan target production: semua hasil investigasi tersimpan di database, Slack hanya menerima alert penting, dan web dashboard dipakai untuk melihat/search/review keseluruhan data.

## 1. Core Decision

Sistem tidak boleh menjadikan Slack sebagai tempat penyimpanan utama.

Pembagian tanggung jawab:

```text
Postgres = source of truth untuk semua hasil investigasi
Slack    = alert channel untuk hasil penting
Dashboard = browse/search/review UI untuk semua hasil
```

MVP saat ini masih memakai file:

```text
evidence/*.json
reports/*.txt
evidence/audit.jsonl
```

File evidence ini adalah prototype dari Postgres evidence store. Nanti struktur dan semantik datanya harus dipindah ke tabel database, bukan dibuang.

## 2. Data Lifecycle

Target production lifecycle:

```text
Platform registration event / Telegram check
-> create investigation job
-> run email-first detection/enrichment
-> write all tool runs and evidence to Postgres
-> compute classification/confidence/action
-> decide whether Slack alert is needed
-> store final report
-> expose result in dashboard
```

Flow detail:

1. User/register event masuk dengan minimal `email`.
2. Worker membuat `investigation_jobs` row.
3. Register payload disimpan di `register_snapshots`.
4. Tools dijalankan sesuai route:
   - email intelligence
   - domain checker
   - website crawler
   - SERP/search fallback
   - scraper
   - enrichment tools jika tersedia
5. Setiap tool call masuk `tool_runs`.
6. Setiap bukti masuk `evidence_items`.
7. Scoring result masuk `confidence_updates`.
8. Final JSON/report masuk `final_reports`.
9. Slack alert hanya dikirim jika alert rules terpenuhi.
10. Dashboard membaca dari Postgres untuk list/search/detail/review.

## 3. What Goes To Postgres

Postgres menyimpan semua hasil, termasuk yang tidak dikirim ke Slack.

Data yang wajib disimpan:

- job id
- input email
- optional future fields: name, username, phone hash, company field, signup source, referrer, country/IP-derived country jika legal
- normalized domain
- primary classification
- business relationship classification
- confidence score
- automation action
- company profile
- person profile/candidates
- tools used
- tools skipped
- tool errors
- evidence items
- source URLs
- short snippets
- final report text
- timestamps
- review status

Important: data personal harus minimal dan punya purpose. Untuk phone/IP, simpan hanya jika legal dan memang dibutuhkan; pertimbangkan hash atau derived fields.

## 4. Suggested Postgres Tables

### `investigation_jobs`

Menyimpan lifecycle job.

Fields:

- `id`
- `source`: `telegram`, `platform_register`, `manual`
- `status`: `queued`, `running`, `completed`, `failed`, `retry_pending`
- `email`
- `normalized_email`
- `domain`
- `started_at`
- `finished_at`
- `final_classification`
- `business_relationship`
- `confidence_score`
- `automation_action`
- `alert_sent`
- `review_status`: `unreviewed`, `reviewed`, `needs_review`, `ignored`

### `register_snapshots`

Menyimpan payload register saat job dibuat.

Fields:

- `job_id`
- `email`
- `name`
- `username`
- `company_field`
- `signup_source`
- `referrer`
- `country`
- `metadata_json`
- `created_at`

### `tool_runs`

Menyimpan audit setiap tool call.

Fields:

- `id`
- `job_id`
- `tool_name`
- `status`: `success`, `skipped`, `failed`
- `started_at`
- `finished_at`
- `latency_ms`
- `cost_estimate`
- `reason`
- `error`
- `input_json`
- `output_summary_json`

### `evidence_items`

Menyimpan unit bukti.

Fields:

- `id`
- `job_id`
- `tool_run_id`
- `source_type`
- `source_url`
- `claim`
- `value`
- `snippet`
- `reliability`
- `confidence_delta`
- `observed_at`

### `entity_candidates`

Menyimpan kandidat company/person/profile yang ditemukan.

Fields:

- `id`
- `job_id`
- `entity_type`: `company`, `person`, `social_profile`, `location`, `product`
- `name`
- `domain`
- `platform`
- `url`
- `match_score`
- `confidence`
- `source_evidence_id`

### `company_profiles`

Hasil enrichment perusahaan.

Fields:

- `job_id`
- `name`
- `domain`
- `website`
- `description`
- `industry`
- `country`
- `city`
- `address`
- `social_profiles_json`
- `source_confidence_json`

### `person_profiles`

Hasil personal-to-business discovery.

Fields:

- `job_id`
- `identity_hint`
- `candidate_profiles_json`
- `associated_companies_json`
- `role_signals_json`
- `business_relationship`
- `confidence`

### `confidence_updates`

Riwayat scoring.

Fields:

- `job_id`
- `prior_score`
- `delta`
- `posterior_score`
- `reason`
- `evidence_id`
- `created_at`

### `final_reports`

Final human/machine-readable output.

Fields:

- `job_id`
- `json_result`
- `telegram_text`
- `slack_text`
- `sent_to_slack_at`
- `created_at`

## 5. What Goes To Slack

Slack hanya untuk alert penting, bukan semua hasil.

Kirim ke Slack jika:

- Custom/company domain detected dengan confidence tinggi.
- Company profile enriched dengan social/company footprint jelas.
- Personal/free email ditemukan punya business relationship kuat.
- Founder/owner/CEO candidate ditemukan dengan explicit role evidence.
- Suspicious/risk signal tinggi.
- Tool failures sistemik, misalnya search provider down, bukan failure satu job biasa.
- Manual review dibutuhkan untuk lead yang berpotensi bernilai.

Jangan kirim ke Slack jika:

- Email personal/free tanpa evidence bisnis.
- Unknown low-confidence tanpa sinyal penting.
- Check duplikat dengan hasil sama dalam periode pendek.
- Tool fallback gagal tapi classification tetap low-value.

## 6. Slack Alert Rules

Initial rules:

```text
send_slack_alert = true if:
  classification == possible_company_affiliated
  AND confidence_score >= 75
```

```text
send_slack_alert = true if:
  business_relationship IN (
    personal_with_business_affiliation,
    founder_or_owner_candidate,
    employee_or_company_affiliated
  )
  AND relationship_confidence >= 70
```

```text
send_slack_alert = true if:
  classification == suspicious_or_invalid
  AND risk_score >= 70
```

```text
send_slack_alert = false if:
  classification == likely_personal_email
  AND business_relationship IS NULL
```

All alert rules should be configurable later.

## 7. Slack Message Shape

Slack should be concise:

```text
Company Detection Alert

Email: contact@komerce.id
Classification: possible_company_affiliated
Confidence: 100/100
Company: Komerce
Business: End-to-end e-commerce enabler
Key evidence:
- Custom domain + MX present
- Website active
- LinkedIn/company footprint found

Action: route_company_associated_enriched
Dashboard: https://internal/.../jobs/job_123
```

For personal-to-business:

```text
Business Relationship Alert

Email: person@gmail.com
Classification: likely_personal_email
Relationship: founder_or_owner_candidate
Confidence: 82/100
Possible company: Acme Studio
Evidence:
- Public profile snippet says Founder at Acme Studio
- Company domain linked from profile

Action: route_business_relationship_review
Dashboard: https://internal/.../jobs/job_456
```

## 8. Dashboard Goals

Dashboard bukan CRM penuh di awal. Dashboard adalah review/search UI untuk hasil investigasi.

MVP dashboard views:

### Job List

Columns:

- checked at
- email
- domain
- classification
- business relationship
- confidence
- automation action
- alert sent
- review status

Filters:

- classification
- confidence range
- alert sent
- review status
- source
- date range

Search:

- email
- domain
- company name
- person identity hint
- social URL

### Job Detail

Sections:

- input snapshot
- final classification
- company profile
- person/business relationship profile
- evidence list
- tool runs
- tool errors
- final report
- review actions

### Evidence View

Show:

- source type
- source URL
- claim
- value/snippet
- reliability
- confidence delta
- observed at

### Review Actions

Initial actions:

- mark reviewed
- mark false positive
- mark high-value lead
- mark needs retry
- add internal note

## 9. Relationship To Current MVP

Current MVP:

```text
Telegram -> OpenClaw -> scripts -> file evidence -> Telegram reply
```

Target production:

```text
Platform/Telegram -> worker -> scripts/tools -> Postgres -> Slack alerts + dashboard
```

Migration path:

1. Keep current scripts.
2. Add DB writer beside file writer.
3. Store every `company_check` result in Postgres.
4. Add `send_slack_alert` decision.
5. Build read-only dashboard over Postgres.
6. Move Telegram from primary UI to testing/dev channel.
7. Integrate platform registration events.

## 10. Why This Keeps Slack Clean

Slack receives only high-signal alerts. DB keeps everything.

Examples:

- `contact@komerce.id`: saved to DB, likely Slack alert if confidence >= threshold.
- `random@gmail.com`: saved to DB, no Slack alert unless business relationship found.
- `person@gmail.com` with founder evidence: saved to DB and Slack alert.
- failed/inconclusive checks: saved to DB, dashboard review/retry, no Slack spam unless system-wide issue.

## 11. Implementation Order

Recommended order:

1. Define Postgres schema.
2. Add DB writer while keeping file evidence writer.
3. Add alert decision function.
4. Add Slack alert only when decision returns true.
5. Add dashboard job list.
6. Add dashboard job detail.
7. Add enrichment fields and social/profile tables.
8. Add platform registration ingestion.
9. Add queue/retry.
10. Add multi-agent for complex/high-value jobs.

## 12. Open Questions

- What confidence threshold should trigger Slack for company domain?
- Should repeated checks for the same email update the same entity or create a new job every time?
- How long should personal-profile evidence be retained?
- Should dashboard expose raw snippets or only normalized evidence?
- Should platform users be notified or is this internal-only enrichment?
