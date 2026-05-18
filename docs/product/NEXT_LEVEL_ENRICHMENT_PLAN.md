# Next Level Enrichment Plan

Dokumen ini menjelaskan pengembangan setelah MVP email detection. Fokusnya tetap email-first: sistem mulai dari email/register input, lalu memperkaya data secara bertahap untuk menemukan profil perusahaan, social footprint, dan kemungkinan hubungan personal ke bisnis.

Plan ini bukan pengganti MVP. Ini adalah layer lanjutan di atas flow yang sudah berjalan:

```text
email_intelligence
-> domain_checker
-> website_crawler_router
-> serp_query_builder
-> ddg_search/free_scraper
-> scoring_engine
-> report_formatter
-> evidence_store
```

## 1. Goal

MVP saat ini menjawab:

```text
Apakah email/register input ini kemungkinan terkait perusahaan?
```

Next level menjawab:

```text
Kalau ini perusahaan, perusahaan apa, bergerak di bidang apa, punya footprint apa, dan akun sosial apa saja?

Kalau ini personal/free email, apakah orang tersebut punya hubungan dengan bisnis, perusahaan, agency, freelancer operation, atau founder/owner signal?
```

## 2. Prinsip Utama

- Tetap email-first untuk fase sekarang.
- Jangan berhenti di `possible_company_affiliated` kalau enrichment mode aktif.
- Semua data tambahan wajib punya source/evidence.
- Jangan klaim founder/owner hanya dari satu sinyal lemah.
- SERP snippet boleh dipakai sebagai sinyal awal, bukan bukti final untuk klaim besar.
- Social profile matching harus punya confidence, bukan asal cocok nama.
- Personal email tidak otomatis berarti non-business.
- Browser/paid tools tetap fallback, bukan default, sampai budget dan compliance jelas.

## 3. Dua Jalur Investigasi

### 3.1 Company Enrichment Flow

Dipakai saat email memakai custom/company domain, misalnya:

```text
contact@komerce.id
```

Target output:

- company name
- primary domain
- website status
- business description
- industry/category
- country/city/address jika tersedia
- contact page
- social profile links
- LinkedIn company page
- Instagram/TikTok/X/Facebook/YouTube if discoverable
- marketplace/app/product pages jika relevan
- Google Maps/local business signal jika tersedia
- founder/team/leadership signals jika explicit
- confidence per field
- source URL per field

Suggested flow:

```text
custom domain detected
-> fetch homepage
-> extract title/meta/schema/social links
-> crawl /about, /contact, /team, /founders, /careers, /privacy
-> build SERP queries for domain + company name
-> discover LinkedIn/company/social/map candidates
-> scrape/fetch safe public pages/snippets
-> normalize company profile
-> score field confidence
-> produce company_profile JSON
```

### 3.2 Personal-To-Business Discovery Flow

Dipakai saat email memakai free/personal provider, misalnya:

```text
r.fajarnugraha@gmail.com
```

Untuk sekarang sistem memakai field register yang realistis tersedia dari platform: `email`, `full_name`, `no_hp`, dan `brand_name`. Jika `full_name` atau `brand_name` kosong, sistem tetap dapat memakai local-part email sebagai low-confidence identity hint.

Target output:

- possible person identity hints
- possible identity hints from email local-part
- public profile candidates
- possible business/company affiliation
- role signal, seperti founder, CEO, owner, director, freelancer, agency, consultant
- associated company candidates
- confidence per candidate
- evidence/source per claim

Suggested flow:

```text
free email detected
-> parse local-part into identity hints
-> build public profile queries
-> search X/LinkedIn/GitHub/Product Hunt/web snippets via SERP
-> collect candidate profiles
-> extract role/company phrases from snippets/pages
-> cross-check company/domain if discovered
-> classify personal-business relationship
```

## 4. New Classifications

Current MVP classifications remain valid:

- `possible_company_affiliated`
- `unknown_needs_more_evidence`
- `likely_personal_email`
- `suspicious_or_invalid`

Next level can add relationship classifications:

- `company_profile_enriched`
- `personal_with_business_affiliation`
- `founder_or_owner_candidate`
- `employee_or_company_affiliated`
- `freelancer_or_agency_candidate`
- `business_relationship_unknown`

These should not replace the primary classification immediately. Safer structure:

```json
{
  "classification": "likely_personal_email",
  "business_relationship": "founder_or_owner_candidate"
}
```

## 5. Target JSON Shape

```json
{
  "job_type": "company_detection_enrichment",
  "input": {
    "email": "contact@komerce.id",
    "full_name": null,
    "no_hp": null,
    "brand_name": null
  },
  "classification": "possible_company_affiliated",
  "business_relationship": null,
  "company_profile": {
    "name": "Komerce",
    "domain": "komerce.id",
    "website": "https://komerce.id/",
    "description": "End-to-end e-commerce enabler",
    "industry": "e-commerce enablement",
    "location": {
      "country": "Indonesia",
      "city": null,
      "address": null
    },
    "social_profiles": [
      {
        "platform": "linkedin",
        "url": "https://www.linkedin.com/company/komerceid/",
        "confidence": 0.78,
        "source_url": "https://duckduckgo.com/html/?q=komerce.id+linkedin"
      }
    ],
    "source_confidence": {
      "name": 0.9,
      "description": 0.85,
      "social_profiles": 0.7
    }
  },
  "person_profile": {
    "identity_hint": null,
    "candidate_profiles": [],
    "associated_companies": [],
    "role_signals": []
  },
  "tools_used": [],
  "tools_skipped": [],
  "tool_errors": [],
  "evidence": [],
  "automation_action": "route_company_associated_enriched"
}
```

## 6. Evidence Types

Add structured evidence types:

- `company_homepage`
- `company_about_page`
- `company_contact_page`
- `company_schema_org`
- `company_social_link`
- `serp_company_result`
- `serp_social_profile_result`
- `serp_map_result`
- `public_profile_snippet`
- `role_signal`
- `person_company_affiliation`
- `company_address_signal`
- `company_industry_signal`

Each evidence item should include:

```json
{
  "source_type": "company_social_link",
  "source_url": "https://komerce.id/",
  "claim": "Homepage links to Instagram profile.",
  "value": "https://instagram.com/...",
  "reliability": "medium",
  "confidence_delta": 5,
  "observed_at": "..."
}
```

## 7. Tool Plan

### Already Available

- `email_intelligence`
- `domain_checker`
- `website_crawler_router`
- `serp_query_builder`
- `ddg_search`
- `free_scraper`
- `scoring_engine`
- `evidence_store`

### New Tools To Build

#### `social_link_extractor`

Input:

```json
{
  "url": "https://komerce.id/",
  "html_or_text": "..."
}
```

Output:

```json
{
  "social_links": [
    {"platform": "instagram", "url": "..."},
    {"platform": "linkedin", "url": "..."}
  ]
}
```

#### `company_profile_builder`

Combines domain checker, crawler, scraper, and SERP evidence into a normalized `company_profile`.

#### `public_profile_search`

Uses email local-part, `full_name`, and `brand_name` to search:

- LinkedIn via SERP snippets
- X profile snippets
- GitHub profile snippets
- Product Hunt maker snippets
- personal websites

#### `relationship_scorer`

Scores whether a person likely has business affiliation.

Examples:

- `CEO at X` in LinkedIn snippet: strong but should be cross-checked.
- `Founder of X` on personal website: strong.
- Same name on random result: weak.
- Email local-part only: weak.

#### `maps_signal_search`

For now, use SERP snippets only. Later, replace with official Google Places API if needed.

## 8. Source Policy

Allowed in early phase:

- company website pages
- public SERP snippets
- public social profile snippets
- public GitHub/Product Hunt pages
- Google Maps snippets via search result
- official APIs if configured

Avoid:

- bypassing login walls
- scraping private or logged-in pages
- CAPTCHA bypass
- storing sensitive personal data beyond business detection need
- treating one ambiguous profile as definitive

## 9. Scoring Policy

Company enrichment confidence:

- homepage title/meta confirms company: low-medium
- `/about` or schema.org organization found: medium
- social links from official domain: medium-high
- LinkedIn company page matches company/domain: medium-high
- address/contact page found: medium
- Google Maps/Places match: medium-high if source is reliable

Personal-business confidence:

- email local-part only: very low
- full name match only: low
- full name + brand name co-occurrence: medium
- profile snippet says founder/CEO/owner: medium
- profile links to company domain: high
- company website mentions the person: high
- two independent sources agree: high

Founder/owner guardrail:

```text
Do not classify as founder/owner unless explicit role evidence exists from a reliable source, ideally supported by at least two independent signals.
```

## 10. Report Behavior

Telegram report should stay concise. The detailed enrichment data should live in JSON.

For Telegram:

```text
Company Detection Enrichment Report

Input:
- Email: ...

Kesimpulan:
...

Company profile:
- Name: ...
- Website: ...
- Business: ...
- Social: LinkedIn, Instagram, ...

Business relationship:
- ...

Evidence summary:
- ...

Automation:
...
```

For platform integration:

- use JSON, not Telegram text
- store source URLs
- store confidence per field
- keep raw snippets short

## 11. Implementation Roadmap

### Phase 1: Email-First Company Enrichment

- Extract social links from company website HTML.
- Normalize company name/title/description.
- Add company profile object to result JSON.
- Add SERP company/social discovery from domain/company name.
- Keep Telegram output concise.

### Phase 2: Personal-To-Business Discovery

- Improve local-part parsing.
- Search public profile snippets from local-part, full_name, and brand_name.
- Normalize current platform fields: email, full_name, no_hp, brand_name.
- Add role signal extraction.
- Add `business_relationship` classification.

### Phase 3: Source-Specific Checkers

- GitHub public checker.
- Product Hunt checker.
- X SERP/profile checker.
- LinkedIn via SERP snippet checker.
- Maps/Places signal checker.

### Phase 4: Production Hardening

- Move evidence store to Postgres.
- Add queue/worker.
- Add source confidence table.
- Add retry/backoff per tool.
- Add cost/rate tracking.
- Add multi-agent only when job complexity justifies it.

## 12. Open Questions

- How much personal data should be retained for free-email users?
- Should platform registration make `brand_name` required or keep it optional?
- What threshold routes a lead into B2B automation?
- Should Google Maps use SERP only first, or official Places API once budget exists?
- What should happen when social profile candidates conflict?
