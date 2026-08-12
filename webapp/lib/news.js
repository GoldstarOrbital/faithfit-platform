// Christian news feed for the Explore tab. Pulls headlines from each outlet's
// PUBLIC RSS feed (no API key, no scraping full article text) and caches them
// in news_items, the same shape as lib/podcasts.js uses for episodes: refreshed
// periodically, headline + summary + link back to the source, never the full
// copyrighted article body.
//
// Feed URLs were verified live (HTTP 200, real <item> entries) before being
// committed here. These are real, currently-publishing outlets.
'use strict';

const { randomUUID } = require('crypto');
const db = require('./db');

const FEEDS = [
  { source: 'Christianity Today', feed_url: 'https://www.christianitytoday.com/feed/' },
  { source: 'Religion News Service', feed_url: 'https://religionnews.com/feed/' },
  { source: 'The Christian Post', feed_url: 'https://www.christianpost.com/rss/' },
];

const MAX_ITEMS_PER_FEED = 20;
const MAX_AGE_DAYS = 30; // prune items older than this so the feed can't grow forever

function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS news_items (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      guid TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT,
      link TEXT NOT NULL,
      image_url TEXT,
      published_at TEXT,
      fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(source, guid)
    );
    CREATE INDEX IF NOT EXISTS idx_news_published ON news_items(published_at DESC);
  `);
}

// --- minimal RSS parsing, matching lib/podcasts.js exactly ---
function decodeEntities(s) {
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#8217;/g, '’').replace(/&#8216;/g, '‘')
    .replace(/&#8230;/g, '…')
    .replace(/&amp;/g, '&')
    .replace(/<[^>]+>/g, '') // strip residual HTML from summaries -- headline + text only
    .trim();
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1] : null;
}

function attrTag(block, name, attr) {
  const m = block.match(new RegExp(`<${name}\\b[^>]*\\b${attr}=["']([^"']+)["']`, 'i'));
  return m ? m[1] : null;
}

function parseFeed(xml) {
  const items = [];
  const itemRe = /<item[\s>]([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRe.exec(xml)) && items.length < MAX_ITEMS_PER_FEED) {
    const b = m[1];
    const title = tag(b, 'title');
    const link = tag(b, 'link');
    const guid = (tag(b, 'guid') && decodeEntities(tag(b, 'guid'))) || (link && decodeEntities(link));
    if (!guid || !title || !link) continue;
    const pub = tag(b, 'pubDate');
    let published_at = null;
    if (pub) { const d = new Date(decodeEntities(pub)); if (!isNaN(d)) published_at = d.toISOString(); }
    const desc = tag(b, 'description') || tag(b, 'content:encoded');
    const image = attrTag(b, 'media:content', 'url') || attrTag(b, 'enclosure', 'url')
      || (() => { const d = tag(b, 'description') || ''; return (/<img[^>]+src=["']([^"']+)["']/i.exec(d) || [])[1] || null; })();
    items.push({
      guid,
      title: decodeEntities(title),
      summary: desc ? decodeEntities(desc).slice(0, 300) : null,
      link: decodeEntities(link),
      image_url: image || null,
      published_at,
    });
  }
  return items;
}

async function fetchFeed(url) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'functioning-faith-news/1.0' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally { clearTimeout(to); }
}

// Resilient: a failing outlet is logged and skipped, never crashes the caller.
async function refreshNews() {
  const upsert = db.prepare(`
    INSERT INTO news_items (id, source, guid, title, summary, link, image_url, published_at)
    VALUES (@id, @source, @guid, @title, @summary, @link, @image_url, @published_at)
    ON CONFLICT(source, guid) DO UPDATE SET
      title=excluded.title, summary=excluded.summary, link=excluded.link,
      image_url=excluded.image_url, published_at=excluded.published_at
  `);
  let updated = 0;
  for (const f of FEEDS) {
    try {
      const xml = await fetchFeed(f.feed_url);
      const items = parseFeed(xml);
      for (const it of items) upsert.run({ id: randomUUID(), source: f.source, ...it });
      updated += items.length;
      console.log(`[news] ${f.source}: ${items.length} items`);
    } catch (err) {
      console.error(`[news] failed to refresh ${f.source}: ${err.message}`);
    }
  }
  db.prepare(`DELETE FROM news_items WHERE published_at IS NOT NULL AND published_at < datetime('now', '-${MAX_AGE_DAYS} days')`).run();
  return { updated };
}

function list({ limit = 40 } = {}) {
  return db.prepare(`SELECT id, source, title, summary, link, image_url, published_at
    FROM news_items ORDER BY COALESCE(published_at, fetched_at) DESC LIMIT ?`).all(Math.min(Number(limit) || 40, 100));
}

function startNewsRefresh() {
  init();
  refreshNews().catch(err => console.error('[news] initial refresh error:', err.message));
  setInterval(() => {
    refreshNews().catch(err => console.error('[news] refresh error:', err.message));
  }, 60 * 60 * 1000).unref();
}

module.exports = { init, refreshNews, list, startNewsRefresh, FEEDS };
