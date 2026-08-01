/**
 * The reels feed: ingestion, ranking, and keeping it alive.
 *
 * The brief was "keep the content fresh, but keep it inside the parameters".
 * Those pull against each other — the freshest possible feed is whatever was
 * uploaded most recently, which is also the fastest way to drift outside what
 * this app is for. So freshness here is *rotation within a fixed catalogue*
 * (lib/reel-sources.js), not open discovery. Nothing enters the feed that did
 * not come from a defined source.
 *
 * Four things decide what you see, in order:
 *
 *   1. Eligibility — screened, embeddable, not known-dead, and (for the
 *      family-safe view) not language-flagged.
 *   2. Not seen recently — a hard filter, relaxed only if it would leave the
 *      feed empty. This is what actually makes it feel fresh; recency of upload
 *      matters far less than "I have not been shown this."
 *   3. Score — upload recency, a nudge for material never shown to anyone, and
 *      deliberate randomness so two loads are never identical.
 *   4. Mix — per-category caps by weight, then interleaved so you never get
 *      four Walnut Grove clips in a row.
 *
 * Everything degrades. With no YOUTUBE_API_KEY nothing is ingested and the feed
 * serves whatever the library already holds; with an empty library it returns
 * an empty list rather than inventing anything.
 */
'use strict';

const { randomUUID } = require('crypto');
const db = require('./db');
const youtube = require('./youtube');
const { CATEGORIES, screen } = require('./reel-sources');

// How long a video stays "seen" for one member. Long enough that the feed does
// not loop back within a session or a day of casual use; short enough that a
// good clip can come round again rather than being burned forever.
const SEEN_COOLDOWN_DAYS = 10;
// Re-check stored videos for takedowns on this cadence.
const LIVENESS_DAYS = 7;
const MAX_PER_QUERY = 12;
// Video search costs 100 quota units against a 10,000/day allowance, so the
// query sources run on a slow cadence. Channels are cheap (1 unit via the
// uploads playlist) and refresh every cycle; queries are for catalogue depth,
// not breaking news -- a Rocky edit from last Tuesday is not more valuable than
// one from last year.
const QUERY_REFRESH_DAYS = 7;
const MAX_PER_CHANNEL = 10;

function init() {
  // Additive columns on the existing videos table.
  const cols = db.prepare('PRAGMA table_info(videos)').all().map(c => c.name);
  const add = (name, ddl) => { if (!cols.includes(name)) db.exec(`ALTER TABLE videos ADD COLUMN ${ddl}`); };
  add('language_flag', 'language_flag INTEGER DEFAULT 0');   // strong language likely
  add('source_kind', "source_kind TEXT DEFAULT 'channel'");  // 'channel' | 'query'
  add('source_note', 'source_note TEXT');                    // which query/channel produced it
  add('last_checked_at', 'last_checked_at TEXT');
  add('dead_at', 'dead_at TEXT');                            // takedown / blocked / private

  db.exec(`
    -- What each member has already been shown. The single most important input
    -- to "does this feel fresh", and the reason the feed differs per person.
    CREATE TABLE IF NOT EXISTS reel_impressions (
      user_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, video_id)
    );
    CREATE INDEX IF NOT EXISTS idx_reel_impr_user ON reel_impressions(user_id, seen_at);

    -- When each catalogue query last ran, so an expensive search is not repeated
    -- on every cycle.
    CREATE TABLE IF NOT EXISTS reel_query_runs (
      query TEXT PRIMARY KEY,
      last_run_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

// --- Ingestion --------------------------------------------------------------
function upsert(row) {
  db.prepare(`
    INSERT INTO videos (id, category, video_id, title, description, thumbnail_url,
                        channel_title, published_at, is_short, language_flag,
                        source_kind, source_note, last_checked_at)
    VALUES (@id, @category, @video_id, @title, @description, @thumbnail_url,
            @channel_title, @published_at, @is_short, @language_flag,
            @source_kind, @source_note, datetime('now'))
    ON CONFLICT(category, video_id) DO UPDATE SET
      title = excluded.title,
      thumbnail_url = excluded.thumbnail_url,
      channel_title = excluded.channel_title,
      language_flag = excluded.language_flag,
      last_checked_at = datetime('now'),
      dead_at = NULL
  `).run(row);
}

/**
 * Fill the library from the catalogue. Safe to run repeatedly: everything
 * upserts on (category, video_id).
 */
async function ingest() {
  if (!youtube.isConfigured()) {
    console.log('[reels] no YOUTUBE_API_KEY — serving whatever the library already holds');
    return { added: 0, skipped: 0 };
  }
  let added = 0, skipped = 0;

  for (const [category, def] of Object.entries(CATEGORIES)) {
    // Channels first: a real publisher is steadier than a search.
    for (const q of (def.channels || [])) {
      try {
        const found = await youtube.searchChannels(q);
        if (!found.length) continue;
        const uploads = await youtube.fetchUploadsCheap(found[0].channelId, MAX_PER_CHANNEL);
        for (const v of uploads) {
          const check = screen({ title: v.title, description: v.description }, category);
          if (!check.ok) { skipped++; continue; }
          upsert({
            id: randomUUID(), category, video_id: v.videoId,
            title: v.title || null, description: v.description || '',
            thumbnail_url: v.thumbnailUrl || null,
            channel_title: found[0].title || null,
            published_at: v.publishedAt || null,
            is_short: 1, language_flag: check.language_flag,
            source_kind: 'channel', source_note: q,
          });
          added++;
        }
      } catch (err) {
        console.error(`[reels] channel "${q}" failed: ${err.message}`);
      }
    }

    // Then queries, for material spread across many uploaders.
    for (const q of (def.queries || [])) {
      const last = db.prepare('SELECT last_run_at FROM reel_query_runs WHERE query = ?').get(q);
      if (last && Date.parse(last.last_run_at + 'Z') > Date.now() - QUERY_REFRESH_DAYS * 86400000) {
        continue;                       // ran recently; the results are still on file
      }
      try {
        const found = await youtube.searchVideos(q, { maxResults: MAX_PER_QUERY });
        db.prepare(`INSERT INTO reel_query_runs (query) VALUES (?)
                    ON CONFLICT(query) DO UPDATE SET last_run_at = datetime('now')`).run(q);
        for (const v of found) {
          const check = screen(v, category);
          if (!check.ok) { skipped++; continue; }
          upsert({
            id: randomUUID(), category, video_id: v.videoId,
            title: v.title || null, description: v.description || '',
            thumbnail_url: v.thumbnailUrl || null,
            channel_title: v.channelTitle || null,
            published_at: v.publishedAt || null,
            is_short: 1, language_flag: check.language_flag,
            source_kind: 'query', source_note: q,
          });
          added++;
        }
      } catch (err) {
        console.error(`[reels] query "${q}" failed: ${err.message}`);
      }
    }
  }
  console.log('[reels] ingest complete: %d stored, %d screened out', added, skipped);
  return { added, skipped };
}

/**
 * Re-check stored videos for takedowns.
 *
 * Most of the film and television material is uploaded by third parties and
 * disappears without warning. A dead ID renders as an error box inside the
 * feed, so it is marked rather than left to fail in front of someone. Marked,
 * not deleted: a video blocked in one region or briefly unavailable can come
 * back, and the row carries its provenance.
 */
async function pruneDead(limit) {
  if (!youtube.isConfigured()) return { checked: 0, dead: 0 };
  const due = db.prepare(`
    SELECT DISTINCT video_id FROM videos
     WHERE dead_at IS NULL
       AND (last_checked_at IS NULL OR last_checked_at < datetime('now', ?))
     LIMIT ?`).all('-' + LIVENESS_DAYS + ' days', Math.min(200, Number(limit) || 100))
    .map(r => r.video_id);
  if (!due.length) return { checked: 0, dead: 0 };

  const alive = await youtube.checkVideos(due);
  let dead = 0;
  const markDead = db.prepare("UPDATE videos SET dead_at = datetime('now') WHERE video_id = ?");
  const markSeen = db.prepare("UPDATE videos SET last_checked_at = datetime('now') WHERE video_id = ?");
  for (const id of due) {
    const hit = alive.get(id);
    if (!hit) { markDead.run(id); dead++; }
    else if (!hit.unknown) markSeen.run(id);   // unknown = request failed, retry later
  }
  if (dead) console.log('[reels] %d video(s) no longer playable, marked', dead);
  return { checked: due.length, dead };
}

// --- The feed ---------------------------------------------------------------
/** Score a candidate. Higher wins. */
function score(v, now) {
  let s = 0;

  // Upload recency, gently. This is a catalogue of deliberately chosen
  // material, much of it decades old — a 1985 Highway to Heaven clip is not
  // worse than a video posted last week, so recency nudges rather than decides.
  if (v.published_at) {
    const days = (now - Date.parse(v.published_at)) / 86400000;
    if (Number.isFinite(days)) s += Math.max(0, 12 - Math.log10(Math.max(1, days)) * 4);
  }

  // Never shown to anyone: worth surfacing so the library actually gets used
  // rather than the same forty clips circulating.
  if (!v.global_impressions) s += 8;

  // Deliberate randomness. Without it the same ordering appears every time and
  // a feed that never varies reads as broken however good the ranking is.
  s += Math.random() * 14;

  // A little preference for a real publisher over a search result: official
  // uploads are higher quality and far less likely to vanish.
  if (v.source_kind === 'channel') s += 3;

  return s;
}

/**
 * Build a member's feed.
 *
 * @param {string} userId
 * @param {object} opts  limit, familySafe (exclude language-flagged)
 */
function feed(userId, opts = {}) {
  const limit = Math.min(60, Math.max(5, Number(opts.limit) || 30));
  const familySafe = opts.familySafe !== false;      // safe unless asked otherwise

  const rows = db.prepare(`
    SELECT v.video_id, v.category, v.title, v.description, v.thumbnail_url,
           v.channel_title, v.published_at, v.language_flag, v.source_kind,
           (SELECT COUNT(*) FROM reel_impressions i WHERE i.video_id = v.video_id) AS global_impressions,
           (SELECT seen_at FROM reel_impressions i
             WHERE i.video_id = v.video_id AND i.user_id = ?) AS my_seen_at
      FROM videos v
     WHERE v.dead_at IS NULL
       AND v.category IN (${Object.keys(CATEGORIES).map(() => '?').join(',')})
       ${familySafe ? 'AND COALESCE(v.language_flag,0) = 0' : ''}
  `).all(userId, ...Object.keys(CATEGORIES));

  const now = Date.now();
  const cutoff = now - SEEN_COOLDOWN_DAYS * 86400000;
  const fresh = rows.filter(r => !r.my_seen_at || Date.parse(r.my_seen_at + 'Z') < cutoff);

  // Relaxing the cooldown is better than serving an empty screen, but say so in
  // the response rather than pretending the repeat was a fresh pick.
  const recycled = fresh.length < Math.min(limit, 10);
  const pool = recycled ? rows : fresh;
  if (!pool.length) return { videos: [], recycled: false, exhausted: true };

  // Rank within each category, then cap by weight so nothing floods.
  //
  // Weights are shared out across categories that actually have something to
  // show, not across all of them. A category can be empty for ordinary reasons
  // — the family-safe view excludes the language-flagged one, or a category is
  // used up for this member — and reserving its share anyway silently shrinks
  // the feed. That is exactly what happened: a 20-item request came back with
  // 14 because the excluded category's slots were held open for nothing.
  const ranked = {};
  for (const key of Object.keys(CATEGORIES)) {
    ranked[key] = pool.filter(v => v.category === key)
      .map(v => ({ v, s: score(v, now) }))
      .sort((a, b) => b.s - a.s)
      .map(x => x.v);
  }
  const live = Object.keys(CATEGORIES).filter(k => ranked[k].length);
  const totalWeight = live.reduce((a, k) => a + (CATEGORIES[k].weight || 1), 0) || 1;

  const buckets = {};
  for (const key of live) {
    const cap = Math.max(1, Math.ceil(limit * ((CATEGORIES[key].weight || 1) / totalWeight)));
    buckets[key] = ranked[key].slice(0, cap);
  }

  // Interleave round-robin, strongest bucket first each pass, so consecutive
  // reels come from different categories.
  const order = Object.keys(buckets).sort((a, b) => buckets[b].length - buckets[a].length);
  const out = [];
  for (let i = 0; out.length < limit; i++) {
    let placed = false;
    for (const key of order) {
      const item = buckets[key][i];
      if (item) { out.push({ ...item, category_label: CATEGORIES[key].label }); placed = true; }
      if (out.length >= limit) break;
    }
    if (!placed) break;                     // every bucket exhausted
  }

  // Top-up. The caps are a shaping device, not a quota to be honoured at the
  // cost of returning a short feed — if rounding or a category running dry
  // mid-pass leaves us under the limit, fill from what is left in rank order.
  if (out.length < limit) {
    const taken = new Set(out.map(v => v.video_id));
    for (const key of live) {
      for (const v of ranked[key]) {
        if (out.length >= limit) break;
        if (taken.has(v.video_id)) continue;
        taken.add(v.video_id);
        out.push({ ...v, category_label: CATEGORIES[key].label });
      }
      if (out.length >= limit) break;
    }
  }

  return { videos: out, recycled, exhausted: false };
}

/** Record what was actually delivered, so it is not delivered again. */
function markSeen(userId, videoIds) {
  if (!userId || !Array.isArray(videoIds) || !videoIds.length) return 0;
  const ins = db.prepare(`INSERT INTO reel_impressions (user_id, video_id) VALUES (?, ?)
                          ON CONFLICT(user_id, video_id) DO UPDATE SET seen_at = datetime('now')`);
  db.exec('BEGIN');
  try {
    for (const id of videoIds.slice(0, 100)) ins.run(userId, String(id));
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return videoIds.length;
}

function stats() {
  try {
    return db.prepare(`
      SELECT category, COUNT(*) AS total,
             SUM(CASE WHEN dead_at IS NULL THEN 1 ELSE 0 END) AS playable,
             SUM(COALESCE(language_flag,0)) AS language_flagged
        FROM videos
       WHERE category IN (${Object.keys(CATEGORIES).map(() => '?').join(',')})
       GROUP BY category ORDER BY category`).all(...Object.keys(CATEGORIES));
  } catch { return []; }
}

let timer = null;
function start() {
  init();
  if (!youtube.isConfigured()) {
    console.log('[reels] no YOUTUBE_API_KEY — no ingestion; existing library still serves');
    return;
  }
  // Behind boot, never awaited: the app serves while this fills in.
  const cycle = () => ingest()
    .then(() => pruneDead(100))
    .catch(err => console.error('[reels] refresh failed:', err.message));
  setTimeout(cycle, 20000);
  timer = setInterval(cycle, 12 * 60 * 60 * 1000);   // twice a day is plenty
  if (timer.unref) timer.unref();
}

module.exports = {
  start, init, ingest, pruneDead, feed, markSeen, stats,
  SEEN_COOLDOWN_DAYS, CATEGORIES,
};
