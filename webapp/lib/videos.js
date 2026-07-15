// Curated Christian video library, sourced from real YouTube channels via the
// YouTube Data API v3 (gated behind YOUTUBE_API_KEY, same as youtube.js). We
// never hardcode a channel ID directly — each entry below is a SEARCH QUERY for
// a real, well-known channel; resolveChannels() verifies it exists via the API
// and only then stores its real channel ID. If the key is unset, or a search
// doesn't turn up a confident match, that source is simply skipped — never
// fabricated.
//
// Category decision: the task described three buckets of interest (kids,
// fitness, "short christian/motivational/academia/philosophy"). We keep the
// third as ONE combined "motivational" category rather than splitting further —
// short devotional-style talks, academic/philosophy explainers, and general
// motivational content all read the same way in a short-video feed, and
// splitting them would leave each sub-category too thin to be useful.
const { randomUUID } = require('crypto');
const db = require('./db');
const youtube = require('./youtube');

const SOURCES = {
  kids: [
    'VeggieTales official',
    'Superbook Official',
    'Bibleman Official',
    'What\'s In The Bible Official',
  ],
  fitness: [
    'Christian workout devotional fitness',
    'Faith fitness Christian workout',
  ],
  motivational: [
    'Christian motivation short',
    'biblical philosophy explained',
    'Christian academia lecture short',
  ],
};

const MAX_VIDEOS_PER_CHANNEL = 6;

// Search each category's queries, take the top verified-looking result, and
// upsert it into video_sources keyed by (category, channel_id). Resilient:
// a failing/empty query is skipped, never crashes the caller. No-op if
// YOUTUBE_API_KEY is unset.
async function resolveChannels() {
  if (!youtube.isConfigured()) return { resolved: 0 };
  const upsert = db.prepare(`
    INSERT INTO video_sources (id, category, channel_id, channel_title, added_note)
    VALUES (@id, @category, @channel_id, @channel_title, @added_note)
  `);
  const existing = new Set(
    db.prepare('SELECT category || \'::\' || channel_id AS k FROM video_sources').all().map(r => r.k)
  );
  let resolved = 0;
  for (const [category, queries] of Object.entries(SOURCES)) {
    for (const query of queries) {
      try {
        const results = await youtube.searchChannels(query);
        if (!results.length) continue;
        const top = results[0];
        const key = `${category}::${top.channelId}`;
        if (existing.has(key)) continue;
        upsert.run({
          id: randomUUID(),
          category,
          channel_id: top.channelId,
          channel_title: top.title,
          added_note: `resolved from search query "${query}"`,
        });
        existing.add(key);
        resolved++;
        console.log(`[videos] resolved ${category} channel: ${top.title} (query: "${query}")`);
      } catch (err) {
        console.error(`[videos] failed to resolve channel for query "${query}": ${err.message}`);
      }
    }
  }
  return { resolved };
}

// Pull recent uploads for every resolved channel and upsert into `videos`.
// Resilient per-channel try/catch, never crashes the process.
async function refreshVideos() {
  if (!youtube.isConfigured()) return { updated: 0 };
  const sources = db.prepare('SELECT category, channel_id, channel_title FROM video_sources').all();
  const upsert = db.prepare(`
    INSERT INTO videos (id, category, video_id, title, description, thumbnail_url, channel_title, published_at)
    VALUES (@id, @category, @video_id, @title, @description, @thumbnail_url, @channel_title, @published_at)
    ON CONFLICT(category, video_id) DO UPDATE SET
      title=excluded.title, description=excluded.description, thumbnail_url=excluded.thumbnail_url,
      channel_title=excluded.channel_title, published_at=excluded.published_at
  `);
  let updated = 0;
  for (const s of sources) {
    try {
      const uploads = await youtube.fetchRecentUploads(s.channel_id, MAX_VIDEOS_PER_CHANNEL);
      for (const v of uploads) {
        upsert.run({
          id: randomUUID(),
          category: s.category,
          video_id: v.videoId,
          title: v.title,
          description: v.description,
          thumbnail_url: v.thumbnailUrl,
          channel_title: v.channelTitle || s.channel_title,
          published_at: v.publishedAt,
        });
      }
      updated += uploads.length;
      console.log(`[videos] ${s.channel_title || s.channel_id} (${s.category}): ${uploads.length} videos`);
    } catch (err) {
      console.error(`[videos] failed to refresh ${s.channel_title || s.channel_id}: ${err.message}`);
    }
  }
  return { updated };
}

// Kick off a background resolve + refresh at startup and on a ~12h interval,
// without blocking server boot or crashing on network failure. Caller must gate
// this behind youtube.isConfigured() so it's a true no-op (not even a timer)
// when unset.
function startVideoLibraryRefresh() {
  (async () => {
    try {
      await resolveChannels();
      await refreshVideos();
    } catch (err) {
      console.error('[videos] initial refresh error:', err.message);
    }
  })();
  setInterval(() => {
    resolveChannels()
      .then(() => refreshVideos())
      .catch(err => console.error('[videos] refresh error:', err.message));
  }, 12 * 60 * 60 * 1000).unref();
}

module.exports = { SOURCES, resolveChannels, refreshVideos, startVideoLibraryRefresh };
