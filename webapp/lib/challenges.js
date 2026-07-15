// Themed running/activity challenges — scripture- and Tolkien-flavored, distance/
// time/count based. Users join a challenge and their completed workouts advance it.
const { randomUUID } = require('crypto');
const db = require('./db');

// metric: distance_km | duration_min | workouts.  target is in that metric's unit.
// activity_type null => any activity counts toward it.
const CHALLENGES = [
  { key: 'frodo-sprint', name: "Frodo's Sprint", metric: 'distance_km', target: 5, theme: 'speed', activity_type: null,
    scripture_ref: null,
    flavor: "A hobbit's dash to the Prancing Pony — quick feet, brave heart.",
    description: 'Cover 5 km. A brisk, spirited start to the journey.' },
  { key: 'emmaus-road', name: 'The Emmaus Road', metric: 'distance_km', target: 11, theme: 'reflection', activity_type: null,
    scripture_ref: 'Luke 24:13-35',
    flavor: 'Walk the road the disciples walked, where they met the risen Christ.',
    description: 'Cover 11 km — roughly the seven miles from Jerusalem to Emmaus.' },
  { key: 'jericho-seven', name: 'Jericho Seven', metric: 'distance_km', target: 7, theme: 'perseverance', activity_type: null,
    scripture_ref: 'Joshua 6',
    flavor: 'Circle the city seven times, as Israel did before the walls fell.',
    description: 'Cover 7 km — one for each march around Jericho.' },
  { key: 'gideon-300', name: "Gideon's 300", metric: 'duration_min', target: 300, theme: 'discipline', activity_type: null,
    scripture_ref: 'Judges 7',
    flavor: "Three hundred minutes of faithful effort, like Gideon's chosen few.",
    description: 'Log 300 minutes of activity, any kind.' },
  { key: 'moses-40', name: "Moses's Wilderness 40", metric: 'distance_km', target: 40, theme: 'endurance', activity_type: null,
    scripture_ref: 'Numbers 14:33',
    flavor: 'Forty for the forty years in the wilderness — go the distance.',
    description: 'Cover 40 km over as many sessions as it takes.' },
  { key: 'elijah-horeb', name: 'Elijah to Horeb', metric: 'distance_km', target: 42, theme: 'renewal', activity_type: null,
    scripture_ref: '1 Kings 19:8',
    flavor: "Forty days' journey to the mountain of God — a marathon of renewal.",
    description: 'Cover 42 km — a full marathon to the mountain of God.' },
  { key: 'noah-40', name: "Noah's Forty", metric: 'workouts', target: 40, theme: 'consistency', activity_type: null,
    scripture_ref: 'Genesis 7:12',
    flavor: 'Forty days and forty nights — show up, again and again.',
    description: 'Complete 40 workouts of any kind.' },
];

function ensureChallenges() {
  const upsert = db.prepare(`
    INSERT INTO challenges (id, key, name, description, flavor, scripture_ref, metric, target, theme, activity_type)
    VALUES (@id, @key, @name, @description, @flavor, @scripture_ref, @metric, @target, @theme, @activity_type)
    ON CONFLICT(key) DO UPDATE SET
      name=excluded.name, description=excluded.description, flavor=excluded.flavor,
      scripture_ref=excluded.scripture_ref, metric=excluded.metric, target=excluded.target,
      theme=excluded.theme, activity_type=excluded.activity_type
  `);
  for (const c of CHALLENGES) upsert.run({ id: randomUUID(), ...c });
}

// Advance every joined, not-yet-completed challenge for this user by a finished
// workout. Returns the list of challenges newly completed (for notifications/XP).
function applyWorkoutToChallenges(userId, workout) {
  const rows = db.prepare(`
    SELECT c.*, uc.progress, uc.completed_at
    FROM user_challenges uc JOIN challenges c ON c.id = uc.challenge_id
    WHERE uc.user_id = ? AND uc.completed_at IS NULL
  `).all(userId);

  const distanceKm = Number(workout.distance_km) || 0;
  const durationMin = (Number(workout.duration_sec) || 0) / 60;
  const newlyCompleted = [];

  const upd = db.prepare('UPDATE user_challenges SET progress = ?, completed_at = ? WHERE user_id = ? AND challenge_id = ?');
  for (const c of rows) {
    if (c.activity_type && workout.type && c.activity_type.toLowerCase() !== String(workout.type).toLowerCase()) continue;
    let add = 0;
    if (c.metric === 'distance_km') add = distanceKm;
    else if (c.metric === 'duration_min') add = durationMin;
    else if (c.metric === 'workouts') add = 1;
    if (add <= 0) continue;
    const progress = Number(c.progress) + add;
    const done = progress >= c.target;
    upd.run(progress, done ? new Date().toISOString() : null, userId, c.id);
    if (done) newlyCompleted.push(c);
  }
  return newlyCompleted;
}

module.exports = { CHALLENGES, ensureChallenges, applyWorkoutToChallenges };
