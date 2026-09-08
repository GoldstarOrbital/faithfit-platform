'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { rankPosts, mixPosts, feedKind } = require('../lib/personalization');
const vm = require('node:vm');

// Execute the actual production candidate SQL, not a duplicate query.
const source = fs.readFileSync(path.join(__dirname, '../routes/api.js'), 'utf8');
const mixed = mixPosts([
  { id: 'w1', workout_type: 'Run' }, { id: 'w2', workout_type: 'Run' },
  { id: 'r1', deferred_media_kind: 'video', verse_reference: 'John 1:1' },
  { id: 's1', verse_reference: 'John 1:1' }, { id: 'p1', photo_category: 'nature' },
  { id: 'w1', workout_type: 'Run' },
], 6);
assert.deepEqual(mixed.slice(0, 4).map(feedKind), ['workout', 'reel', 'scripture', 'post']);
assert.equal(new Set(mixed.map(p => p.id)).size, mixed.length);
assert.equal(mixPosts([], 12).length, 0);
assert.deepEqual(mixPosts([{id:'only'}], 12), [{id:'only'}]);
const shapeContext = {
  db: { prepare: () => ({get: () => ({c: 0})}) },
  publishedRoute: () => null, validateDataUrlImage: () => ({ok:true}),
  personalization: {feedKind},
};
vm.createContext(shapeContext);
vm.runInContext(source.slice(source.indexOf('function shapeFeedPost('), source.indexOf('// ---- feed ----')), shapeContext);
const baseWorkout = {id:'w',workout_type:'Run', start_time:'2026-09-08T12:00:00Z',end_time:'2026-09-08T12:30:00Z'};
const noGPS = shapeContext.shapeFeedPost({...baseWorkout}, null);
assert.equal(noGPS.distance_km, null, 'never invent distance');
assert.equal(noGPS.pace_min_per_km, null);
assert.equal(noGPS.avg_speed_kmh, null);
assert.equal(noGPS.duration_sec, 1800);
const run = shapeContext.shapeFeedPost({...baseWorkout,distance_km:5}, null);
assert.equal(run.pace_min_per_km, '6.0');
const ski = shapeContext.shapeFeedPost({...baseWorkout,workout_type:'Ski',distance_km:5}, null);
assert.equal(ski.pace_min_per_km, null);
assert.equal(ski.avg_speed_kmh, 10);
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
db.exec('DELETE FROM account_relationship_controls');

const chronological = source.split("router.get('/feed',")[1].split("// ---- \"For You\"")[0];
const feedSQL = chronological.match(/const posts = db.prepare\(`([\s\S]*?)`\)/)[1];
const parameters = { me: 'me', following_only: 0, before: '', limit: 20 };
const legacy = db.prepare(feedSQL).all({ ...parameters, deferred: 0 });
const compact = db.prepare(feedSQL).all({ ...parameters, deferred: 1 });
assert.deepEqual(compact.map(p => p.id), legacy.map(p => p.id));
assert.ok(compact.every(p => p.video_data === null && p.deferred_media_kind === 'video'));
assert.ok(JSON.stringify(compact).length < JSON.stringify(legacy).length / 10);

// Run the actual visibility helper and media handler against this disposable
// database. Auth middleware attachment is asserted separately; no live users.
let handler;
const auth = () => {};
vm.runInNewContext(source.slice(source.indexOf('function postVisibleTo('), source.indexOf("router.get('/posts/:id',")), {
  db,
  circle: { isInCircle: (owner, member) => !!db.prepare('SELECT 1 FROM circle_members WHERE owner_id=? AND member_id=?').get(owner, member) },
  dms: { isBlockedEitherWay: (a, b) => !!db.prepare('SELECT 1 FROM dm_blocks WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)').get(a,b,b,a) },
  requireAuth: auth,
  validateDataUrlImage: () => ({ ok: true }),
  router: { get: (route, middleware, callback) => { assert.equal(route, '/posts/:id/media'); assert.equal(middleware, auth); handler = callback; } },
});
function mediaRead(id, userId) {
  const res = { code: 200, headers: {}, set(k,v) { this.headers[k]=v; return this; }, status(code) { this.code=code; return this; }, json(body) { this.body=body; return this; } };
  handler({ params: { id }, session: { userId } }, res);
  return res;
}
assert.equal(mediaRead('0','me').body.video_data.length, 16384);
assert.equal(mediaRead('0','me').headers['Cache-Control'], 'private, no-store');
assert.equal(mediaRead('private','me').code, 404);
assert.equal(mediaRead('0',null).code, 404);
assert.equal(mediaRead('private','author').code, 200);
db.exec("UPDATE posts SET visibility='private' WHERE id='0'");
assert.equal(mediaRead('0','me').code, 404, 'changing privacy after feed load must deny media');
db.exec("UPDATE posts SET visibility='followers' WHERE id='0'; INSERT INTO followers VALUES ('me','author')");
assert.equal(mediaRead('0','me').code, 200);
db.exec("INSERT INTO dm_blocks VALUES ('author','me')");
assert.equal(mediaRead('0','me').code, 404, 'blocks must apply at media delivery time');
// Exercise route opt-in against the real owner check and endpoint trimming.
db.exec('ALTER TABLE workouts ADD COLUMN user_id TEXT');
const gps = Array.from({length:11}, (_,i) => [44 + i * .002, -123]);
db.prepare('INSERT INTO workouts(id,user_id,gps_path) VALUES(?,?,?)').run('route-workout','author',JSON.stringify(gps));
db.prepare('INSERT INTO posts(id,user_id,workout_id,visibility) VALUES(?,?,?,?)').run('route-post','author','route-workout','private');
let routeHandler;
const routeContext = {db,requireAuth:auth,router:{patch:(url,middleware,callback)=>{assert.equal(middleware,auth);routeHandler=callback;}}};
vm.createContext(routeContext);
vm.runInContext(source.slice(source.indexOf('function haversineMetres('),source.indexOf('function storyVisible(')),routeContext);
vm.runInContext(source.slice(source.indexOf("router.patch('/posts/:id/route'"),source.indexOf("router.patch('/posts/:id/visibility'")),routeContext);
function setRoute(userId, enabled) {
  const res = {code:200,status(c){this.code=c;return this;},set(){return this;},json(body){this.body=body;return this;}};
  routeHandler({session:{userId},params:{id:'route-post'},body:{show_route:enabled}},res);
  return res;
}
assert.equal(setRoute('me',true).code,404,'other members cannot publish your route');
assert.equal(setRoute('author','true').code,400,'sharing requires explicit boolean consent');
assert.equal(setRoute('author',true).code,200);
const published = db.prepare('SELECT * FROM posts WHERE id=?').get('route-post');
assert.equal(published.visibility,'private','route changes must never widen audience');
assert.equal(published.route_privacy_m,300);
const trimmed = routeContext.publishedRoute({...published,gps_path:JSON.stringify(gps)});
assert.ok(trimmed.length < gps.length && trimmed.length >= 2);
assert.notDeepEqual(trimmed[0],gps[0]);
assert.equal(setRoute('author',false).code,200);
assert.equal(db.prepare('SELECT show_route FROM posts WHERE id=?').get('route-post').show_route,0);
db.prepare('UPDATE workouts SET gps_path=NULL WHERE id=?').run('route-workout');
assert.equal(setRoute('author',true).code,400);
const reelsRoute = source.split("router.get('/reels',")[1];
const ownedQuery = reelsRoute.match(/const owned = db.prepare\(`([\s\S]*?)`\)/)[1];
db.exec("DELETE FROM dm_blocks; DELETE FROM account_relationship_controls; UPDATE posts SET video_category='workout',visibility='public' WHERE id='0'");
const inlineReels = db.prepare(ownedQuery).all({me:'me',deferred:0});
const compactReels = db.prepare(ownedQuery).all({me:'me',deferred:1});
assert.equal(inlineReels.length,1);
assert.equal(compactReels[0].video_data,null,'Reels metadata must not download video bytes');
assert.equal(inlineReels[0].video_data.length,16384,'old app builds remain compatible');
db.exec("INSERT INTO dm_blocks VALUES ('author','me')");
assert.equal(db.prepare(ownedQuery).all({me:'me',deferred:1}).length,0);
db.exec("DELETE FROM dm_blocks; INSERT INTO account_relationship_controls VALUES ('me','author','mute')");
assert.equal(db.prepare(ownedQuery).all({me:'me',deferred:1}).length,0);
db.close();
console.log('Feed ranking and deferred media: compact payload, legacy compatibility, visibility changes, ownership, followers, blocks and mutes passed.');
