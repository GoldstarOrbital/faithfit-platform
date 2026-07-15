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
  bio_verse_ref TEXT,
  bio_verse_text TEXT,
  job TEXT,
  church TEXT,
  fitness_group TEXT,
  gym TEXT,
  age INTEGER,
  show_age INTEGER DEFAULT 0,
  password_hash TEXT,
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
  distance_km REAL,
  gps_points INTEGER,
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


db.exec(`
CREATE TABLE IF NOT EXISTS post_likes (
  post_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS post_comments (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  content TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS motivation_quotes (
  id TEXT PRIMARY KEY,
  text TEXT,
  attribution TEXT,
  theme TEXT
);

CREATE TABLE IF NOT EXISTS podcasts (
  id TEXT PRIMARY KEY,
  title TEXT,
  host TEXT,
  description TEXT,
  duration_min INTEGER,
  theme TEXT
);

CREATE TABLE IF NOT EXISTS breathing_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  pattern TEXT,
  duration_sec INTEGER,
  completed_at TEXT DEFAULT (datetime('now'))
);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS bible_verses (
  id TEXT PRIMARY KEY,
  book TEXT NOT NULL,
  book_id TEXT,
  chapter INTEGER NOT NULL,
  verse INTEGER NOT NULL,
  text TEXT NOT NULL,
  translation TEXT NOT NULL,
  UNIQUE(book, chapter, verse, translation)
);
`);

// FTS5 virtual table + sync triggers, created separately since some SQLite builds
// are picky about mixing virtual-table DDL into a single multi-statement exec.
db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS bible_verses_fts USING fts5(
    text, book, reference UNINDEXED, content='bible_verses', content_rowid='rowid'
  );
`);
db.exec(`
  CREATE TRIGGER IF NOT EXISTS bible_verses_ai AFTER INSERT ON bible_verses BEGIN
    INSERT INTO bible_verses_fts(rowid, text, book, reference)
    VALUES (new.rowid, new.text, new.book, new.book || ' ' || new.chapter || ':' || new.verse);
  END;
`);

// --- migration: add secure-profile columns to pre-existing DBs (safe no-op on fresh DBs) ---
const userCols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
const addCol = (name, ddl) => { if (!userCols.includes(name)) db.exec(`ALTER TABLE users ADD COLUMN ${ddl}`); };
addCol('bio_verse_ref', 'bio_verse_ref TEXT');
addCol('bio_verse_text', 'bio_verse_text TEXT');
addCol('job', 'job TEXT');
addCol('church', 'church TEXT');
addCol('fitness_group', 'fitness_group TEXT');
addCol('gym', 'gym TEXT');
addCol('age', 'age INTEGER');
addCol('show_age', 'show_age INTEGER DEFAULT 0');
addCol('password_hash', 'password_hash TEXT');
// Default visibility for newly shared workouts/posts (private | followers | public).
addCol('default_visibility', "default_visibility TEXT DEFAULT 'public'");

// --- migration: post visibility model + stored GPS route (additive, volume-safe) ---
const postCols = db.prepare("PRAGMA table_info(posts)").all().map(c => c.name);
// ALTER ADD COLUMN with a DEFAULT backfills existing rows, so pre-existing posts
// stay visible ('public') rather than vanishing behind the new visibility filter.
if (!postCols.includes('visibility')) db.exec("ALTER TABLE posts ADD COLUMN visibility TEXT DEFAULT 'public'");

const workoutCols = db.prepare("PRAGMA table_info(workouts)").all().map(c => c.name);
// gps_path: JSON array of [lat,lng] for the real route, used by the public share page.
if (!workoutCols.includes('gps_path')) db.exec("ALTER TABLE workouts ADD COLUMN gps_path TEXT");

module.exports = db;
