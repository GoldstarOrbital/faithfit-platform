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
function search({ sport, grad_year, q, limit = 40 } = {}) {
  const clauses = ['ap.is_public = 1', 'ap.school_email_verified_at IS NOT NULL'];
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
  if (!p || !p.is_public || !p.school_email_verified_at) return null;
  const u = db.prepare('SELECT display_name, CASE WHEN avatar_data IS NOT NULL THEN 1 ELSE 0 END AS has_avatar FROM users WHERE id = ?').get(userId);
  if (!u) return null;
  return { ...p, display_name: u.display_name, has_avatar: !!u.has_avatar, stats: recentStats(userId) };
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

module.exports = { init, get, upsert, search, publicProfile, recentStats, analyze, SPORTS, requestEmailVerification, confirmEmailVerification };
