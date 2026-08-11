# Functioning Faith release readiness

This is the release gate for the public web/PWA and the native iOS shell. It is
deliberately written around trust and user control: engagement should come from
useful community, Scripture, and progress—not dark patterns, hidden autoplay,
or notifications that are difficult to turn off.

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

## Before submitting native apps

- [x] Native source consumes the current paginated feed contract and uses the
      production API base URL.
- [x] Native live workouts call the real start/stop endpoints and record Core
      Location routes when permission is granted; heart rate is never fabricated.
- [x] Native Profile includes sign-out and permanent account deletion controls.
- [ ] Create the Xcode project around `ios/FunctioningFaith`, add the source files,
      and verify the Release configuration uses the production API client.
- [ ] Add Sign in with Apple capability and the production OAuth redirect URI.
- [ ] Add `NSLocationWhenInUseUsageDescription` explaining live workout routes.
- [ ] Add Bluetooth usage text explaining optional heart-rate/sensor pairing.
- [ ] Request notification permission only after the member chooses a category.
- [x] Implement in-app account deletion and verify deletion of connected tokens,
      push subscriptions, messages, posts, workouts, and profile data.
- [ ] Test login, workout start/stop, GPS denial, offline launch, push deep links,
      content reporting, blocking, export, and deletion on physical devices.
- [ ] Prepare App Store privacy nutrition labels and Google Play Data Safety form
      from the current collection map below.

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
