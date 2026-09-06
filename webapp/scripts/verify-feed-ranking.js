'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { rankPosts } = require('../lib/personalization');

// Execute the actual production candidate SQL, not a duplicate query.
const source = fs.readFileSync(path.join(__dirname, '../routes/api.js'), 'utf8');
const route = source.split("router.get('/feed/for-you'")[1].split("// A compact, dedicated read")[0];
const query = route.match(/const candidates = db.prepare\(`([\s\S]*?)`\)/)[1];
const hydrate = route.match(/const mediaForPost = db.prepare\(`([\s\S]*?)`\)/)[1];
const db = new DatabaseSync(':memory:');
db.exec(`
CREATE TABLE users(id TEXT, display_name TEXT, avatar_data TEXT);
CREATE TABLE developer_applications(user_id TEXT, status TEXT);
CREATE TABLE posts(id TEXT, content TEXT, created_at TEXT, user_id TEXT, visibility TEXT,
workout_id TEXT, verse_id TEXT, photo_data TEXT, photo_category TEXT, video_data TEXT,
video_category TEXT, show_route INTEGER, route_privacy_m INTEGER);
CREATE TABLE workouts(id TEXT, gps_path TEXT, type TEXT, calories REAL, avg_hr REAL,
start_time TEXT, end_time TEXT, distance_km REAL);
CREATE TABLE scripture_verses(id TEXT, reference TEXT, text TEXT, youversion_id TEXT);
CREATE TABLE post_comments(post_id TEXT);
CREATE TABLE post_likes(post_id TEXT);
CREATE TABLE followers(follower_id TEXT, followee_id TEXT);
CREATE TABLE circle_members(owner_id TEXT, member_id TEXT);
CREATE TABLE dm_blocks(blocker_id TEXT, blocked_id TEXT);
CREATE TABLE account_relationship_controls(actor_id TEXT, subject_id TEXT, control TEXT);
INSERT INTO users VALUES ('author','Author',NULL),('me','Me',NULL);
`);
const insert = db.prepare(`INSERT INTO posts(id,content,created_at,user_id,visibility,video_data)
VALUES (?, 'Test post', datetime('now'), 'author', ?, ?)`);
for (let i = 0; i < 200; i++) insert.run(String(i), 'public', 'x'.repeat(16384));
insert.run('private', 'private', 'private media');
const candidates = db.prepare(query).all({ me: 'me' });
assert.equal(candidates.length, 200);
assert.ok(candidates.every(p => !('video_data' in p) && !('photo_data' in p) && !('gps_path' in p)));
const winners = rankPosts(candidates, {}).slice(0, 12);
assert.equal(winners.length, 12);
for (const post of winners) assert.equal(db.prepare(hydrate).get(post.id).video_data.length, 16384);
db.exec("INSERT INTO dm_blocks VALUES ('author','me')");
assert.equal(db.prepare(query).all({ me: 'me' }).length, 0, 'reverse blocks must hide candidates');
db.exec("DELETE FROM dm_blocks; INSERT INTO account_relationship_controls VALUES ('me','author','mute')");
assert.equal(db.prepare(query).all({ me: 'me' }).length, 0, 'muted authors must stay hidden');
db.close();
console.log('Feed ranking: metadata-only candidate pool, winner hydration, private visibility, blocks and mutes passed.');
