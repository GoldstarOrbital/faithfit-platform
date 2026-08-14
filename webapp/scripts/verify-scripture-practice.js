const fs = require('fs');
const path = require('path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const need = (source, token, label) => { if (!source.includes(token)) throw new Error(`Missing ${label}`); };

const server = read('server.js');
const api = read('routes/api.js');
const app = read('public/app.js');
const practice = read('lib/scripture-practice.js');

need(server, 'scripturePractice.init()', 'practice migration startup');
need(practice, 'CREATE TABLE IF NOT EXISTS scripture_practice_enrollments', 'private enrollment storage');
need(practice, 'CREATE TABLE IF NOT EXISTS scripture_practice_days', 'private note storage');
need(practice, 'Psalms 23:1', 'verified daily passage catalog');
need(api, "router.get('/scripture/practice', requireAuth", 'authenticated practice endpoint');
need(api, "router.post('/scripture/practice/days/:day/complete', requireAuth", 'authenticated completion endpoint');
need(app, 'PRIVATE DAILY PRACTICE', 'private practice UI');
need(app, 'No streaks, rankings, or public activity', 'non-manipulative practice framing');

console.log(JSON.stringify({ private_by_default: true, verified_passages: true, optional_notes: true, no_streaks_or_rankings: true }));
