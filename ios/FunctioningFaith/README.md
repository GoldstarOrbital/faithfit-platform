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
Install XcodeGen on macOS, then run xcodegen generate --spec project.yml from this
directory. Open the generated FunctioningFaith.xcodeproj, select a simulator, and run.
Set the Development Team and bundle identifier in Signing & Capabilities before
archiving. `APIClient.useMock = true` by default for previews and local review.
Before TestFlight, add Sign in with Apple and switch the release configuration to live
networking with the production base URL.
The shell now includes email/password sign-in and registration, a restore-session path,
real feed/profile/workout request plumbing, production account deletion/sign-out, real
Core Location route capture, and a production base URL. The feed decoder matches the
paginated production API. Native Profile now exposes opt-in Scripture, community, and
reminder notification categories and requests system permission only after a category
is selected. Newly registered members also receive a resumable three-step activation
flow: a concise product promise, optional follows/groups from the live recommendation
API, and explicit notification choices. Existing members are never forced back through
it. OAuth provider buttons and Sign in with Apple remain a final entitlement/deep-link
step.

The project spec includes a unit-test target, iOS 17 deployment settings, the live
permission copy, the privacy manifest, and the Sign in with Apple entitlement scaffold.
The Apple capability still needs to be enabled for the final App ID in the Apple
Developer portal and verified on a signed device build.

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

## TestFlight and App Store release checks

- Native registration sends the same date-of-birth, Terms acceptance, and password-policy fields required by the production API. Verify a fresh-account path against the production environment before upload.
- `PrivacyInfo.xcprivacy` declares the app's use of `UserDefaults` for local member settings. Re-check the manifest whenever a new SDK, analytics package, or required-reason API is added.
- Before archive, set the Apple Development Team, enable Sign in with Apple if the native app adds any third-party sign-in option, provide app icons/screenshots, and verify the production privacy-policy and support URLs in App Store Connect.
- Archive and test on a signed physical device: location workout capture, notification opt-in, biometric lock, account export/deletion, and fresh sign-up.
