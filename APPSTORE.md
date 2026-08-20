# App Store readiness — Functioning Faith

Verified against the code in this repo on 2026-08-20. Claims below were checked
against `ios/FunctioningFaith/` and `webapp/`, not assumed.

> **Important:** An earlier revision of this document said there was no native
> shell. That is outdated. The shipping path is the **native SwiftUI app** at
> `ios/FunctioningFaith/`, talking to the production web API. Treat
> `ios/FunctioningFaith/README.md`, `ios/FunctioningFaith/RELEASE_CHECKLIST.md`,
> and especially **`ios/FunctioningFaith/APP_STORE_SUBMISSION.md`** as the
> operational sources of truth for the native build and the final human steps.

## Native app (primary App Store path)

| Area | Status | Location |
|---|---|---|
| SwiftUI app shell (tabs, auth, feed, workouts, explore, profile, DMs) | **Present** | `ios/FunctioningFaith/FunctioningFaith/` |
| XcodeGen project | **Present** | `ios/FunctioningFaith/project.yml` |
| Bundle ID | `com.functioningfaith.app` | `project.yml` |
| Sign in with Apple entitlement scaffold | **Present** | `FunctioningFaith.entitlements` |
| HealthKit entitlement (read-only) | **Present** | same |
| Permission copy (location, Bluetooth, Health, notifications, Face ID) | **Present** | `Resources/Info.plist` |
| Privacy manifest | **Present** | `Resources/PrivacyInfo.xcprivacy` |
| Production API base URL | Default production Railway host; overridable via Info.plist `FFAPIBaseURL` | `APIClient.swift` + `Config.swift` |
| Mock vs live networking | `#if DEBUG` → mock on; Release → live | `APIClient.swift` |
| Account deletion | Native Profile → `DELETE /api/me` | API + Profile UI |
| UGC report / block | Native + server routes | APIClient + web moderation |

### Guideline 4.2 (Minimum Functionality)

The App Store submission is **not** a web-view wrapper. The native binary
includes:

- Core Location route capture for live workouts
- HealthKit read of workouts / steps / workout heart rate
- Native Sign in with Apple (ASAuthorization)
- Native OAuth via `ASWebAuthenticationSession` for other providers
- Keychain-backed E2E DM crypto interoperable with the web client
- Biometric lock option
- Category-gated notification permission requests

Review notes should state these capabilities explicitly so the binary is not
mistaken for a thin Safari shell.

## Guideline 1.2 (User-Generated Content)

| Requirement | Status | Where |
|---|---|---|
| Report content | **Done** | `POST /api/posts/:id/report`, `POST /api/users/:id/report` |
| Block users | **Done** | `POST/DELETE /api/users/:id/block`, DM-level block |
| Published content standard | **Done** | `webapp/public/terms.html` |
| Moderation queue | **Done** | `webapp/public/moderation.html` + API |
| Developer contact / support URL | **Done** | `webapp/public/support.html`, `hello@functioningfaith.app` |

## Guideline 5.1.1(v) — Account deletion

**Compliant.** In-app deletion on web and native both call `DELETE /api/me`,
which removes the account row (not a soft flag). Privacy policy describes
legal-hold exceptions.

## Guideline 4.8 — Sign in with Apple

Server and native client both support Apple. Before archive:

1. Enable Sign in with Apple on the App ID `com.functioningfaith.app`.
2. Confirm native audience / client id (`APPLE_NATIVE_CLIENT_ID`, default
   `com.functioningfaith.app`) on the server.
3. Verify button parity: if Google is shown, Apple must be equally available.

## Age rating

- Terms: 13+
- UGC + DMs + group chat → App Store floor **12+**
- No alcohol/gambling/mature content pipelines; reels/videos actively blocklist

## Privacy nutrition labels (App Store Connect)

Transcribe from `webapp/public/privacy.html` and the table in
`docs/app-store-readiness.md`:

- **Contact Info** (email) — linked to user, app functionality / account
- **Location** — linked to user, only when member starts a live workout or
  searches churches nearby
- **Health & Fitness** — linked to user, only with HealthKit / connector consent
- **User Content** — posts, DMs, groups
- **Identifiers** — push token when notifications enabled
- Tracking: **No** (`NSPrivacyTracking` = false)

## Required legal URLs

Use the production host (currently Railway demo until a custom domain is cut):

- Privacy: `https://faithfit-demo-production.up.railway.app/privacy.html`
- Terms: `https://faithfit-demo-production.up.railway.app/terms.html`
- Support: `https://faithfit-demo-production.up.railway.app/support.html`

Replace with the custom domain once DNS/TLS is live.

## What is still human / portal work

These cannot be finished from the repo alone. Follow the single playbook:

**→ [`ios/FunctioningFaith/APP_STORE_SUBMISSION.md`](ios/FunctioningFaith/APP_STORE_SUBMISSION.md)**

It covers, in order:

1. App Icon asset (currently missing — required before archive)
2. Apple Developer Program membership and App ID capabilities (Sign in with Apple, HealthKit)
3. Signed physical-device QA — `RELEASE_CHECKLIST.md`
4. Cross-platform E2E DM test — `docs/E2E_DM_VERIFICATION.md`
5. App Store Connect record: screenshots, description, age questionnaire, privacy labels, review notes
6. Archive → TestFlight → Submit for Review

## Summary

| Item | Owner |
|---|---|
| Native SwiftUI app + API client | **In repo** |
| Permission strings, privacy manifest, entitlements scaffold | **In repo** |
| UGC, deletion, moderation, support URL | **In repo (web + native)** |
| App Icon asset catalog | **Human (see playbook §0)** |
| Apple portal capabilities + Team ID | **Human** |
| Device QA + E2E DM crypto proof | **Human on device** |
| App Store Connect metadata + submit | **Human** |
