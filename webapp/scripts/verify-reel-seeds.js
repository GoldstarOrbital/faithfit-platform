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

const OEMBED = 'https://www.youtube.com/oembed?format=json&url=';

async function check(id) {
  const url = OEMBED + encodeURIComponent('https://www.youtube.com/watch?v=' + id);
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
      const r = await check(item.id);
      checked++;
      if (r.ok) {
        console.log(`  ok    ${item.id}  [${r.author}]  ${r.title.slice(0, 58)}`);
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
