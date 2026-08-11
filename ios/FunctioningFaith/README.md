# Functioning Faith iOS release shell

SwiftUI app skeleton: NavigationStack root + TabView (Home Feed, Workouts, Explore, Profile),
wired to a mock API client so it runs standalone in the simulator without a live backend.

## Structure
- `Functioning Faith/App` - entry point
- `Functioning Faith/Views` - SwiftUI screens
- `Functioning Faith/Models` - Codable DTOs matching backend schema
- `Functioning Faith/Networking` - APIClient (mock + real modes)
- `Functioning Faith/Tests` - unit/UI test stubs

## Running
Open in Xcode (add these files to a new SwiftUI App project targeting iOS 17+), select a
simulator, and run. `APIClient.useMock = true` by default for previews and local review.
Before TestFlight, add Sign in with Apple and switch the release configuration to live
networking with the production base URL.
The shell now includes email/password sign-in and registration, a restore-session path,
real feed/profile/workout request plumbing, and a production base URL; OAuth provider
buttons and Sign in with Apple remain a final entitlement/deep-link step.

## Store metadata included

- `FunctioningFaith/Resources/Info.plist` contains the live-workout and optional sensor
  permission copy shown by iOS.
- `FunctioningFaith/Resources/PrivacyInfo.xcprivacy` declares the app's collection map
  and explicitly declares that the app does not track members across other companies'
  apps or websites.
- The web app's account deletion endpoint is the canonical deletion behavior; the native
  Profile screen must call it before submission.

## Accessibility
- Dynamic Type supported via `.font(.body)` / relative text styles throughout.
- All interactive elements have `.accessibilityLabel` and meet the 44x44pt minimum tap target.
- Contrast targets WCAG AA (verify with Xcode's Accessibility Inspector before ship).
