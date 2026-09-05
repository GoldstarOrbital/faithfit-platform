# Functioning Faith iOS — App Store Submission Playbook

This document turns the remaining **human / portal / device** work into a single executable checklist.
Everything that can live in the repo is already done (see `APPSTORE.md`, `RELEASE_CHECKLIST.md`, `docs/E2E_DM_VERIFICATION.md`).

**You need:**
- Active Apple Developer Program membership ($99/yr)
- A Mac with Xcode 16+ (or current stable)
- A physical iPhone (iOS 17+)
- Access to the production API and two test accounts
- App Store Connect access for the team that owns `com.functioningfaith.app`

Estimated calendar time once credentials are ready: 1–2 focused days.

---

## 0. App Icon — DONE in repo

Asset catalog is scaffolded at:

`FunctioningFaith/Resources/Assets.xcassets/AppIcon.appiconset/`

`Contents.json` already references `AppIcon.png` (1024×1024, single-size universal).

**Generate the PNG before first archive:**

```bash
cd ios/FunctioningFaith
bash scripts/install-app-icon.sh
# requires: python3 + Pillow  (pip install Pillow)
```

That writes a brand-matched cream / gold-arc / cross+ff mark at 1024×1024 (opaque — App Store rejects transparency).

If you have a designer master (e.g. the official logo PNG), replace:

`FunctioningFaith/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon.png`

with your 1024×1024 **opaque** export, then skip the generator.

`project.yml` already includes the asset catalog and:

```yaml
ASSETCATALOG_COMPILER_APPICON_NAME: AppIcon
ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME: AccentColor
```

Re-run `xcodegen generate` after any catalog change.

---

## 1. Apple Developer portal — App ID & capabilities

1. Go to [developer.apple.com/account](https://developer.apple.com/account) → **Certificates, Identifiers & Profiles** → **Identifiers**.
2. Click **+** → **App IDs** → **App**.
3. Description: `Functioning Faith`
4. Bundle ID: **Explicit** → `com.functioningfaith.app`
5. Capabilities — enable exactly:
   - **Sign In with Apple**
   - **HealthKit**
   - (Optional for v1) **Push Notifications** — only if you ship native APNs; the current native code requests notification permission but does not yet register for remote push. Leave off for the first submission if unsure.
6. Save.
7. If you already have an App ID with this bundle, edit it and add the missing capabilities.
8. Create a **Development** and **Distribution** provisioning profile (or let Xcode manage signing).
9. Note your **Team ID** (10-character string under Membership).

### Server-side Apple audience

On the production Railway / server environment set:

```
APPLE_NATIVE_CLIENT_ID=com.functioningfaith.app
```

(or whatever value you put in Info.plist `FFAppleClientID`). The native Sign in with Apple flow sends the ID token with this audience; the server must verify it.

---

## 2. Local project preparation

```bash
cd ios/FunctioningFaith
bash scripts/install-app-icon.sh   # if AppIcon.png is not already present
# Install XcodeGen if needed: brew install xcodegen
xcodegen generate --spec project.yml
open FunctioningFaith.xcodeproj
```

In Xcode:

1. Select the **FunctioningFaith** target → **Signing & Capabilities**.
2. Choose your Team (this fills `DEVELOPMENT_TEAM`).
3. Confirm the two capabilities appear (Sign in with Apple, HealthKit). If they do not, the portal App ID is missing them or the entitlements file is not linked.
4. Switch scheme to **Release** and build for a connected physical device (or Any iOS Device for archive).
5. Fix any remaining compile errors (there should be none on current main).

Confirm in the built binary / Info:

- `FFAPIBaseURL` points at production (or your staging host).
- `FFAppleClientID` matches the App ID.
- `APIClient.useMock` is `false` in Release (`#if DEBUG` only).

---

## 3. Physical-device QA

Install a **signed** Release (or Debug-with-live-API) build on a real iPhone.

Work through every row in:

**[`RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md)**

Pay special attention to:

- Sign in with Apple (must succeed on device; simulator is not authoritative).
- HealthKit authorization sheet and subsequent sync.
- Live workout GPS with location permission granted **and** denied.
- Notification permission only after a category is toggled (never at first launch).
- Permanent account deletion.
- Deep links: `functioningfaith://messages`, `functioningfaith://workouts`, etc.

Sign the QA table at the bottom of the checklist.

---

## 4. Cross-platform E2E DM proof

This is the highest-risk unverified piece.

Follow every step in:

**[`docs/E2E_DM_VERIFICATION.md`](docs/E2E_DM_VERIFICATION.md)**

You need:

- Account **A** on the iOS device
- Account **B** in a desktop browser on the same production host
- Distinctive probe strings so a false “looks fine” is impossible

Both directions (native→web and web→native) **must** show the exact plaintext. If either fails, stop and debug against the table in that document before continuing.

Sign the crypto sign-off table.

---

## 5. App Store Connect record

1. [appstoreconnect.apple.com](https://appstoreconnect.apple.com) → **My Apps** → **+** → **New App**.
2. Platforms: iOS
3. Name: `Functioning Faith`
4. Primary language: English (U.S.)
5. Bundle ID: select `com.functioningfaith.app`
6. SKU: `functioningfaith-ios-001` (or any unique string)
7. User Access: Full Access (or as needed)

### Version 1.0 metadata (templates)

**Subtitle** (30 characters max):

```
Faith, fitness & community
```

**Description** (paste and edit):

```
Functioning Faith is a faith-based fitness and community app. Track real workouts with GPS, pair movement with Scripture, and grow with others — alone or with your church.

• Live GPS workouts and HealthKit (read-only) sync from Apple Watch and other wearables
• Scripture library, verse practice, and moment-aware encouragement
• Community feed, groups, challenges, and end-to-end encrypted direct messages
• Church finder, podcasts, and reels
• Sign in with Apple, email, or other providers you choose
• Full in-app account deletion and data controls

Built so that Scripture is never generated by a model — only selected and verified.
```

**Keywords** (100 characters, comma-separated):

```
faith,fitness,christian,bible,workout,scripture,community,church,run,health
```

**Support URL**:
`https://faithfit-demo-production.up.railway.app/support.html`  
(replace with custom domain when ready)

**Privacy Policy URL**:
`https://faithfit-demo-production.up.railway.app/privacy.html`

**Marketing URL** (optional):
`https://faithfit-demo-production.up.railway.app`

### Age rating

Complete the questionnaire. Expect **12+** because of user-generated content and messaging. No unrestricted web, no gambling, no mature themes.

### Privacy nutrition labels

Transcribe from `webapp/public/privacy.html` and the collection map in `docs/app-store-readiness.md`:

| Data type              | Linked to user | Used for tracking | Purpose                          |
|------------------------|----------------|-------------------|----------------------------------|
| Email Address          | Yes            | No                | App Functionality, Account Mgmt  |
| Precise Location       | Yes            | No                | App Functionality (workouts / church search) |
| Health & Fitness       | Yes            | No                | App Functionality (HealthKit)    |
| User Content           | Yes            | No                | App Functionality (posts, DMs)   |
| Device ID (push token) | Yes            | No                | App Functionality (if notifications enabled) |

**Tracking**: No (`NSPrivacyTracking` = false).

### Screenshots (required)

Capture on a physical device or simulator at the exact sizes Apple lists for the current year:

- 6.7" (iPhone 15/16 Pro Max etc.)
- 6.5"
- 5.5" (if still required)
- iPad Pro if you keep `TARGETED_DEVICE_FAMILY: "1,2"`

Suggested frames (in order):

1. Home feed with a post that includes a verse + workout
2. Live workout / map screen
3. Scripture browse or practice
4. Explore / groups / challenges
5. Profile + Health sync or stats
6. Messages (DM thread)

Export PNG, no status-bar overlays that hide content.

### App Review notes (paste into the “Notes” field)

```
Functioning Faith is a native SwiftUI app (not a web-view wrapper).

Key native capabilities for review:
• Core Location route capture during member-initiated live workouts
• HealthKit read-only (workouts, steps, workout heart rate) — never writes to Health
• Sign in with Apple via ASAuthorizationAppleIDProvider
• End-to-end encrypted DMs (CryptoKit ECDH + AES-GCM, interoperable with the web client)
• In-app permanent account deletion (Profile → Delete account → DELETE /api/me)
• Report & block for UGC (posts and users)
• Deep links via functioningfaith:// (messages, workouts, groups, verses)

Test account (if needed):
  email: [see credentials held outside this public repo]
  password: [see credentials held outside this public repo]

Production API base: https://faithfit-demo-production.up.railway.app
(Privacy / Terms / Support linked above)

Please exercise a live workout start/stop, and open Messages to see an
existing conversation. To confirm end-to-end encryption specifically, send a
new message from this account -- the app generates its encryption keys on
first use, so only messages sent after that point are E2E-encrypted in transit;
the pre-seeded welcome conversation predates key generation and is stored as
plain text server-side, same as it would be for any account that has not yet
opened Messages.
```

Done -- a real reviewer account exists with two posts and an existing DM
conversation with a second seeded account ("Faith Community Team"), both
created directly against the production API. This repo is public, so its
credentials are not written here -- get them from whoever set up the
account, or re-register a fresh reviewer account via POST /api/auth/register
if you need new ones.

---

## 6. Archive → TestFlight → Submit

1. In Xcode: **Product → Archive** (Release, Any iOS Device).
2. Organizer → **Distribute App** → **App Store Connect** → Upload.
3. Wait for processing (can take 10–60 min).
4. In App Store Connect → TestFlight → add internal testers, install, smoke-test one more time.
5. When ready: App Store → version 1.0 → **Add for Review** → Submit.

After submission, monitor Resolution Center for any Guideline questions (4.2 minimum functionality is the most common false positive for apps that look “simple”; the review notes above are written to head that off).

---

## 7. Sign-off

| Step                              | Owner | Date | Build / commit |
|-----------------------------------|-------|------|----------------|
| App Icon complete                 |       |      |                |
| App ID + capabilities             |       |      |                |
| Server `APPLE_NATIVE_CLIENT_ID`   |       |      |                |
| Device QA (`RELEASE_CHECKLIST`)   |       |      |                |
| E2E DM proof                      |       |      |                |
| App Store Connect metadata        |       |      |                |
| Archive uploaded                  |       |      |                |
| Submit for Review                 |       |      |                |

Once the final row is checked, the native iOS app is on the App Store review queue.
