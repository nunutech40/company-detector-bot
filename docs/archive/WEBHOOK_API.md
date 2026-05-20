# Webhook API

**Service:** Company Detection Webhook  
**Status:** Service scaffold ready; final production integration pending  
**Last updated:** 20 Mei 2026

---

## 1. Overview

Webhook API lets the Komerce platform trigger company detection from register flow without using Telegram. The service is running and returns deterministic responses, but the production DB handoff is still part of the final integration phase together with Slack routing.

Runtime:

- Path: `webhook/`
- Stack: Express.js
- Port: `3002`
- systemd service: `company-webhook`

Base URL:

```text
http://103.226.139.107:3002
```

Authentication uses a shared secret from environment variable `WEBHOOK_SECRET`. Do not hardcode production secrets in application code.

---

## 2. Endpoints

### `GET /health`

Health check.

Response:

```json
{
  "ok": true,
  "service": "company-detection-webhook",
  "version": "1.0.0"
}
```

### `POST /webhook/check`

Trigger one investigation.

Request:

```json
{
  "email": "user@example.com",
  "full_name": "Nama Lengkap",
  "no_hp": "08123456789",
  "brand_name": "Nama Brand",
  "secret": "<shared-secret>"
}
```

| Field | Required | Notes |
|---|---:|---|
| `email` | Yes | Primary detection signal |
| `full_name` | No | Identity hint |
| `no_hp` | No | Confirmation only, not public search seed |
| `brand_name` | No | Business hint |
| `secret` | Yes | Must match `WEBHOOK_SECRET` |

Success response:

```json
{
  "ok": true,
  "email": "user@example.com",
  "classification": "possible_company_affiliated",
  "confidence_score": 70,
  "confidence_label": "medium",
  "automation_action": "route_company_associated",
  "company_detected": true,
  "summary": "Email memakai custom domain dan sinyal domain/bisnis cukup kuat.",
  "dashboard_url": "http://103.226.139.107:3001",
  "note": "Hasil ini dari deterministic pipeline. AI enrichment dapat menyusul melalui OpenClaw flow dan terlihat di dashboard."
}
```

Error examples:

```json
{ "ok": false, "error": "invalid_secret" }
```

```json
{ "ok": false, "error": "email_required" }
```

---

## 3. Current Behavior

The webhook currently:

1. Validates shared secret.
2. Validates and sanitizes input.
3. Runs Go `company-check` binary with `--json --save`.
4. Returns deterministic result and dashboard URL.

Final production behavior must persist the matching webhook request result to PostgreSQL/dashboard. Queue/worker is future work after the direct DB path is finalized.

---

## 4. Classification Values

| Value | Meaning |
|---|---|
| `possible_company_affiliated` | Business/company affiliation likely |
| `likely_personal_email` | Likely personal |
| `unknown_needs_more_evidence` | Not enough evidence |
| `suspicious_or_invalid` | Invalid/disposable/risky |

## 5. Automation Actions

| Value | Meaning |
|---|---|
| `route_company_associated` | Business route/alert candidate |
| `continue_as_personal_or_unknown` | Continue normal flow |
| `risk_review` | Manual risk review |
| `store_unknown_retry_later` | Store and retry/enrich later |

---

## 6. Example

```bash
curl -X POST http://103.226.139.107:3002/webhook/check \
  -H "Content-Type: application/json" \
  -d '{
    "email": "contact@komerce.id",
    "full_name": "Ragil Setiawan",
    "brand_name": "Komerce",
    "secret": "<shared-secret>"
  }'
```

---

## 7. Next Improvements

- Add queue/worker and retry.
- Finalize DB writer evidence path for webhook requests.
- Add rate limiting.
- Add idempotency key from platform register.
- Add async status endpoint if webhook volume grows.
