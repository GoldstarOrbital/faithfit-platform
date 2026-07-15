const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'faithfit.db'));

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  display_name TEXT,
  bio TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_consents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  granted_at TEXT DEFAULT (datetime('now')),
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS workouts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT,
  start_time TEXT,
  end_time TEXT,
  calories INTEGER,
  avg_hr INTEGER,
  max_hr INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS biometric_samples (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workout_id TEXT,
  time TEXT NOT NULL,
  heart_rate INTEGER,
  hrv INTEGER,
  steps INTEGER,
  stress_level INTEGER
);

CREATE TABLE IF NOT EXISTS scripture_verses (
  id TEXT PRIMARY KEY,
  reference TEXT,
  text TEXT,
  translation TEXT,
  youversion_id TEXT,
  themes TEXT
);

CREATE TABLE IF NOT EXISTS scripture_triggers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  verse_id TEXT NOT NULL,
  trigger_type TEXT,
  biometric_snapshot TEXT,
  timestamp TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  content TEXT,
  workout_id TEXT,
  verse_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS followers (
  follower_id TEXT NOT NULL,
  followee_id TEXT NOT NULL,
  PRIMARY KEY (follower_id, followee_id)
);

CREATE TABLE IF NOT EXISTS user_xp (
  user_id TEXT PRIMARY KEY,
  xp INTEGER DEFAULT 0,
  level INTEGER DEFAULT 1,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS badges (
  id TEXT PRIMARY KEY,
  name TEXT,
  description TEXT,
  icon TEXT
);

CREATE TABLE IF NOT EXISTS user_badges (
  user_id TEXT NOT NULL,
  badge_id TEXT NOT NULL,
  earned_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, badge_id)
);

CREATE TABLE IF NOT EXISTS quests (
  id TEXT PRIMARY KEY,
  name TEXT,
  description TEXT,
  theme TEXT,
  target INTEGER
);

CREATE TABLE IF NOT EXISTS user_quests (
  user_id TEXT NOT NULL,
  quest_id TEXT NOT NULL,
  progress TEXT,
  completed INTEGER DEFAULT 0,
  PRIMARY KEY (user_id, quest_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT,
  payload TEXT,
  delivered_at TEXT DEFAULT (datetime('now')),
  read INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  name TEXT,
  description TEXT
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  PRIMARY KEY (group_id, user_id)
);
`);

module.exports = db;
