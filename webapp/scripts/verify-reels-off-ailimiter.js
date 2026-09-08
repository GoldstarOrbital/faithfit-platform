'use strict';
// GET /reels must not share the metered AI limiter. Scripture mission was
// already moved off aiLimiter so Home cannot 429 after unrelated AI use;
// Reels open is the same class of "fast path that is not an AI call".
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../routes/api.js'), 'utf8');

const missionMount = source.match(/router\.get\(\s*'\/scripture\/mission'\s*,([\s\S]*?)(?:async\s*)?\(/);
assert.ok(missionMount, 'could not find GET /scripture/mission mount');
assert.ok(!/aiLimiter/.test(missionMount[1]),
  '/scripture/mission must stay off aiLimiter (regression guard)');

const reelsMount = source.match(/router\.get\(\s*'\/reels'\s*,([\s\S]*?)(?:async\s*)?\(/);
assert.ok(reelsMount, 'could not find GET /reels mount');
assert.ok(!/aiLimiter/.test(reelsMount[1]),
  'GET /reels must not mount aiLimiter — a burned AI budget must not 429 a warm Reels open');

console.log('Reels off aiLimiter: /reels and /scripture/mission are not behind the metered AI limiter.');
