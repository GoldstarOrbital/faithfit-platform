'use strict';

const db = require('./db');

function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workout_kudos (
      workout_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (workout_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_workout_kudos_workout ON workout_kudos(workout_id, created_at);
  `);
}

function count(workoutId) {
  return db.prepare('SELECT COUNT(*) c FROM workout_kudos WHERE workout_id=?').get(workoutId)?.c || 0;
}

function has(workoutId, userId) {
  return !!db.prepare('SELECT 1 FROM workout_kudos WHERE workout_id=? AND user_id=?').get(workoutId, userId);
}

function toggle(workoutId, userId) {
  if (has(workoutId, userId)) {
    db.prepare('DELETE FROM workout_kudos WHERE workout_id=? AND user_id=?').run(workoutId, userId);
    return { given: false, count: count(workoutId) };
  }
  db.prepare('INSERT INTO workout_kudos(workout_id,user_id) VALUES(?,?)').run(workoutId, userId);
  return { given: true, count: count(workoutId) };
}

module.exports = { init, count, has, toggle };
