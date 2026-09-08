'use strict';
// Pins SHARED + Instagram P0 privacy locks Alex approved for launch focus:
// 1) GET /stories + storyVisible honor visibility='circle' via circle_members
// 2) POST /stories defaults from users.default_visibility (not hard-coded public)
// 3) PATCH /privacy (accountSecurity.updatePrivacy) and profile default_visibility
//    refuse under-18 public profile / everyone messaging / public defaults
// Source asserts fail if the locks are removed; SQLite + real updatePrivacy
// exercises the behavior the way verify-feed-ranking / verify-block-severs do.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const api = read('routes', 'api.js');
const securitySrc = read('lib', 'account-security.js');

// ---- Source contracts ----
const storyVisible = api.split('function storyVisible(')[1]?.split('router.get(\'/stories\'')[0] || '';
assert.ok(storyVisible, 'storyVisible helper must exist');
assert.match(storyVisible, /visibility === 'circle'/, 'storyVisible must accept visibility=circle');
assert.match(storyVisible, /circle\.isInCircle\(story\.user_id,\s*viewerId\)/,
  'storyVisible must gate circle moments with circle.isInCircle(owner, viewer)');

const storiesRoute = api.split("router.get('/stories', requireAuth")[1];
assert.ok(storiesRoute, 'GET /stories route must exist');
const storiesSqlBlock = storiesRoute.split('router.')[0];
assert.match(
  storiesSqlBlock,
  /s\.visibility\s*=\s*'circle'[\s\S]*circle_members[\s\S]*owner_id\s*=\s*s\.user_id[\s\S]*member_id\s*=\s*@me|circle_members[\s\S]*owner_id\s*=\s*s\.user_id[\s\S]*member_id\s*=\s*@me[\s\S]*s\.visibility\s*=\s*'circle'/,
  'GET /stories must include circle_members EXISTS for visibility=circle'
);
assert.match(storiesSqlBlock, /account_relationship_controls[\s\S]*control\s*=\s*'mute'/,
  'mute filter from 11441ef must still be present on GET /stories');

const postStories = api.split("router.post('/stories', requireAuth")[1]?.split('router.')[0] || '';
assert.ok(postStories, 'POST /stories route must exist');
assert.match(postStories, /SELECT default_visibility FROM users WHERE id\s*=\s*\?/,
  'POST /stories must read users.default_visibility');
assert.match(postStories, /VISIBILITIES\.includes\(visibility\)\s*\?\s*visibility\s*:\s*userDefault/,
  'POST /stories must fall back to userDefault, not a hard-coded public');
assert.doesNotMatch(
  postStories.replace(/userDefault[\s\S]*?\|\|\s*'public'/, ''),
  /VISIBILITIES\.includes\(visibility\)\s*\?\s*visibility\s*:\s*'public'/,
  'POST /stories must not keep the old hard-coded : \'public\' fallback as the only default'
);

assert.match(securitySrc, /teen_privacy_lock/,
  'updatePrivacy must throw teen_privacy_lock for under-18 broaden attempts');
assert.match(securitySrc, /profile_visibility === 'public'/,
  'under-18 must be blocked from public profile_visibility');
assert.match(securitySrc, /message_permission === 'everyone'/,
  'under-18 must be blocked from everyone messaging');

const profilePatch = api.split("req.body.default_visibility !== undefined")[1]?.slice(0, 800) || '';
assert.match(profilePatch, /teen_privacy_lock/,
  'profile default_visibility PATCH must refuse public for under-18');
assert.match(profilePatch, /age\s*<\s*18/,
  'profile default_visibility teen lock must check age < 18');

// Registration / setup teen defaults stay the reference ceiling.
assert.match(api, /if \(age < 18\) db\.prepare\(`UPDATE users SET profile_visibility='private'/);
assert.match(api, /message_permission='followers'/);
assert.match(api, /default_visibility='private'/);

// ---- SQLite: real GET /stories visibility SQL with circle moments ----
const storiesSql = storiesSqlBlock.match(/db\.prepare\(`([\s\S]*?)`\)\.all\(\{\s*me\s*\}\)/)?.[1];
assert.ok(storiesSql, 'could not extract GET /stories SQL');

const db = new DatabaseSync(':memory:');
db.exec(`
CREATE TABLE users(id TEXT PRIMARY KEY, display_name TEXT, avatar_data TEXT);
CREATE TABLE stories(
  id TEXT PRIMARY KEY, user_id TEXT, content TEXT, photo_data TEXT, photo_category TEXT,
  visibility TEXT, created_at TEXT, expires_at TEXT
);
CREATE TABLE story_views(story_id TEXT, viewer_id TEXT);
CREATE TABLE story_reactions(story_id TEXT, user_id TEXT, emoji TEXT);
CREATE TABLE followers(follower_id TEXT, followee_id TEXT);
CREATE TABLE circle_members(owner_id TEXT, member_id TEXT);
CREATE TABLE dm_blocks(blocker_id TEXT, blocked_id TEXT);
CREATE TABLE account_relationship_controls(actor_id TEXT, subject_id TEXT, control TEXT);
INSERT INTO users VALUES ('owner','Owner',NULL),('circle_friend','Circle',NULL),
  ('follower_only','Follower',NULL),('stranger','Stranger',NULL),('me','Me',NULL);
INSERT INTO stories(id,user_id,content,visibility,created_at,expires_at) VALUES
  ('circle-moment','owner','for circle','circle',datetime('now'),datetime('now','+12 hours')),
  ('public-moment','owner','for all','public',datetime('now'),datetime('now','+12 hours'));
INSERT INTO followers VALUES ('follower_only','owner'),('circle_friend','owner');
INSERT INTO circle_members VALUES ('owner','circle_friend');
`);

const listFor = (me) => db.prepare(storiesSql).all({ me }).map(r => r.id).sort();
assert.deepEqual(listFor('circle_friend'), ['circle-moment', 'public-moment'],
  'Trusted Circle members must receive circle moments');
assert.deepEqual(listFor('follower_only'), ['public-moment'],
  'a follower who is not in the circle must not see circle moments');
assert.deepEqual(listFor('stranger'), ['public-moment'],
  'strangers must not see circle moments');
assert.deepEqual(listFor('owner'), ['circle-moment', 'public-moment'],
  'owners always see their own moments');

// Mute still hides (regression pin alongside verify-story-mutes).
db.exec("INSERT INTO account_relationship_controls VALUES ('circle_friend','owner','mute')");
assert.deepEqual(listFor('circle_friend'), [], 'muted circle authors stay hidden');
db.exec('DELETE FROM account_relationship_controls');
db.close();

// ---- Behavior: real updatePrivacy against a throwaway DATA_DIR ----
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-teen-privacy-'));
const realDb = require('../lib/db');
const accountSecurity = require('../lib/account-security');
accountSecurity.init();

const teenId = 'teen-user';
const adultId = 'adult-user';
realDb.prepare(`INSERT INTO users (id,email,display_name,password_hash,date_of_birth,age,
  profile_visibility,follower_list_visibility,message_permission,tag_permission,comment_permission,default_visibility)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
  .run(teenId, 'teen@example.com', 'Teen', 'x', '2012-01-15', 14,
    'private', 'private', 'followers', 'nobody', 'followers', 'private');
realDb.prepare(`INSERT INTO users (id,email,display_name,password_hash,date_of_birth,age,
  profile_visibility,follower_list_visibility,message_permission,tag_permission,comment_permission,default_visibility)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
  .run(adultId, 'adult@example.com', 'Adult', 'x', '1990-01-15', 36,
    'public', 'followers', 'everyone', 'followers', 'everyone', 'public');

assert.throws(
  () => accountSecurity.updatePrivacy(teenId, { profile_visibility: 'public' }),
  (err) => err && err.code === 'teen_privacy_lock',
  'under-18 cannot set public profile'
);
assert.throws(
  () => accountSecurity.updatePrivacy(teenId, { message_permission: 'everyone' }),
  (err) => err && err.code === 'teen_privacy_lock',
  'under-18 cannot set everyone messaging'
);
// Followers-safe broaden still allowed (matches "private/followers-safe").
const ok = accountSecurity.updatePrivacy(teenId, { profile_visibility: 'followers', message_permission: 'nobody' });
assert.equal(ok.profile_visibility, 'followers');
assert.equal(ok.message_permission, 'nobody');

const adult = accountSecurity.updatePrivacy(adultId, { profile_visibility: 'public', message_permission: 'everyone' });
assert.equal(adult.profile_visibility, 'public');
assert.equal(adult.message_permission, 'everyone');

console.log(JSON.stringify({
  ok: true,
  story_circle_visible: true,
  story_default_visibility: true,
  teen_privacy_locks: true,
  mute_still_present: true,
}));
