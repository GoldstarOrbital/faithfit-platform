// Real podcast ingestion. Pulls recent episodes from each show's PUBLIC RSS feed
// (no API key, no paid service) and caches them in podcast_episodes, so the app
// serves real, current episodes with direct MP3 audio — refreshed periodically
// rather than hardcoded.
//
// Feed URLs were resolved from Apple's public iTunes Search API and verified to
// match each show's real title + host before being committed here. These are all
// real, currently-running independent Christian podcasts.
const { randomUUID } = require('crypto');
const db = require('./db');

const FEEDS = [
  { title: 'The Bible Recap', host: 'Tara-Leigh Cobble', theme: 'devotion',
    description: "A daily companion podcast that recaps that day's Bible reading in about 20 minutes.",
    feed_url: 'https://feed.podbean.com/thebiblerecap/feed.xml' },
  { title: 'The Ten Minute Bible Hour Podcast', host: 'Matt Whitman', theme: 'devotion',
    description: 'Approachable, honest conversations about scripture and faith questions.',
    feed_url: 'https://rss.buzzsprout.com/2544823.rss' },
  { title: 'Ask NT Wright Anything', host: 'N.T. Wright & Premier Unbelievable', theme: 'purpose',
    description: 'Listener questions on theology and scripture answered by biblical scholar N.T. Wright.',
    feed_url: 'https://feeds.megaphone.fm/NSR7466770103' },
  { title: 'Christian History Almanac', host: '1517 Podcasts', theme: 'renewal',
    description: 'Daily short episodes on church history figures and events.',
    feed_url: 'https://rss.libsyn.com/shows/176333/destinations/1192955.xml' },
];

const MAX_EPISODES = 15;

// Normalize a show title so seed rows and feed entries reconcile even when the
// wording drifts ("Ten Minute Bible Hour" vs "The Ten Minute Bible Hour Podcast").
function slug(title) {
  return String(title).toLowerCase().replace(/\bthe\b|\bpodcast\b/g, '').replace(/[^a-z0-9]/g, '');
}

// Ensure the podcast rows exist and carry their feed_url. Matches seeded rows by
// normalized title (updating them in place to the canonical title + feed_url) and
// inserts any that are missing. Then removes stale rows that have no feed (e.g. a
// pre-existing seed row whose title we've since canonicalized) so no duplicates
// linger in the persistent volume.
function ensurePodcasts() {
  const bySlug = new Map();
  for (const p of db.prepare('SELECT id, title FROM podcasts').all()) {
    if (!bySlug.has(slug(p.title))) bySlug.set(slug(p.title), p.id);
  }
  const upd = db.prepare('UPDATE podcasts SET title = ?, host = ?, description = ?, theme = ?, feed_url = ? WHERE id = ?');
  const ins = db.prepare('INSERT INTO podcasts (id, title, host, description, theme, feed_url) VALUES (?, ?, ?, ?, ?, ?)');
  for (const f of FEEDS) {
    const id = bySlug.get(slug(f.title));
    if (id) upd.run(f.title, f.host, f.description, f.theme, f.feed_url, id);
    else ins.run(randomUUID(), f.title, f.host, f.description, f.theme, f.feed_url);
  }
  // Drop any podcast rows without a feed (stale seed rows / duplicates) and their episodes.
  const stale = db.prepare('SELECT id FROM podcasts WHERE feed_url IS NULL').all();
  const delEp = db.prepare('DELETE FROM podcast_episodes WHERE podcast_id = ?');
  const delPod = db.prepare('DELETE FROM podcasts WHERE id = ?');
  for (const s of stale) { delEp.run(s.id); delPod.run(s.id); }
}

// --- minimal RSS parsing (no XML dependency) ---
function decodeEntities(s) {
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#8217;/g, '’').replace(/&#8216;/g, '‘')
    .replace(/&#8230;/g, '…')
    .replace(/&amp;/g, '&')
    .replace(/<[^>]+>/g, '')  // strip any residual HTML tags in descriptions
    .trim();
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1] : null;
}

function parseDuration(raw) {
  if (!raw) return null;
  const s = raw.trim();
  if (/^\d+$/.test(s)) return Number(s);
  const parts = s.split(':').map(Number);
  if (parts.some(isNaN)) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

function parseFeed(xml) {
  const items = [];
  const itemRe = /<item[\s>]([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRe.exec(xml)) && items.length < MAX_EPISODES) {
    const b = m[1];
    const encMatch = b.match(/<enclosure\b[^>]*\burl=["']([^"']+)["'][^>]*>/i);
    const audio = encMatch ? encMatch[1] : null;
    const title = tag(b, 'title');
    const guid = (tag(b, 'guid') && decodeEntities(tag(b, 'guid'))) || audio || (title && decodeEntities(title));
    if (!guid) continue;
    const pub = tag(b, 'pubDate');
    let published_at = null;
    if (pub) { const d = new Date(decodeEntities(pub)); if (!isNaN(d)) published_at = d.toISOString(); }
    const desc = tag(b, 'description') || tag(b, 'itunes:summary');
    items.push({
      guid,
      title: title ? decodeEntities(title) : '(untitled episode)',
      description: desc ? decodeEntities(desc).slice(0, 500) : null,
      audio_url: audio,
      link: tag(b, 'link') ? decodeEntities(tag(b, 'link')) : null,
      duration_sec: parseDuration(tag(b, 'itunes:duration')),
      published_at,
    });
  }
  return items;
}

async function fetchFeed(url) {
  const ctrl = new AbortController();
  // Some feeds (e.g. a daily show's full archive) are large — allow ample time.
  const to = setTimeout(() => ctrl.abort(), 60000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'faithfit-podcasts/1.0' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally { clearTimeout(to); }
}

// Refresh episodes for feeds whose last fetch is older than maxAgeMin (0 = force).
// Resilient: a failing feed is logged and skipped, never crashes the caller.
async function refreshEpisodes({ maxAgeMin = 360 } = {}) {
  ensurePodcasts();
  const rows = db.prepare('SELECT id, title, feed_url, last_fetched FROM podcasts WHERE feed_url IS NOT NULL').all();
  const upsert = db.prepare(`
    INSERT INTO podcast_episodes (id, podcast_id, guid, title, description, audio_url, link, duration_sec, published_at)
    VALUES (@id, @podcast_id, @guid, @title, @description, @audio_url, @link, @duration_sec, @published_at)
    ON CONFLICT(podcast_id, guid) DO UPDATE SET
      title=excluded.title, description=excluded.description, audio_url=excluded.audio_url,
      link=excluded.link, duration_sec=excluded.duration_sec, published_at=excluded.published_at
  `);
  const now = Date.now();
  let updated = 0;
  for (const p of rows) {
    if (maxAgeMin > 0 && p.last_fetched && (now - new Date(p.last_fetched).getTime()) < maxAgeMin * 60000) continue;
    try {
      const xml = await fetchFeed(p.feed_url);
      const episodes = parseFeed(xml);
      for (const e of episodes) upsert.run({ id: randomUUID(), podcast_id: p.id, ...e });
      db.prepare('UPDATE podcasts SET last_fetched = ? WHERE id = ?').run(new Date().toISOString(), p.id);
      updated += episodes.length;
      console.log(`[podcasts] ${p.title}: ${episodes.length} episodes`);
    } catch (err) {
      console.error(`[podcasts] failed to refresh ${p.title}: ${err.message}`);
    }
  }
  return { updated };
}

// Kick off a background refresh at startup and on an interval, without blocking
// server boot or crashing on network failure.
function startPodcastRefresh() {
  ensurePodcasts();
  refreshEpisodes({ maxAgeMin: 0 }).catch(err => console.error('[podcasts] initial refresh error:', err.message));
  setInterval(() => {
    refreshEpisodes({ maxAgeMin: 360 }).catch(err => console.error('[podcasts] refresh error:', err.message));
  }, 6 * 60 * 60 * 1000).unref();
}

module.exports = { FEEDS, ensurePodcasts, parseFeed, refreshEpisodes, startPodcastRefresh };
