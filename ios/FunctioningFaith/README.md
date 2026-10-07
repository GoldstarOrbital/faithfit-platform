# Functioning Faith — native iOS

Native SwiftUI app that talks to the same production API as the web client.
This is a first-party iOS client, not a web-view wrapper.

**Bundle ID:** `com.functioningfaith.app`  
**Deployment target:** iOS 17+  
**Project generation:** [XcodeGen](https://github.com/yonaskolb/XcodeGen)

## Quick start (Mac)

```bash
cd ios/FunctioningFaith
# brew install xcodegen   # if needed
xcodegen generate --spec project.yml
open FunctioningFaith.xcodeproj
```

1. Select your **Development Team** under Signing & Capabilities.
2. Build & run on a simulator (Debug uses mock data by default) or a signed physical device.
3. For live API testing set `APIClient.shared.useMock = false` (already automatic in Release) and ensure `FFAPIBaseURL` in Info.plist points at the host you want.

## What is already in the binary

The active app target is defined in [`project.yml`](project.yml): iOS 17+, bundle
ID `com.functioningfaith.app`, with a separately signed WidgetKit extension.

- **Native app shell:** Home, Workouts, Explore, Scripture, Messages, Profile,
  and Settings are SwiftUI experiences backed by the shared API.
- **Authentication:** email/password and Sign in with Apple, with supported web
  identity providers handed off through `ASWebAuthenticationSession`.
- **Workout tracking:** Core Location route and telemetry capture, workout
  history/summary, HealthKit authorization and sync, and Bluetooth heart-rate
  sensor support. Data availability depends on device permissions and hardware.
- **Out-of-app workout surface:** ActivityKit Live Activity plus a WidgetKit
  extension for an active workout; these require a correctly signed build and
  device testing to validate end-to-end.
- **Faith and community:** Bible browse/search/practice, verse discussions,
  journeys, groups, feed, reels, profiles, and direct messages.
- **Safety and account controls:** reporting, blocking, and in-app account
  deletion (`DELETE /api/me`).
- **Platform configuration:** privacy manifest, usage descriptions, app icon
  assets, and entitlement files are present in the project. Presence in source
  does not by itself prove Apple portal capabilities or distribution signing.

## Operational docs (do not skip)

| Document | Purpose |
|---|---|
| **[APP_STORE_SUBMISSION.md](APP_STORE_SUBMISSION.md)** | Release playbook for Apple capabilities, signing, device QA, E2E DM proof, App Store Connect, and submission |
| [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) | Mechanical QA gate on a signed physical device |
| [docs/E2E_DM_VERIFICATION.md](docs/E2E_DM_VERIFICATION.md) | Byte-for-byte native ↔ web E2E crypto proof |
| [../../APPSTORE.md](../../APPSTORE.md) | Guideline compliance narrative |

## Configuration

| Key | Where | Default |
|---|---|---|
| `FFAPIBaseURL` | Info.plist / project.yml | `https://faithfit-demo-production.up.railway.app` |
| `FFAppleClientID` | Info.plist / project.yml | `com.functioningfaith.app` |
| `DEVELOPMENT_TEAM` | Xcode or project.yml | empty (set before archive) |

Server must have `APPLE_NATIVE_CLIENT_ID` matching `FFAppleClientID`.

## Release readiness: what this README does not certify

The repository contains the app icon assets and project configuration, but source
files alone cannot establish that an App Store build is ready. Before calling a
release ready, verify the current Apple Developer capabilities and provisioning
for **both** the app and widget targets, build and install a signed release on a
physical iPhone, complete [`RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md), and
prove native-to-web and web-to-native encrypted messaging using
[`docs/E2E_DM_VERIFICATION.md`](docs/E2E_DM_VERIFICATION.md). Then confirm the
current App Store Connect privacy, review-account, screenshot, and processing
requirements in the playbook. CI compilation or an uploaded binary is not a
substitute for that device and Apple-processing verification.
