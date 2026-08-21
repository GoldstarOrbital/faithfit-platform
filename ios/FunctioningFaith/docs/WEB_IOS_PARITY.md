# Web (Railway) ↔ native iOS parity matrix

**Goal:** App Store native shell should expose the same *member* product as `webapp/` on Railway — not admin/dev tooling, not a second backend.

**UI philosophy:** Native uses **SwiftUI + HIG** (tabs, lists, system controls). Visual language tracks the web **parchment / meadow / hearth** tokens in `FFTheme` (see `Theme.swift`). Pixel-identical CSS is not the target; feature and information parity is.

Web primary tabs: **Home · Workout · Stats · Explore · Profile** (+ DMs / search / notifications in the chrome).

Native primary tabs: **Home · Train · Explore · Messages · Profile**  
(Stats stays linked from Explore + Profile so Messages can stay one-tap; Train is the Railway Workout tab — live GPS, manual log, journeys.)

---

## Member product — parity status

| Web surface | Native | Status |
|-------------|--------|--------|
| Sign in / register / MFA / Terms+DOB | `AuthView` | **Parity** |
| Account setup gate | `NativeAccountSetupView` | **Parity** |
| Social onboarding | `SocialOnboardingView` | **Parity** |
| Home feed (posts, likes, comments, stories rail) | `HomeFeedView`, `StoriesRail`, `CommentThreadView` | **Parity** (stories composer/viewer present) |
| Post composer | `PostComposerView` | **Parity** |
| Workout live GPS + HR | `WorkoutView`, `NativeWorkoutTracker` | **Parity** (live / manual / journey + 18 activity types) |
| Workout log / detail / share | Train recent log + feed share | **Parity** (manual log posts `/workouts/manual`; share still via feed) |
| Stats / goals / charts | `StatsView` | **Parity** (weekly recap + goals CRUD; hub: Explore → Stats) |
| Explore index | `ExploreView` + `ExploreCatalog` | **Parity** (same 12 Railway sections) |
| Challenges join | Explore challenges | **Parity** |
| Groups + pulse + messages | `GroupDetailView`, members | **Parity** |
| Quests list | Explore quests | **Parity** (read-only list) |
| Reels | `ReelsFeedView`, `ReelPlayerView` | **Parity** |
| Journeys list/detail/live | `JourneysListView`, detail, live session | **Parity** (3D web journey is web-only polish) |
| Athlete recruiting search | `AthleteSearchView`, profile detail | **Parity** |
| Scripture tab / practice / saved / threads | `ScriptureView`, practice, saved, `VerseThreadView`, browse, lookup | **Parity** |
| Breathwork | `BreathworkView` | **Parity** |
| Heart check-in | `HeartCheckInView` | **Parity** |
| Podcasts | `PodcastsView` | **Parity** |
| Church finder | `ChurchFinderView` | **Parity** |
| News | `NewsView` | **Parity** |
| Video library | `VideoLibraryView` | **Parity** |
| Search | `SearchView` | **Parity** |
| DMs + E2E | `DMInboxView`, conversation, `E2ECrypto` | **Parity** (must device-verify) |
| Notifications panel | `NotificationsView` | **Parity** |
| Reminders | `RemindersView` | **Parity** |
| Profile edit / badges / XP | `ProfileView`, `EditProfileView` | **Parity** |
| Apple Health sync | `HealthKitManager` + Profile | **Parity** (native advantage) |
| Strava connect/sync | Profile connectors | **Parity** when server configured |
| Safety / block / mute / circle | `SafetyView`, `CircleView` | **Parity** |
| Follow requests | `FollowRequestsView` | **Parity** |
| Account deletion / sign-out | Profile | **Parity** |
| Biometric lock | `BiometricLock` | **Native-only** (good) |
| Offline banner | `NetworkMonitor` | **Native-only** |
| Deep links | `DeepLinkRouter` | **Parity** (`functioningfaith://`) |
| Privacy / Terms / Support | Links to production HTML | **Parity** (SFSafari / Link) |

---

## Intentionally web-only (not App Store member UI)

| Surface | Reason |
|---------|--------|
| `moderation.html` | Staff/reviewer tool |
| `developers.html` / API keys / webhooks | Developer program |
| Creator `overlay.html` | Streaming overlay for creators |
| Public `recruiting.html` / `coach-roster.html` SEO pages | Public web directories; native has in-app search |
| PWA install / service worker / A2HS | Web install path |
| Turnstile captcha chrome | Web bot mitigation |
| Journey **3D** (`journey3d.js`) | WebGL polish; native uses list/map live session |
| Full Google Health / Fitbit / Oura OAuth rows | Prefer HealthKit + Strava on iOS; add if product prioritizes |

---

## Visual system

| Token | Web CSS | Native `FFTheme` |
|-------|---------|------------------|
| Page | `--parch-0` | `parchment0` |
| Card | `--parch-1` | `parchment1` |
| Ink | `--ink` | `ink` |
| Accent | `--meadow` | `accent` / `meadow` |
| Gold | `--gold-2` | `goldBright` |
| Danger | `--seal` | `danger` |

App-wide `.tint(FFTheme.accent)` is set in `FunctioningFaithApp`.

---

## Remaining gaps (prioritized)

1. **Sermon / church YouTube embed** — native opens URLs in Safari; in-app player optional.
2. **Google Health / Fitbit / Oura** connector rows — optional; HealthKit covers Watch.
3. **Journey 3D** remains web-only (`journey3d.js`); native uses list + live GPS session.
4. **BLE heart-rate monitor** on Train — UI admits the reading; Core Bluetooth pairing is still the native-only follow-up.

---

## How to verify “everything is brought over”

1. Walk web tab bar + Explore index on production.
2. For each row in the matrix marked **Parity**, open the same flow on a signed iOS build.
3. Anything **Partial** → file an issue or implement before submit.
4. Web-only table should **not** block App Store submission.

Last reviewed against `webapp/public/app.js` + `ios/FunctioningFaith` on 2026-08-21.
