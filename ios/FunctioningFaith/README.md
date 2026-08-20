# Functioning Faith — native iOS

Native SwiftUI app that talks to the same production API as the web client.
This is the App Store shipping path (not a web-view wrapper).

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

- Full tab shell: Home feed, Workouts, Explore, Messages (E2E DMs), Profile
- Email / password + Sign in with Apple + other OAuth providers via `ASWebAuthenticationSession`
- Live GPS workouts (Core Location) + HealthKit read-only sync (workouts, steps, workout HR)
- Scripture browse / practice, groups, challenges, reels, podcasts, church finder
- Report / block, in-app permanent account deletion (`DELETE /api/me`)
- Privacy manifest, expanded usage strings, entitlements scaffold for Sign in with Apple + HealthKit
- Config-driven base URL and Apple client ID (`Config.swift` + Info.plist keys)

## Operational docs (do not skip)

| Document | Purpose |
|---|---|
| **[APP_STORE_SUBMISSION.md](APP_STORE_SUBMISSION.md)** | **Complete playbook for the remaining human steps** (App Icon, portal capabilities, device QA, E2E DM proof, App Store Connect, submit) |
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

## Known remaining work (human only)

See the playbook. In short:

1. **App Icon** — asset catalog is not yet in the repo; required before archive.
2. Enable Sign in with Apple + HealthKit on the App ID in the Apple Developer portal.
3. Run the full device checklist and the E2E DM verification.
4. Create the App Store Connect record, upload screenshots, fill privacy labels, submit.

Nothing else in the native code path is blocking a submission once those steps are done.
