# Native iOS architecture notes (mobile-app skill)

## Platform posture

Functioning Faith ships as a **native SwiftUI** app (not React Native / Flutter).
Navigation, permissions, and device capabilities follow iOS Human Interface Guidelines.

## Structure

| Layer | Responsibility |
|---|---|
| `FunctioningFaithApp` | Session restore, biometric gate, scene-phase lock/unlock, environment injection |
| `RootTabView` | Primary navigation (Home, Workouts, Explore, **Messages**, Profile) + offline banner |
| `NativeSession` | Auth state ownership |
| `APIClient` | Cookie-session networking; mock only under `#if DEBUG` |
| `DMStore` + `E2ECrypto` | Encrypted DMs interoperable with web |
| `HealthKitManager` / `NativeWorkoutTracker` | Device sensors, least-privilege Health reads |
| `NetworkMonitor` | Path reachability for offline UX |
| `FFTheme` + `SharedComponents` | Spacing, touch targets, loading/empty/error states |

## Mobile quality bars this tree targets

1. **Reachability** — offline banner; restore UI acknowledges wait-for-network.
2. **Interruption** — biometric lock on background; auto-unlock attempt on active.
3. **Small-screen clarity** — `ContentUnavailableView` empty/error states; 44pt min targets via `ffMinTapTarget()`.
4. **Edge states** — `FFAsyncContainer` / `FFLoadingView` / `FFErrorStateView` for consistent recovery.
5. **Permissions** — requested at point of use (location for workouts/churches, Health on sync, notifications after category opt-in).
6. **Accessibility** — Dynamic Type fonts via theme helpers; combined accessibility elements on banners and loaders.

## Tab model

Five tabs keep primary tasks one tap away (thumb-zone friendly on large phones):

1. Home — feed + social
2. Workouts — live tracking
3. Explore — groups, challenges, scripture discovery
4. Messages — E2E DMs with unread badge
5. Profile — account, safety, Health, settings

Stats remains reachable from Profile / Explore rather than competing for a sixth tab.

## App Icon

`Resources/Assets.xcassets/AppIcon.appiconset` is scaffolded. Drop a **1024×1024** PNG named `AppIcon.png` into that folder and update `Contents.json` with a `filename` entry before archive (see `APP_STORE_SUBMISSION.md` §0).

## Next mobile polish candidates

- Deep link routing (`functioningfaith://`) beyond OAuth callback
- Background URLSession for large Health sync batches
- Widget extension for verse-of-day / streak (separate target)
- VoiceOver audit pass on feed rows and DM bubbles
