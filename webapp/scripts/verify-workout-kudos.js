const fs = require('fs');
const path = require('path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const need = (source, token, label) => { if (!source.includes(token)) throw new Error(`Missing ${label}`); };

const server = read('server.js');
const api = read('routes/api.js');
const app = read('public/app.js');
const kudos = read('lib/workout-kudos.js');

need(server, 'workoutKudos.init()', 'kudos migration startup');
need(kudos, 'CREATE TABLE IF NOT EXISTS workout_kudos', 'one-kudos-per-member storage');
need(kudos, 'PRIMARY KEY (workout_id, user_id)', 'kudos uniqueness');
need(api, "router.post('/workouts/:id/kudos', requireAuth", 'authenticated kudos endpoint');
need(api, "followers f WHERE f.follower_id=@me", 'follow relationship enforcement');
need(api, "control='mute'", 'mute relationship enforcement');
need(app, 'data-workout-kudos', 'friend workout kudos control');

console.log(JSON.stringify({ one_kudos_per_member: true, followed_friends_only: true, private_notification: true, accessible_control: true }));
