# FitFaith

A faith-based fitness + social web app — Strava and Instagram, reimagined around
scripture, community, and Christian identity instead of vanity metrics. Track real
runs, pair them with scripture, share your journey, and grow with others — alone or
with your church.

**Live:** https://faithfit-demo-production.up.railway.app

This is a real, production web app — a first-class responsive experience for both
mobile-web and desktop. (A separate native iOS app is built in parallel elsewhere.)

> The deployed application is entirely in [`webapp/`](webapp/). The other top-level
> folders (`services/`, `migrations/`, `ios/`, `infra/`, `integrations/`, …) are an
> earlier microservices scaffold that is **not used** by the live app and can be ignored.

## What it does

**Fitness**
- Real GPS run tracking (Leaflet/OpenStreetMap, haversine distance, no API key) and
  real Bluetooth heart-rate pairing (Web Bluetooth, standard BLE Heart Rate Service).
- 15 trackable activity types, manual logging (no live tracking required), a full
  analytics dashboard (streaks, PRs, weekly trend chart, activity breakdown).
- Themed challenges (Frodo's Sprint, The Emmaus Road, Jericho Seven, Gideon's 300,
  Moses's Wilderness 40, Elijah to Horeb, Noah's Forty) with auto-tracked progress.
- Workout partners: tag someone you trained with — once they confirm, you both get
  bonus XP (never automatic, prevents abuse).
- Strava sync (real OAuth2 connector — imports your recent activities, including
  the real GPS route).

**Faith**
- Real Bible library: 8,900+ verses of public-domain scripture (WEB/KJV), fast FTS5
  search, word-for-word verified against source (`webapp/scripts/verify-bible.js`).
- Scripture Trigger Engine: a real pipeline mapping workout/biometric context to a
  fitting verse.
- Location-based church discovery (free OpenStreetMap Overpass API, real results,
  no key needed) and daily devotionals from your church's real, linked YouTube
  channel.
- Church official website integration: if your church already embeds a sermon
  player (YouTube/Vimeo) on its own site, add the link and FitFaith surfaces the
  real embed directly — no API key needed for this path at all.
- Weekly sermon transcript + read-aloud (real YouTube captions, read via your
  browser's free built-in text-to-speech — not an AI voice, not a paid summary).
- Curated video library (Kids / Fitness / Motivational) from real, verified YouTube
  channels — gated behind a free-tier YouTube API key.

**Social**
- Feed with posts, likes, comments, follows, a public profile, a weekly leaderboard
  among people you follow, and a live notification bell.
- Sign in with Google / Microsoft / Apple (real OAuth2/OIDC with full cryptographic
  ID-token verification) alongside email + password.
- Group chat + scheduled run meetups with RSVP.
- Profile pictures (uploaded client-side, resized, stored — no third-party image
  host). Bio can include one link, restricted to LinkedIn or a recognized
  fundraiser platform (GoFundMe, JustGiving, Classy, Fundly, GiveSendGo).
- Post photos are self-certified as nature, animal, or a group photo only — no
  solo/portrait photos on posts (that's what the profile picture is for). A
  lightweight report action exists for community enforcement.
- Workout visibility (private/followers/public) with a shareable, unauthenticated
  link (`/w/:id`) for public activities.
- Full data export (`GET /api/me/export`) and a verified-quotes-only policy —
  every quote is scripture or a fact-checked, correctly-attributed source.

## Tech

Single Node.js (>=22.5) Express process. `node:sqlite` (built-in `DatabaseSync`) with
FTS5 for Bible search — no native addons to compile. Vanilla HTML/CSS/JS single-page
app (no build step). Cookie-session auth with scrypt-hashed passwords, plus real
OAuth2/OIDC. Rustic "silver / wood, illuminated-manuscript" theme with emerald
accents. Deployed on Railway with a persistent volume so data survives redeploys.

## Running locally

```bash
cd webapp
npm install
npm start           # http://localhost:3000  (set PORT to override)
```

The Bible library loads from committed JSON on first boot; podcasts and (if
configured) devotionals/videos refresh from their sources in the background. To
(re)ingest more scripture or verify what's already in the DB:

```bash
node scripts/ingest-bible.js            # all configured books, skips existing
node scripts/ingest-bible.js genesis    # a single book
node scripts/verify-bible.js            # word-for-word check against the source
```

## Deployment

Railway auto-deploys `webapp/` from `main` (Root Directory set to `webapp/`). A
persistent volume is mounted at `/data` (`DATA_DIR=/data`) so the SQLite database
survives redeploys — do not remove it. All data-loading migrations are additive and
idempotent, so redeploys never lose user data.

## Environment

Everything below is optional and additive — the app runs fully with none of it set
(email/password sign-in, Bible, feed, challenges, church search via Overpass, and
church-website video embeds all work with zero configuration). Each integration is
a true no-op (not even a background timer) until its variables are present.

| Var | Purpose | Cost | Notes |
|---|---|---|---|
| `PORT` | HTTP port | — | default `3000` |
| `DATA_DIR` | SQLite data directory | — | persistent volume in prod |
| `SESSION_SECRET` | cookie-session signing key | — | **set a real one in prod** |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | "Sign in with Google" | Free | [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials → OAuth client ID (Web application). Add `<your-domain>/api/auth/oauth/google/callback` as an authorized redirect URI. |
| `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` | "Sign in with Microsoft" | Free | [Azure Portal](https://portal.azure.com/) → App registrations → New registration. Redirect URI: `<your-domain>/api/auth/oauth/microsoft/callback`. |
| `APPLE_CLIENT_ID`, `APPLE_KEY_ID`, `APPLE_TEAM_ID`, `APPLE_PRIVATE_KEY` | "Sign in with Apple" | **Paid** — requires an active Apple Developer Program membership ($99/yr) | Set up a Services ID + Sign in with Apple key in the Apple Developer portal. |
| `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET` | Strava activity sync | Free | Register an app at [strava.com/settings/api](https://www.strava.com/settings/api). |
| `YOUTUBE_API_KEY` | Church devotionals + curated video library | Free tier | [Google Cloud Console](https://console.cloud.google.com/) → enable "YouTube Data API v3" → create an API key. Has a daily free quota; the church-website video path needs no key at all. |

**Not included:** paid LLM-based sermon summarization was deliberately left out —
the sermon feature only fetches the real caption transcript (free) and reads it
aloud via the browser's built-in text-to-speech (free). No Anthropic/OpenAI API
call is made anywhere in this app, so there's no per-request AI cost to budget for.
