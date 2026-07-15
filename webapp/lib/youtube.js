// Church daily devotionals sourced from real YouTube uploads via the YouTube
// Data API v3. Gated entirely behind process.env.YOUTUBE_API_KEY — when it's
// absent, isConfigured() is false and every export is a safe no-op / null
// return, never fabricated data. Alex must create the Google Cloud project and
// enable the API himself; this module only consumes the key.
const { randomUUID } = require('crypto');
const db = require('./db');

const API_BASE = 'https://www.googleapis.com/youtube/v3';
const TIMEOUT_MS = 15000;

function isConfigured() {
  return !!process.env.YOUTUBE_API_KEY;
}

async function ytFetch(pathAndQuery) {
  const key = process.env.YOUTUBE_API_KEY;
  const sep = pathAndQuery.includes('?') ? '&' : '?';
  const url = `${API_BASE}/${pathAndQuery}${sep}key=${encodeURIComponent(key)}`;
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'faithfit-devotionals/1.0' } });
    if (!res.ok) throw new Error(`YouTube API HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(to);
  }
}

// Real channel search — how a user links their own church's real channel.
// Never guesses/fabricates a channel ID.
async function searchChannels(query) {
  if (!isConfigured()) return [];
  const q = String(query || '').trim();
  if (!q) return [];
  const data = await ytFetch(`search?part=snippet&type=channel&maxResults=8&q=${encodeURIComponent(q)}`);
  const items = Array.isArray(data.items) ? data.items : [];
  return items.map(it => ({
    channelId: it.id && it.id.channelId,
    title: it.snippet && it.snippet.title,
    thumbnailUrl: it.snippet && it.snippet.thumbnails && (it.snippet.thumbnails.default || {}).url,
  })).filter(c => c.channelId && c.title);
}

// Most recent real video uploaded by a channel, or null if none found.
async function fetchLatestUpload(channelId) {
  if (!isConfigured() || !channelId) return null;
  const data = await ytFetch(`search?part=snippet&channelId=${encodeURIComponent(channelId)}&order=date&type=video&maxResults=1`);
  const items = Array.isArray(data.items) ? data.items : [];
  if (!items.length) return null;
  const it = items[0];
  const videoId = it.id && it.id.videoId;
  if (!videoId) return null;
  return {
    videoId,
    title: (it.snippet && it.snippet.title) || null,
    thumbnailUrl: (it.snippet && it.snippet.thumbnails && (it.snippet.thumbnails.high || it.snippet.thumbnails.default || {}).url) || null,
    publishedAt: (it.snippet && it.snippet.publishedAt) || null,
  };
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

// Fetch today's devotional for every linked church, skipping ones already
// fetched today. Resilient: a single church's failure is logged and skipped,
// never crashes the caller. No-op if YOUTUBE_API_KEY is unset.
async function refreshTodaysDevotionals() {
  if (!isConfigured()) return { updated: 0 };
  const date = todayDate();
  const churches = db.prepare('SELECT id, name, youtube_channel_id FROM churches WHERE youtube_channel_id IS NOT NULL').all();
  const already = new Set(
    db.prepare('SELECT church_id FROM church_devotionals WHERE fetched_date = ?').all(date).map(r => r.church_id)
  );
  const upsert = db.prepare(`
    INSERT INTO church_devotionals (id, church_id, video_id, title, thumbnail_url, published_at, fetched_date)
    VALUES (@id, @church_id, @video_id, @title, @thumbnail_url, @published_at, @fetched_date)
    ON CONFLICT(church_id, fetched_date) DO UPDATE SET
      video_id=excluded.video_id, title=excluded.title, thumbnail_url=excluded.thumbnail_url, published_at=excluded.published_at
  `);
  let updated = 0;
  for (const c of churches) {
    if (already.has(c.id)) continue;
    try {
      const video = await fetchLatestUpload(c.youtube_channel_id);
      if (!video) continue;
      upsert.run({
        id: randomUUID(),
        church_id: c.id,
        video_id: video.videoId,
        title: video.title,
        thumbnail_url: video.thumbnailUrl,
        published_at: video.publishedAt,
        fetched_date: date,
      });
      updated++;
      console.log(`[devotionals] ${c.name || c.id}: fetched today's video`);
    } catch (err) {
      console.error(`[devotionals] failed to refresh ${c.name || c.id}: ${err.message}`);
    }
  }
  return { updated };
}

// Kick off a background refresh at startup and on a ~12h interval, without
// blocking server boot or crashing on network failure. Caller must gate this
// behind isConfigured() so it's a true no-op (not even a timer) when unset.
function startDevotionalRefresh() {
  refreshTodaysDevotionals().catch(err => console.error('[devotionals] initial refresh error:', err.message));
  setInterval(() => {
    refreshTodaysDevotionals().catch(err => console.error('[devotionals] refresh error:', err.message));
  }, 12 * 60 * 60 * 1000).unref();
}

// Up to maxResults recent real videos uploaded by a channel, newest first.
async function fetchRecentUploads(channelId, maxResults = 6) {
  if (!isConfigured() || !channelId) return [];
  const n = Math.min(50, Math.max(1, Number(maxResults) || 6));
  const data = await ytFetch(`search?part=snippet&channelId=${encodeURIComponent(channelId)}&order=date&type=video&maxResults=${n}`);
  const items = Array.isArray(data.items) ? data.items : [];
  return items.map(it => {
    const videoId = it.id && it.id.videoId;
    if (!videoId) return null;
    return {
      videoId,
      title: (it.snippet && it.snippet.title) || null,
      description: (it.snippet && it.snippet.description) || null,
      thumbnailUrl: (it.snippet && it.snippet.thumbnails && (it.snippet.thumbnails.high || it.snippet.thumbnails.default || {}).url) || null,
      channelTitle: (it.snippet && it.snippet.channelTitle) || null,
      publishedAt: (it.snippet && it.snippet.publishedAt) || null,
    };
  }).filter(Boolean);
}

// ISO-8601 duration (e.g. "PT48M12S") -> seconds.
function parseIsoDuration(iso) {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(String(iso || ''));
  if (!m) return null;
  const [, h, mi, s] = m;
  return (Number(h) || 0) * 3600 + (Number(mi) || 0) * 60 + (Number(s) || 0);
}

// Find the longest video a channel uploaded in the last 8 days — a heuristic for
// "this week's full service" vs. shorter daily devotional clips. Returns null if
// nothing was uploaded in that window. Never fabricates a result.
async function fetchWeeklyServiceVideo(channelId) {
  if (!isConfigured() || !channelId) return null;
  const since = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
  const data = await ytFetch(`search?part=snippet&channelId=${encodeURIComponent(channelId)}&order=date&type=video&maxResults=25&publishedAfter=${encodeURIComponent(since)}`);
  const items = Array.isArray(data.items) ? data.items : [];
  const videoIds = items.map(it => it.id && it.id.videoId).filter(Boolean);
  if (!videoIds.length) return null;
  const detail = await ytFetch(`videos?part=contentDetails,snippet&id=${encodeURIComponent(videoIds.join(','))}`);
  const detItems = Array.isArray(detail.items) ? detail.items : [];
  let best = null;
  let bestSec = -1;
  for (const it of detItems) {
    const sec = parseIsoDuration(it.contentDetails && it.contentDetails.duration);
    if (sec == null) continue;
    if (sec > bestSec) {
      bestSec = sec;
      best = {
        videoId: it.id,
        title: (it.snippet && it.snippet.title) || null,
        publishedAt: (it.snippet && it.snippet.publishedAt) || null,
        durationSec: sec,
      };
    }
  }
  return best;
}

module.exports = {
  isConfigured, searchChannels, fetchLatestUpload, refreshTodaysDevotionals, startDevotionalRefresh,
  fetchRecentUploads, fetchWeeklyServiceVideo,
};
