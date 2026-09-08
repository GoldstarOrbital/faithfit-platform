#!/usr/bin/env node
'use strict';
/**
 * Home's Scripture in Motion card must load from GET /scripture/mission on its
 * own fast path — not wait for the nine-call secondary Promise.all pack that
 * also pulls recommendations, devotionals, reels, etc.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
const api = fs.readFileSync(path.join(__dirname, '../routes/api.js'), 'utf8');

assert.match(api, /router\.get\('\/scripture\/mission',\s*requireAuth,\s*async/,
  'GET /scripture/mission must stay behind requireAuth');
assert.doesNotMatch(api.split("router.get('/scripture/mission'")[1].split('{')[0], /aiLimiter/,
  'GET /scripture/mission must not use aiLimiter — Home re-rolls often and AI is background-only');

const renderHome = app.slice(
  app.indexOf('async function renderHome(main, forceRefresh = false)'),
  app.indexOf('// A tappable public profile for any member')
);
assert.ok(renderHome.length > 500, 'could not isolate renderHome');

assert.match(renderHome, /api\('\/scripture\/mission'\)/,
  'renderHome must fetch /scripture/mission for the SIM card');
assert.match(renderHome, /homeCache\.mission|missionFetched/,
  'mission must be cached on state.homeCache for same-session revisits');
assert.match(renderHome, /mission && mission\.reference && mission\.text/,
  'the mission-card UI must prefer the /scripture/mission payload');

const secondaryIdx = renderHome.indexOf("api('/recommendations')");
assert.ok(secondaryIdx > 0, 'secondary pack still fetches /recommendations for For you / explore');
const missionFetchIdx = renderHome.indexOf("api('/scripture/mission')");
assert.ok(missionFetchIdx > 0, 'dedicated mission fetch missing');
assert.ok(missionFetchIdx < secondaryIdx,
  'mission fetch must start before (not only inside) the secondary Promise.all');

assert.doesNotMatch(renderHome, /rec && rec\.verse \? `/,
  'SIM card must not be gated on rec.verse from the secondary pack');
assert.match(renderHome, /_homeMissionPromise/,
  'in-flight mission promise shares across re-renders while loading');

// Shared-device cache audit: in-memory homeCache must never paint another
// member's feed/SiM mission after login/demo/MFA/setup-signout without reload.
assert.match(app, /function clearHomeSessionCache\s*\(/,
  'homeCache + in-flight mission need an explicit clearHomeSessionCache helper');
assert.match(app, /state\.homeCache = null;\s*_homeMissionPromise = null/,
  'clearHomeSessionCache must null homeCache and _homeMissionPromise');
assert.match(app, /previousId !== nextId \|\| \(state\.homeCache && state\.homeCache\.userId !== nextId\)/,
  'loadMe must clear Home cache when the signed-in member changes');
assert.match(app, /#setup-signout[\s\S]{0,220}clearHomeSessionCache\(\)/,
  'setup-signout must clear homeCache (it does not full-reload)');
assert.match(renderHome, /homeCache\.userId === homeUserId/,
  'renderHome must require homeCache.userId to match the signed-in member before reuse');
assert.match(renderHome, /userId: homeUserId/,
  'homeCache must store the member id it was built for');

console.log('Home Scripture in Motion: dedicated /scripture/mission fast path, homeCache.mission, independent of secondary pack.');
console.log('Home cache identity: clearHomeSessionCache on account change; renderHome refuses another member\'s cache.');
