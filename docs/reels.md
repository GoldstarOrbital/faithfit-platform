# Reels

Short-form feed: grit, the Inklings, Walnut Grove, and Highway to Heaven —
mixed, rotated, and kept inside the app's parameters.

## The one rule

**No video ID is ever written by hand.**

A made-up eleven-character YouTube ID is not a broken link — it resolves to
*some* real video. Typing a plausible-looking string into a source file would
put an unknown video in front of a family audience. So every source in
[`webapp/lib/reel-sources.js`](../webapp/lib/reel-sources.js) is a **search**,
executed against the real YouTube Data API with `safeSearch=strict`, and only
what comes back is stored.

## What's in it

| Category | Weight | Sources |
|---|---|---|
| `motivation` — Grit + perseverance | 3 | David Goggins, Nick Bare (channels); Goggins clips, Rocky and Creed speeches and training montages (queries) |
| `inklings` — Lewis + Tolkien | 3 | CSLewisDoodle, Tolkien Untangled (channels); Mere Christianity, the problem of pain, Tolkien interviews, the Lewis–Tolkien conversation on myth, eucatastrophe, Samwise's speech (queries) |
| `prairie` — Walnut Grove | 2 | Little House on the Prairie official (channel); best moments, Charles Ingalls lessons, faith scenes (queries) |
| `highway` — Highway to Heaven | 2 | Official channel; Michael Landon as Jonathan Smith, the probationary angel (queries) |

Weight controls the **share of the feed** a category may occupy, not how good it
is. Lewis and Goggins pull 3; the two Landon shows pull 2 each and sit together
tonally.

Two source kinds:

- **channels** — a real publisher exists, so take their uploads. Steadier,
  higher quality, far less likely to vanish. Costs 1 quota unit.
- **queries** — the material is spread across many uploaders (film edits,
  television clips). Costs 100 units, so these run weekly, not per cycle.

## Safety

`safeSearch=strict` is YouTube's filter and it is **not** sufficient alone. Two
further layers, doing different jobs:

- **BLOCK** — refuses the video outright. Substance and sexual terms, plus
  `explicit`, `uncensored`, `nsfw`, `gore`, `suicide`, `self-harm`.
- **FLAG** — keeps it, marks `language_flag`, and excludes it from the
  family-safe view.

`motivation` is flagged at **category level**. David Goggins is genuinely
profane — a compilation with an innocuous title can open with it — and a parent
handing a child the reels tab has to be safe. The feed is family-safe by
default; `GET /api/reels?safe=off` opts in to the flagged material.

This means **Goggins content does not appear in the default feed.** That is
deliberate, not an oversight. If you want it on by default, either move
`motivation` out of `LANGUAGE_RISK` in `reel-sources.js` (and accept the
language), or add a per-member preference.

## How freshness works

The freshest possible feed is "whatever was uploaded most recently", which is
also the fastest way to drift outside what this app is for. So freshness here is
**rotation within a fixed catalogue**, not open discovery.

Four stages, in order ([`webapp/lib/reels.js`](../webapp/lib/reels.js)):

1. **Eligibility** — screened, not known-dead, and (family-safe) not
   language-flagged.
2. **Not seen recently** — a hard filter on `reel_impressions`, 10-day cooldown.
   *This is what actually makes it feel fresh.* "I have not been shown this"
   matters far more than when it was uploaded.
3. **Score** — upload recency (gentle: a 1985 Highway to Heaven clip is not
   worse than last week's upload), a bonus for material never shown to anyone,
   a preference for official channels, and real randomness so two loads differ.
4. **Mix** — per-category caps by weight, then round-robin interleaved so you
   never get four Walnut Grove clips in a row.

Weights are shared across categories that **actually have candidates**, not all
of them. Reserving a share for an empty category silently shortens the feed —
a 20-item request returned 14 before this was fixed. A top-up pass fills any
remaining shortfall in rank order.

When the catalogue is used up for a member, the cooldown is relaxed rather than
serving an empty screen — and the response says `recycled: true` instead of
presenting repeats as new.

## Liveness

Most of the film and television material is uploaded by third parties and
disappears without warning. A dead ID renders as an error box inside the feed,
so stored videos are re-checked every 7 days via `videos.list` and marked
`dead_at` when gone.

Marked, **not deleted** — a video blocked in one region or briefly unavailable
can come back, and the row carries its provenance. A failed API batch is treated
as *unknown*, never as "all of these are dead", so one bad request cannot wipe a
working library.

## Quota

This is the constraint that actually governs the design. The YouTube Data API
allows **10,000 units/day**; `search` costs **100**, `playlistItems` and
`videos` cost **1**.

Ingestion was exceeding the daily allowance and failing with HTTP 429 on nearly
every channel. Three fixes:

| | Before | After |
|---|---|---|
| Channel uploads | `search` — 100 units each | uploads playlist — **1 unit** each |
| Channel resolution | re-searched every cycle (~3,700 units/day) | skipped once on file — **0** |
| Query searches | every cycle | **weekly** |
| **Per cycle** | **~9,500 units** | **~37 units** |

The old code checked "do I already know this channel?" *after* spending the 100
units to look it up. Weekly query refresh adds ~2,100 units once a week.

## Endpoints

- `GET /api/reels` — the feed. `?safe=off` includes language-flagged material.
  Returns `curated_count` and `recycled` alongside the videos.
- Church videos are appended separately and are unaffected by this algorithm.

## Adding a category

1. Add it to `CATEGORIES` in `reel-sources.js` with a `label`, a `weight`, and
   `channels` / `queries` as **searches**, never IDs.
2. If strong language is likely, add the key to `LANGUAGE_RISK`.
3. Nothing else. Ingestion, screening, mixing, liveness and the feed all read
   from `CATEGORIES`.

Mind the quota when adding queries: each one costs 100 units per weekly refresh.

## Known limits

- **Unofficial clips are fragile.** Rocky/Creed edits and television clips are
  mostly third-party uploads; expect churn. The liveness check handles the
  symptom, not the cause.
- **Search quality varies.** A query returns what YouTube thinks is relevant.
  Screening catches the unacceptable, but a mediocre match still gets stored —
  worth reviewing `source_note` in the `videos` table occasionally.
- **The catalogue is not endless.** Roughly 30 channel uploads plus 12 per
  query. A heavy user will hit `recycled: true`; widen the queries to fix that.
