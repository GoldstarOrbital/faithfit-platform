'use strict';
// Pins Alex's Sept 8 decision: muted members' stories stay hidden from GET /stories,
// matching the feed mute filter. Source-text asserts so removing the mute NOT EXISTS
// from the stories query fails this check (and therefore Web CI).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

const api = read('routes', 'api.js');
const app = read('public', 'app.js');

const storiesRoute = api.split("router.get('/stories', requireAuth")[1];
assert.ok(storiesRoute, 'GET /stories route must exist');
const storiesSql = storiesRoute.split('router.')[0];
assert.match(storiesSql, /dm_blocks/,
  'GET /stories must still filter dm_blocks (blocks stay hidden)');
assert.match(
  storiesSql,
  /account_relationship_controls[\s\S]*control\s*=\s*'mute'[\s\S]*subject_id\s*=\s*s\.user_id|account_relationship_controls[\s\S]*subject_id\s*=\s*s\.user_id[\s\S]*control\s*=\s*'mute'/,
  'GET /stories must exclude muted authors via account_relationship_controls control=\'mute\' and subject_id = s.user_id (removing this NOT EXISTS fails this assert)'
);
assert.match(storiesSql, /AND NOT EXISTS\s*\(\s*SELECT 1 FROM account_relationship_controls rc/,
  'mute exclusion must be a NOT EXISTS against account_relationship_controls');
assert.match(storiesSql, /rc\.actor_id\s*=\s*@me/,
  'mute filter must use the viewer (@me) as actor_id');

assert.match(app, /Mute hides their posts and stories from your feed but keeps the follow/,
  'profile safety note must say mute hides posts and stories');
assert.match(app, /Their posts and stories are hidden from your feed\. They are not told\./,
  'settings muted list must say posts and stories are hidden');

console.log(JSON.stringify({
  ok: true,
  stories_mute_filter: true,
  stories_dm_blocks_filter: true,
  mute_copy_mentions_stories: true,
}));
