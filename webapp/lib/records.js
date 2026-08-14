/**
 * Personal records — your own bests, per activity type.
 *
 * Strava's achievement banners are the thing that turns a solo workout into a
 * social object worth posting, and this app had nothing equivalent: a member
 * could run the best 10K of their life and the app would say exactly what it
 * said for a slow shuffle round the block.
 *
 * Deliberately PERSONAL records, not leaderboards. This app already made that
 * choice explicitly elsewhere -- Group Pulse carries a comment saying it has
 * "no leaderboard, and no streak-loss language ... without turning private
 * spiritual or recovery rhythms into a competition" -- and comparing your
 * 5K against the congregation's fastest is a different, harsher thing than
 * beating your own. Everything here compares you to you.
 *
 * A record is only claimed from a workout that actually measured the thing:
 * pace needs real distance AND real duration, so a manually logged "1 hour,
 * no distance" entry never sets a pace record, and a GPS drop that records
 * 40km in nine minutes is rejected by a sanity bound rather than standing
 * forever as an unbeatable best.
 */
'use strict';

const db = require('./db');

// value_is_better: some records are won by a bigger number, pace by a smaller.
const METRICS = {
  distance_km:  { label: 'Longest distance', unit: 'km',  higher: true },
  duration_min: { label: 'Longest session',  unit: 'min', higher: true },
  pace_min_km:  { label: 'Fastest pace',     unit: 'min/km', higher: false },
  calories:     { label: 'Most calories',    unit: 'kcal', higher: true },
};

// Sanity bounds. A GPS glitch or a fat-fingered manual entry should not mint a
// permanent record nobody can ever beat.
const MIN_DISTANCE_FOR_PACE_KM = 0.8;
const MIN_DURATION_FOR_PACE_S = 120;
const FASTEST_CREDIBLE_PACE = 2.0;   // min/km — under 2:00/km is faster than the world 1500m record pace
const SLOWEST_CREDIBLE_PACE = 30.0;  // min/km — slower than this is a walk with stops, not a pace record

function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS personal_records (
      user_id TEXT NOT NULL,
      activity_type TEXT NOT NULL,
      metric TEXT NOT NULL,
      value REAL NOT NULL,
      workout_id TEXT,
      achieved_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, activity_type, metric)
    );
    CREATE INDEX IF NOT EXISTS idx_personal_records_user ON personal_records(user_id, achieved_at DESC);
  `);
}

/** The measurable values a finished workout actually supports. */
function metricsFor(workout) {
  const out = {};
  const distance = Number(workout.distance_km) || 0;
  let seconds = Number(workout.duration_sec) || 0;
  if (!seconds && workout.start_time && workout.end_time) {
    seconds = (Date.parse(workout.end_time) - Date.parse(workout.start_time)) / 1000;
  }
  if (distance > 0) out.distance_km = round(distance, 2);
  if (seconds > 0) out.duration_min = round(seconds / 60, 1);
  if (Number(workout.calories) > 0) out.calories = Math.round(Number(workout.calories));
  // Pace only when both halves were genuinely measured, and only when the
  // result is humanly plausible.
  if (distance >= MIN_DISTANCE_FOR_PACE_KM && seconds >= MIN_DURATION_FOR_PACE_S) {
    const pace = (seconds / 60) / distance;
    if (pace >= FASTEST_CREDIBLE_PACE && pace <= SLOWEST_CREDIBLE_PACE) out.pace_min_km = round(pace, 2);
  }
  return out;
}

function round(n, dp) { const f = 10 ** dp; return Math.round(n * f) / f; }

function beats(metric, candidate, current) {
  if (current == null) return true;
  return METRICS[metric].higher ? candidate > current : candidate < current;
}

/**
 * Record any new bests this workout set. Returns the list that were actually
 * beaten, so the caller can celebrate them — an empty array is the normal
 * case and means "a good session, just not a record".
 *
 * The very first workout of a given type would otherwise set four records at
 * once, which is meaningless noise rather than an achievement, so a member's
 * first session of a type is stored silently and announced as nothing.
 */
function record(workout) {
  if (!workout || !workout.user_id || !workout.type) return [];
  const values = metricsFor(workout);
  if (!Object.keys(values).length) return [];

  const priorCount = db.prepare(
    'SELECT COUNT(*) c FROM personal_records WHERE user_id = ? AND activity_type = ?'
  ).get(workout.user_id, workout.type).c;
  const isFirstEver = priorCount === 0;

  const existing = db.prepare(
    'SELECT metric, value FROM personal_records WHERE user_id = ? AND activity_type = ?'
  ).all(workout.user_id, workout.type);
  const current = Object.fromEntries(existing.map(r => [r.metric, r.value]));

  const beaten = [];
  const upsert = db.prepare(`
    INSERT INTO personal_records (user_id, activity_type, metric, value, workout_id, achieved_at)
    VALUES (@user_id, @activity_type, @metric, @value, @workout_id, datetime('now'))
    ON CONFLICT(user_id, activity_type, metric)
    DO UPDATE SET value = excluded.value, workout_id = excluded.workout_id, achieved_at = excluded.achieved_at
  `);
  for (const [metric, value] of Object.entries(values)) {
    if (!beats(metric, value, current[metric])) continue;
    upsert.run({ user_id: workout.user_id, activity_type: workout.type, metric, value, workout_id: workout.id || null });
    if (!isFirstEver) {
      beaten.push({ metric, value, previous: current[metric] ?? null, ...METRICS[metric], activity_type: workout.type });
    }
  }
  return beaten;
}

/** Every record a member holds, grouped by activity type. */
function forUser(userId) {
  const rows = db.prepare(`
    SELECT activity_type, metric, value, workout_id, achieved_at
    FROM personal_records WHERE user_id = ? ORDER BY activity_type, metric
  `).all(userId);
  const byType = {};
  for (const r of rows) {
    (byType[r.activity_type] ||= []).push({ ...r, ...METRICS[r.metric] });
  }
  return byType;
}

module.exports = { init, record, forUser, metricsFor, METRICS };
