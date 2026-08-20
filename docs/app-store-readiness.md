# Functioning Faith release readiness

This is the release gate for the public web/PWA and the native iOS app.
Engagement should come from useful community, Scripture, and progress—not dark
patterns, hidden autoplay, or notifications that are difficult to turn off.

**Native operational checklist:** [`ios/FunctioningFaith/RELEASE_CHECKLIST.md`](../ios/FunctioningFaith/RELEASE_CHECKLIST.md)  
**E2E DM crypto proof:** [`ios/FunctioningFaith/docs/E2E_DM_VERIFICATION.md`](../ios/FunctioningFaith/docs/E2E_DM_VERIFICATION.md)  
**Full human submission playbook:** [`ios/FunctioningFaith/APP_STORE_SUBMISSION.md`](../ios/FunctioningFaith/APP_STORE_SUBMISSION.md)  
**App Store narrative:** [`APPSTORE.md`](../APPSTORE.md)

## Web/PWA shipped

- [x] Installable manifest with standalone display mode and brand icon.
- [x] Service worker with network-first navigation and versioned asset caching.
- [x] HTTPS production deployment and health endpoint.
- [x] Google/Apple/Microsoft identity providers are only shown when configured.
- [x] Privacy and Terms pages linked from account creation.
- [x] Consent controls for biometric ingestion and Scripture personalization.
- [x] Data export from Profile → Settings.
- [x] Workout visibility and route-end privacy controls.
- [x] Notification categories are opt-in and deep links are same-origin checked.

## Native iOS shell shipped in repo

- [x] SwiftUI app under `ios/FunctioningFaith` with XcodeGen `project.yml`.
- [x] Native source consumes the paginated feed contract and production API base URL
      (overridable via Info.plist `FFAPIBaseURL`).
- [x] Native live workouts call real start/stop endpoints and record Core Location
      routes when permission is granted; heart rate is never fabricated.
- [x] HealthKit read-only sync path.
- [x] Native Profile includes sign-out and permanent account deletion.
- [x] Unit-test target and Release settings that use live networking (`#if DEBUG` mock only).
- [x] Permission copy in Info.plist (location, Bluetooth, Health, notifications, Face ID, photos).
- [x] Privacy manifest declares collection map and no cross-app tracking.
- [x] Sign in with Apple entitlement scaffold + native auth flow.
- [x] Notification permission only after the member chooses a category.
- [ ] **App Icon asset catalog** (required before archive — see playbook §0).
- [ ] Enable Sign in with Apple + HealthKit on the final App ID; set Development Team.
- [ ] Verify production OAuth / Apple audience on a signed device build.
- [ ] Run full device QA (`RELEASE_CHECKLIST.md`).
- [ ] Complete E2E DM native ↔ web decrypt proof.
- [ ] App Store Connect privacy labels, screenshots, and Submit for Review.

## Collection map for store disclosures

| Data | Why | Optional? |
| --- | --- | --- |
| Email/name | Account, sign-in, profile | Email required; profile fields optional |
| Workout/GPS | Route, distance, pace, activity history | Only when starting a live workout |
| Heart rate/wearables | Training metrics and Scripture context | Explicit consent / device connection |
| Posts, DMs, groups | Social features selected by the member | Yes; member controls audience |
| Notification token | Push categories the member enables | Yes |
| Connected-provider tokens | Sync the provider the member selected | Yes; disconnectable |

## Ethical retention principles

- Every reminder has a category, an understandable reason, and an off switch.
- Streaks and badges celebrate consistency without shaming missed days.
- Recommendations explain themselves (“because you joined…”, “from your church”).
- Feed ranking must not hide safety controls, privacy settings, or account export.
- No fake scarcity, forced contacts access, hidden opt-ins, or endless prompts.
