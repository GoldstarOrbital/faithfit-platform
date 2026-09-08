'use strict';
// Opening Reels used to make third-party network calls inline, on every single
// open: a YouTube API request for the member's church channel, and failing
// that an HTTP fetch and HTML scrape of the church's own website. Both sat on
// the critical path of opening a tab, so a slow or unreachable church site
// made Reels slow for that member every time they opened it.
//
// Runs the real cache out of routes/api.js rather than a copy, driving it with
// a deliberately slow refresh so the point being asserted -- that the response
// never waits for it -- is the thing actually measured.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../routes/api.js'), 'utf8');
// \r?\n throughout: this repo is checked out with CRLF on Windows, and a
// pattern anchored on a bare \n silently stops matching there -- which reads
// as "the cache is gone" rather than "the test cannot see it".
const block = source.match(/const CHURCH_VIDEO_TTL_MS = [\s\S]*?\r?\nasync function refreshChurchVideos[\s\S]*?\r?\n}\r?\n/);
assert.ok(block, 'could not find the church video cache');

// A refresh that takes a second, standing in for a church website that is slow
// or simply not answering.
let refreshes = 0;
const context = {
  Date, Map, console,
  youtube: { isConfigured: () => false },
  fetchChurchWebsiteEmbeds: async () => {
    refreshes++;
    await new Promise(resolve => setTimeout(resolve, 1000));
    return [{ videoId: 'v1', provider: 'youtube', url: 'https://example.test/v1' }];
  },
  setTimeout, Promise,
};
const churchVideosFor = vm.runInNewContext(`${block[0]}; churchVideosFor;`, context);

const church = { osm_id: 'c1', name: 'Test Church', website_url: 'https://slow.example.test' };

async function main() {
  // The first open must not pay for the refresh it starts.
  const started = Date.now();
  const first = churchVideosFor(church);
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 100, `opening Reels must not wait on a church website, took ${elapsed}ms`);
  // Length, not deepEqual: the array comes from the vm context, so it has that
  // realm's Array.prototype and a strict deep comparison fails on the
  // prototype rather than on anything real.
  assert.equal(first.length, 0, 'a cold cache returns the library feed now rather than a complete feed later');

  // A second open while that refresh is still running must not start another.
  churchVideosFor(church);
  churchVideosFor(church);
  assert.equal(refreshes, 1, 'concurrent opens share one refresh rather than each starting their own');

  // Once it lands, the videos are there, still without anyone having waited.
  await new Promise(resolve => setTimeout(resolve, 1400));
  const warm = churchVideosFor(church);
  assert.equal(warm.length, 1, 'the church video is served once the background refresh has landed');
  assert.equal(warm[0].church_name, 'Test Church');
  assert.equal(refreshes, 1, 'a warm cache does not refresh again inside the TTL');

  // The request path itself must hold no awaits on third parties any more.
  const handler = source.split("router.get('/reels'")[1].split('router.')[0];
  assert.ok(!handler.includes('await youtube.fetchRecentUploads'),
    'the YouTube call must not be back on the request path');
  assert.ok(!handler.includes('await fetchChurchWebsiteEmbeds'),
    'the church website scrape must not be back on the request path');
  assert.match(handler, /churchVideosFor\(church\)/, 'church videos come from the cache');
  assert.ok(!handler.includes('await gloo.chatJson'),
    'Gloo church curation must not sit on the request path (peekCache + background only)');
  assert.match(handler, /gloo\.peekCache\(opts\)/, 'a warm Gloo cache is read synchronously');
  assert.match(handler, /gloo\.chatJson\(opts\)\.catch/, 'a Gloo miss fills the cache in the background');

  console.log('Reels latency: a cold cache opens immediately, concurrent opens share one refresh, and no third-party call sits on the request path.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
