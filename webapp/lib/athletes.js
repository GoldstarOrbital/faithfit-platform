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

const db = require('./db');

const SPORTS = [
  'Football', 'Basketball', 'Baseball', 'Softball', 'Soccer', 'Track & Field',
  'Cross Country', 'Volleyball', 'Wrestling', 'Swimming', 'Tennis', 'Golf',
  'Lacrosse', 'Hockey', 'Rowing', 'Gymnastics', 'Other',
];

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
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_athlete_profiles_public ON athlete_profiles(is_public, sport, grad_year);
  `);
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

function upsert(userId, fields) {
  const sport = String(fields.sport || '').trim().slice(0, 40);
  if (!sport) return { error: 'sport_required' };
  const highlight_url = String(fields.highlight_url || '').trim().slice(0, 300) || null;
  if (!isValidUrl(highlight_url)) return { error: 'invalid_highlight_url', hint: 'Use a link starting with https://' };

  const grad_year = Number(fields.grad_year) || null;
  if (grad_year && (grad_year < 2020 || grad_year > 2035)) return { error: 'invalid_grad_year' };

  const row = {
    position: String(fields.position || '').trim().slice(0, 60) || null,
    school: String(fields.school || '').trim().slice(0, 120) || null,
    height_cm: Number.isFinite(Number(fields.height_cm)) && fields.height_cm ? Math.round(Number(fields.height_cm)) : null,
    weight_kg: Number.isFinite(Number(fields.weight_kg)) && fields.weight_kg ? Math.round(Number(fields.weight_kg)) : null,
    bio: String(fields.bio || '').trim().slice(0, 500) || null,
    is_public: fields.is_public ? 1 : 0,
  };

  db.prepare(`
    INSERT INTO athlete_profiles (user_id, sport, position, grad_year, school, height_cm, weight_kg, highlight_url, bio, is_public, updated_at)
    VALUES (@user_id, @sport, @position, @grad_year, @school, @height_cm, @weight_kg, @highlight_url, @bio, @is_public, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      sport=@sport, position=@position, grad_year=@grad_year, school=@school, height_cm=@height_cm,
      weight_kg=@weight_kg, highlight_url=@highlight_url, bio=@bio, is_public=@is_public, updated_at=datetime('now')
  `).run({ user_id: userId, sport, grad_year, highlight_url, ...row });

  return { profile: get(userId) };
}

/** Public directory search -- no auth, since scouts are not expected to have an account. */
function search({ sport, grad_year, q, limit = 40 } = {}) {
  const clauses = ['ap.is_public = 1'];
  const params = {};
  if (sport) { clauses.push('ap.sport = @sport'); params.sport = String(sport).slice(0, 40); }
  if (grad_year) { clauses.push('ap.grad_year = @grad_year'); params.grad_year = Number(grad_year); }
  if (q) { clauses.push("(u.display_name LIKE @q ESCAPE '\\' OR ap.school LIKE @q ESCAPE '\\')"); params.q = '%' + String(q).slice(0, 60).replace(/[\\%_]/g, c => '\\' + c) + '%'; }

  const rows = db.prepare(`
    SELECT ap.user_id, ap.sport, ap.position, ap.grad_year, ap.school, ap.highlight_url, ap.bio,
           u.display_name, CASE WHEN u.avatar_data IS NOT NULL THEN 1 ELSE 0 END AS has_avatar
    FROM athlete_profiles ap JOIN users u ON u.id = ap.user_id
    WHERE ${clauses.join(' AND ')}
    ORDER BY ap.updated_at DESC LIMIT @limit
  `).all({ ...params, limit: Math.min(Number(limit) || 40, 100) });

  return rows.map(r => ({ ...r, stats: recentStats(r.user_id) }));
}

function publicProfile(userId) {
  const p = get(userId);
  if (!p || !p.is_public) return null;
  const u = db.prepare('SELECT display_name, CASE WHEN avatar_data IS NOT NULL THEN 1 ELSE 0 END AS has_avatar FROM users WHERE id = ?').get(userId);
  if (!u) return null;
  return { ...p, display_name: u.display_name, has_avatar: !!u.has_avatar, stats: recentStats(userId) };
}

module.exports = { init, get, upsert, search, publicProfile, recentStats, SPORTS };
