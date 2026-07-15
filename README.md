# FaithFit

A faith-based fitness + social web app — Strava and Instagram, reimagined around
scripture, community, and Christian identity instead of vanity metrics. Track real
runs, pair them with scripture, share your journey, and grow with others.

**Live:** https://faithfit-demo-production.up.railway.app

This is a real, production web app — a first-class responsive experience for both
mobile-web and desktop. (A separate native iOS app is built in parallel elsewhere.)

> The deployed application is entirely in [`webapp/`](webapp/). The other top-level
> folders (`services/`, `migrations/`, `ios/`, `infra/`, `integrations/`, …) are an
> earlier microservices scaffold that is **not used** by the live app and can be ignored.

## What it does

- **Real GPS run tracking** — live route on an OpenStreetMap/Leaflet map, haversine
  distance, no API key required.
- **Real Bluetooth heart-rate pairing** — Web Bluetooth against the standard BLE
  Heart Rate Service (0x180D); works with real chest straps in Chrome/Edge.
- **Scripture Trigger Engine** — a real pipeline that reads workout/biometric context,
  maps it to scripture themes, and surfaces a fitting verse.
- **Real Bible library** — 8,900+ verses of public-domain scripture (WEB/KJV) with
  fast FTS5 full-text search. Complete Genesis, Psalms, Proverbs, and all four
  Gospels, plus more. Ingested and verified by [`webapp/scripts/ingest-bible.js`](webapp/scripts/ingest-bible.js);
  see the live [`/api/bible/coverage`](https://faithfit-demo-production.up.railway.app/api/bible/coverage).
- **Social feed** — followers, posts (workouts + reflections), likes, comments,
  Strava-style stat cards and Instagram-style stories.
- **Workout visibility + sharing** — every post is private, followers-only, or public;
  public workouts get a shareable, unauthenticated link (`/w/:id`) showing the route,
  stats, and paired verse — without exposing private profile fields.
- **Podcasts** — real, current episodes from independent Christian shows (The Bible
  Recap, The Ten Minute Bible Hour, Ask NT Wright Anything, Christian History Almanac),
  ingested from their public RSS feeds with an in-app audio player.
- **Gamification** — XP/levels, badges, quests. **Breathing** box-breathing sessions.
- **Verified quotes only** — every quote is scripture or a correctly-attributed,
  fact-checked source. Nothing fabricated or misattributed.
- **Secure, locked-down profile** — the bio can only be a real Bible verse that exists
  in our library; email and password hash are never returned by any API.

## Tech

Single Node.js (>=22.5) Express process. `node:sqlite` (built-in `DatabaseSync`) with
FTS5 for Bible search — no native addons to compile. Vanilla HTML/CSS/JS single-page
app (no build step). Cookie-session auth with scrypt-hashed passwords. Rustic
"silver / wood, illuminated-manuscript" theme. Deployed on Railway with a persistent
volume so data survives redeploys.

## Running locally

```bash
cd webapp
npm install
npm start           # http://localhost:3000  (set PORT to override)
```

The Bible library loads from committed JSON on first boot; podcasts refresh from their
RSS feeds in the background. To (re)ingest more scripture:

```bash
node scripts/ingest-bible.js            # all configured books, skips existing
node scripts/ingest-bible.js genesis    # a single book
```

## Deployment

Railway auto-deploys `webapp/` from `main` (Root Directory set to `webapp/`). A
persistent volume is mounted at `/data` (`DATA_DIR=/data`) so the SQLite database
survives redeploys — do not remove it. All Bible/podcast data loads are additive and
idempotent, so redeploys never lose user data.

## Environment

| Var | Purpose | Default |
|---|---|---|
| `PORT` | HTTP port | `3000` |
| `DATA_DIR` | SQLite data directory (persistent volume in prod) | `webapp/data` |
| `SESSION_SECRET` | cookie-session signing key | dev fallback — **set in prod** |
