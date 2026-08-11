#!/usr/bin/env node
/**
 * Re-verify every hardcoded reel seed.
 *
 * The seeds in lib/reel-sources.js are the only video IDs written by hand in
 * this app. They were checked once; third-party uploads get taken down, and
 * even official channels make videos private. This re-checks them.
 *
 * Uses YouTube's public oEmbed endpoint — no API key, no quota, no auth. A
 * video that is missing, private, or not embeddable does not return oEmbed
 * data, which is exactly the set of failures that would render as an error box
 * inside the feed.
 *
 *   node scripts/verify-reel-seeds.js
 *
 * Exits non-zero if any seed fails, so it can gate a deploy.
 */
'use strict';

const { SEEDS } = require('../lib/reel-sources');

// Each provider's own public oEmbed. All keyless; all fail for anything
// private, deleted, or not embeddable — exactly the states that would render as
// an error box inside the feed.
const OEMBED = {
  youtube: (id) => 'https://www.youtube.com/oembed?format=json&url=' +
    encodeURIComponent('https://www.youtube.com/watch?v=' + id),
  vimeo: (id) => 'https://vimeo.com/api/oembed.json?url=' +
    encodeURIComponent('https://vimeo.com/' + id),
  tiktok: (id) => 'https://www.tiktok.com/oembed?url=' +
    encodeURIComponent('https://www.tiktok.com/@i/video/' + id),
};

async function check(id, provider) {
  const build = OEMBED[provider || 'youtube'];
  if (!build) return { ok: false, reason: 'unknown provider ' + provider };
  const url = build(id);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 15000);
  try {
    const res = await fetch(url, { signal: ac.signal });
    if (!res.ok) return { ok: false, reason: 'HTTP ' + res.status };
    const j = await res.json();
    return { ok: true, title: j.title, author: j.author_name };
  } catch (e) {
    return { ok: false, reason: e.name === 'AbortError' ? 'timeout' : e.message };
  } finally {
    clearTimeout(timer);
  }
}

(async () => {
  let checked = 0, failed = 0;
  for (const [category, list] of Object.entries(SEEDS)) {
    console.log('\n' + category);
    for (const item of list) {
      const r = await check(item.id, item.provider);
      checked++;
      if (r.ok) {
        console.log(`  ok    ${String(item.provider||'youtube').padEnd(7)} ${item.id.padEnd(11)} [${r.author}]  ${String(r.title).slice(0, 46)}`);
      } else {
        failed++;
        console.log(`  FAIL  ${item.id}  ${r.reason}  — stored as "${item.title}"`);
      }
      await new Promise(r2 => setTimeout(r2, 150));   // be a polite client
    }
  }
  console.log(`\n${checked} seed(s) checked, ${failed} failed.`);
  if (failed) {
    console.log('Remove or replace the failing ids in lib/reel-sources.js.');
  }
  process.exit(failed ? 1 : 0);
})();
