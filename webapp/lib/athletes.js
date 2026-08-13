/**
 * Athlete recruiting profiles.
 *
 * Opt-in only: a profile exists the moment someone fills in a sport, but it
 * is not visible to anyone until they explicitly flip is_public on — the
 * same "off unless you turn it on" default the rest of this app uses for
 * anything discoverable by strangers (public route sharing, audience
 * settings). A highschool or college athlete fills in sport, position,
 * graduating class, and school, and can point to one highlight video link;
 * the training numbers underneath (recent workouts, distance, pace) are
 * pulled live from their real logged workouts, not self-reported, so a
 * scout is looking at something that cannot be puffed up.
 */
'use strict';

const { randomBytes, randomUUID, createHash } = require('crypto');
const db = require('./db');
const gloo = require('./gloo');
const schools = require('./schools');

const SPORTS = [
  'Football', 'Basketball', 'Baseball', 'Softball', 'Soccer', 'Track & Field',
  'Cross Country', 'Volleyball', 'Wrestling', 'Swimming', 'Tennis', 'Golf',
  'Lacrosse', 'Hockey', 'Rowing', 'Gymnastics', 'Other',
];

// What "stats" means is genuinely different per sport -- a bat length means
// nothing for a swimmer, a 2k erg time means nothing for a golfer. Rather
// than one fixed column set (forcing every sport into baseball-shaped
// fields, or a pile of nullable columns), each sport gets its own small
// whitelist of keys. upsertStats() only accepts keys on the list for the
// athlete's current sport -- an unlisted key is dropped, not stored, so a
// profile can't accumulate stats for a sport the athlete isn't in.
const SPORT_STAT_FIELDS = {
  Baseball: [
    { key: 'bat_length_in', label: 'Bat length', unit: 'in' },
    { key: 'batting_avg', label: 'Batting average', unit: '' },
    { key: 'era', label: 'ERA', unit: '' },
    { key: 'throwing_velo_mph', label: 'Throwing velocity', unit: 'mph' },
  ],
  Softball: [
    { key: 'bat_length_in', label: 'Bat length', unit: 'in' },
    { key: 'batting_avg', label: 'Batting average', unit: '' },
    { key: 'era', label: 'ERA', unit: '' },
    { key: 'throwing_velo_mph', label: 'Throwing velocity', unit: 'mph' },
  ],
  Basketball: [
    { key: 'vertical_leap_in', label: 'Vertical leap', unit: 'in' },
    { key: 'three_pt_pct', label: '3-point %', unit: '%' },
    { key: 'wingspan_in', label: 'Wingspan', unit: 'in' },
  ],
  Football: [
    { key: 'forty_yard_dash_sec', label: '40-yard dash', unit: 'sec' },
    { key: 'bench_press_lb', label: 'Bench press max', unit: 'lb' },
    { key: 'vertical_leap_in', label: 'Vertical leap', unit: 'in' },
  ],
  Soccer: [
    { key: 'sprint_40m_sec', label: '40m sprint', unit: 'sec' },
    { key: 'goals_this_season', label: 'Goals this season', unit: '' },
    { key: 'assists_this_season', label: 'Assists this season', unit: '' },
  ],
  'Track & Field': [
    { key: 'personal_best_event', label: 'Primary event', unit: '' },
    { key: 'personal_best_time', label: 'Personal best', unit: '' },
  ],
  'Cross Country': [
    { key: 'personal_best_5k', label: '5K personal best', unit: '' },
  ],
  Volleyball: [
    { key: 'vertical_leap_in', label: 'Vertical leap', unit: 'in' },
    { key: 'approach_touch_in', label: 'Approach touch', unit: 'in' },
  ],
  Wrestling: [
    { key: 'weight_class_lb', label: 'Weight class', unit: 'lb' },
    { key: 'season_record', label: 'Season record', unit: '' },
  ],
  Swimming: [
    { key: 'primary_stroke', label: 'Primary stroke', unit: '' },
    { key: 'personal_best_time', label: 'Personal best', unit: '' },
  ],
  Tennis: [
    { key: 'serve_speed_mph', label: 'Serve speed', unit: 'mph' },
    { key: 'utr_rating', label: 'UTR rating', unit: '' },
  ],
  Golf: [
    { key: 'handicap', label: 'Handicap', unit: '' },
    { key: 'avg_score', label: 'Average score', unit: '' },
  ],
  Lacrosse: [
    { key: 'shot_speed_mph', label: 'Shot speed', unit: 'mph' },
    { key: 'goals_this_season', label: 'Goals this season', unit: '' },
  ],
  Hockey: [
    { key: 'skating_sprint_sec', label: 'Skating sprint', unit: 'sec' },
    { key: 'goals_this_season', label: 'Goals this season', unit: '' },
  ],
  Rowing: [
    { key: 'erg_2k_time', label: '2K erg time', unit: '' },
  ],
  Gymnastics: [
    { key: 'events', label: 'Events competed', unit: '' },
    { key: 'all_around_score', label: 'All-around score', unit: '' },
  ],
  Other: [
    { key: 'notes', label: 'Notes', unit: '' },
  ],
};
const HANDEDNESS_VALUES = new Set(['left', 'right', 'switch']);

function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS athlete_profiles (
      user_id TEXT PRIMARY KEY,
      sport TEXT NOT NULL,
      position TEXT,
      grad_year INTEGER,
      school TEXT,
      height_cm INTEGER,
      weight_kg INTEGER,
      highlight_url TEXT,
      bio TEXT,
      is_public INTEGER NOT NULL DEFAULT 0,
      school_email TEXT,
      school_email_verified_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_athlete_profiles_public ON athlete_profiles(is_public, sport, grad_year);

    CREATE TABLE IF NOT EXISTS athlete_email_verifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      email TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  // Additive migration for installations that created athlete_profiles before verification existed.
  const cols = db.prepare('PRAGMA table_info(athlete_profiles)').all().map(c => c.name);
  if (!cols.includes('school_email')) db.exec('ALTER TABLE athlete_profiles ADD COLUMN school_email TEXT');
  if (!cols.includes('school_email_verified_at')) db.exec('ALTER TABLE athlete_profiles ADD COLUMN school_email_verified_at TEXT');
  if (!cols.includes('handedness')) db.exec('ALTER TABLE athlete_profiles ADD COLUMN handedness TEXT');
  if (!cols.includes('sport_stats')) db.exec('ALTER TABLE athlete_profiles ADD COLUMN sport_stats TEXT');
  // Neither MaxPreps nor GameChanger offers a public API to sync stats from
  // automatically (confirmed as of 2026 -- MaxPreps' only integration path
  // is a closed stat-import-partner program, GameChanger's only official
  // export is CSV/PDF). These are just reference links so a coach can click
  // through and verify stats at the source; actual numbers still come from
  // the athlete's own sport_stats fields (fillable by hand or via the CSV
  // importer below).
  if (!cols.includes('maxpreps_url')) db.exec('ALTER TABLE athlete_profiles ADD COLUMN maxpreps_url TEXT');
  if (!cols.includes('gamechanger_url')) db.exec('ALTER TABLE athlete_profiles ADD COLUMN gamechanger_url TEXT');
  // Links to schools.ncessch (lib/schools.js) when the athlete picked a
  // real, synced school rather than typing a name freehand. Nullable and
  // additive on purpose: the free-text `school` column stays the display
  // value either way (kept in sync with the picked school's real name when
  // this is set), so nothing that already reads `school` needed to change.
  if (!cols.includes('school_nces_id')) db.exec('ALTER TABLE athlete_profiles ADD COLUMN school_nces_id TEXT');

  db.exec(`
    CREATE TABLE IF NOT EXISTS athlete_videos (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      url TEXT NOT NULL,
      title TEXT,
      added_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_athlete_videos_user ON athlete_videos(user_id, added_at DESC);

    CREATE TABLE IF NOT EXISTS athlete_teams (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      team_name TEXT NOT NULL,
      level TEXT,
      season TEXT,
      added_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_athlete_teams_user ON athlete_teams(user_id);

    CREATE TABLE IF NOT EXISTS athlete_awards (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      year INTEGER,
      issuer TEXT,
      added_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_athlete_awards_user ON athlete_awards(user_id);

    -- A coach endorsement is only ever written by the coach account that
    -- authored it (coach_user_id), never entered by the athlete about
    -- themselves -- see endorse() below, which requires a verified coach
    -- session and stamps coach_user_id from that session, not from input.
    CREATE TABLE IF NOT EXISTS athlete_endorsements (
      id TEXT PRIMARY KEY,
      athlete_user_id TEXT NOT NULL,
      coach_user_id TEXT NOT NULL,
      quote TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(athlete_user_id, coach_user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_athlete_endorsements_athlete ON athlete_endorsements(athlete_user_id);

    -- Secondary sports beyond the primary one on athlete_profiles. The
    -- primary sport stays where it is (it's what search/matching filter on
    -- and nothing about that changes) -- this is purely additive, for a
    -- recruit who plays more than one sport to show a second (or third)
    -- with its own position and stats.
    CREATE TABLE IF NOT EXISTS athlete_sports (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      sport TEXT NOT NULL,
      position TEXT,
      sport_stats TEXT,
      added_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, sport)
    );
    CREATE INDEX IF NOT EXISTS idx_athlete_sports_user ON athlete_sports(user_id);

    -- Per-stat-key provenance, separate from the stats themselves so the
    -- sport_stats JSON shape never has to change. Defaults to 'manual' when
    -- no row exists; a row is written for 'csv' when the value came through
    -- the CSV importer. See app.js's CSV importer and PUT /athlete-profile.
    CREATE TABLE IF NOT EXISTS athlete_stat_sources (
      user_id TEXT NOT NULL,
      stat_key TEXT NOT NULL,
      source TEXT NOT NULL,
      PRIMARY KEY (user_id, stat_key)
    );

    -- A verified coach vouching for one specific stat on an athlete's
    -- profile -- distinct from an endorsement (a free-text quote about the
    -- athlete as a whole). Multiple coaches can confirm the same stat;
    -- the directory shows a count. One row per (athlete, coach, stat).
    CREATE TABLE IF NOT EXISTS athlete_stat_confirmations (
      id TEXT PRIMARY KEY,
      athlete_user_id TEXT NOT NULL,
      stat_key TEXT NOT NULL,
      coach_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(athlete_user_id, stat_key, coach_user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_stat_confirmations_athlete ON athlete_stat_confirmations(athlete_user_id, stat_key);
  `);
}

function hash(value) {
  return createHash('sha256').update(String(value || '')).digest('hex');
}

function isValidUrl(u) {
  if (!u) return true;
  try { const p = new URL(u); return p.protocol === 'https:'; } catch { return false; }
}

/** Real training numbers from the last 90 days -- not self-reported. */
function recentStats(userId) {
  const row = db.prepare(`
    SELECT COUNT(*) AS workouts,
           ROUND(COALESCE(SUM(distance_km), 0), 1) AS distance_km,
           ROUND(AVG(avg_hr), 0) AS avg_hr
    FROM workouts
    WHERE user_id = ? AND start_time > datetime('now', '-90 days')
  `).get(userId);
  return {
    workouts_90d: row.workouts || 0,
    distance_km_90d: row.distance_km || 0,
    avg_hr_90d: row.avg_hr || null,
  };
}

function get(userId) {
  return db.prepare('SELECT * FROM athlete_profiles WHERE user_id = ?').get(userId) || null;
}

/** Drops any stat key not on that sport's whitelist, and coerces values to
 *  plain strings capped at a sane length -- these render as free text next
 *  to a label, not parsed back into numbers anywhere. */
function cleanSportStats(sport, stats) {
  const allowed = new Set((SPORT_STAT_FIELDS[sport] || []).map(f => f.key));
  const out = {};
  if (stats && typeof stats === 'object') {
    for (const [k, v] of Object.entries(stats)) {
      if (!allowed.has(k)) continue;
      const s = String(v == null ? '' : v).trim().slice(0, 40);
      if (s) out[k] = s;
    }
  }
  return out;
}

function upsert(userId, fields) {
  const sport = String(fields.sport || '').trim().slice(0, 40);
  if (!sport) return { error: 'sport_required' };
  const highlight_url = String(fields.highlight_url || '').trim().slice(0, 300) || null;
  if (!isValidUrl(highlight_url)) return { error: 'invalid_highlight_url', hint: 'Use a link starting with https://' };
  const maxpreps_url = String(fields.maxpreps_url || '').trim().slice(0, 300) || null;
  if (!isValidUrl(maxpreps_url)) return { error: 'invalid_maxpreps_url', hint: 'Use a link starting with https://' };
  const gamechanger_url = String(fields.gamechanger_url || '').trim().slice(0, 300) || null;
  if (!isValidUrl(gamechanger_url)) return { error: 'invalid_gamechanger_url', hint: 'Use a link starting with https://' };

  const grad_year = Number(fields.grad_year) || null;
  if (grad_year && (grad_year < 2020 || grad_year > 2035)) return { error: 'invalid_grad_year' };

  const handedness = HANDEDNESS_VALUES.has(fields.handedness) ? fields.handedness : null;
  const cleanedStats = cleanSportStats(sport, fields.sport_stats);
  const sport_stats = JSON.stringify(cleanedStats);

  // Provenance per stat key: 'csv' if the client says this value came from
  // the CSV importer, 'manual' otherwise (the default, and what's assumed
  // for every pre-existing profile that predates this table). Only keys
  // actually present after whitelist cleaning get a row -- a dropped key
  // can't have a source.
  const sources = fields.sport_stats_sources && typeof fields.sport_stats_sources === 'object' ? fields.sport_stats_sources : {};
  db.prepare('DELETE FROM athlete_stat_sources WHERE user_id = ?').run(userId);
  const insSource = db.prepare('INSERT INTO athlete_stat_sources (user_id, stat_key, source) VALUES (?, ?, ?)');
  for (const key of Object.keys(cleanedStats)) {
    insSource.run(userId, key, sources[key] === 'csv' ? 'csv' : 'manual');
  }

  // Picking a real synced school (school_nces_id) is authoritative: the
  // display name comes from the schools table, not whatever the client
  // sent, so it can never drift from the real record. Typing a school name
  // freehand (no id) still works exactly as before -- this is additive,
  // not a requirement.
  let school = String(fields.school || '').trim().slice(0, 120) || null;
  let school_nces_id = null;
  if (fields.school_nces_id) {
    const picked = schools.get(String(fields.school_nces_id));
    if (picked) { school_nces_id = picked.ncessch; school = picked.name; }
  }

  const row = {
    position: String(fields.position || '').trim().slice(0, 60) || null,
    height_cm: Number.isFinite(Number(fields.height_cm)) && fields.height_cm ? Math.round(Number(fields.height_cm)) : null,
    weight_kg: Number.isFinite(Number(fields.weight_kg)) && fields.weight_kg ? Math.round(Number(fields.weight_kg)) : null,
    bio: String(fields.bio || '').trim().slice(0, 500) || null,
    is_public: fields.is_public ? 1 : 0,
  };

  db.prepare(`
    INSERT INTO athlete_profiles (user_id, sport, position, grad_year, school, school_nces_id, height_cm, weight_kg, highlight_url, maxpreps_url, gamechanger_url, bio, is_public, handedness, sport_stats, updated_at)
    VALUES (@user_id, @sport, @position, @grad_year, @school, @school_nces_id, @height_cm, @weight_kg, @highlight_url, @maxpreps_url, @gamechanger_url, @bio, @is_public, @handedness, @sport_stats, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      sport=@sport, position=@position, grad_year=@grad_year, school=@school, school_nces_id=@school_nces_id, height_cm=@height_cm,
      weight_kg=@weight_kg, highlight_url=@highlight_url, maxpreps_url=@maxpreps_url, gamechanger_url=@gamechanger_url,
      bio=@bio, is_public=@is_public, handedness=@handedness, sport_stats=@sport_stats, updated_at=datetime('now')
  `).run({ user_id: userId, sport, grad_year, school, school_nces_id, highlight_url, maxpreps_url, gamechanger_url, handedness, sport_stats, ...row });

  return { profile: get(userId) };
}

// --- Videos, teams, awards: small owned lists, all scoped to userId so one
// athlete can never edit or delete another's. ---------------------------

function listVideos(userId) { return db.prepare('SELECT id, url, title, added_at FROM athlete_videos WHERE user_id = ? ORDER BY added_at DESC').all(userId); }
function addVideo(userId, { url, title }) {
  const cleanUrl = String(url || '').trim().slice(0, 300);
  if (!cleanUrl || !isValidUrl(cleanUrl) || !/^https:/i.test(cleanUrl)) return { error: 'invalid_video_url', hint: 'Use a link starting with https://' };
  const existing = db.prepare('SELECT COUNT(*) c FROM athlete_videos WHERE user_id = ?').get(userId).c;
  if (existing >= 12) return { error: 'too_many_videos', hint: 'Remove an older video before adding a new one (max 12).' };
  const id = randomUUID();
  db.prepare('INSERT INTO athlete_videos (id, user_id, url, title) VALUES (?,?,?,?)').run(id, userId, cleanUrl, String(title || '').trim().slice(0, 120) || null);
  return { video: db.prepare('SELECT id, url, title, added_at FROM athlete_videos WHERE id = ?').get(id) };
}
function removeVideo(userId, videoId) {
  const r = db.prepare('DELETE FROM athlete_videos WHERE id = ? AND user_id = ?').run(videoId, userId);
  return { ok: r.changes > 0 };
}

function listTeams(userId) { return db.prepare('SELECT id, team_name, level, season, added_at FROM athlete_teams WHERE user_id = ? ORDER BY season DESC, added_at DESC').all(userId); }
function addTeam(userId, { team_name, level, season }) {
  const name = String(team_name || '').trim().slice(0, 120);
  if (!name) return { error: 'team_name_required' };
  const id = randomUUID();
  db.prepare('INSERT INTO athlete_teams (id, user_id, team_name, level, season) VALUES (?,?,?,?,?)')
    .run(id, userId, name, String(level || '').trim().slice(0, 60) || null, String(season || '').trim().slice(0, 20) || null);
  return { team: db.prepare('SELECT id, team_name, level, season, added_at FROM athlete_teams WHERE id = ?').get(id) };
}
function removeTeam(userId, teamId) {
  const r = db.prepare('DELETE FROM athlete_teams WHERE id = ? AND user_id = ?').run(teamId, userId);
  return { ok: r.changes > 0 };
}

function listAwards(userId) { return db.prepare('SELECT id, title, year, issuer, added_at FROM athlete_awards WHERE user_id = ? ORDER BY year DESC, added_at DESC').all(userId); }
function addAward(userId, { title, year, issuer }) {
  const clean = String(title || '').trim().slice(0, 160);
  if (!clean) return { error: 'title_required' };
  const y = Number(year) || null;
  if (y && (y < 1950 || y > 2035)) return { error: 'invalid_year' };
  const id = randomUUID();
  db.prepare('INSERT INTO athlete_awards (id, user_id, title, year, issuer) VALUES (?,?,?,?,?)')
    .run(id, userId, clean, y, String(issuer || '').trim().slice(0, 120) || null);
  return { award: db.prepare('SELECT id, title, year, issuer, added_at FROM athlete_awards WHERE id = ?').get(id) };
}
function removeAward(userId, awardId) {
  const r = db.prepare('DELETE FROM athlete_awards WHERE id = ? AND user_id = ?').run(awardId, userId);
  return { ok: r.changes > 0 };
}

function listEndorsements(athleteUserId) {
  return db.prepare(`
    SELECT e.id, e.quote, e.created_at, c.sport AS coach_sport, c.organization AS coach_organization, c.title AS coach_title,
           u.display_name AS coach_name
    FROM athlete_endorsements e
    JOIN coach_profiles c ON c.user_id = e.coach_user_id
    JOIN users u ON u.id = e.coach_user_id
    WHERE e.athlete_user_id = ? ORDER BY e.created_at DESC
  `).all(athleteUserId);
}

/** Only ever called with a coachUserId taken from the caller's own verified
 *  session (see routes/api.js) -- never accepts an arbitrary coach id from
 *  the request body, so an athlete cannot forge an endorsement "from" a
 *  coach who never wrote one. One endorsement per coach per athlete;
 *  submitting again replaces the previous quote rather than duplicating. */
function endorse(coachUserId, athleteUserId, quote) {
  const clean = String(quote || '').trim().slice(0, 500);
  if (!clean) return { error: 'quote_required' };
  if (!publicProfile(athleteUserId)) return { error: 'athlete_not_found' };
  db.prepare(`
    INSERT INTO athlete_endorsements (id, athlete_user_id, coach_user_id, quote)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(athlete_user_id, coach_user_id) DO UPDATE SET quote = excluded.quote, created_at = datetime('now')
  `).run(randomUUID(), athleteUserId, coachUserId, clean);
  return { ok: true };
}

/**
 * Sends a confirmation link to a school email address. Best-effort, same
 * contract as password reset: silently returns { queued:false } if Resend
 * isn't configured, so the app degrades rather than erroring for anyone
 * running without an email provider set up.
 *
 * There is no curated highschool-domain registry to check against -- unlike
 * .edu for the developer-verification flow, highschools don't share one --
 * so what this actually proves is narrower and stated as such: the address
 * is real and this athlete controls it, not that the school itself is
 * accredited or that the domain belongs to a school at all.
 */
async function requestEmailVerification(userId, email, baseUrl) {
  const mail = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return { error: 'invalid_email' };
  if (!get(userId)) return { error: 'profile_not_found', hint: 'Save your sport and other details first.' };
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) return { queued: false };

  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  db.prepare('DELETE FROM athlete_email_verifications WHERE user_id = ? OR expires_at < datetime(\'now\')').run(userId);
  db.prepare('INSERT INTO athlete_email_verifications (id, user_id, email, token_hash, expires_at) VALUES (?,?,?,?,?)')
    .run(randomUUID(), userId, mail, hash(token), expires);

  const link = `${String(baseUrl).replace(/\/$/, '')}/api/athlete-profile/verify-email/confirm?token=${encodeURIComponent(token)}`;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM,
      to: [mail],
      subject: 'Verify your school email for Functioning Faith recruiting',
      html: `<p>Confirm this is your school email to make your Functioning Faith athlete recruiting profile visible in the public directory.</p><p><a href="${link}">Verify my school email</a></p><p>This link expires in 24 hours. If you did not request this, no action is needed.</p>`,
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error('verification_email_failed');
  return { queued: true, email: mail };
}

/** Consumes a verification token. Returns the userId on success, or null. */
function confirmEmailVerification(token) {
  const row = db.prepare(
    "SELECT * FROM athlete_email_verifications WHERE token_hash = ? AND used_at IS NULL AND expires_at > datetime('now')"
  ).get(hash(String(token || '')));
  if (!row) return null;
  db.prepare('UPDATE athlete_email_verifications SET used_at = datetime(\'now\') WHERE id = ?').run(row.id);
  db.prepare("UPDATE athlete_profiles SET school_email = ?, school_email_verified_at = datetime('now') WHERE user_id = ?")
    .run(row.email, row.user_id);
  return row.user_id;
}

/** Public directory search -- no auth, since scouts are not expected to have an account.
 *  Requires a verified school email, not just is_public, so a public listing means
 *  someone confirmed a real inbox they control -- not just flipped a toggle. */
function search({ sport, grad_year, q, school_nces_id, limit = 40 } = {}) {
  const clauses = ['ap.is_public = 1', 'ap.school_email_verified_at IS NOT NULL'];
  const params = {};
  if (sport) { clauses.push('ap.sport = @sport'); params.sport = String(sport).slice(0, 40); }
  if (grad_year) { clauses.push('ap.grad_year = @grad_year'); params.grad_year = Number(grad_year); }
  if (school_nces_id) { clauses.push('ap.school_nces_id = @school_nces_id'); params.school_nces_id = String(school_nces_id); }
  if (q) { clauses.push("(u.display_name LIKE @q ESCAPE '\\' OR ap.school LIKE @q ESCAPE '\\')"); params.q = '%' + String(q).slice(0, 60).replace(/[\\%_]/g, c => '\\' + c) + '%'; }

  const rows = db.prepare(`
    SELECT ap.user_id, ap.sport, ap.position, ap.grad_year, ap.school, ap.school_nces_id, ap.highlight_url, ap.bio, ap.handedness,
           u.display_name, CASE WHEN u.avatar_data IS NOT NULL THEN 1 ELSE 0 END AS has_avatar,
           (SELECT COUNT(*) FROM athlete_videos v WHERE v.user_id = ap.user_id) AS video_count,
           (SELECT COUNT(*) FROM athlete_endorsements e WHERE e.athlete_user_id = ap.user_id) AS endorsement_count,
           (SELECT COUNT(*) FROM athlete_awards aw WHERE aw.user_id = ap.user_id) AS award_count
    FROM athlete_profiles ap JOIN users u ON u.id = ap.user_id
    WHERE ${clauses.join(' AND ')}
    ORDER BY ap.updated_at DESC LIMIT @limit
  `).all({ ...params, limit: Math.min(Number(limit) || 40, 100) });

  return rows.map(r => ({ ...r, stats: recentStats(r.user_id) }));
}

/** Attaches provenance (manual vs CSV) and coach-confirmation count to each
 *  stat, for the badges shown in the directory -- see athlete_stat_sources
 *  and athlete_stat_confirmations in init(). A stat with no source row
 *  (every profile saved before this table existed) reads as 'manual',
 *  which is the honest default: nothing claims a provenance it doesn't have. */
function parseSportStats(json, sport, userId) {
  let parsed = {};
  try { parsed = JSON.parse(json || '{}') || {}; } catch { parsed = {}; }
  const fields = SPORT_STAT_FIELDS[sport] || [];
  const present = fields.filter(f => parsed[f.key]);
  if (!present.length) return [];
  const sourceRows = userId ? db.prepare('SELECT stat_key, source FROM athlete_stat_sources WHERE user_id = ?').all(userId) : [];
  const sourceMap = new Map(sourceRows.map(r => [r.stat_key, r.source]));
  const confirmRows = userId ? db.prepare('SELECT stat_key, COUNT(*) c FROM athlete_stat_confirmations WHERE athlete_user_id = ? GROUP BY stat_key').all(userId) : [];
  const confirmMap = new Map(confirmRows.map(r => [r.stat_key, r.c]));
  return present.map(f => ({
    ...f, value: parsed[f.key],
    source: sourceMap.get(f.key) || 'manual',
    confirmed_by: confirmMap.get(f.key) || 0,
  }));
}

function listSports(userId) {
  return db.prepare('SELECT id, sport, position, sport_stats, added_at FROM athlete_sports WHERE user_id = ? ORDER BY added_at ASC').all(userId)
    .map(r => ({ ...r, sport_stats: parseSportStats(r.sport_stats, r.sport, null) }));
}
function addSport(userId, { sport, position, sport_stats }) {
  const primary = get(userId);
  const clean = String(sport || '').trim().slice(0, 40);
  if (!clean || !SPORT_STAT_FIELDS[clean]) return { error: 'invalid_sport' };
  if (primary && primary.sport === clean) return { error: 'already_primary_sport', hint: 'This is already your primary sport.' };
  const id = randomUUID();
  db.prepare(`
    INSERT INTO athlete_sports (id, user_id, sport, position, sport_stats)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id, sport) DO UPDATE SET position = excluded.position, sport_stats = excluded.sport_stats
  `).run(id, userId, clean, String(position || '').trim().slice(0, 60) || null, JSON.stringify(cleanSportStats(clean, sport_stats)));
  return { sport: db.prepare('SELECT id, sport, position, sport_stats, added_at FROM athlete_sports WHERE user_id = ? AND sport = ?').get(userId, clean) };
}
function removeSport(userId, sportRowId) {
  const r = db.prepare('DELETE FROM athlete_sports WHERE id = ? AND user_id = ?').run(sportRowId, userId);
  return { ok: r.changes > 0 };
}

/**
 * A coach vouching for one specific stat, not the whole profile. Requires
 * the caller (routes/api.js) to have already checked coaches.isVerified --
 * this function itself only enforces that the athlete profile is real and
 * public, the same boundary endorse() uses.
 */
function confirmStat(coachUserId, athleteUserId, statKey) {
  const profile = get(athleteUserId);
  if (!publicProfile(athleteUserId)) return { error: 'athlete_not_found' };
  const validKeys = new Set((SPORT_STAT_FIELDS[profile.sport] || []).map(f => f.key));
  if (!validKeys.has(statKey)) return { error: 'invalid_stat_key' };
  db.prepare(`
    INSERT OR IGNORE INTO athlete_stat_confirmations (id, athlete_user_id, stat_key, coach_user_id)
    VALUES (?, ?, ?, ?)
  `).run(randomUUID(), athleteUserId, statKey, coachUserId);
  const count = db.prepare('SELECT COUNT(*) c FROM athlete_stat_confirmations WHERE athlete_user_id = ? AND stat_key = ?').get(athleteUserId, statKey).c;
  return { ok: true, confirmed_by: count };
}

/**
 * Profile completeness, scored toward what actually gets an athlete found
 * and trusted -- not a binary "public or not." Nudges (missing, in
 * descending point order) tell the athlete exactly what to do next rather
 * than just showing a number.
 */
const SCORE_WEIGHTS = [
  { key: 'verified_email', points: 25, label: 'Verify your school email', check: p => !!p.school_email_verified_at },
  { key: 'endorsement', points: 15, label: 'Get a coach endorsement', check: (p, ctx) => ctx.endorsements.length > 0 },
  { key: 'video', points: 15, label: 'Add a highlight video', check: (p, ctx) => !!p.highlight_url || ctx.videos.length > 0 },
  { key: 'stats', points: 15, label: 'Fill in your sport stats', check: (p, ctx) => ctx.statsFilledRatio >= 0.5, partial: (p, ctx) => ctx.statsFilledRatio },
  { key: 'bio', points: 10, label: 'Write a short bio', check: p => !!(p.bio && p.bio.trim().length >= 20) },
  { key: 'photo', points: 5, label: 'Add a profile photo', check: (p, ctx) => ctx.hasAvatar },
  { key: 'physical', points: 5, label: 'Add height, weight, and handedness', check: p => !!(p.height_cm && p.weight_kg && p.handedness) },
  { key: 'team', points: 5, label: 'Add a past team', label2: 'team', check: (p, ctx) => ctx.teams.length > 0 },
  { key: 'award', points: 5, label: 'Add an award or honor', check: (p, ctx) => ctx.awards.length > 0 },
];
function profileScore(userId) {
  const p = get(userId);
  if (!p) return { score: 0, factors: [], missing: [] };
  const fields = SPORT_STAT_FIELDS[p.sport] || [];
  const filled = fields.length ? Object.keys(cleanSportStats(p.sport, JSON.parse(p.sport_stats || '{}') || {})).length : 0;
  const ctx = {
    videos: listVideos(userId), teams: listTeams(userId), awards: listAwards(userId), endorsements: listEndorsements(userId),
    hasAvatar: !!db.prepare('SELECT 1 FROM users WHERE id = ? AND avatar_data IS NOT NULL').get(userId),
    statsFilledRatio: fields.length ? filled / fields.length : 0,
  };
  let score = 0;
  const factors = [], missing = [];
  for (const w of SCORE_WEIGHTS) {
    const earned = w.check(p, ctx);
    const points = earned ? w.points : (w.partial ? Math.round(w.partial(p, ctx) * w.points) : 0);
    score += points;
    factors.push({ key: w.key, label: w.label, points, max_points: w.points, earned: !!earned });
    if (!earned) missing.push({ key: w.key, label: w.label, points: w.points - points });
  }
  missing.sort((a, b) => b.points - a.points);
  return { score: Math.min(100, score), factors, missing };
}

function publicProfile(userId) {
  const p = get(userId);
  if (!p || !p.is_public || !p.school_email_verified_at) return null;
  const u = db.prepare('SELECT display_name, CASE WHEN avatar_data IS NOT NULL THEN 1 ELSE 0 END AS has_avatar FROM users WHERE id = ?').get(userId);
  if (!u) return null;
  return {
    ...p, display_name: u.display_name, has_avatar: !!u.has_avatar, stats: recentStats(userId),
    sport_stats: parseSportStats(p.sport_stats, p.sport, userId),
    videos: listVideos(userId), teams: listTeams(userId), awards: listAwards(userId), endorsements: listEndorsements(userId),
    additional_sports: listSports(userId),
  };
}

/**
 * A short, Gloo-generated read on an athlete's own recent training, for the
 * athlete themselves -- not for a coach, and not part of any public listing.
 * Grounded the same way coach matching is: the model gets only this one
 * athlete's real profile fields and real 90-day stats, told explicitly to
 * reason only from what it's given, no records/rankings/comparisons to
 * anyone else. Falls back to a plain, honest message (not an error) when
 * Gloo isn't configured or the reply doesn't parse -- an athlete without AI
 * available should see "not available", not a broken screen.
 */
async function analyze(userId) {
  const profile = get(userId);
  if (!profile) return { error: 'profile_not_found', hint: 'Save your sport and other details first.' };
  const stats = recentStats(userId);

  if (!gloo.isConfigured()) {
    return { analysis: null, available: false };
  }

  const out = await gloo.chatJson({
    kind: 'athlete_self_analysis', userId, cache: true, cacheDays: 1, maxTokens: 350,
    messages: [
      { role: 'system', content: 'You give a highschool or college athlete a short, honest, encouraging read on their own recent training. '
        + 'Reply with ONLY a JSON object: {"summary":"2-3 sentences, under 70 words","strength":"one sentence naming a real pattern in the data","suggestion":"one concrete, low-risk suggestion, under 30 words"}. '
        + 'Base everything strictly on the stats given -- never invent records, comparisons to other athletes, injury advice, or numbers not provided. '
        + 'If the data is sparse (few or no workouts), say that plainly rather than padding with generic praise.' },
      { role: 'user', content: `Sport: ${profile.sport}${profile.position ? ', position ' + profile.position : ''}\n`
        + `Last 90 days: ${stats.workouts_90d} workouts, ${stats.distance_km_90d} km total`
        + (stats.avg_hr_90d ? `, average heart rate ${stats.avg_hr_90d}` : '') + '.' },
    ],
  });
  if (!out || !out.json) return { analysis: null, available: true, generated: false };
  return { analysis: out.json, available: true, generated: true, stats };
}

module.exports = {
  init, get, upsert, search, publicProfile, recentStats, analyze, SPORTS, SPORT_STAT_FIELDS,
  requestEmailVerification, confirmEmailVerification,
  listVideos, addVideo, removeVideo, listTeams, addTeam, removeTeam,
  listAwards, addAward, removeAward, listEndorsements, endorse,
  listSports, addSport, removeSport, confirmStat, profileScore,
};
