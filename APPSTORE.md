# App Store readiness — Functioning Faith

Verified against the actual code in this repo on 2026-08-12, not assumed. Each
item below says what's true today and what's still missing. Nothing here is
generic boilerplate — every claim was checked against `webapp/` before being
written down.

## The one risk that decides everything: Guideline 4.2 (Minimum Functionality)

**There is currently no native wrapper in this repo at all** — no Capacitor,
Cordova, Expo, or Xcode project. `webapp/` is a server-rendered PWA (Express +
vanilla JS), nothing more.

Apple rejects apps that are "simply a website wrapped in an app" with no
justification for existing outside Safari. Before this ships to the App
Store, someone has to:

1. Pick a wrapper (Capacitor is the natural fit here — it's a thin native
   shell around exactly the web app that already exists, and it exposes real
   native APIs where the web app currently uses browser-only ones).
2. Make the *native build* meaningfully different from "open Safari" — the
   things that already exist and genuinely qualify:
   - **Push notifications** — `lib/push.js` is real (VAPID web push), but iOS
     Safari-based web push has real limitations; native APNs via the wrapper
     is the credible answer.
   - **GPS workout tracking** — `lib/segments.js` / `lib/overlay.js` and the
     workout flow use the browser Geolocation API today; a native wrapper can
     use background location, which the web app cannot.
   - **Wearable integrations** — `lib/wearables.js` (Strava/Fitbit/Oura) is
     real OAuth, not a mockup.
   - **The offline shell** — `public/sw.js` already caches the app shell with
     a real cache-invalidation strategy (see the `SHELL_CACHE` version bump
     and `cacheable()` guard against caching error responses).

Without at least the background-location and native-push angle, this reads as
exactly the wrapped-website pattern Apple's reviewers are trained to catch.
This is the highest-leverage unresolved item — everything else below is
secondary to it.

## Guideline 1.2 (User-Generated Content) — mostly already satisfied

Apple requires, for any app with UGC: a way to report objectionable content, a
way to block abusive users, published content standards, and a way to contact
the developer. Checked against the live routes:

| Requirement | Status | Where |
|---|---|---|
| Report content | **Done** | `POST /api/posts/:id/report`, `POST /api/users/:id/report` |
| Block users | **Done** | `POST/DELETE /api/users/:id/block`, plus a separate DM-level block at `POST/DELETE /api/dms/block/:userId` |
| Published content standard | **Done** | `public/terms.html` §2, with a specific, non-vague definition of "no vanity content" |
| Moderation review + enforcement | **Done** | `moderation_queue` table, `GET/POST /api/moderation/queue*`, reachable now at `public/moderation.html` |
| Developer contact | **Fixed this pass** | `public/terms.html` and `public/privacy.html` both referenced "the support channel" without ever naming one — that was broken copy pointing at nothing. Both now link `hello@functioningfaith.app` (matches the address already used as the VAPID contact in `lib/push.js`). |

The one thing Apple sometimes also wants and isn't fully built: a *published*
average review-time or an explicit statement that reports get a timely
response. `terms.html` §7 says reports get review and an appeal path, which
is probably sufficient, but if review flags it, tightening that language is a
five-minute fix, not a feature.

## Age rating

- Minimum age is enforced app-side: `terms.html` §3 states 13+, and the app
  does not claim COPPA parental-consent support for under-13 (correct —
  don't build that unless you actually intend to comply with COPPA in full).
- UGC + chat (DMs, group chat, comments) means this cannot be rated below
  **12+ (App Store) / Teen (Google Play equivalent)** regardless of content
  tone — the UGC + communication combination alone triggers that floor.
- No alcohol/gambling/mature content anywhere in the app; the reel and food
  content pipelines (`lib/reel-sources.js`, `lib/videos.js`) actively
  *blocklist* that material rather than surface it. That's a fact worth
  having in the App Store Connect age-rating questionnaire answers, not an
  assumption.

## Account deletion — Guideline 5.1.1(v)

**Already fully compliant.** This is not just an API:
- Real in-app button: `public/app.js` — "Delete my account" in profile
  settings, wired to `DELETE /api/me`.
- The backend (`routes/api.js` ~line 2541) actually deletes the row, not a
  soft-delete flag — confirmed by reading the handler, not assumed from the
  route name.
- `privacy.html` accurately describes what deletion does and does not
  remove (safety/legal-hold records may persist, which is standard and
  expected, not a compliance gap).

Nothing to do here. This requirement is done.

## Sign-in requirements — Guideline 4.8 (Sign in with Apple)

If an app offers third-party login, Apple requires Sign in with Apple as an
equivalent option. Checked `lib/oauth.js`: Google, Microsoft, **and Apple**
are all wired as real OAuth providers. Compliant as built — just confirm the
native wrapper actually surfaces Apple sign-in as prominently as Google's,
since Apple reviewers check button parity, not just backend support.

## Privacy nutrition labels (App Store Connect, not code)

This is a data-entry task in App Store Connect, not something fixable in the
repo — but `privacy.html` §1 and §8 already enumerate exactly what's
collected and which providers see it (Gloo, YouVersion, Strava/Fitbit/Oura,
push providers), which is the source of truth to transcribe from. The
category to get right: GPS/location and health data (heart rate, sleep,
readiness) are both processed — per `privacy.html` §6, only with explicit
opt-in and only for a workout/connector the member initiates. That maps to
"Location" and "Health & Fitness" categories in the nutrition label, both
marked as linked-to-user (not just device-only), since routes and readings
are stored per account.

## Required legal URLs — status

- Privacy Policy: **live**, `public/privacy.html`.
- Terms of Service: **live**, `public/terms.html`.
- Support URL: **was missing**, now fixed. `public/support.html` is a real
  page at `https://<domain>/support.html` — the URL to hand App Store Connect
  for its "Support URL" field. `terms.html` and `privacy.html` both link to
  it instead of a bare mailto.

## Summary — what's actually left

1. **Build the native wrapper** (Capacitor recommended) and give it a real
   native capability the web app doesn't have (background GPS, native push).
   This is the load-bearing item; nothing else matters if 4.2 rejects it.
2. Transcribe the privacy nutrition labels into App Store Connect from
   `privacy.html` §1/§6/§8 — Location and Health & Fitness both need to be
   marked "linked to user," not "not linked."
3. Everything else — UGC moderation, blocking, reporting, account deletion,
   Sign in with Apple — is already built and verified against the running
   code, not assumed from good intentions.
