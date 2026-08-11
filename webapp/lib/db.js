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

CREATE TABLE IF NOT EXISTS user_reminders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  repeat_rule TEXT NOT NULL DEFAULT 'once',
  enabled INTEGER NOT NULL DEFAULT 1,
  last_sent_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_user_reminders_due ON user_reminders(enabled, scheduled_at);

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

// --- group identity, associations, ownership, and invites (additive) ---
const groupCols = db.prepare("PRAGMA table_info(groups)").all().map(c => c.name);
const addGroupCol = (name, ddl) => { if (!groupCols.includes(name)) db.exec(`ALTER TABLE groups ADD COLUMN ${ddl}`); };
addGroupCol('username', 'username TEXT');
addGroupCol('creator_id', 'creator_id TEXT');
addGroupCol('church_osm_id', 'church_osm_id TEXT');
addGroupCol('church_name', 'church_name TEXT');
addGroupCol('location_name', 'location_name TEXT');
addGroupCol('lat', 'lat REAL');
addGroupCol('lng', 'lng REAL');
addGroupCol('sport', 'sport TEXT');
addGroupCol('gloo_synced_at', 'gloo_synced_at TEXT');
addGroupCol('created_at', 'created_at TEXT');
db.exec("UPDATE groups SET created_at = datetime('now') WHERE created_at IS NULL");
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_groups_username ON groups(username) WHERE username IS NOT NULL');

const memberCols = db.prepare("PRAGMA table_info(group_members)").all().map(c => c.name);
if (!memberCols.includes('role')) db.exec("ALTER TABLE group_members ADD COLUMN role TEXT NOT NULL DEFAULT 'member'");
db.exec(`
  CREATE TABLE IF NOT EXISTS group_invites (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    created_by TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_group_invites_group ON group_invites(group_id);
`);
// Give legacy groups stable usernames and preserve their first member as admin.
const legacyGroups = db.prepare("SELECT id, name FROM groups WHERE username IS NULL OR username = ''").all();
for (const g of legacyGroups) {
  const base = String(g.name || 'group').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 28) || 'group';
  let username = base, n = 2;
  while (db.prepare('SELECT 1 FROM groups WHERE username = ?').get(username)) username = `${base}-${n++}`;
  db.prepare('UPDATE groups SET username = ? WHERE id = ?').run(username, g.id);
}
const legacyAdmins = db.prepare('SELECT id FROM groups WHERE creator_id IS NULL').all();
for (const g of legacyAdmins) {
  const first = db.prepare('SELECT user_id FROM group_members WHERE group_id = ? ORDER BY rowid LIMIT 1').get(g.id);
  if (first) {
    db.prepare('UPDATE groups SET creator_id = ? WHERE id = ?').run(first.user_id, g.id);
    db.prepare("UPDATE group_members SET role = 'admin' WHERE group_id = ? AND user_id = ?").run(g.id, first.user_id);
  }
}


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

-- Per-member history for the Explore Motivation queue. The quote id is
-- intentionally a string so curated, local Bible, and YouVersion verses can
-- share one history without pretending they are the same source.
CREATE TABLE IF NOT EXISTS motivation_seen (
  user_id TEXT NOT NULL,
  quote_id TEXT NOT NULL,
  seen_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, quote_id)
);

-- Verse addresses from the complete YouVersion canon. Text is fetched only
-- when selected, then cached by the existing YouVersion passage layer.
CREATE TABLE IF NOT EXISTS motivation_bible_refs (
  quote_id TEXT PRIMARY KEY,
  version_id INTEGER NOT NULL,
  reference TEXT NOT NULL,
  book TEXT NOT NULL,
  chapter INTEGER NOT NULL,
  verse INTEGER NOT NULL
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
CREATE TABLE IF NOT EXISTS bible_meta (
  key TEXT PRIMARY KEY,
  value TEXT
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

// Whether a post shows the route that was actually ridden. Off unless the author
// turns it on: a GPS trace usually starts and ends at someone's home, so it is
// never published as a side effect of sharing a workout.
// --- Rename: FaithFit -> Functioning Faith ----------------------------------
// The seeded demo accounts carried an @faithfit.demo address, and three routes
// identify a demo account by that domain. Renaming the code without moving the
// rows would leave the live database full of accounts no query matches, and
// demo sign-in would simply stop working.
//
// Idempotent and narrowly scoped: only ever touches the demo domain, and does
// nothing at all once there is nothing left to move.
try {
  const stale = db.prepare("SELECT COUNT(*) c FROM users WHERE email LIKE '%@faithfit.demo'").get().c;
  if (stale > 0) {
    db.prepare("UPDATE users SET email = replace(email, '@faithfit.demo', '@functioningfaith.demo') WHERE email LIKE '%@faithfit.demo'").run();
    console.log('[rename] moved %d demo account(s) to @functioningfaith.demo', stale);
  }
} catch { /* users table not built yet on a first run; the seed writes the new domain anyway */ }

const postRouteCols = db.prepare('PRAGMA table_info(posts)').all().map(c => c.name);
if (!postRouteCols.includes('show_route')) db.exec('ALTER TABLE posts ADD COLUMN show_route INTEGER NOT NULL DEFAULT 0');
// Trims the first and last stretch of the published trace, which is the usual
// mitigation for exactly that problem.
if (!postRouteCols.includes('route_privacy_m')) db.exec('ALTER TABLE posts ADD COLUMN route_privacy_m INTEGER NOT NULL DEFAULT 0');

// --- migration: real podcast RSS ingestion (additive) ---
const podcastCols = db.prepare("PRAGMA table_info(podcasts)").all().map(c => c.name);
if (!podcastCols.includes('feed_url')) db.exec("ALTER TABLE podcasts ADD COLUMN feed_url TEXT");
if (!podcastCols.includes('artwork_url')) db.exec("ALTER TABLE podcasts ADD COLUMN artwork_url TEXT");
if (!podcastCols.includes('last_fetched')) db.exec("ALTER TABLE podcasts ADD COLUMN last_fetched TEXT");

db.exec(`
CREATE TABLE IF NOT EXISTS podcast_episodes (
  id TEXT PRIMARY KEY,
  podcast_id TEXT NOT NULL,
  guid TEXT NOT NULL,
  title TEXT,
  description TEXT,
  audio_url TEXT,
  link TEXT,
  duration_sec INTEGER,
  published_at TEXT,
  UNIQUE(podcast_id, guid)
);
`);

// --- migration: richer workouts (manual entry, notes, activity source, elevation) ---
const wCols2 = db.prepare("PRAGMA table_info(workouts)").all().map(c => c.name);
if (!wCols2.includes('note')) db.exec("ALTER TABLE workouts ADD COLUMN note TEXT");
if (!wCols2.includes('source')) db.exec("ALTER TABLE workouts ADD COLUMN source TEXT DEFAULT 'app'"); // app | manual | ble | import
if (!wCols2.includes('elevation_gain_m')) db.exec("ALTER TABLE workouts ADD COLUMN elevation_gain_m REAL");
if (!wCols2.includes('duration_sec')) db.exec("ALTER TABLE workouts ADD COLUMN duration_sec INTEGER");

// --- themed challenges (Strava-style, scripture/LotR flavored) ---
db.exec(`
CREATE TABLE IF NOT EXISTS challenges (
  id TEXT PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  flavor TEXT,
  scripture_ref TEXT,
  metric TEXT NOT NULL DEFAULT 'distance_km',   -- distance_km | duration_min | workouts
  target REAL NOT NULL,
  theme TEXT,
  activity_type TEXT                            -- NULL = any activity counts
);
CREATE TABLE IF NOT EXISTS user_challenges (
  user_id TEXT NOT NULL,
  challenge_id TEXT NOT NULL,
  progress REAL DEFAULT 0,
  joined_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT,
  PRIMARY KEY (user_id, challenge_id)
);
`);

// --- premium progress layer: custom goals + training log ------------------
db.exec(`
CREATE TABLE IF NOT EXISTS training_goals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  metric TEXT NOT NULL,                 -- distance_km | duration_min | workouts | calories
  target REAL NOT NULL,
  period TEXT NOT NULL,                 -- week | month | year
  activity_type TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_training_goals_user ON training_goals(user_id, archived_at);
`);

// --- OAuth / SSO identities (Sign in with Google, Apple, Microsoft, etc.) ---
// A user can have zero or more linked identities; password_hash may be NULL for
// identity-only accounts (a user who only ever signed in via a connector).
db.exec(`
CREATE TABLE IF NOT EXISTS user_identities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,          -- 'google' | 'apple' | 'microsoft' | ...
  provider_user_id TEXT NOT NULL,  -- the 'sub' claim / provider's stable user id
  email TEXT,
  linked_at TEXT DEFAULT (datetime('now')),
  UNIQUE(provider, provider_user_id)
);
`);

// --- Third-party data connectors (wearables / activity platforms) ---
// Separate from sign-in identities: a connector grants Functioning Faith permission to
// pull the user's activity data (e.g. Strava). Tokens are stored so we can
// refresh and re-sync later; scope is recorded for transparency (shown to the
// user, exportable via /api/me/export).
db.exec(`
CREATE TABLE IF NOT EXISTS user_connectors (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,               -- 'strava' | ...
  provider_user_id TEXT,
  access_token TEXT,
  refresh_token TEXT,
  expires_at TEXT,
  scope TEXT,
  connected_at TEXT DEFAULT (datetime('now')),
  last_synced_at TEXT,
  UNIQUE(user_id, provider)
);
CREATE TABLE IF NOT EXISTS imported_activities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  workout_id TEXT,
  imported_at TEXT DEFAULT (datetime('now')),
  UNIQUE(provider, external_id)
);
`);

// --- migration: location-based church selection (Overpass, additive) ---
const userCols2 = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
const addCol2 = (name, ddl) => { if (!userCols2.includes(name)) db.exec(`ALTER TABLE users ADD COLUMN ${ddl}`); };
addCol2('church_osm_id', 'church_osm_id TEXT');
addCol2('church_name', 'church_name TEXT');
addCol2('church_lat', 'church_lat REAL');
addCol2('church_lng', 'church_lng REAL');
addCol2('church_address', 'church_address TEXT');

// --- church devotionals (YouTube, additive, no-op unless YOUTUBE_API_KEY is set) ---
db.exec(`
CREATE TABLE IF NOT EXISTS churches (
  id TEXT PRIMARY KEY,
  osm_id TEXT UNIQUE,
  name TEXT,
  youtube_channel_id TEXT,
  youtube_channel_title TEXT
);
CREATE TABLE IF NOT EXISTS church_devotionals (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  video_id TEXT NOT NULL,
  title TEXT,
  thumbnail_url TEXT,
  published_at TEXT,
  fetched_date TEXT NOT NULL,
  UNIQUE(church_id, fetched_date)
);
`);

// --- group chat + run meetups (additive) ---
db.exec(`
CREATE TABLE IF NOT EXISTS group_messages (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS group_events (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  creator_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  activity_type TEXT,
  event_time TEXT NOT NULL,
  location_name TEXT,
  lat REAL,
  lng REAL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS event_rsvps (
  event_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL,
  PRIMARY KEY (event_id, user_id)
);
`);

// --- migration: profile pictures, bio link, post photos + reports, workout partners (additive) ---
const userCols3 = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
const addCol3 = (name, ddl) => { if (!userCols3.includes(name)) db.exec(`ALTER TABLE users ADD COLUMN ${ddl}`); };
addCol3('avatar_data', 'avatar_data TEXT');
addCol3('avatar_updated_at', 'avatar_updated_at TEXT');
addCol3('bio_link_url', 'bio_link_url TEXT');
addCol3('bio_link_label', 'bio_link_label TEXT');

const postCols2 = db.prepare("PRAGMA table_info(posts)").all().map(c => c.name);
if (!postCols2.includes('photo_data')) db.exec("ALTER TABLE posts ADD COLUMN photo_data TEXT");
if (!postCols2.includes('photo_category')) db.exec("ALTER TABLE posts ADD COLUMN photo_category TEXT");

db.exec(`
CREATE TABLE IF NOT EXISTS post_reports (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  reporter_id TEXT NOT NULL,
  reason TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS user_reports (
  id TEXT PRIMARY KEY,
  reported_user_id TEXT NOT NULL,
  reporter_id TEXT NOT NULL,
  reason TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS workout_partners (
  id TEXT PRIMARY KEY,
  workout_id TEXT NOT NULL,
  tagged_by TEXT NOT NULL,
  partner_user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(workout_id, partner_user_id)
);
CREATE TABLE IF NOT EXISTS workout_invites (
  id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  workout_type TEXT NOT NULL DEFAULT 'Run',
  scheduled_at TEXT,
  duration_min INTEGER,
  location TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now')),
  responded_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_workout_invites_recipient ON workout_invites(recipient_id, status, created_at);
`);

// --- video library (YouTube, additive, no-op unless YOUTUBE_API_KEY is set) ---
db.exec(`
CREATE TABLE IF NOT EXISTS video_sources (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  channel_title TEXT,
  added_note TEXT
);
CREATE TABLE IF NOT EXISTS videos (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  video_id TEXT NOT NULL,
  title TEXT,
  description TEXT,
  thumbnail_url TEXT,
  channel_title TEXT,
  published_at TEXT,
  fetched_at TEXT DEFAULT (datetime('now')),
  UNIQUE(category, video_id)
);
CREATE TABLE IF NOT EXISTS wearable_metrics (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  metric_date TEXT NOT NULL,
  sleep_score REAL,
  sleep_sec INTEGER,
  readiness_score REAL,
  hrv REAL,
  resting_hr REAL,
  steps INTEGER,
  raw_json TEXT,
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, provider, metric_date)
);
`);
const videoCols = db.prepare("PRAGMA table_info(videos)").all().map(c => c.name);
if (!videoCols.includes('is_short')) db.exec('ALTER TABLE videos ADD COLUMN is_short INTEGER NOT NULL DEFAULT 0');

// --- weekly full-service sermon + AI summary (additive) ---
db.exec(`
CREATE TABLE IF NOT EXISTS church_services (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  video_id TEXT NOT NULL,
  title TEXT,
  duration_sec INTEGER,
  published_at TEXT,
  transcript TEXT,
  summary TEXT,
  fetched_week TEXT NOT NULL,
  UNIQUE(church_id, fetched_week)
);
`);

// --- church official website (additive) — an alternate, key-free way to surface
// real sermon/service videos: many churches already embed YouTube/Vimeo players
// on their own site, so we can read those real embeds directly instead of only
// relying on the YouTube Data API. ---
const churchCols = db.prepare("PRAGMA table_info(churches)").all().map(c => c.name);
if (!churchCols.includes('website_url')) db.exec('ALTER TABLE churches ADD COLUMN website_url TEXT');

// --- journeys: Zwift-style virtual routes advanced by real workouts (additive) ---
// Appended at the end of db.js so it merges cleanly alongside other feature work.
db.exec(`
CREATE TABLE IF NOT EXISTS journeys (
  id TEXT PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  world TEXT NOT NULL,
  subtitle TEXT,
  description TEXT,
  scripture_ref TEXT,
  total_km REAL NOT NULL,
  terrain TEXT,
  elevation_m INTEGER,
  activity_hint TEXT
);
CREATE TABLE IF NOT EXISTS journey_waypoints (
  id TEXT PRIMARY KEY,
  journey_id TEXT NOT NULL,
  km_mark REAL NOT NULL,
  title TEXT NOT NULL,
  narrative TEXT,
  scripture_ref TEXT,
  scripture_text TEXT,
  UNIQUE(journey_id, km_mark)
);
CREATE TABLE IF NOT EXISTS user_journeys (
  user_id TEXT NOT NULL,
  journey_id TEXT NOT NULL,
  progress_km REAL DEFAULT 0,
  started_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT,
  last_waypoint_km REAL DEFAULT -1,
  PRIMARY KEY (user_id, journey_id)
);
`);

// --- migration: heart-rate zones + real effort measurement (additive) ---
// users: the reference figures needed to compute zones honestly. All nullable â€”
// a user with none of them gets null zones, never invented ones.
const userColsHr = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
const addColHr = (name, ddl) => { if (!userColsHr.includes(name)) db.exec(`ALTER TABLE users ADD COLUMN ${ddl}`); };
addColHr('max_hr', 'max_hr INTEGER');          // user-measured/entered max HR (ground truth)
addColHr('resting_hr', 'resting_hr INTEGER');
addColHr('birth_year', 'birth_year INTEGER');  // used for the Tanaka max-HR estimate

// workouts: the computed effort summary for the session.
const workoutColsHr = db.prepare("PRAGMA table_info(workouts)").all().map(c => c.name);
if (!workoutColsHr.includes('effort_score')) db.exec('ALTER TABLE workouts ADD COLUMN effort_score REAL');
if (!workoutColsHr.includes('time_in_zone')) db.exec('ALTER TABLE workouts ADD COLUMN time_in_zone TEXT'); // JSON {zone: seconds}
if (!workoutColsHr.includes('peak_zone')) db.exec('ALTER TABLE workouts ADD COLUMN peak_zone INTEGER');

// scripture_triggers: which workout a trigger belongs to, so the engine can avoid
// repeating a verse within a single session.
const trigCols = db.prepare("PRAGMA table_info(scripture_triggers)").all().map(c => c.name);
if (!trigCols.includes('workout_id')) db.exec('ALTER TABLE scripture_triggers ADD COLUMN workout_id TEXT');
if (!trigCols.includes('moment')) db.exec('ALTER TABLE scripture_triggers ADD COLUMN moment TEXT');

// --- migration: theological tradition, for values-aligned AI (additive) ---
// Members have always been able to name their church. This records the
// tradition that church belongs to, which is the one thing Gloo's API can act
// on: the same question about the same verse is answered differently for an
// evangelical member and a catholic one.
//
// Nullable and never inferred. A blank tradition means every Gloo call for that
// member goes out without the parameter, which is the platform's own neutral
// default — guessing a stranger's theology from a church name would be both
// unreliable and presumptuous.
const userColsTrad = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
if (!userColsTrad.includes('tradition')) db.exec('ALTER TABLE users ADD COLUMN tradition TEXT');
// Preferred YouVersion translation. Also nullable: unset means the app's
// default (engWEBUS), which matches the locally ingested text.
if (!userColsTrad.includes('bible_version_id')) db.exec('ALTER TABLE users ADD COLUMN bible_version_id INTEGER');

// --- Scripture as conversation, not broadcast (additive) ---
// One canonical thread per verse reference (UNIQUE) so conversation about a
// verse concentrates in one place instead of fragmenting across posts.
// verse_reflections.parent_id enables exactly one level of replies (a reply's
// parent must itself be a top-level reflection).
db.exec(`
CREATE TABLE IF NOT EXISTS verse_threads (
  id TEXT PRIMARY KEY,
  reference TEXT NOT NULL,
  book TEXT,
  chapter INTEGER,
  verse INTEGER,
  opened_by TEXT NOT NULL,
  prompt TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(reference)
);
CREATE TABLE IF NOT EXISTS verse_reflections (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  parent_id TEXT,
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS verse_reflection_likes (
  reflection_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (reflection_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_verse_reflections_thread ON verse_reflections(thread_id);
`);

module.exports = db;
