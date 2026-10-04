#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const api = fs.readFileSync(path.join(__dirname, '../routes/api.js'), 'utf8');
const start = api.indexOf('async function matchedScriptureForPost');
const end = api.indexOf("router.post('/posts'", start);
assert.ok(start >= 0 && end > start, 'could not isolate post Scripture matcher');
const matcher = api.slice(start, end);

assert.match(matcher, /recentWorkoutTypes[\s\S]*SELECT type FROM workouts WHERE user_id=\?/,
  'post Scripture must use the member’s recent workout types');
assert.match(matcher, /savedSignal[\s\S]*SELECT text FROM saved_verses WHERE user_id=\?/,
  'post Scripture must use Scripture the member chose to save');
assert.match(matcher, /questionSignal[\s\S]*SELECT question FROM bible_answers_history WHERE user_id=\?/,
  'post Scripture must use the member’s own recent Bible Answers interests');
assert.match(matcher, /recentVerseIds[\s\S]*SELECT verse_id FROM posts WHERE user_id=\?[^]*LIMIT 12/,
  'post Scripture must load recent post verses for de-duplication');
assert.match(matcher, /freshCandidates=candidates\.filter\(v=>!recentVerseIds\.has\(v\.id\)\)/,
  'recent verses must be removed while another fitting candidate exists');
assert.match(matcher, /Candidates: \$\{JSON\.stringify\(candidates/,
  'AI selection must remain restricted to verified, de-duplicated candidates');

console.log('Post Scripture: member-grounded signals, recent-verse exclusion, verified candidate boundary.');
