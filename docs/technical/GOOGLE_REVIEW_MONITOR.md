# Google Business Profile Review Monitor

## Purpose

Monitor review Google Business Profile berbintang 1-3 sebagai fitur
deterministic yang terisolasi dari Company Detector investigation flow.

Development menggunakan profil warung pribadi yang dimiliki/dikelola akun
Google personal. Production nanti mengganti credential dan location ke Google
Business Profile Komerce tanpa mengubah kode atau flow.

```text
21:00 WIB -> Google Business Profile API collect + deduplicate
09:00 WIB -> Telegram daily report
```

## Product Status

```text
Implementation: ready for Google Business Profile API credentials
OAuth bootstrap tools: ready
Separate env and Compose profile: ready
Telegram test-send: passed
Real API collection: waiting for personal Google OAuth/account/location setup
Production scheduler: disabled until API preflight passes
```

## Isolation Contract

- Satu repository dan Docker image dengan Company Detector.
- Service Compose terpisah: `review-monitor`.
- Opt-in profile: normal Company Detector deployment tidak menyalakannya.
- Secret terpisah: `.env.review-monitor`.
- Scheduler terpisah: `ops/docker/review-monitor-scheduler.js`.
- State/deduplication terpisah: `company_detector_review_monitor`.
- Tidak memanggil OpenClaw/LLM.
- Tidak membaca/menulis investigation tables.
- Boleh berbagi Docker, Telegram integration, dan operations infrastructure.

## Architecture Flowchart

```mermaid
flowchart LR
  subgraph shared["Shared Company Detector Project"]
    Repo["Repository + Docker image"]
    TelegramCredential["Telegram Bot API"]
  end

  subgraph isolated["Isolated Review Monitor"]
    Scheduler["Independent scheduler"]
    GBP["Google Business Profile API client"]
    Filter["Rating 1-3 filter + reviewId dedupe"]
    State["Dedicated state volume"]
    Reporter["Telegram reporter"]
    Env[".env.review-monitor"]
  end

  Repo --> Scheduler
  Env --> GBP
  Env --> Reporter
  Scheduler --> GBP --> Filter --> State --> Reporter
  TelegramCredential --> Reporter
```

## Runtime Sequence

```mermaid
sequenceDiagram
  autonumber
  participant Scheduler
  participant OAuth as Google OAuth
  participant GBP as Business Profile Reviews API
  participant State as Dedicated State
  participant Telegram

  Scheduler->>OAuth: Refresh access token at 21:00
  OAuth-->>Scheduler: Short-lived access token
  Scheduler->>GBP: List reviews for account/location

  alt API succeeds
    GBP-->>Scheduler: Verified review list
    Scheduler->>Scheduler: Filter stars 1-3 and dedupe by reviewId
    Scheduler->>State: Save reviews + healthy collect status
  else OAuth/API failure
    Scheduler->>State: Save unhealthy collect status
  end

  Scheduler->>State: Read unsent reviews at 09:00
  alt Latest collect healthy
    State-->>Scheduler: New negative reviews or verified empty result
    Scheduler->>Telegram: Send daily report
  else Latest collect unhealthy or stale
    Scheduler->>Telegram: Send monitoring failure alert
  end
```

## Separate Environment File

Review monitor secrets must not be mixed into core Company Detector `.env`.

```bash
cp .env.review-monitor.example .env.review-monitor
chmod 600 .env.review-monitor
```

Required values:

```text
GBP_BUSINESS_NAME=
GBP_ACCOUNT_ID=
GBP_LOCATION_ID=
GBP_CLIENT_ID=
GBP_CLIENT_SECRET=
GBP_REFRESH_TOKEN=
TELEGRAM_DEFAULT_BOT_TOKEN=
REVIEW_MONITOR_TELEGRAM_TO=
```

Never commit or share `.env.review-monitor`. OAuth client secret and refresh
token provide access to the Google Business Profile managed by that account.

## Development Setup With Personal Warung

Requirements:

- The personal Google account is owner/manager of the warung Business Profile.
- The profile is verified and visible in Google Business Profile.
- A Google Cloud project is created for development.
- Google Business Profile APIs are enabled and API access is approved.
- OAuth client type is Desktop App or another approved internal setup.

Fill `GBP_CLIENT_ID` and `GBP_CLIENT_SECRET`, then generate the authorization
URL:

```bash
docker compose --profile review-monitor run --rm \
  review-monitor node review_monitor/oauth.js auth-url
```

Open the URL, login using the personal account that manages the warung, grant
access, then exchange the returned authorization code:

```bash
docker compose --profile review-monitor run --rm \
  review-monitor node review_monitor/oauth.js exchange-code '<AUTHORIZATION_CODE>'
```

Install the resulting `GBP_REFRESH_TOKEN` into `.env.review-monitor` through a
secure editor.

Discover account and location IDs:

```bash
docker compose --profile review-monitor run --rm \
  review-monitor node review_monitor/oauth.js list-accounts

# Fill GBP_ACCOUNT_ID, then:
docker compose --profile review-monitor run --rm \
  review-monitor node review_monitor/oauth.js list-locations
```

The API outputs names such as `accounts/123` and `locations/456`. Store only
the numeric ID portions in `GBP_ACCOUNT_ID` and `GBP_LOCATION_ID`.

## Acceptance And Activation

Run the dedicated preflight:

```bash
chmod +x ops/docker/verify-review-monitor.sh
./ops/docker/verify-review-monitor.sh
```

The preflight validates:

- `.env.review-monitor` exists with permission `600`.
- No placeholder remains.
- OAuth/account/location/Telegram values exist.
- Google Business Profile Reviews API collection succeeds.
- Telegram test-send succeeds.

Only after preflight passes:

```bash
docker compose --profile review-monitor up -d review-monitor
docker compose logs -f review-monitor
```

## Commands

```bash
# Collect real reviews without sending:
docker compose --profile review-monitor run --rm \
  review-monitor node review_monitor/monitor.js collect

# Send real unsent reviews or verified-empty report:
docker compose --profile review-monitor run --rm \
  review-monitor node review_monitor/monitor.js send

# Telegram format test with dummy data:
docker compose --profile review-monitor run --rm \
  review-monitor node review_monitor/monitor.js test-send
```

## Safety Behavior

- API/OAuth failure is stored as unhealthy collection.
- The 09:00 report sends a monitoring failure alert when collection is
  unhealthy or older than 36 hours.
- A verified-empty message is sent only after the official API successfully
  returned a review list.
- Refresh tokens and OAuth secrets never enter Git, image layers, or docs.

## Move From Personal Warung To Komerce

No code change is required.

1. Create/approve the office Google Cloud project and OAuth client.
2. Authorize using an office account that manages the Komerce Business Profile.
3. Replace only the `.env.review-monitor` values:
   `GBP_BUSINESS_NAME`, account/location IDs, OAuth client, refresh token.
4. Run `verify-review-monitor.sh`.
5. Enable the scheduler only after the production preflight passes.

Do not reuse personal OAuth credentials for production.

## Acceptance Checklist

- [ ] OAuth account manages the intended development warung profile.
- [ ] `list-accounts` and `list-locations` return expected IDs.
- [ ] API collector returns verified reviews or verified empty result.
- [ ] Only rating 1-3 reviews are stored.
- [ ] Repeated collection deduplicates by stable Google `reviewId`.
- [ ] Telegram `test-send` reaches the intended target.
- [ ] Failed/stale collection sends failure alert, not false-empty result.
- [ ] Scheduler logs show collect 21:00 and send 09:00 WIB.
- [ ] Investigation worker/OpenClaw/database remain unchanged.
