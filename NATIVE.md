# Native wrapper — what's built, what's real, what's left

Written after actually running every command below in this environment, not
from general Capacitor knowledge. Where something couldn't be verified here
(no Mac, no Xcode, no Android SDK/JDK), that's stated plainly rather than
assumed to work.

## What's actually done

- **Capacitor installed and configured** — `webapp/capacitor.config.json`.
  The WebView points at the live deployed origin (`server.url`), not a
  bundled copy of `public/` — this app is server-backed (sessions, the
  moderation queue, Gloo-gated verse matching all live behind `/api`), so
  bundling would serve a page whose `fetch('/api/...')` calls resolve
  against nothing.
- **iOS and Android platform projects generated** — `webapp/ios/` and
  `webapp/android/`, via `npx cap add ios` / `npx cap add android`, both
  confirmed to run clean in this environment and pick up all 5 plugins.
- **Real app icons, not placeholders** — `scripts/generate-icons.js` was
  extended (same hand-written RFC 2083 PNG encoder used for the PWA icons
  earlier, no new dependency) to also emit:
  - The iOS App Store icon at the exact path and size Xcode's asset catalog
    wants (`AppIcon-512@2x.png`, 1024×1024), encoded **without an alpha
    channel** — verified the file has zero transparency, which is what App
    Store Connect's automatic icon validation actually checks for.
  - Android's full launcher icon set: legacy square icons at all five
    densities (`ic_launcher.png` / `ic_launcher_round.png`, 48–192px) plus
    the adaptive-icon foreground layer at all five densities
    (`ic_launcher_foreground.png`, 108–432px) — verified by decoding the PNG
    back out and confirming the corners are genuinely transparent (alpha=0)
    and the glyph sits correctly inset in the safe zone, not just "looks
    right in a preview."
  - The adaptive icon's background layer color was fixed from Capacitor's
    default white to the brand cream (`#F6EFDF`).
- **`public/native.js`** — the bridge code. Detects `window.Capacitor`;
  every one of its effects is a no-op when that's absent, which is every
  ordinary web visitor. Confirmed in a browser: booted the app, checked the
  console, zero errors, zero behavior change from before this existed.
  - Hides the native splash screen once the page has painted.
  - Sets the native status bar to the app's cream background.
  - Requests push permission and registers the resulting device token
    against `POST /api/push/native-register`.
- **`lib/push.js` extended** with a `native_push_tokens` table and
  `registerNativeToken` / `unregisterNativeToken`. Tested directly against a
  running server: register, unregister, and rejecting an invalid platform
  string all work as expected.
- **iOS `Info.plist`** got the two entries a real submission needs:
  `NSLocationWhenInUseUsageDescription` (required the moment any code calls
  the Geolocation plugin — not yet, but the plugin is installed, so this is
  in place ahead of that) and `ITSAppUsesNonExemptEncryption: false` (the app
  only uses standard HTTPS/TLS, which is export-compliance-exempt, so this
  skips the manual prompt at every future submission).

## What's real but explicitly incomplete

**Actual push delivery is not wired.** `push.sendNative()` exists with the
real function signature but always returns `{ sent: 0, skipped:
'not_configured' }`. Sending to an iOS token needs an APNs auth key (a `.p8`
file plus a Team ID and Key ID, which only exist once there's an Apple
Developer Program membership); sending to an Android token needs a Firebase
project and a service-account credential. Neither can be created from here —
they require accounts and console access this environment doesn't have.
Registration is real and tested; delivery is two HTTP integrations away, not
built from scratch, once those credentials exist.

**Native background GPS is not wired into the workout flow.**
`@capacitor/geolocation` is installed, but the existing workout tracker uses
the browser Geolocation API through the WebView, which already works. Routing
it through the native plugin's background-capable path touches real
fitness-tracking logic (`lib/segments.js`, the live workout recorder) that
deserves a dedicated pass with its own testing, not a bolt-on alongside
everything else in this one. Worth doing — background tracking survives the
screen locking, which the browser API does not — but not done yet.

## What cannot be done from this environment at all

- **Building or running the actual iOS app.** That needs Xcode on a Mac, plus
  CocoaPods to resolve the native plugin dependencies. Neither exists here.
  The `ios/` project is a complete, valid Xcode project — `open
  ios/App/App.xcworkspace` on a Mac with Xcode is the next step — but it has
  never actually been opened or built in this session, and I won't claim
  otherwise.
- **Building the Android APK/AAB.** That needs a JDK and the Android SDK
  (`ANDROID_HOME`), neither installed here. `npx cap add android` and `npx
  cap sync` both ran clean, which confirms the project structure is valid,
  but `./gradlew assembleDebug` was never actually run.
- **An Apple Developer Program membership** ($99/year) — required for
  Sign in with Apple to work in a real build (the web OAuth flow already
  works; the native entitlement needs a real team), for push (the APNs key
  above), and for App Store submission itself.
- **A Google Play Console account** ($25 one-time) — required for Play Store
  submission and for generating a real Android signing key.

## Before shipping: the one thing that must change

`capacitor.config.json`'s `server.url` currently points at
`faithfit-demo-production.up.railway.app` — a demo hostname, for local
iteration only. Ship to either store with that URL and the WebView will show
a Railway domain in a company's app that names `functioningfaith.app`
everywhere else (Terms, Privacy, Support). Before a real submission, point
this at the actual production domain, and set up an
`apple-app-site-association` file there if universal links matter.

## Concrete next steps, in order

1. Get an Apple Developer Program membership and a Google Play Console
   account.
2. Stand up a real production domain (not the Railway demo hostname) and
   update `capacitor.config.json`.
3. On a Mac: `open ios/App/App.xcworkspace`, resolve CocoaPods, set the
   signing team, build to a real device, verify push permission prompts and
   the splash/status-bar behavior actually look right (this has only been
   verified by reading `native.js`'s logic and confirming it's inert on the
   web — it has never run inside an actual native WebView).
4. Generate an APNs `.p8` key and a Firebase project; wire `sendNative()` in
   `lib/push.js` to actually call them.
5. On a machine with the Android SDK: `cd android && ./gradlew
   assembleDebug`, install on a device, same verification pass.
6. Revisit native background geolocation for the workout flow as its own
   focused change.
