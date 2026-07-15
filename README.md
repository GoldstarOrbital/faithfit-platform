# FaithFit Platform

A faith-infused fitness social platform: microservices backend, biometric time-series pipeline,
scripture trigger engine, gamification, and a SwiftUI iOS reference client.

## Architecture

- **API Gateway**: Gloo Gateway (`infra/gloo-gateway/gateway.yaml`)
- **Microservices** (`services/`): auth, user-profile, fitness, wearable-ingest, scripture-engine,
  personalization, social-graph, gamification, notification, media, creator-tools
- **Data layer**: Postgres + TimescaleDB (`biometric_data` hypertable), Redis cache
- **Event bus**: Kafka (`eventbus/`) — see `eventbus/topics.md` for the domain event catalog
- **External integrations**: YouVersion, Gloo, Apple HealthKit, Google Fit, Garmin, Fitbit, Oura, WHOOP
  (`integrations/`, `wearables/`)
- **iOS reference client**: SwiftUI skeleton (`ios/FaithFit/`)

## Repo layout

```
migrations/          Postgres + TimescaleDB SQL migrations (schema exactly per spec)
services/<name>/     One skeleton per microservice (Express + Dockerfile + tests)
integrations/        YouVersion + Gloo adapter clients, mock servers, adapter interface docs
wearables/           HealthKit/Google Fit/polling adapters, consent gate, normalization layer
eventbus/             Kafka producer/consumer wrappers + topic catalog
scripture-engine/    Scripture Trigger Engine pipeline + unit tests (pure, DB/Kafka-free core)
ios/FaithFit/        SwiftUI skeleton (Home Feed, Workout screen, mock API client)
infra/               K8s manifests, Helm chart, Terraform stubs, GitHub Actions, monitoring
qa/                  E2E test plan, load test script, security checklist
config/feature-flags.json   All third-party-dependent features, default OFF
shared/              vault-client, feature-flags loader, retry/backoff helper
```

## Running locally

```bash
cp .env.example .env
docker-compose up --build
./infra/smoke-test.sh   # hits /health on every service
```

Run scripture engine unit tests (pure logic, no infra needed):
```bash
node --test scripture-engine/tests/pipeline.test.js
```

## Required API keys / secrets (via vault in prod, `.env` locally)

| Key | Used by | Notes |
|---|---|---|
| `YOUVERSION_API_KEY` | scripture-engine, integrations/youversion | Contract/scopes NOT yet verified — see `integrations/youversion/adapter-interface.md` |
| `GLOO_API_KEY` | creator-tools, integrations/gloo | Contract/scopes NOT yet verified — see `integrations/gloo/adapter-interface.md` |
| `APNS_AUTH_KEY` | notification | Apple Push auth key (.p8) |
| Google Fit OAuth client | wearable-ingest | Per-user OAuth, not a static key |
| Garmin/Fitbit/Oura/WHOOP API keys | wearable-ingest (polling adapters) | Per-vendor developer app credentials |

## Feature flag checklist (all default OFF — `config/feature-flags.json`)

Before flipping any flag to `true` in a real environment, confirm:
1. Contract verified against the vendor's current official docs (endpoints, auth, scopes).
2. Rate limits understood and `shared/retry.js` backoff tuned accordingly.
3. Licensing/data-use terms reviewed (especially YouVersion translation licensing).
4. Consent flow (`wearables/consent.js`, `user_consents` table) covers the data this flag unlocks.
5. Flag flipped per-environment via `FLAG_<NAME>` env override before a full code change, so it
   can be reverted instantly.

Flags: `youversion.read`, `youversion.write`, `gloo.read`, `gloo.write`, `wearable.healthkit`,
`wearable.googlefit`, `wearable.garmin`, `wearable.fitbit`, `wearable.oura`, `wearable.whoop`,
`scripture.personalization`, `notifications.push`.

## Privacy / GDPR / CCPA compliance checklist

- [ ] Explicit opt-in captured (`user_consents`) before any biometric ingestion
- [ ] Explicit opt-in captured before scripture personalization (separate scope from biometric ingest)
- [ ] Biometric data encrypted at rest and in transit
- [ ] `audit_logs` populated for all data access outside the owning user (support tooling, admin)
- [ ] Data export endpoint (user's own data, machine-readable)
- [ ] Data deletion endpoint: cascades to `biometric_data`, `scripture_triggers`, `posts`, `workouts`,
      wearable device links, and revokes third-party tokens
- [ ] Data Processing Agreement on file with YouVersion, Gloo, and each wearable vendor before enabling
      their integration in production
- [ ] Privacy policy discloses exactly which biometric signals feed the scripture personalization model

## What's implemented vs. stubbed

Fully implemented with passing unit tests: scripture trigger engine pipeline (14 tests across
scripture-engine/gamification/notification/wearables), gamification XP/quest/badge logic,
notification composer, wearable normalization + consent gate, YouVersion/Gloo adapters with
feature-flag gating + retry/backoff + mock servers.

Stubbed (routes/Dockerfiles present, business logic marked `TODO`): the 11 services' actual
DB-backed route handlers, HealthKit Swift background delivery, live Google Fit response parsing,
Terraform apply, K8s secrets wiring. These are intentionally left as documented next steps rather
than guessed at, per the "do not assume API contracts" rule in the spec.

## Spin-off agent work breakdown

This repo covers the deliverables originally scoped across Infra, Integrations, Wearable, Mobile,
Gamification, and QA agent tracks (see spec section 6) — folded into one coherent scaffold instead
of parallel agents, so schemas/interfaces stay consistent across services. Directory ownership maps
1:1 to those tracks: `infra/` (Infra agent), `integrations/` (Integrations agent), `wearables/` +
`ios/` (Wearable + Mobile agents), `services/gamification/` (Gamification agent), `qa/` (QA agent),
`scripture-engine/` (ML/Personalization agent's rule-based baseline — see pipeline.js scoring function
for the swap-in point for a real ranking model).
