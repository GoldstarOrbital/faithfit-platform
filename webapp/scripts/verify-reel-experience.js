#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

const api = read('routes', 'api.js');
const app = read('public', 'app.js');
const css = read('public', 'styles.css');

assert.match(api, /router\.post\('\/reels\/:videoId\/impression'/, 'opened catalogue Reels must record an impression');
assert.match(api, /LEFT JOIN scripture_verses v ON v\.id = p\.verse_id/, 'owned Reels must return their verified Scripture pairing');
assert.match(api, /LEFT JOIN posts p ON p\.id = r\.video_id/, 'saved Functioning Faith originals must remain playable');
assert.match(app, /data-reel-track-impression/, 'the client must identify catalogue Reels that can be marked seen');
assert.match(app, /\/impression/, 'the client must report an actual opened Reel');
assert.match(app, /data-reel-verse-ref/, 'a Scripture-paired Reel needs an open-verse action');
assert.match(app, /renderVerseThread\(verse\.dataset\.reelVerseRef\)/, 'opening a Reel verse must use the canonical Scripture thread');
assert.match(css, /\.reel-scripture/, 'the Scripture action needs visible Reel styling');
assert.match(app, /function openReelDiscussion\(postId\)/, 'owned Reels need a community conversation sheet');
assert.match(app, /data-reel-discuss/, 'only Functioning Faith originals should expose a discussion action');
assert.match(app, /\/posts\/\$\{encodeURIComponent\(postId\)\}\/comments/, 'Reel discussion must reuse protected post comments');
assert.match(css, /\.reel-discussion-backdrop/, 'the discussion sheet needs a focused mobile-safe presentation');

console.log(JSON.stringify({ actual_view_freshness: true, owned_reel_scripture: true, source_transparency: true, original_reel_conversation: true }));
