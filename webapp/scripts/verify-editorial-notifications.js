'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const push = read('lib/push.js');
const news = read('lib/news.js');
const podcasts = read('lib/podcasts.js');
const web = read('public/app.js');

assert.match(push, /podcasts:\s*'New episodes/, 'podcasts must be a distinct push category');
assert.match(push, /news:\s*'New headlines/, 'news must be a distinct push category');
assert.match(push, /async function broadcast\(/, 'push must support opted-in editorial broadcasts');
assert.match(news, /push\.broadcast\('news'/, 'new headlines must notify opted-in members');
assert.match(podcasts, /push\.broadcast\('podcasts'/, 'new episodes must notify opted-in members');
assert.match(push, /functioningfaith:\/\/podcasts/, 'podcast pushes must deep-link into the native app');
assert.match(push, /functioningfaith:\/\/news/, 'news pushes must deep-link into the native app');
assert.match(web, /kind === 'podcasts' \|\| kind === 'news'/, 'editorial pushes must deep-link in the web app');

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-editorial-notifications-'));
  process.env.DATA_DIR = dataDir;
  const db = require('../lib/db');
  const pushModule = require('../lib/push');
  pushModule.init();
  db.prepare(`INSERT INTO native_push_tokens (id, user_id, platform, token, categories)
    VALUES (?, ?, 'ios', ?, ?)`).run('on', 'member-on', 'token-on', JSON.stringify(['podcasts']));
  db.prepare(`INSERT INTO native_push_tokens (id, user_id, platform, token, categories)
    VALUES (?, ?, 'ios', ?, ?)`).run('off', 'member-off', 'token-off', JSON.stringify(['news']));

  const result = await pushModule.broadcast('podcasts', {
    title: 'A show', body: 'A new episode', url: '/?open=podcasts', tag: 'podcast:test',
  });
  assert.equal(result.users, 1, 'broadcast must select only users who opted into its category');
  assert.deepEqual(db.prepare('SELECT DISTINCT user_id FROM push_log').all(), [{ user_id: 'member-on' }],
    'opted-out members must not receive or log the editorial notification');

  db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  console.log('Editorial notifications: separate opt-ins, fresh-content delivery, and deep links verified.');
})().catch(error => { console.error(error); process.exitCode = 1; });
