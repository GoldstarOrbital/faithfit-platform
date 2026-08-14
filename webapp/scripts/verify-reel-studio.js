'use strict';

// Contract for the owned-Reel path. Keep this client/server edge explicit: a
// short video is accepted by the same guarded post route, then returned as an
// owned Reel rather than being mistaken for an external embed.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');
const server = read('server.js');
const api = read('routes', 'api.js');
const app = read('public', 'app.js');
const sources = read('lib', 'reel-sources.js');

assert.match(server, /camera=\(self\), microphone=\(self\)/, 'Reel recording needs same-origin camera and mic permissions');
assert.match(server, /express\.json\(\{ limit: '6mb' \}\)/, 'the guarded 4MB Reel payload must reach validation');
assert.match(api, /'functioning_faith' AS provider/, 'validated public video posts must be returned to Reels as owned media');
assert.match(api, /p\.video_category IN \('workout','nature','animal','group'\)/, 'owned Reel feed must retain the anti-vanity category gate');
assert.match(app, /function openReelStudio\(/, 'Reels needs an in-app creation surface');
assert.match(app, /getUserMedia\(/, 'members must be able to record in the site');
assert.match(app, /video_data: videoData/, 'the studio must publish through the guarded post payload');
assert.match(app, /provider === 'functioning_faith'/, 'owned clips must use native video playback, not an external embed');
assert.match(sources, /2819 Church official/, 'the official Pastor Philip Anthony Mitchell source must be catalogued as an embed source');

console.log(JSON.stringify({ owned_reel_feed: true, in_app_recording: true, guarded_upload: true, official_2819_embed_source: true }));
