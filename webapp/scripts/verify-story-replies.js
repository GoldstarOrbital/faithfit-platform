#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const api = read('routes', 'api.js');
const app = read('public', 'app.js');
const css = read('public', 'styles.css');
const html = read('public', 'index.html');
const sw = read('public', 'sw.js');

assert.match(api, /router\.post\('\/stories\/:id\/reply'/, 'Moments need a protected private-reply route');
assert.match(api, /requireCommunityAccess/, 'Moment replies must require community access');
assert.match(api, /storyVisible\(story, me\)/, 'Moment replies must respect story visibility');
assert.match(api, /dms\.openThread\(me, story\.user_id\)/, 'Moment replies must use the established DM permission gate');
assert.match(api, /kind: 'story_reply'/, 'Moment reply context must be marked as a DM message type');
assert.match(app, /data-story-reply-form/, 'the viewer needs a private reply control');
assert.match(app, /\/reply/, 'the viewer must submit its reply to the protected route');
assert.match(app, /function renderStoryReplyMessage/, 'reply context must be readable in DMs');
assert.match(css, /\.story-reply \{/, 'the reply affordance needs focused viewer styling');
assert.match(html, /app\.js\?v=ff-story-replies-1/, 'the app bundle must be cache-busted');
assert.match(sw, /functioning-faith-shell-v38/, 'the shell cache must advance');
console.log(JSON.stringify({ protected_story_replies: true, dm_safety_reused: true }));
