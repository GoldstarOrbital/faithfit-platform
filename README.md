# Functioning Faith

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

## Hackathon build

The competition story is **Scripture in Motion**: a grounded Scripture moment attached
to real movement, a game-like world, and a community that helps people flourish. The
demo script and integration checklist live in [`docs/hackathon-readiness.md`](docs/hackathon-readiness.md).

Built on both contest platforms — **Gloo AI** for values-aligned inference and
**YouVersion** for scripture — with a hard line between what a model may decide
and what only scripture may say. See [Scripture, AI, and the line between
them](#scripture-ai-and-the-line-between-them).

## Scripture, AI, and the line between them

Two APIs do the faith work in this app, and they are deliberately given
different jobs:

| | **Gloo AI Platform** | **YouVersion Platform** |
|---|---|---|
| Job | Decides **which** scripture fits this moment, and writes the words *around* it | Supplies **what the verse actually says** |
| Why it | Values-aligned inference, and a `tradition` parameter no general model endpoint has | The canon, in 14 English translations, from the people who publish them |
| Code | [`webapp/lib/gloo.js`](webapp/lib/gloo.js) | [`webapp/lib/youversion.js`](webapp/lib/youversion.js) |

Scripture is supplied in three places, all through one verified path in
[`webapp/lib/companion.js`](webapp/lib/companion.js): **mid-workout**,
**during breathwork**, and **when your heart rate is up while you're sitting
still**. That file exists to enforce one rule:

> **A model never produces scripture.**

Ask a language model to recall a verse and it will give you something
verse-shaped, subtly wrong: a word swapped, a clause dropped, a reference off by
one. So no text a model emits is ever shown as scripture. The model returns a
*reference*; the reference is resolved against YouVersion (or the locally
ingested public-domain library, verified word-for-word); and the real text is
what a member reads.

**Three checks stand between a model and a member.** They are code, not prompt
instructions:

1. **Truncated replies are discarded, not trimmed.** Found while building this:
   a length-capped completion returned `Philippians 4:1` — almost certainly a cut
   `4:13`. Both are real verses, so no reference check could ever catch it. Any
   completion whose `finish_reason` isn't `stop` is thrown away.
2. **Every cited reference must resolve.** Extraction is deliberately
   over-inclusive: it matches anything *shaped* like a citation, not just real
   book names, because a model that invents `Hezekiah 3:16` produces something
   no book-name pattern would recognise. Unknown book → treated as unresolved.
3. **Verse text always comes from the resolver.** A reply whose references all
   fail is dropped whole and the app falls back to its hand-authored verse
   lists — the behaviour it shipped with.

`GET /api/ai/status` is public and unauthenticated on purpose. It reports both
integrations, the guardrails, and a 7-day count of references cited vs.
references verified. A claim like the one above should be checkable by anyone
rather than asserted in a README.

### What this actually changes

**Scripture chosen for the moment you're in.** The app already classified live
sessions from real telemetry and had an authored shortlist per moment. What it
couldn't do was weigh *your* numbers against that shortlist. Now the shortlist,
your measured heart-rate zone, the gradient ahead, and your tradition go to
Gloo, which picks one and writes a single line about the choice. Same telemetry,
different traditions, genuinely different answers — verified live:

```
evangelical → Hebrews 12:1     catholic → Galatians 6:9
```

Selection stays inside scripture a human already vetted for that moment; the
judgement about which one fits *now* is made with the real numbers in hand.

**Scripture while you breathe.** Each breathing pattern used to ship one
authored verse, identical for everyone forever. Now the verse is chosen from a
shortlist matched to what the pattern is *for* — steadying before effort,
coming to rest, winding down, waking up — in your tradition, and it can take
account of why you opened it.

**Scripture when your heart rate is up at a desk.** The third context, and the
one with the strictest rule in the codebase. `POST /api/checkin/heart` compares
a live monitor reading against **your own measured resting rate**, using
heart-rate reserve rather than raw bpm (+20 is a lot at a resting rate of 48 and
unremarkable at 78), and offers scripture plus a breathing pattern.

It refuses to speak without the evidence. No monitor, no resting baseline, or
you're moving → it says exactly what is missing instead of producing a softer
answer from thinner evidence. `"Elevated" is a comparison, and comparing to an
estimate would not mean anything.` A single high reading is a twitch, not a
state, so it requires a sustained one.

And it never tells you what you are feeling:

> A heart rate is a measurement. Stress, anxiety, fear and dread are not — they
> are interpretations of a measurement, and a wrong one lands on someone at the
> worst possible moment.

Two people with identical readings may be dreading a meeting, recovering from
coffee, fighting an infection, or about to propose to somebody. So the model
gets the numbers and is explicitly forbidden the interpretation — it may not
call you stressed, anxious, worried, panicking, overwhelmed or afraid, may not
diagnose, and may not predict what your body is about to do. It reports what was
measured, offers scripture, and offers a way to breathe. What the reading *means*
is yours to say. A test asserts no context label or blurb in the app names a
feeling.

**Scripture as conversation.** Verse threads gained a companion that answers the
question which stalls a thread — what a word meant, who was being addressed — in
the asker's own tradition. It is not a participant: its answer goes to the asker
and is never written into the thread, so nobody's conversation fills with
machine text. Any further verse it cites is fetched and shown as real text
beside the answer; one that can't be resolved is stripped from the reply.

**Tradition as a real setting.** Members could always name their church. That
was decoration. `tradition` (evangelical / catholic / mainline /
not_faith-specific, or blank) is the first field the app acts on. Blank means
calls go out unshaped — a stranger's theology is never inferred from a church
name. It is also **not public**: it's a setting, not a badge, so it's stripped
from every profile payload except your own.

Everything degrades. With no Gloo credentials the companion is absent and
sessions use the authored verse lists; with no YouVersion key the local 22-book
library serves and references beyond it stay bare. Neither is stubbed with a
placeholder, and nothing is ever filled in from nowhere.

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
  player (YouTube/Vimeo) on its own site, add the link and Functioning Faith surfaces the
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
| `YOUVERSION_API_KEY` | Real verse text for the whole canon, in 14 English translations | Free | [YouVersion Platform](https://developers.youversion.com/). Sent as `x-yvp-app-key`. Without it the app serves its 22 locally ingested public-domain books and leaves other references bare. |
| `GLOO_CLIENT_ID` / `GLOO_CLIENT_SECRET` | Values-aligned AI: moment-aware scripture selection + the verse companion | Metered | [Gloo AI Studio](https://studio.ai.gloo.com/) → API Credentials. OAuth2 client credentials. Without them the companion is absent and sessions use the authored verse lists. |
| `GLOO_PUBLISHER` | Grounds companion answers in your own uploaded content (Gloo RAG) | — | Optional. Only meaningful once content is ingested into Gloo under your publisher; unset means ordinary completions. |

**Cost note:** Gloo is the only metered dependency. Every call is cached by a
hash of the exact request (`gloo_cache`) and logged with its token usage
(`gloo_calls`), because the same moment and tradition recur constantly across a
session and across members — inspect either table, or `GET /api/ai/status`, to
see what it is actually spending. Expect a large `prompt_tokens` figure on every
call: Gloo prepends its own values-alignment system prompt, which is the point.

**Still not included:** paid LLM sermon summarization. The sermon feature fetches
the real caption transcript (free) and reads it aloud via the browser's built-in
text-to-speech (free) — no model rewrites a preacher's words.
