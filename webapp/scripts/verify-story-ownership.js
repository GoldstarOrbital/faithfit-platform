#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

const api = read('routes', 'api.js');
const models = read('..', 'ios', 'FunctioningFaith', 'FunctioningFaith', 'Models', 'Models.swift');
const client = read('..', 'ios', 'FunctioningFaith', 'FunctioningFaith', 'Networking', 'APIClient.swift');
const viewer = read('..', 'ios', 'FunctioningFaith', 'FunctioningFaith', 'Views', 'StoryViewerView.swift');

assert.match(api, /router\.get\('\/stories\/:id\/viewers', requireAuth/, 'viewer analytics must require authentication');
assert.match(api, /WHERE id = \? AND user_id = \?/, 'only a story owner may read viewer analytics');
assert.match(api, /sv\.viewer_id != \?/, 'the owner must not be included in their own viewer count');
assert.match(api, /LIKE \? ESCAPE '\\\\'/, 'viewer search must escape wildcard input');
assert.match(api, /LIMIT 100/, 'viewer analytics must have a bounded response');
assert.match(api, /router\.post\('\/stories\/:id\/extend', requireAuth/, 'story extension must require authentication');
assert.match(api, /user_id = \? AND expires_at > datetime\('now'\)/, 'only owners can extend active stories');
assert.match(api, /datetime\(expires_at, '\+24 hours'\)/, 'an extension must be exactly 24 additional hours');
assert.match(models, /struct StoryViewer: Decodable, Identifiable/, 'the native client needs a typed viewer model');
assert.match(client, /func fetchStoryViewers\(/, 'the native client must load viewer analytics');
assert.match(client, /func extendStory\(/, 'the native client must extend an active story');
assert.match(viewer, /StoryViewersView/, 'the native owner flow must render a viewer list');
assert.match(viewer, /guard !Task\.isCancelled/, 'search requests must not overwrite newer results');
console.log(JSON.stringify({ story_owner_analytics: true, active_only_extension: true, native_cancellation_guard: true }));
