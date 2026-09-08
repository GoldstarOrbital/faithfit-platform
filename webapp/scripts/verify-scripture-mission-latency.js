'use strict';
// Scripture in Motion must not put YouVersion or a live AI call on Home's
// request path. Coaching already uses peekCache + background fill; verse text
// must resolve from the local verified library only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../lib/scriptureMission.js'), 'utf8');
assert.ok(!/companion\.resolveRef\s*\(/.test(source),
  'mission must not call resolveRef');
assert.match(source, /lookupScriptureText/,
  'mission resolves verses from the local verified library');
assert.ok(!/\.bible_version_id|SELECT[^\n]*bible_version_id/.test(source),
  'mission must not read bible_version_id from the user row');
assert.match(source, /gloo\.peekCache\(opts\)/, 'coaching uses a sync cache peek');
assert.match(source, /gloo\.chat\(opts\)\.catch/, 'coaching miss fills in the background');
assert.match(source, /const coaching = dailyInsight\(/,
  'coaching is synchronous (peek or fallback)');

const api = fs.readFileSync(path.join(__dirname, '../routes/api.js'), 'utf8');
const routeHead = api.split("router.get('/scripture/mission'")[1].split('{')[0];
assert.ok(!/aiLimiter/.test(routeHead),
  'Home mission must not share the AI rate limiter');

console.log('Scripture in Motion latency: local verse resolve, no aiLimiter, coaching never awaits a live AI call.');