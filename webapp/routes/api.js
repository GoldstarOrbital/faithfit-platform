const express = require('express');
const { randomUUID } = require('crypto');
const db = require('../lib/db');
const { publish, subscribe } = require('../lib/events');
const { runPipeline } = require('../lib/pipeline');
const { xpForEvent, levelForXp } = require('../lib/xp');
const { advanceQuestProgress } = require('../lib/quests');
const { badgeEligibility } = require('../lib/badges');
const { composeForEvent } = require('../lib/composer');
const { loadBibleData } = require('../lib/bible-load');
const { hashPassword, verifyPassword } = require('../lib/password');
const { ensureChallenges, applyWorkoutToChallenges } = require('../lib/challenges');
const oauth = require('../lib/oauth');
const strava = require('../lib/strava');
const { searchNearbyChurches } = require('../lib/overpass');
const youtube = require('../lib/youtube');
const sermonSummary = require('../lib/sermon-summary');

// Load real, public-domain Bible text (KJV/WEB) into bible_verses once at startup.
loadBibleData();
// Seed / refresh the themed challenge catalog.
ensureChallenges();

// Activities FaithFit can track. Kept server-side so the client and validation
// stay in sync. `d` = whether distance/pace is meaningful for that activity.
const ACTIVITY_TYPES = [
  { type: 'Run', icon: '🏃', d: true },
  { type: 'Walk', icon: '🚶', d: true },
  { type: 'Hike', icon: '🥾', d: true },
  { type: 'Trail Run', icon: '⛰️', d: true },
  { type: 'Cycle', icon: '🚴', d: true },
  { type: 'Swim', icon: '🏊', d: true },
  { type: 'Row', icon: '🚣', d: true },
  { type: 'Elliptical', icon: '🌀', d: false },
  { type: 'Strength', icon: '🏋️', d: false },
  { type: 'HIIT', icon: '🔥', d: false },
  { type: 'Yoga', icon: '🧘', d: false },
  { type: 'Pilates', icon: '🤸', d: false },
  { type: 'Climbing', icon: '🧗', d: false },
  { type: 'Skiing', icon: '⛷️', d: true },
  { type: 'Workout', icon: '💪', d: false },
];
const ACTIVITY_SET = new Set(ACTIVITY_TYPES.map(a => a.type));

const router = express.Router();

// ---- auth: real email + password accounts (scrypt-hashed). ----
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VISIBILITIES = ['private', 'followers', 'public'];

function publicUser(row) {
  if (!row) return null;
  const { password_hash, email, ...rest } = row;
  return rest;
}

// ---- shared image-upload cap (avatars + post photos) ----
const MAX_IMAGE_BYTES = 250 * 1024; // 250KB
function validateDataUrlImage(dataUrl) {
  if (typeof dataUrl !== 'string' || !/^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(dataUrl)) {
    return { ok: false, error: 'invalid_image', hint: 'Image must be a base64 data URL (data:image/...;base64,...).' };
  }
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const bytes = Math.floor(base64.length * 3 / 4);
  if (bytes > MAX_IMAGE_BYTES) {
    return { ok: false, error: 'image_too_large', hint: `Image must be under ${Math.round(MAX_IMAGE_BYTES / 1024)}KB after resizing.` };
  }
  return { ok: true, bytes };
}

// ---- bio link allowlist: LinkedIn or known fundraiser platforms only ----
const BIO_LINK_ALLOWLIST = {
  'linkedin.com': 'LinkedIn ↗',
  'gofundme.com': 'Support my fundraiser ↗',
  'gofund.me': 'Support my fundraiser ↗',
  'justgiving.com': 'Support my fundraiser ↗',
  'classy.org': 'Support my fundraiser ↗',
  'fundly.com': 'Support my fundraiser ↗',
  'givesendgo.com': 'Support my fundraiser ↗',
};
function matchBioLinkLabel(urlStr) {
  let u;
  try { u = new URL(urlStr); } catch { return null; }
  const host = u.hostname.toLowerCase();
  for (const domain of Object.keys(BIO_LINK_ALLOWLIST)) {
    if (host === domain || host.endsWith('.' + domain)) return BIO_LINK_ALLOWLIST[domain];
  }
  return null;
}

// ---- shared XP application (used by the workout.completed handler + partner bonuses) ----
function applyXp(userId, amount) {
  const current = db.prepare('SELECT * FROM user_xp WHERE user_id = ?').get(userId) || { xp: 0 };
  const newXp = current.xp + amount;
  const newLevel = levelForXp(newXp);
  db.prepare("INSERT INTO user_xp (user_id, xp, level, updated_at) VALUES (?, ?, ?, datetime('now')) ON CONFLICT(user_id) DO UPDATE SET xp=excluded.xp, level=excluded.level, updated_at=excluded.updated_at")
    .run(userId, newXp, newLevel);
  return newXp;
}
const PARTNER_XP_BONUS = Math.max(10, Math.round(xpForEvent('workout.completed') * 0.25)); // +25% of base workout XP, min 10

// Create a real account. Password is scrypt-hashed; email is stored lowercased
// and must be unique. Signs the new user in on success.
router.post('/auth/register', (req, res) => {
  const { email, password, display_name } = req.body || {};
  const mail = String(email || '').trim().toLowerCase();
  const name = String(display_name || '').trim().slice(0, 60);
  const pw = String(password || '');

  if (!EMAIL_RE.test(mail)) return res.status(400).json({ error: 'invalid_email' });
  if (pw.length < 8) return res.status(400).json({ error: 'weak_password', hint: 'Use at least 8 characters.' });
  if (!name) return res.status(400).json({ error: 'missing_display_name' });

  const existing = db.prepare('SELECT 1 FROM users WHERE email = ?').get(mail);
  if (existing) return res.status(409).json({ error: 'email_taken' });

  const id = randomUUID();
  db.prepare('INSERT INTO users (id, email, display_name, password_hash) VALUES (?, ?, ?, ?)')
    .run(id, mail, name, hashPassword(pw));
  db.prepare('INSERT OR IGNORE INTO user_xp (user_id, xp, level) VALUES (?, 0, 1)').run(id);

  req.session.userId = id;
  res.status(201).json({ ok: true, user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)) });
});

// Sign in with email + password.
router.post('/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const mail = String(email || '').trim().toLowerCase();
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(mail);
  // Constant-ish response: same error whether the email is unknown or the
  // password is wrong, so we don't leak which emails have accounts.
  if (!row || !verifyPassword(String(password || ''), row.password_hash)) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  req.session.userId = row.id;
  res.json({ ok: true, user: publicUser(row) });
});

router.post('/auth/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

// Sign in as one of the seeded EXAMPLE accounts (no password). Kept so people can
// explore a populated app instantly — clearly optional demo content, not the
// primary way to use FaithFit. Only works for the pre-seeded demo emails.
router.post('/auth/demo', (req, res) => {
  const { user_id } = req.body || {};
  const user = db.prepare("SELECT * FROM users WHERE id = ? AND email LIKE '%@faithfit.demo'").get(user_id);
  if (!user) return res.status(404).json({ error: 'demo_user_not_found' });
  req.session.userId = user.id;
  res.json({ ok: true, user: publicUser(user) });
});

router.get('/users', (req, res) => {
  res.json(db.prepare(`
    SELECT id, display_name, bio_verse_ref, bio_verse_text, job, church, fitness_group, gym,
      CASE WHEN show_age = 1 THEN age ELSE NULL END AS age,
      CASE WHEN avatar_data IS NOT NULL THEN 1 ELSE 0 END AS has_avatar
    FROM users
  `).all());
});

// Dedicated lightweight endpoint for fetching a user's real avatar image lazily.
// Kept out of list/feed responses so those payloads don't bloat with base64 images.
router.get('/users/:id/avatar', (req, res) => {
  const row = db.prepare('SELECT avatar_data FROM users WHERE id = ?').get(req.params.id);
  if (!row || !row.avatar_data) return res.status(404).json({ error: 'no_avatar' });
  res.json({ avatar_data: row.avatar_data });
});

// ---- OAuth / SSO sign-in (Google, Apple, Microsoft — generic OIDC connector) ----
// Only providers with real credentials configured (env vars) are reported —
// the frontend hides buttons for anything not actually wired up.
router.get('/auth/providers', (req, res) => {
  res.json({ providers: oauth.listConfiguredProviders() });
});

function baseUrl(req) {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/$/, '');
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  return `${proto}://${req.get('host')}`;
}

// Kick off the Authorization Code + PKCE flow. `link=1` links the provider to
// the CURRENTLY signed-in account instead of signing in / creating a new one.
router.get('/auth/oauth/:provider/start', (req, res) => {
  const { provider } = req.params;
  if (!oauth.isConfigured(provider)) return res.status(404).json({ error: 'provider_not_configured' });
  const { verifier, challenge } = oauth.generatePkce();
  const state = oauth.b64url(require('crypto').randomBytes(16));
  const nonce = oauth.b64url(require('crypto').randomBytes(16));
  const link = req.query.link === '1' && !!req.session.userId;

  req.session.oauthPending = { provider, state, nonce, verifier, link, userId: link ? req.session.userId : null, createdAt: Date.now() };
  const redirectUri = `${baseUrl(req)}/api/auth/oauth/${provider}/callback`;
  try {
    const url = oauth.buildAuthorizationUrl(provider, { redirectUri, state, nonce, codeChallenge: challenge });
    res.redirect(url);
  } catch (err) {
    res.status(400).json({ error: 'oauth_start_failed', detail: err.message });
  }
});

async function handleOauthCallback(req, res) {
  const { provider } = req.params;
  const params = { ...req.query, ...req.body };
  const pending = req.session.oauthPending;
  const fail = (reason) => res.redirect(`/?oauth_error=${encodeURIComponent(reason)}`);

  if (!pending || pending.provider !== provider) return fail('session_expired');
  if (Date.now() - pending.createdAt > 10 * 60 * 1000) { req.session.oauthPending = null; return fail('session_expired'); }
  if (!params.code || params.state !== pending.state) { req.session.oauthPending = null; return fail('state_mismatch'); }

  try {
    const redirectUri = `${baseUrl(req)}/api/auth/oauth/${provider}/callback`;
    const tokens = await oauth.exchangeCodeForTokens(provider, { code: params.code, redirectUri, codeVerifier: pending.verifier });
    if (!tokens.id_token) throw new Error('no_id_token_returned');
    const claims = await oauth.verifyIdToken(provider, tokens.id_token, { nonce: pending.nonce });

    const email = claims.email ? String(claims.email).trim().toLowerCase() : null;
    const emailVerified = claims.email_verified === true || claims.email_verified === 'true';
    const name = claims.name || (email ? email.split('@')[0] : `${oauth.PROVIDERS[provider].label} user`);

    if (pending.link) {
      // Linking to an already-signed-in account.
      const existingOther = db.prepare('SELECT user_id FROM user_identities WHERE provider = ? AND provider_user_id = ?').get(provider, claims.sub);
      if (existingOther && existingOther.user_id !== pending.userId) { req.session.oauthPending = null; return fail('identity_linked_elsewhere'); }
      db.prepare(`INSERT INTO user_identities (id, user_id, provider, provider_user_id, email) VALUES (?,?,?,?,?)
                  ON CONFLICT(provider, provider_user_id) DO UPDATE SET email = excluded.email`)
        .run(randomUUID(), pending.userId, provider, claims.sub, email);
      req.session.oauthPending = null;
      return res.redirect('/?linked=' + provider);
    }

    // Sign-in-or-create.
    let identity = db.prepare('SELECT user_id FROM user_identities WHERE provider = ? AND provider_user_id = ?').get(provider, claims.sub);
    let userId;
    if (identity) {
      userId = identity.user_id;
    } else if (email && emailVerified) {
      // Link to an existing password account with the same, provider-verified email.
      const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
      if (existingUser) {
        userId = existingUser.id;
        db.prepare('INSERT OR IGNORE INTO user_identities (id, user_id, provider, provider_user_id, email) VALUES (?,?,?,?,?)')
          .run(randomUUID(), userId, provider, claims.sub, email);
      }
    }
    if (!userId) {
      // New account — no password (identity-only sign-in).
      userId = randomUUID();
      const uniqueEmail = email || `${provider}-${claims.sub}@login.faithfit`;
      db.prepare('INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)').run(userId, uniqueEmail, String(name).slice(0, 60));
      db.prepare('INSERT OR IGNORE INTO user_xp (user_id, xp, level) VALUES (?, 0, 1)').run(userId);
      db.prepare('INSERT INTO user_identities (id, user_id, provider, provider_user_id, email) VALUES (?,?,?,?,?)')
        .run(randomUUID(), userId, provider, claims.sub, email);
    }

    req.session.oauthPending = null;
    req.session.userId = userId;
    res.redirect('/');
  } catch (err) {
    req.session.oauthPending = null;
    console.error(`[oauth] ${provider} callback failed:`, err.message);
    fail('sign_in_failed');
  }
}
router.get('/auth/oauth/:provider/callback', handleOauthCallback);
router.post('/auth/oauth/:provider/callback', handleOauthCallback); // Apple uses form_post

// Linked sign-in identities + connected data connectors for the current user —
// full transparency into what's linked, shown in Profile settings.
router.get('/auth/connections', requireAuth, (req, res) => {
  const uid = req.session.userId;
  const identities = db.prepare('SELECT provider, email, linked_at FROM user_identities WHERE user_id = ?').all(uid);
  const connectors = db.prepare('SELECT provider, scope, connected_at, last_synced_at FROM user_connectors WHERE user_id = ?').all(uid);
  res.json({ identities, connectors });
});

router.post('/auth/identities/:provider/unlink', requireAuth, (req, res) => {
  db.prepare('DELETE FROM user_identities WHERE user_id = ? AND provider = ?').run(req.session.userId, req.params.provider);
  res.json({ ok: true });
});

// ---- Device / wearable sync via Strava (real GPS-watch data, free to connect) ----
router.get('/connectors/strava/configured', (req, res) => res.json({ configured: strava.isConfigured() }));

router.get('/connectors/strava/start', requireAuth, (req, res) => {
  if (!strava.isConfigured()) return res.status(404).json({ error: 'strava_not_configured' });
  const state = oauth.b64url(require('crypto').randomBytes(16));
  req.session.stravaPending = { state, userId: req.session.userId, createdAt: Date.now() };
  const redirectUri = `${baseUrl(req)}/api/connectors/strava/callback`;
  res.redirect(strava.buildAuthorizationUrl({ redirectUri, state }));
});

router.get('/connectors/strava/callback', async (req, res) => {
  const pending = req.session.stravaPending;
  const fail = (reason) => res.redirect(`/?strava_error=${encodeURIComponent(reason)}`);
  if (!pending || Date.now() - pending.createdAt > 10 * 60 * 1000) { req.session.stravaPending = null; return fail('session_expired'); }
  if (req.query.error) { req.session.stravaPending = null; return fail('access_denied'); }
  if (req.query.state !== pending.state) { req.session.stravaPending = null; return fail('state_mismatch'); }

  try {
    const tokens = await strava.exchangeCodeForTokens(req.query.code);
    db.prepare(`INSERT INTO user_connectors (id, user_id, provider, provider_user_id, access_token, refresh_token, expires_at, scope)
                VALUES (?,?,?,?,?,?,?,?)
                ON CONFLICT(user_id, provider) DO UPDATE SET
                  provider_user_id=excluded.provider_user_id, access_token=excluded.access_token,
                  refresh_token=excluded.refresh_token, expires_at=excluded.expires_at, scope=excluded.scope`)
      .run(randomUUID(), pending.userId, 'strava', String(tokens.athlete?.id || ''), tokens.access_token, tokens.refresh_token,
        new Date(tokens.expires_at * 1000).toISOString(), 'read,activity:read_all');
    req.session.stravaPending = null;
    await syncStravaForUser(pending.userId).catch(err => console.error('[strava] initial sync failed:', err.message));
    res.redirect('/?connected=strava');
  } catch (err) {
    req.session.stravaPending = null;
    console.error('[strava] callback failed:', err.message);
    fail('connect_failed');
  }
});

router.post('/connectors/strava/sync', requireAuth, async (req, res) => {
  try {
    const result = await syncStravaForUser(req.session.userId);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(502).json({ error: 'sync_failed', detail: err.message });
  }
});

router.post('/connectors/:provider/disconnect', requireAuth, (req, res) => {
  db.prepare('DELETE FROM user_connectors WHERE user_id = ? AND provider = ?').run(req.session.userId, req.params.provider);
  res.json({ ok: true });
});

// Pull recent Strava activities and import any not already seen, mapped into
// FaithFit's own workout model (source='strava'). Idempotent — dedupes by
// Strava's activity id via imported_activities. Auto-refreshes an expired
// access token using the stored refresh token.
async function syncStravaForUser(userId) {
  let conn = db.prepare('SELECT * FROM user_connectors WHERE user_id = ? AND provider = ?').get(userId, 'strava');
  if (!conn) throw new Error('not_connected');

  if (new Date(conn.expires_at).getTime() < Date.now() + 60000) {
    const fresh = await strava.refreshTokens(conn.refresh_token);
    db.prepare('UPDATE user_connectors SET access_token = ?, refresh_token = ?, expires_at = ? WHERE user_id = ? AND provider = ?')
      .run(fresh.access_token, fresh.refresh_token, new Date(fresh.expires_at * 1000).toISOString(), userId, 'strava');
    conn = { ...conn, access_token: fresh.access_token };
  }

  const activities = await strava.fetchRecentActivities(conn.access_token, { perPage: 30 });
  let imported = 0;
  for (const a of activities) {
    const externalId = String(a.id);
    const already = db.prepare('SELECT 1 FROM imported_activities WHERE provider = ? AND external_id = ?').get('strava', externalId);
    if (already) continue;

    const type = strava.mapActivityType(a);
    const start = new Date(a.start_date).toISOString();
    const durationSec = Math.round(a.elapsed_time || a.moving_time || 0);
    const end = new Date(new Date(start).getTime() + durationSec * 1000).toISOString();
    const distanceKm = a.distance ? +(a.distance / 1000).toFixed(2) : null;
    const calories = a.calories || (distanceKm ? Math.round(distanceKm * 60) : Math.round((durationSec / 60) * 8));
    const path = a.map?.summary_polyline ? strava.decodePolyline(a.map.summary_polyline) : null;

    const workoutId = randomUUID();
    db.prepare(`INSERT INTO workouts (id, user_id, type, start_time, end_time, calories, avg_hr, max_hr, distance_km, duration_sec, gps_points, gps_path, note, source)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'strava')`)
      .run(workoutId, userId, type, start, end, calories, a.average_heartrate ? Math.round(a.average_heartrate) : null,
        a.max_heartrate ? Math.round(a.max_heartrate) : null, distanceKm, durationSec, path ? path.length : 0,
        path && path.length ? JSON.stringify(path) : null, a.name ? `Synced from Strava: ${a.name}`.slice(0, 500) : null);
    db.prepare('INSERT INTO imported_activities (id, user_id, provider, external_id, workout_id) VALUES (?,?,?,?,?)')
      .run(randomUUID(), userId, 'strava', externalId, workoutId);

    publish('workout.completed', { user_id: userId, workout_id: workoutId, calories, avg_hr: a.average_heartrate || null });
    const completed = applyWorkoutToChallenges(userId, { distance_km: distanceKm || 0, duration_sec: durationSec, type });
    notifyChallengeCompletions(userId, completed);
    imported++;
  }
  db.prepare('UPDATE user_connectors SET last_synced_at = ? WHERE user_id = ? AND provider = ?').run(new Date().toISOString(), userId, 'strava');
  return { imported, checked: activities.length };
}

// Seeded demo accounts only — powers the "explore a demo profile" affordance on
// the sign-in screen without exposing real users as passwordless login targets.
router.get('/auth/demo-users', (req, res) => {
  res.json(db.prepare(`
    SELECT id, display_name, bio_verse_ref FROM users WHERE email LIKE '%@faithfit.demo' ORDER BY display_name
  `).all());
});

// Back-compat: the old demo picker POSTed here. Route it through the demo path so
// existing sessions/clients keep working, but restrict to seeded demo accounts.
router.post('/session', (req, res) => {
  const { user_id } = req.body || {};
  const user = db.prepare("SELECT * FROM users WHERE id = ? AND email LIKE '%@faithfit.demo'").get(user_id);
  if (!user) return res.status(404).json({ error: 'user_not_found' });
  req.session.userId = user.id;
  res.json({ ok: true, user: publicUser(user) });
});

router.get('/me', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'not_signed_in' });
  const uid = req.session.userId;
  const userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
  if (!userRow) {
    // Stale session pointing at a user that no longer exists (e.g. DB was reset).
    // Clear it and bounce to sign-in instead of rendering a broken "undefined" profile.
    req.session = null;
    return res.status(401).json({ error: 'not_signed_in' });
  }
  // Never expose email or password_hash in any API response (secure-profile rule).
  const user = publicUser(userRow);
  const xp = db.prepare('SELECT * FROM user_xp WHERE user_id = ?').get(uid);
  const badges = db.prepare(`SELECT b.* FROM user_badges ub JOIN badges b ON b.id = ub.badge_id WHERE ub.user_id = ?`).all(uid);
  const consents = db.prepare('SELECT scope FROM user_consents WHERE user_id = ? AND revoked_at IS NULL').all(uid).map(r => r.scope);
  const stats = {
    workouts: db.prepare("SELECT COUNT(*) c FROM workouts WHERE user_id = ? AND end_time IS NOT NULL").get(uid).c,
    total_calories: db.prepare("SELECT COALESCE(SUM(calories),0) c FROM workouts WHERE user_id = ?").get(uid).c,
    followers: db.prepare('SELECT COUNT(*) c FROM followers WHERE followee_id = ?').get(uid).c,
    following: db.prepare('SELECT COUNT(*) c FROM followers WHERE follower_id = ?').get(uid).c,
  };
  res.json({ user, xp, badges, consents, stats });
});

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'not_signed_in' });
  const exists = db.prepare('SELECT 1 FROM users WHERE id = ?').get(req.session.userId);
  if (!exists) {
    req.session = null;
    return res.status(401).json({ error: 'not_signed_in' });
  }
  next();
}

// ---- consent (privacy opt-in, per spec section 3) ----
router.post('/consent', requireAuth, (req, res) => {
  const { scope, granted } = req.body || {};
  if (!['biometric_ingest', 'scripture_personalization'].includes(scope)) {
    return res.status(400).json({ error: 'invalid_scope' });
  }
  if (granted) {
    const existing = db.prepare('SELECT * FROM user_consents WHERE user_id = ? AND scope = ? AND revoked_at IS NULL').get(req.session.userId, scope);
    if (!existing) db.prepare('INSERT INTO user_consents (id, user_id, scope) VALUES (?, ?, ?)').run(randomUUID(), req.session.userId, scope);
  } else {
    db.prepare("UPDATE user_consents SET revoked_at = datetime('now') WHERE user_id = ? AND scope = ? AND revoked_at IS NULL").run(req.session.userId, scope);
  }
  res.json({ ok: true });
});

// ---- feed ----
router.get('/feed', (req, res) => {
  const meId = req.session.userId || null;
  // Visibility rules: public → everyone; followers → the author's followers (and
  // the author); private → author only.
  const posts = db.prepare(`
    SELECT p.id, p.content, p.created_at, p.user_id author_id, u.display_name author,
           CASE WHEN u.avatar_data IS NOT NULL THEN 1 ELSE 0 END AS author_has_avatar,
           p.visibility, p.workout_id, p.photo_data, p.photo_category,
           w.type workout_type, w.calories, w.avg_hr, w.start_time, w.end_time, w.distance_km,
           v.reference verse_reference, v.text verse_text, v.youversion_id
    FROM posts p
    JOIN users u ON u.id = p.user_id
    LEFT JOIN workouts w ON w.id = p.workout_id
    LEFT JOIN scripture_verses v ON v.id = p.verse_id
    WHERE p.visibility = 'public'
       OR p.user_id = @me
       OR (p.visibility = 'followers' AND EXISTS (
             SELECT 1 FROM followers f WHERE f.followee_id = p.user_id AND f.follower_id = @me))
    ORDER BY p.created_at DESC LIMIT 50
  `).all({ me: meId });

  const withSocial = posts.map(p => {
    const likeCount = db.prepare('SELECT COUNT(*) c FROM post_likes WHERE post_id = ?').get(p.id).c;
    const likedByMe = meId ? !!db.prepare('SELECT 1 FROM post_likes WHERE post_id = ? AND user_id = ?').get(p.id, meId) : false;
    const comments = db.prepare(`
      SELECT c.id, c.content, c.created_at, u.display_name author
      FROM post_comments c JOIN users u ON u.id = c.user_id
      WHERE c.post_id = ? ORDER BY c.created_at ASC
    `).all(p.id);
    let pace = null, distanceKm = p.distance_km ?? null;
    if (p.workout_type && p.start_time && p.end_time) {
      const mins = (new Date(p.end_time) - new Date(p.start_time)) / 60000;
      if (distanceKm == null) distanceKm = +(mins / 6).toFixed(1); // fallback estimate when no real GPS data
      pace = distanceKm > 0 ? (mins / distanceKm).toFixed(1) : null;
    }
    return { ...p, like_count: likeCount, liked_by_me: likedByMe, comments, distance_km: distanceKm, pace_min_per_km: pace };
  });
  res.json(withSocial);
});

router.post('/posts/:id/like', requireAuth, (req, res) => {
  const existing = db.prepare('SELECT 1 FROM post_likes WHERE post_id = ? AND user_id = ?').get(req.params.id, req.session.userId);
  if (existing) {
    db.prepare('DELETE FROM post_likes WHERE post_id = ? AND user_id = ?').run(req.params.id, req.session.userId);
  } else {
    db.prepare('INSERT INTO post_likes (post_id, user_id) VALUES (?, ?)').run(req.params.id, req.session.userId);
  }
  const likeCount = db.prepare('SELECT COUNT(*) c FROM post_likes WHERE post_id = ?').get(req.params.id).c;
  res.json({ liked: !existing, like_count: likeCount });
});

router.post('/posts/:id/comments', requireAuth, (req, res) => {
  const { content } = req.body || {};
  if (!content || !content.trim()) return res.status(400).json({ error: 'empty_comment' });
  const id = randomUUID();
  db.prepare('INSERT INTO post_comments (id, post_id, user_id, content) VALUES (?, ?, ?, ?)').run(id, req.params.id, req.session.userId, content.trim());
  const comment = db.prepare(`SELECT c.id, c.content, c.created_at, u.display_name author FROM post_comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?`).get(id);
  res.json(comment);
});

// ---- workout partners: tag someone you worked out with, they must confirm ----
// Validates each partner id is a real, distinct user (rejects self-tagging), inserts
// a pending workout_partners row, and notifies the partner. No XP is awarded here —
// bonus XP only happens once the partner confirms via /workout-partners/:id/respond.
function tagWorkoutPartners(taggerId, workoutId, partnerUserIds) {
  if (!Array.isArray(partnerUserIds) || !partnerUserIds.length) return { tagged: [], errors: [] };
  const taggerName = db.prepare('SELECT display_name FROM users WHERE id = ?').get(taggerId)?.display_name || 'Someone';
  const tagged = [], errors = [];
  for (const rawId of partnerUserIds) {
    const partnerId = String(rawId || '').trim();
    if (!partnerId) continue;
    if (partnerId === taggerId) { errors.push({ partner_user_id: partnerId, error: 'cannot_tag_self' }); continue; }
    const exists = db.prepare('SELECT 1 FROM users WHERE id = ?').get(partnerId);
    if (!exists) { errors.push({ partner_user_id: partnerId, error: 'user_not_found' }); continue; }
    const id = randomUUID();
    try {
      db.prepare('INSERT INTO workout_partners (id, workout_id, tagged_by, partner_user_id, status) VALUES (?, ?, ?, ?, ?)')
        .run(id, workoutId, taggerId, partnerId, 'pending');
      db.prepare('INSERT INTO notifications (id, user_id, type, payload) VALUES (?, ?, ?, ?)')
        .run(randomUUID(), partnerId, 'workout_partner_tag', JSON.stringify({
          workout_partner_id: id, message: `${taggerName} tagged you as a workout partner — confirm to both get bonus XP`,
        }));
      tagged.push(partnerId);
    } catch (e) {
      errors.push({ partner_user_id: partnerId, error: 'already_tagged' });
    }
  }
  return { tagged, errors };
}

// ---- workouts ----
router.post('/workouts/start', requireAuth, (req, res) => {
  const { type = 'Run' } = req.body || {};
  const id = randomUUID();
  db.prepare('INSERT INTO workouts (id, user_id, type, start_time) VALUES (?, ?, ?, ?)')
    .run(id, req.session.userId, type, new Date().toISOString());
  publish('workout.started', { user_id: req.session.userId, workout_id: id, type });
  res.json({ id, type, start_time: new Date().toISOString() });
});

router.post('/workouts/:id/sample', requireAuth, (req, res) => {
  const { heart_rate, stress_level } = req.body || {};
  const workout = db.prepare('SELECT * FROM workouts WHERE id = ? AND user_id = ?').get(req.params.id, req.session.userId);
  if (!workout) return res.status(404).json({ error: 'not_found' });
  db.prepare('INSERT INTO biometric_samples (id, user_id, workout_id, time, heart_rate, stress_level) VALUES (?, ?, ?, ?, ?, ?)')
    .run(randomUUID(), req.session.userId, workout.id, new Date().toISOString(), heart_rate, stress_level ?? 0);

  // Run the real scripture trigger pipeline on this live biometric sample.
  const consents = db.prepare('SELECT scope FROM user_consents WHERE user_id = ? AND revoked_at IS NULL').all(req.session.userId).map(r => r.scope);
  const personalizationEnabled = consents.includes('scripture_personalization');
  const candidateVerses = db.prepare('SELECT id, reference, youversion_id, themes FROM scripture_verses').all()
    .map(v => ({ ...v, themes: v.themes.split(',') }));
  const history = db.prepare('SELECT verse_id FROM scripture_triggers WHERE user_id = ? ORDER BY timestamp DESC LIMIT 20').all(req.session.userId);

  const result = runPipeline({
    rawSnapshot: { heart_rate, workout_type: workout.type, movement: { intensity: 0.8 }, stress_level: stress_level ?? 0 },
    candidateVerses,
    userHistory: history.map(h => ({ verse_id: h.verse_id, engaged: false })),
    userPreferences: {},
    personalizationEnabled,
    verseTextLookup: (yid) => db.prepare('SELECT text FROM scripture_verses WHERE youversion_id = ?').get(yid),
  });

  db.prepare('INSERT INTO scripture_triggers (id, user_id, verse_id, trigger_type, biometric_snapshot) VALUES (?, ?, ?, ?, ?)')
    .run(randomUUID(), req.session.userId, result.verse.id, result.context, JSON.stringify(result.snapshot));

  publish('verse.triggered', { user_id: req.session.userId, verse_id: result.verse.id, youversion_id: result.verse.youversion_id, trigger_type: result.context, payload: result.payload });

  res.json({ context: result.context, verse: result.payload, verse_id: result.verse.id });
});

router.post('/workouts/:id/stop', requireAuth, (req, res) => {
  const workout = db.prepare('SELECT * FROM workouts WHERE id = ? AND user_id = ?').get(req.params.id, req.session.userId);
  if (!workout) return res.status(404).json({ error: 'not_found' });
  const samples = db.prepare('SELECT * FROM biometric_samples WHERE workout_id = ?').all(workout.id);
  const hrs = samples.map(s => s.heart_rate).filter(Boolean);
  const avgHr = hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null;
  const maxHr = hrs.length ? Math.max(...hrs) : null;
  const { gps_distance_km, gps_points, gps_path, partner_user_ids } = req.body || {};
  // Calories: use real GPS distance if we have one (running ~ 60 kcal/km), else fall back to a duration-based estimate.
  const durationMin = (Date.now() - new Date(workout.start_time).getTime()) / 60000;
  const calories = gps_distance_km > 0 ? Math.round(gps_distance_km * 60) : Math.round(durationMin * 8);

  // Persist the real route (array of [lat,lng]) so a shared workout can render its
  // map without the tracker still being open. Cap the stored point count to keep
  // the row reasonable; the count column still records how many points were logged.
  let pathJson = null, pointCount = 0;
  if (Array.isArray(gps_path) && gps_path.length) {
    const clean = gps_path.filter(p => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])).slice(0, 3000);
    pointCount = clean.length;
    if (clean.length) pathJson = JSON.stringify(clean);
  } else if (Number.isInteger(gps_points)) {
    pointCount = gps_points;
  }

  const durationSec = Math.max(0, Math.round((Date.now() - new Date(workout.start_time).getTime()) / 1000));
  db.prepare("UPDATE workouts SET end_time = datetime('now'), avg_hr = ?, max_hr = ?, calories = ?, distance_km = ?, gps_points = ?, gps_path = ?, duration_sec = ? WHERE id = ?")
    .run(avgHr, maxHr, calories, gps_distance_km || null, pointCount, pathJson, durationSec, workout.id);

  publish('workout.completed', { user_id: req.session.userId, workout_id: workout.id, calories, avg_hr: avgHr, max_hr: maxHr });
  const completedChallenges = applyWorkoutToChallenges(req.session.userId, { distance_km: gps_distance_km || 0, duration_sec: durationSec, type: workout.type });
  notifyChallengeCompletions(req.session.userId, completedChallenges);
  const partners = tagWorkoutPartners(req.session.userId, workout.id, partner_user_ids);

  res.json({ id: workout.id, calories, avg_hr: avgHr, max_hr: maxHr, distance_km: gps_distance_km || null, duration_sec: durationSec, completed_challenges: completedChallenges.map(c => c.name), partner_tag_errors: partners.errors });
});

// Manually log a completed workout (Strava-style "add activity" — no live tracking).
router.post('/workouts/manual', requireAuth, (req, res) => {
  const uid = req.session.userId;
  let { type = 'Run', duration_min, distance_km, calories, note, date, avg_hr, partner_user_ids } = req.body || {};
  if (!ACTIVITY_SET.has(type)) return res.status(400).json({ error: 'invalid_activity_type' });
  const durSec = Math.max(0, Math.round((Number(duration_min) || 0) * 60));
  if (durSec === 0 && !(Number(distance_km) > 0)) return res.status(400).json({ error: 'need_duration_or_distance' });
  const dist = Number(distance_km) > 0 ? Number(distance_km) : null;
  const cal = Number(calories) > 0 ? Math.round(Number(calories)) : (dist ? Math.round(dist * 60) : Math.round((durSec / 60) * 8));
  const when = date && !isNaN(new Date(date)) ? new Date(date).toISOString() : new Date().toISOString();
  const start = new Date(new Date(when).getTime() - durSec * 1000).toISOString();
  const id = randomUUID();
  db.prepare(`INSERT INTO workouts (id, user_id, type, start_time, end_time, calories, avg_hr, distance_km, duration_sec, gps_points, note, source)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'manual')`)
    .run(id, uid, type, start, when, cal, Number(avg_hr) > 0 ? Math.round(Number(avg_hr)) : null, dist, durSec, (note || '').toString().slice(0, 500) || null);

  publish('workout.completed', { user_id: uid, workout_id: id, calories: cal, avg_hr: avg_hr || null });
  const completed = applyWorkoutToChallenges(uid, { distance_km: dist || 0, duration_sec: durSec, type });
  notifyChallengeCompletions(uid, completed);
  const partners = tagWorkoutPartners(uid, id, partner_user_ids);
  res.status(201).json({ id, type, calories: cal, distance_km: dist, duration_sec: durSec, completed_challenges: completed.map(c => c.name), partner_tag_errors: partners.errors });
});

// Tag partners on an already-completed workout the caller owns (used from the
// post-workout share screen, which is shown after /stop or /manual already ran).
router.post('/workouts/:id/tag-partners', requireAuth, (req, res) => {
  const workout = db.prepare('SELECT id FROM workouts WHERE id = ? AND user_id = ?').get(req.params.id, req.session.userId);
  if (!workout) return res.status(404).json({ error: 'not_found' });
  const { partner_user_ids } = req.body || {};
  const partners = tagWorkoutPartners(req.session.userId, workout.id, partner_user_ids);
  res.json({ ok: true, tagged: partners.tagged, errors: partners.errors });
});

// Respond to a pending workout-partner tag (must be the tagged partner). On accept,
// both the workout owner and the confirming partner get a one-time bonus XP award —
// gated on the pending → confirmed transition so it can never double-fire (the
// UNIQUE(workout_id, partner_user_id) constraint also prevents duplicate rows).
router.post('/workout-partners/:id/respond', requireAuth, (req, res) => {
  const uid = req.session.userId;
  const tag = db.prepare('SELECT * FROM workout_partners WHERE id = ?').get(req.params.id);
  if (!tag) return res.status(404).json({ error: 'not_found' });
  if (tag.partner_user_id !== uid) return res.status(403).json({ error: 'forbidden' });
  if (tag.status !== 'pending') return res.status(409).json({ error: 'already_responded' });

  const { accept } = req.body || {};
  const newStatus = accept ? 'confirmed' : 'declined';
  const info = db.prepare("UPDATE workout_partners SET status = ? WHERE id = ? AND status = 'pending'").run(newStatus, tag.id);
  if (info.changes === 0) return res.status(409).json({ error: 'already_responded' });

  if (accept) {
    applyXp(tag.tagged_by, PARTNER_XP_BONUS);
    applyXp(tag.partner_user_id, PARTNER_XP_BONUS);
    const partnerName = db.prepare('SELECT display_name FROM users WHERE id = ?').get(uid)?.display_name || 'Your partner';
    db.prepare('INSERT INTO notifications (id, user_id, type, payload) VALUES (?, ?, ?, ?)')
      .run(randomUUID(), tag.tagged_by, 'workout_partner_confirmed', JSON.stringify({
        message: `${partnerName} confirmed the workout partner tag — you both earned +${PARTNER_XP_BONUS} XP!`,
      }));
  }
  res.json({ ok: true, status: newStatus, bonus_xp: accept ? PARTNER_XP_BONUS : 0 });
});

// Pending partner-tag requests awaiting the current user's response.
router.get('/workout-partners/pending', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT wp.id, wp.workout_id, wp.created_at, wp.tagged_by, u.display_name tagged_by_name,
           w.type workout_type, w.calories, w.distance_km
    FROM workout_partners wp
    JOIN users u ON u.id = wp.tagged_by
    LEFT JOIN workouts w ON w.id = wp.workout_id
    WHERE wp.partner_user_id = ? AND wp.status = 'pending'
    ORDER BY wp.created_at DESC
  `).all(req.session.userId);
  res.json(rows);
});

function notifyChallengeCompletions(userId, completed) {
  for (const c of completed) {
    db.prepare('INSERT INTO notifications (id, user_id, type, payload) VALUES (?, ?, ?, ?)')
      .run(randomUUID(), userId, 'challenge_complete', JSON.stringify({ challenge: c.name, message: `Challenge complete: ${c.name}!` }));
  }
}

router.get('/activity-types', (req, res) => res.json(ACTIVITY_TYPES));

// Share a workout / reflection. Visibility defaults to the user's setting.
const PHOTO_CATEGORIES = ['nature', 'animal', 'group'];
router.post('/posts', requireAuth, (req, res) => {
  const { content, workout_id, verse_id, visibility, photo_data, photo_category } = req.body || {};
  const uid = req.session.userId;

  // A workout can only be posted by its owner.
  if (workout_id) {
    const w = db.prepare('SELECT 1 FROM workouts WHERE id = ? AND user_id = ?').get(workout_id, uid);
    if (!w) return res.status(404).json({ error: 'workout_not_found' });
  }

  // Content policy (not automated detection): post photos may only be self-certified
  // as nature, animal, or a group of people — never a solo person (that's what the
  // profile picture, Task 1, is for).
  let photoData = null, photoCategory = null;
  if (photo_data) {
    const check = validateDataUrlImage(photo_data);
    if (!check.ok) return res.status(400).json({ error: check.error, hint: check.hint });
    if (!PHOTO_CATEGORIES.includes(photo_category)) {
      return res.status(400).json({
        error: 'invalid_photo_category',
        hint: 'Post photos can only be nature, animals, or groups of people — no single-person photos (use your profile picture for that).',
      });
    }
    photoData = photo_data;
    photoCategory = photo_category;
  }

  const userDefault = db.prepare('SELECT default_visibility FROM users WHERE id = ?').get(uid)?.default_visibility || 'public';
  const vis = VISIBILITIES.includes(visibility) ? visibility : userDefault;

  const id = randomUUID();
  db.prepare('INSERT INTO posts (id, user_id, content, workout_id, verse_id, visibility, photo_data, photo_category) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, uid, (content || '').toString().slice(0, 1000), workout_id || null, verse_id || null, vis, photoData, photoCategory);
  res.status(201).json({ id, visibility: vis, share_url: vis === 'public' ? `/w/${id}` : null });
});

// Community-enforcement report. No moderation queue/UI yet in this pass — this is
// a foundation for a future admin review flow, not a complete moderation system.
router.post('/posts/:id/report', requireAuth, (req, res) => {
  const post = db.prepare('SELECT id FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'not_found' });
  const reason = (req.body && req.body.reason ? String(req.body.reason) : '').trim().slice(0, 300);
  db.prepare('INSERT INTO post_reports (id, post_id, reporter_id, reason) VALUES (?, ?, ?, ?)')
    .run(randomUUID(), post.id, req.session.userId, reason || null);
  res.status(201).json({ ok: true });
});

// Change a post's visibility after the fact (author only).
router.patch('/posts/:id/visibility', requireAuth, (req, res) => {
  const { visibility } = req.body || {};
  if (!VISIBILITIES.includes(visibility)) return res.status(400).json({ error: 'invalid_visibility' });
  const post = db.prepare('SELECT user_id FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'not_found' });
  if (post.user_id !== req.session.userId) return res.status(403).json({ error: 'forbidden' });
  db.prepare('UPDATE posts SET visibility = ? WHERE id = ?').run(visibility, req.params.id);
  res.json({ ok: true, visibility, share_url: visibility === 'public' ? `/w/${req.params.id}` : null });
});

// ---- public, unauthenticated workout share (Strava-style activity link) ----
// Only PUBLIC posts are exposed, and only the author's display name — never the
// private profile fields (job/church/gym/age/email).
router.get('/public/post/:id', (req, res) => {
  const p = db.prepare(`
    SELECT p.id, p.content, p.created_at, p.visibility, u.display_name author,
           w.type workout_type, w.calories, w.avg_hr, w.max_hr, w.distance_km,
           w.start_time, w.end_time, w.gps_path,
           v.reference verse_reference, v.text verse_text
    FROM posts p
    JOIN users u ON u.id = p.user_id
    LEFT JOIN workouts w ON w.id = p.workout_id
    LEFT JOIN scripture_verses v ON v.id = p.verse_id
    WHERE p.id = ?
  `).get(req.params.id);

  if (!p || p.visibility !== 'public') return res.status(404).json({ error: 'not_found' });

  let route = null;
  if (p.gps_path) { try { route = JSON.parse(p.gps_path); } catch { route = null; } }

  let durationMin = null, pace = null, distanceKm = p.distance_km ?? null;
  if (p.start_time && p.end_time) durationMin = +(((new Date(p.end_time) - new Date(p.start_time)) / 60000).toFixed(1));
  if (distanceKm > 0 && durationMin > 0) pace = +(durationMin / distanceKm).toFixed(1);

  res.json({
    id: p.id,
    author: p.author,
    content: p.content,
    created_at: p.created_at,
    workout: p.workout_type ? {
      type: p.workout_type, calories: p.calories, avg_hr: p.avg_hr, max_hr: p.max_hr,
      distance_km: distanceKm, duration_min: durationMin, pace_min_per_km: pace,
    } : null,
    route,
    verse: p.verse_reference ? { reference: p.verse_reference, text: p.verse_text } : null,
  });
});

// ---- social graph: follow / discover / public profiles ----

// Follow or unfollow another user (toggles). Notifies the followee.
router.post('/users/:id/follow', requireAuth, (req, res) => {
  const me = req.session.userId;
  const target = req.params.id;
  if (target === me) return res.status(400).json({ error: 'cannot_follow_self' });
  const exists = db.prepare('SELECT 1 FROM users WHERE id = ?').get(target);
  if (!exists) return res.status(404).json({ error: 'user_not_found' });

  const already = db.prepare('SELECT 1 FROM followers WHERE follower_id = ? AND followee_id = ?').get(me, target);
  if (already) {
    db.prepare('DELETE FROM followers WHERE follower_id = ? AND followee_id = ?').run(me, target);
  } else {
    db.prepare('INSERT OR IGNORE INTO followers (follower_id, followee_id) VALUES (?, ?)').run(me, target);
    const meName = db.prepare('SELECT display_name FROM users WHERE id = ?').get(me)?.display_name || 'Someone';
    db.prepare('INSERT INTO notifications (id, user_id, type, payload) VALUES (?, ?, ?, ?)')
      .run(randomUUID(), target, 'follow', JSON.stringify({ follower_id: me, message: `${meName} started following you` }));
    publish('user.followed', { follower_id: me, followee_id: target });
  }
  const followers = db.prepare('SELECT COUNT(*) c FROM followers WHERE followee_id = ?').get(target).c;
  res.json({ following: !already, followers_count: followers });
});

// People to follow: users the viewer doesn't already follow (and isn't), ranked by
// follower count so there's always something to discover.
router.get('/users/suggested', requireAuth, (req, res) => {
  const me = req.session.userId;
  const rows = db.prepare(`
    SELECT u.id, u.display_name, u.bio_verse_ref,
           (SELECT COUNT(*) FROM followers f WHERE f.followee_id = u.id) AS followers_count
    FROM users u
    WHERE u.id != @me
      AND u.id NOT IN (SELECT followee_id FROM followers WHERE follower_id = @me)
    ORDER BY followers_count DESC, u.display_name
    LIMIT 12
  `).all({ me });
  res.json(rows);
});

// Public-facing profile for any user. Never exposes private fields (job/church/
// gym/age/email). Posts respect the viewer's visibility (public to all; followers
// if the viewer follows; everything if it's the viewer's own profile).
router.get('/users/:id', (req, res) => {
  const me = req.session.userId || null;
  const u = db.prepare(`
    SELECT id, display_name, bio_verse_ref, bio_verse_text, bio_link_url, bio_link_label,
           CASE WHEN avatar_data IS NOT NULL THEN 1 ELSE 0 END AS has_avatar
    FROM users WHERE id = ?
  `).get(req.params.id);
  if (!u) return res.status(404).json({ error: 'user_not_found' });

  const stats = {
    workouts: db.prepare("SELECT COUNT(*) c FROM workouts WHERE user_id = ? AND end_time IS NOT NULL").get(u.id).c,
    followers: db.prepare('SELECT COUNT(*) c FROM followers WHERE followee_id = ?').get(u.id).c,
    following: db.prepare('SELECT COUNT(*) c FROM followers WHERE follower_id = ?').get(u.id).c,
  };
  const is_me = me === u.id;
  const is_following = me ? !!db.prepare('SELECT 1 FROM followers WHERE follower_id = ? AND followee_id = ?').get(me, u.id) : false;

  const posts = db.prepare(`
    SELECT p.id, p.content, p.created_at, p.visibility, p.workout_id, p.photo_data, p.photo_category,
           w.type workout_type, w.calories, w.avg_hr, w.distance_km,
           v.reference verse_reference, v.text verse_text
    FROM posts p
    LEFT JOIN workouts w ON w.id = p.workout_id
    LEFT JOIN scripture_verses v ON v.id = p.verse_id
    WHERE p.user_id = @uid AND (
      p.visibility = 'public'
      OR @me = @uid
      OR (p.visibility = 'followers' AND EXISTS (SELECT 1 FROM followers f WHERE f.followee_id = @uid AND f.follower_id = @me)))
    ORDER BY p.created_at DESC LIMIT 20
  `).all({ uid: u.id, me });

  res.json({ user: u, stats, is_me, is_following, posts });
});

// ---- explore ----
router.get('/explore', (req, res) => {
  const groups = db.prepare('SELECT * FROM groups').all();
  const quests = db.prepare('SELECT * FROM quests').all();
  res.json({ groups, quests });
});

// ---- group detail: chat (polling) + run meetups with RSVP ----
function isGroupMember(groupId, userId) {
  return !!db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?').get(groupId, userId);
}

router.get('/groups/:id', requireAuth, (req, res) => {
  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.id);
  if (!group) return res.status(404).json({ error: 'not_found' });
  const memberCount = db.prepare('SELECT COUNT(*) c FROM group_members WHERE group_id = ?').get(group.id).c;
  const isMember = isGroupMember(group.id, req.session.userId);
  const messages = db.prepare(`
    SELECT m.id, m.content, m.created_at, m.user_id author_id, u.display_name author
    FROM group_messages m JOIN users u ON u.id = m.user_id
    WHERE m.group_id = ? ORDER BY m.created_at ASC LIMIT 50
  `).all(group.id);
  const events = db.prepare(`
    SELECT e.*,
      (SELECT COUNT(*) FROM event_rsvps r WHERE r.event_id = e.id AND r.status = 'going') going_count,
      (SELECT COUNT(*) FROM event_rsvps r WHERE r.event_id = e.id AND r.status = 'interested') interested_count,
      (SELECT status FROM event_rsvps r WHERE r.event_id = e.id AND r.user_id = @me) my_rsvp
    FROM group_events e
    WHERE e.group_id = @gid AND e.event_time >= datetime('now')
    ORDER BY e.event_time ASC
  `).all({ gid: group.id, me: req.session.userId });
  res.json({ group, member_count: memberCount, is_member: isMember, messages, events });
});

router.post('/groups/:id/join', requireAuth, (req, res) => {
  const group = db.prepare('SELECT id FROM groups WHERE id = ?').get(req.params.id);
  if (!group) return res.status(404).json({ error: 'not_found' });
  db.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)').run(group.id, req.session.userId);
  res.json({ ok: true });
});

router.post('/groups/:id/leave', requireAuth, (req, res) => {
  db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(req.params.id, req.session.userId);
  res.json({ ok: true });
});

router.get('/groups/:id/messages', requireAuth, (req, res) => {
  const group = db.prepare('SELECT id FROM groups WHERE id = ?').get(req.params.id);
  if (!group) return res.status(404).json({ error: 'not_found' });
  if (!isGroupMember(group.id, req.session.userId)) return res.status(403).json({ error: 'not_a_member' });
  const { after } = req.query;
  let rows;
  if (after) {
    rows = db.prepare(`
      SELECT m.id, m.content, m.created_at, m.user_id author_id, u.display_name author
      FROM group_messages m JOIN users u ON u.id = m.user_id
      WHERE m.group_id = ? AND m.created_at > ? ORDER BY m.created_at ASC
    `).all(group.id, after);
  } else {
    rows = db.prepare(`
      SELECT m.id, m.content, m.created_at, m.user_id author_id, u.display_name author
      FROM group_messages m JOIN users u ON u.id = m.user_id
      WHERE m.group_id = ? ORDER BY m.created_at ASC LIMIT 50
    `).all(group.id);
  }
  res.json(rows);
});

router.post('/groups/:id/messages', requireAuth, (req, res) => {
  const group = db.prepare('SELECT id FROM groups WHERE id = ?').get(req.params.id);
  if (!group) return res.status(404).json({ error: 'not_found' });
  if (!isGroupMember(group.id, req.session.userId)) return res.status(403).json({ error: 'not_a_member' });
  const { content } = req.body || {};
  if (!content || !content.trim()) return res.status(400).json({ error: 'empty_message' });
  const trimmed = content.trim().slice(0, 1000);
  const id = randomUUID();
  db.prepare('INSERT INTO group_messages (id, group_id, user_id, content) VALUES (?, ?, ?, ?)').run(id, group.id, req.session.userId, trimmed);
  const message = db.prepare(`
    SELECT m.id, m.content, m.created_at, m.user_id author_id, u.display_name author
    FROM group_messages m JOIN users u ON u.id = m.user_id WHERE m.id = ?
  `).get(id);
  res.json(message);
});

router.post('/groups/:id/events', requireAuth, (req, res) => {
  const group = db.prepare('SELECT id FROM groups WHERE id = ?').get(req.params.id);
  if (!group) return res.status(404).json({ error: 'not_found' });
  if (!isGroupMember(group.id, req.session.userId)) return res.status(403).json({ error: 'not_a_member' });
  const { title, description, activity_type, event_time, location_name, lat, lng } = req.body || {};
  if (!title || !title.trim()) return res.status(400).json({ error: 'title_required' });
  if (!event_time) return res.status(400).json({ error: 'event_time_required' });
  const t = new Date(event_time);
  if (isNaN(t.getTime())) return res.status(400).json({ error: 'invalid_event_time' });
  const id = randomUUID();
  db.prepare(`
    INSERT INTO group_events (id, group_id, creator_id, title, description, activity_type, event_time, location_name, lat, lng)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, group.id, req.session.userId, title.trim(), description || null, activity_type || null, t.toISOString(), location_name || null, lat ?? null, lng ?? null);
  const event = db.prepare('SELECT * FROM group_events WHERE id = ?').get(id);
  res.status(201).json({ ...event, going_count: 0, interested_count: 0, my_rsvp: null });
});

router.get('/groups/:id/events', requireAuth, (req, res) => {
  const group = db.prepare('SELECT id FROM groups WHERE id = ?').get(req.params.id);
  if (!group) return res.status(404).json({ error: 'not_found' });
  const events = db.prepare(`
    SELECT e.*,
      (SELECT COUNT(*) FROM event_rsvps r WHERE r.event_id = e.id AND r.status = 'going') going_count,
      (SELECT COUNT(*) FROM event_rsvps r WHERE r.event_id = e.id AND r.status = 'interested') interested_count,
      (SELECT status FROM event_rsvps r WHERE r.event_id = e.id AND r.user_id = @me) my_rsvp
    FROM group_events e
    WHERE e.group_id = @gid AND e.event_time >= datetime('now')
    ORDER BY e.event_time ASC
  `).all({ gid: group.id, me: req.session.userId });
  res.json(events);
});

router.post('/events/:id/rsvp', requireAuth, (req, res) => {
  const event = db.prepare('SELECT id FROM group_events WHERE id = ?').get(req.params.id);
  if (!event) return res.status(404).json({ error: 'not_found' });
  const { status } = req.body || {};
  if (status === 'going' || status === 'interested') {
    db.prepare(`
      INSERT INTO event_rsvps (event_id, user_id, status) VALUES (?, ?, ?)
      ON CONFLICT(event_id, user_id) DO UPDATE SET status = excluded.status
    `).run(event.id, req.session.userId, status);
  } else {
    db.prepare('DELETE FROM event_rsvps WHERE event_id = ? AND user_id = ?').run(event.id, req.session.userId);
  }
  const goingCount = db.prepare("SELECT COUNT(*) c FROM event_rsvps WHERE event_id = ? AND status = 'going'").get(event.id).c;
  const interestedCount = db.prepare("SELECT COUNT(*) c FROM event_rsvps WHERE event_id = ? AND status = 'interested'").get(event.id).c;
  res.json({ ok: true, going_count: goingCount, interested_count: interestedCount, my_rsvp: (status === 'going' || status === 'interested') ? status : null });
});

// ---- themed challenges ----
router.get('/challenges', (req, res) => {
  const me = req.session.userId || null;
  const rows = db.prepare(`
    SELECT c.*, uc.progress, uc.joined_at, uc.completed_at,
           (SELECT COUNT(*) FROM user_challenges u WHERE u.challenge_id = c.id) AS participants
    FROM challenges c
    LEFT JOIN user_challenges uc ON uc.challenge_id = c.id AND uc.user_id = @me
    ORDER BY c.target
  `).all({ me });
  res.json(rows.map(c => ({
    ...c,
    joined: !!c.joined_at,
    progress: c.progress || 0,
    percent: Math.min(100, Math.round(((c.progress || 0) / c.target) * 100)),
    completed: !!c.completed_at,
  })));
});

router.post('/challenges/:id/join', requireAuth, (req, res) => {
  const c = db.prepare('SELECT id FROM challenges WHERE id = ? OR key = ?').get(req.params.id, req.params.id);
  if (!c) return res.status(404).json({ error: 'challenge_not_found' });
  db.prepare('INSERT OR IGNORE INTO user_challenges (user_id, challenge_id, progress) VALUES (?, ?, 0)').run(req.session.userId, c.id);
  res.status(201).json({ ok: true, challenge_id: c.id });
});

router.post('/challenges/:id/leave', requireAuth, (req, res) => {
  const c = db.prepare('SELECT id FROM challenges WHERE id = ? OR key = ?').get(req.params.id, req.params.id);
  if (!c) return res.status(404).json({ error: 'challenge_not_found' });
  db.prepare('DELETE FROM user_challenges WHERE user_id = ? AND challenge_id = ?').run(req.session.userId, c.id);
  res.json({ ok: true });
});

// ---- analytics: fast, aggregated workout data for the Stats dashboard ----
function completedWorkouts(uid) {
  return db.prepare("SELECT type, calories, avg_hr, max_hr, distance_km, duration_sec, start_time, end_time FROM workouts WHERE user_id = ? AND end_time IS NOT NULL").all(uid);
}

router.get('/stats/summary', requireAuth, (req, res) => {
  const uid = req.session.userId;
  const ws = completedWorkouts(uid);
  const now = Date.now();
  const dur = w => Number(w.duration_sec) || (w.start_time && w.end_time ? Math.max(0, (new Date(w.end_time) - new Date(w.start_time)) / 1000) : 0);
  const sum = (arr, f) => arr.reduce((a, w) => a + (f(w) || 0), 0);
  const within = (days) => ws.filter(w => (now - new Date(w.end_time).getTime()) <= days * 86400000);

  const totals = (arr) => ({
    workouts: arr.length,
    distance_km: +sum(arr, w => w.distance_km).toFixed(2),
    duration_min: Math.round(sum(arr, dur) / 60),
    calories: Math.round(sum(arr, w => w.calories)),
  });

  // Streak: consecutive days (ending today or yesterday) with at least one workout.
  const days = new Set(ws.map(w => new Date(w.end_time).toISOString().slice(0, 10)));
  let streak = 0; let d = new Date();
  const iso = (dt) => dt.toISOString().slice(0, 10);
  if (!days.has(iso(d))) d.setDate(d.getDate() - 1); // allow streak to count through yesterday
  while (days.has(iso(d))) { streak++; d.setDate(d.getDate() - 1); }

  // Personal records.
  const withDist = ws.filter(w => w.distance_km > 0);
  const pace = w => (w.distance_km > 0 && dur(w) > 0) ? (dur(w) / 60) / w.distance_km : null;
  const best = (arr, f) => arr.reduce((b, w) => (f(w) != null && (b == null || f(w) > f(b)) ? w : b), null);
  const longest = best(withDist, w => w.distance_km);
  const longestTime = best(ws, dur);
  const fastest = withDist.filter(w => pace(w)).sort((a, b) => pace(a) - pace(b))[0] || null;

  res.json({
    lifetime: totals(ws),
    this_week: totals(within(7)),
    this_month: totals(within(30)),
    streak_days: streak,
    active_days: days.size,
    records: {
      longest_distance_km: longest ? +longest.distance_km.toFixed(2) : null,
      longest_duration_min: longestTime ? Math.round(dur(longestTime) / 60) : null,
      fastest_pace_min_km: fastest ? +pace(fastest).toFixed(2) : null,
      most_calories: ws.length ? Math.max(...ws.map(w => w.calories || 0)) : null,
      highest_hr: ws.length ? Math.max(...ws.map(w => w.max_hr || 0)) || null : null,
    },
  });
});

router.get('/stats/trends', requireAuth, (req, res) => {
  const uid = req.session.userId;
  const weeks = Math.min(52, Math.max(4, Number(req.query.weeks) || 12));
  const ws = completedWorkouts(uid);
  const dur = w => (Number(w.duration_sec) || (w.start_time && w.end_time ? Math.max(0, (new Date(w.end_time) - new Date(w.start_time)) / 1000) : 0));
  const now = new Date();
  // Build week buckets ending today, going back `weeks` weeks (Mon-anchored not needed — rolling 7-day windows).
  const buckets = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const end = new Date(now); end.setDate(end.getDate() - i * 7);
    const start = new Date(end); start.setDate(start.getDate() - 7);
    buckets.push({ start, end, label: end.toISOString().slice(5, 10), workouts: 0, distance_km: 0, duration_min: 0, calories: 0 });
  }
  for (const w of ws) {
    const t = new Date(w.end_time).getTime();
    for (const b of buckets) {
      if (t > b.start.getTime() && t <= b.end.getTime()) {
        b.workouts++; b.distance_km += w.distance_km || 0; b.duration_min += dur(w) / 60; b.calories += w.calories || 0; break;
      }
    }
  }
  res.json(buckets.map(b => ({ label: b.label, workouts: b.workouts, distance_km: +b.distance_km.toFixed(2), duration_min: Math.round(b.duration_min), calories: Math.round(b.calories) })));
});

router.get('/stats/activity-breakdown', requireAuth, (req, res) => {
  const uid = req.session.userId;
  const rows = db.prepare(`
    SELECT type,
           COUNT(*) count,
           COALESCE(SUM(distance_km),0) distance_km,
           COALESCE(SUM(duration_sec),0) duration_sec,
           COALESCE(SUM(calories),0) calories
    FROM workouts WHERE user_id = ? AND end_time IS NOT NULL
    GROUP BY type ORDER BY count DESC
  `).all(uid);
  res.json(rows.map(r => ({ type: r.type, count: r.count, distance_km: +Number(r.distance_km).toFixed(2), duration_min: Math.round(r.duration_sec / 60), calories: r.calories })));
});

// ---- tailored recommendations (verse + podcast + challenge) ----
router.get('/recommendations', (req, res) => {
  const uid = req.session.userId || null;
  // Pick a theme from the user's most recent activity, else a default rotation.
  let theme = 'strength';
  if (uid) {
    const last = db.prepare("SELECT type FROM workouts WHERE user_id = ? AND end_time IS NOT NULL ORDER BY end_time DESC LIMIT 1").get(uid);
    const map = { Run: 'perseverance', 'Trail Run': 'endurance', Hike: 'endurance', Walk: 'peace', Cycle: 'endurance', Swim: 'renewal', Yoga: 'peace', Pilates: 'peace', Strength: 'strength', HIIT: 'strength', Climbing: 'courage', Row: 'perseverance' };
    if (last) theme = map[last.type] || 'strength';
  }
  // A verse from the real library (deterministic-ish pick by theme keyword search).
  const kw = { perseverance: 'run', endurance: 'strength', peace: 'peace', renewal: 'renew', strength: 'strength', courage: 'courage' }[theme] || 'strength';
  const verseRow = db.prepare(`
    SELECT bv.book, bv.chapter, bv.verse, bv.text FROM bible_verses_fts f
    JOIN bible_verses bv ON bv.rowid = f.rowid WHERE bible_verses_fts MATCH ? ORDER BY RANDOM() LIMIT 1
  `).get(`${kw}*`) || db.prepare('SELECT book, chapter, verse, text FROM bible_verses ORDER BY RANDOM() LIMIT 1').get();
  const verse = verseRow ? { reference: `${verseRow.book} ${verseRow.chapter}:${verseRow.verse}`, text: verseRow.text } : null;

  // A recent podcast episode.
  const ep = db.prepare(`
    SELECT p.title show, e.title, e.audio_url, e.link, e.duration_sec
    FROM podcast_episodes e JOIN podcasts p ON p.id = e.podcast_id
    ORDER BY (e.published_at IS NULL), e.published_at DESC LIMIT 20
  `).all();
  const podcast = ep.length ? ep[Math.floor((verseRow ? verseRow.verse : 0) % ep.length)] : null;

  // A challenge suggestion the user hasn't joined.
  let challenge = null;
  if (uid) {
    challenge = db.prepare(`
      SELECT c.key, c.name, c.description, c.scripture_ref FROM challenges c
      WHERE c.id NOT IN (SELECT challenge_id FROM user_challenges WHERE user_id = ?)
      ORDER BY c.target LIMIT 1`).get(uid);
  }
  res.json({ theme, verse, podcast, challenge });
});

// ---- transparent data export: everything we hold on the signed-in user ----
router.get('/me/export', requireAuth, (req, res) => {
  const uid = req.session.userId;
  const { password_hash, ...profile } = db.prepare('SELECT * FROM users WHERE id = ?').get(uid) || {};
  const data = {
    exported_at: new Date().toISOString(),
    note: 'This is all the data FitFaith holds about your account. Email is included because this is your own export.',
    profile,
    workouts: db.prepare('SELECT * FROM workouts WHERE user_id = ?').all(uid),
    biometric_samples: db.prepare('SELECT * FROM biometric_samples WHERE user_id = ?').all(uid),
    posts: db.prepare('SELECT * FROM posts WHERE user_id = ?').all(uid),
    comments: db.prepare('SELECT * FROM post_comments WHERE user_id = ?').all(uid),
    followers: db.prepare('SELECT follower_id FROM followers WHERE followee_id = ?').all(uid),
    following: db.prepare('SELECT followee_id FROM followers WHERE follower_id = ?').all(uid),
    consents: db.prepare('SELECT scope, granted_at, revoked_at FROM user_consents WHERE user_id = ?').all(uid),
    challenges: db.prepare('SELECT * FROM user_challenges WHERE user_id = ?').all(uid),
    xp: db.prepare('SELECT * FROM user_xp WHERE user_id = ?').get(uid),
    badges: db.prepare('SELECT badge_id, earned_at FROM user_badges WHERE user_id = ?').all(uid),
  };
  res.setHeader('Content-Disposition', 'attachment; filename="fitfaith-my-data.json"');
  res.json(data);
});

// ---- notifications ----
router.get('/notifications', requireAuth, (req, res) => {
  const uid = req.session.userId;
  const notifications = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY delivered_at DESC LIMIT 20').all(uid);
  const unread_count = db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND read = 0').get(uid).c;
  res.json({ notifications, unread_count });
});

router.post('/notifications/:id/read', requireAuth, (req, res) => {
  const info = db.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.session.userId);
  if (info.changes === 0) return res.status(404).json({ error: 'notification_not_found' });
  res.json({ ok: true });
});

router.post('/notifications/read-all', requireAuth, (req, res) => {
  db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0').run(req.session.userId);
  res.json({ ok: true });
});

// Lightweight unread-count-only endpoint — for polling from the topbar bell
// without pulling the full notification list each time.
router.get('/notifications/unread-count', requireAuth, (req, res) => {
  const count = db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND read = 0').get(req.session.userId).c;
  res.json({ count });
});

// ---- weekly leaderboard: current user + everyone they follow, ranked by a
// chosen metric over the current week. Mirrors /stats/summary's this_week
// window (rolling 7 days ending now, keyed off end_time) for consistency.
const LEADERBOARD_METRICS = new Set(['distance_km', 'duration_min', 'workouts']);
router.get('/leaderboard', requireAuth, (req, res) => {
  const uid = req.session.userId;
  const metric = LEADERBOARD_METRICS.has(req.query.metric) ? req.query.metric : 'distance_km';
  const days = 7;
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();

  const memberIds = [uid, ...db.prepare('SELECT followee_id FROM followers WHERE follower_id = ?').all(uid).map(r => r.followee_id)];
  const placeholders = memberIds.map(() => '?').join(',');
  const users = db.prepare(`SELECT id, display_name FROM users WHERE id IN (${placeholders})`).all(...memberIds);

  const dur = w => Number(w.duration_sec) || (w.start_time && w.end_time ? Math.max(0, (new Date(w.end_time) - new Date(w.start_time)) / 1000) : 0);
  const valueFor = (memberId) => {
    const ws = db.prepare(`
      SELECT distance_km, duration_sec, start_time, end_time FROM workouts
      WHERE user_id = ? AND end_time IS NOT NULL AND end_time >= ?
    `).all(memberId, cutoff);
    if (metric === 'distance_km') return +ws.reduce((a, w) => a + (Number(w.distance_km) || 0), 0).toFixed(2);
    if (metric === 'duration_min') return Math.round(ws.reduce((a, w) => a + dur(w), 0) / 60);
    return ws.length; // workouts
  };

  const ranked = users
    .map(u => ({ user_id: u.id, display_name: u.display_name, value: valueFor(u.id), is_me: u.id === uid }))
    .sort((a, b) => b.value - a.value)
    .map((row, i) => ({ ...row, rank: i + 1 }));

  res.json(ranked);
});

// ---- gamification + notification event handlers (in-process, mirrors the Kafka consumers) ----
subscribe('workout.completed', (event) => {
  const xp = xpForEvent('workout.completed');
  const current = db.prepare('SELECT * FROM user_xp WHERE user_id = ?').get(event.user_id) || { xp: 0 };
  const newXp = current.xp + xp;
  const newLevel = levelForXp(newXp);
  db.prepare("INSERT INTO user_xp (user_id, xp, level, updated_at) VALUES (?, ?, ?, datetime('now')) ON CONFLICT(user_id) DO UPDATE SET xp=excluded.xp, level=excluded.level, updated_at=excluded.updated_at")
    .run(event.user_id, newXp, newLevel);

  const workoutCount = db.prepare("SELECT COUNT(*) c FROM workouts WHERE user_id = ? AND end_time IS NOT NULL").get(event.user_id).c;
  const verseCount = db.prepare('SELECT COUNT(*) c FROM scripture_triggers WHERE user_id = ?').get(event.user_id).c;
  const groupCount = db.prepare('SELECT COUNT(*) c FROM group_members WHERE user_id = ?').get(event.user_id).c;
  const earned = badgeEligibility({ workoutsCompleted: workoutCount, versesEngaged: verseCount, groupsJoined: groupCount });
  earned.forEach(badgeId => {
    const already = db.prepare('SELECT 1 FROM user_badges WHERE user_id = ? AND badge_id = ?').get(event.user_id, badgeId);
    if (!already) {
      db.prepare('INSERT INTO user_badges (user_id, badge_id) VALUES (?, ?)').run(event.user_id, badgeId);
      publish('badge.awarded', { user_id: event.user_id, badge_id: badgeId });
    }
  });

  // quest progress
  const quests = db.prepare('SELECT * FROM quests').all();
  quests.forEach(q => {
    const uq = db.prepare('SELECT * FROM user_quests WHERE user_id = ? AND quest_id = ?').get(event.user_id, q.id);
    if (!uq || uq.completed) return;
    const { progress, completed } = advanceQuestProgress(q, JSON.parse(uq.progress || '{}'), event);
    db.prepare('UPDATE user_quests SET progress = ?, completed = ? WHERE user_id = ? AND quest_id = ?')
      .run(JSON.stringify(progress), completed ? 1 : 0, event.user_id, q.id);
    if (completed) publish('quest.progress', { user_id: event.user_id, quest_id: q.id, progress, completed: true });
  });
});

['verse.triggered', 'badge.awarded', 'quest.progress'].forEach(topic => {
  subscribe(topic, (event) => {
    const message = composeForEvent(topic, event);
    db.prepare('INSERT INTO notifications (id, user_id, type, payload) VALUES (?, ?, ?, ?)')
      .run(randomUUID(), event.user_id, message.type, JSON.stringify(message));
  });
});

// ---- motivation / podcasts / breathing (new social+wellness surfaces) ----
router.get('/motivation', (req, res) => {
  const rows = db.prepare('SELECT * FROM motivation_quotes').all();
  res.json(rows[Math.floor(Math.random() * rows.length)]);
});

// Podcasts with their most-recent real episodes (ingested from public RSS feeds).
router.get('/podcasts', (req, res) => {
  const limit = Math.min(20, Math.max(1, Number(req.query.episodes) || 5));
  const podcasts = db.prepare('SELECT id, title, host, description, theme, feed_url, artwork_url, last_fetched FROM podcasts ORDER BY title').all();
  const epStmt = db.prepare(`
    SELECT id, title, description, audio_url, link, duration_sec, published_at
    FROM podcast_episodes WHERE podcast_id = ?
    ORDER BY (published_at IS NULL), published_at DESC LIMIT ?
  `);
  res.json(podcasts.map(p => ({ ...p, episodes: epStmt.all(p.id, limit) })));
});

router.post('/breathing/complete', requireAuth, (req, res) => {
  const { pattern = 'box', duration_sec = 60 } = req.body || {};
  db.prepare('INSERT INTO breathing_sessions (id, user_id, pattern, duration_sec) VALUES (?, ?, ?, ?)')
    .run(randomUUID(), req.session.userId, pattern, duration_sec);
  publish('workout.completed', { user_id: req.session.userId, workout_id: null, calories: 0, avg_hr: null, max_hr: null, kind: 'breathing' });
  res.json({ ok: true });
});


// ---- Secure profile: bio is restricted to a real Bible verse only. ----
// Allowed free-text fields are limited to job, church, fitness_group, gym.
// Age is optional and hidden by default (show_age).
const ALLOWED_PROFILE_FIELDS = ['job', 'church', 'fitness_group', 'gym'];
const MAX_FIELD_LEN = 80;

router.put('/profile', requireAuth, (req, res) => {
  const uid = req.session.userId;
  const { display_name, bio_verse_ref, job, church, fitness_group, gym, age, show_age, avatar_data, bio_link_url } = req.body || {};

  const updates = {};

  if (avatar_data !== undefined) {
    if (avatar_data === null) {
      updates.avatar_data = null;
      updates.avatar_updated_at = null;
    } else {
      const check = validateDataUrlImage(avatar_data);
      if (!check.ok) return res.status(400).json({ error: check.error, hint: check.hint });
      updates.avatar_data = avatar_data;
      updates.avatar_updated_at = new Date().toISOString();
    }
  }

  if (bio_link_url !== undefined) {
    if (bio_link_url === null || bio_link_url === '') {
      updates.bio_link_url = null;
      updates.bio_link_label = null;
    } else {
      const label = matchBioLinkLabel(String(bio_link_url).trim());
      if (!label) {
        return res.status(400).json({
          error: 'link_not_allowed',
          hint: 'Only LinkedIn or fundraiser links (GoFundMe, JustGiving, Classy, Fundly, GiveSendGo) are allowed in your bio.',
        });
      }
      updates.bio_link_url = String(bio_link_url).trim();
      updates.bio_link_label = label;
    }
  }

  if (display_name !== undefined) {
    const name = String(display_name).trim().slice(0, 60);
    if (!name) return res.status(400).json({ error: 'invalid_display_name' });
    updates.display_name = name;
  }

  // Bio must match a verse actually present in our verified bible_verses table —
  // never freeform text, and never fabricated/unverified scripture.
  if (bio_verse_ref !== undefined) {
    if (bio_verse_ref === null || bio_verse_ref === '') {
      updates.bio_verse_ref = null;
      updates.bio_verse_text = null;
    } else {
      const ref = String(bio_verse_ref).trim();
      const m = ref.match(/^(.+?)\s+(\d+):(\d+)$/);
      if (!m) return res.status(400).json({ error: 'invalid_verse_format', hint: 'Use "Book Chapter:Verse", e.g. "Philippians 4:13"' });
      const [, book, chapter, verse] = m;
      const row = db.prepare('SELECT text, book, chapter, verse, translation FROM bible_verses WHERE book = ? AND chapter = ? AND verse = ?')
        .get(book.trim(), Number(chapter), Number(verse));
      if (!row) return res.status(400).json({ error: 'verse_not_found', hint: 'That verse is not yet in our verified library. Try another reference.' });
      updates.bio_verse_ref = `${row.book} ${row.chapter}:${row.verse}`;
      updates.bio_verse_text = row.text;
    }
  }

  for (const field of ALLOWED_PROFILE_FIELDS) {
    const val = req.body ? req.body[field] : undefined;
    if (val !== undefined) {
      updates[field] = val === null ? null : String(val).trim().slice(0, MAX_FIELD_LEN);
    }
  }

  if (age !== undefined) {
    if (age === null || age === '') {
      updates.age = null;
    } else {
      const n = Number(age);
      if (!Number.isInteger(n) || n < 13 || n > 120) return res.status(400).json({ error: 'invalid_age' });
      updates.age = n;
    }
  }

  if (show_age !== undefined) updates.show_age = show_age ? 1 : 0;

  if (req.body && req.body.default_visibility !== undefined) {
    if (!VISIBILITIES.includes(req.body.default_visibility)) return res.status(400).json({ error: 'invalid_visibility' });
    updates.default_visibility = req.body.default_visibility;
  }

  // Location-based church selection (a real place picked from /api/churches/search
  // results, distinct from the free-text `church` field which stays as a manual
  // fallback). Clearing is supported by passing church_osm_id: null.
  if (req.body && req.body.church_osm_id !== undefined) {
    if (req.body.church_osm_id === null) {
      updates.church_osm_id = null;
      updates.church_name = null;
      updates.church_lat = null;
      updates.church_lng = null;
      updates.church_address = null;
    } else {
      const osmId = String(req.body.church_osm_id).trim().slice(0, 40);
      const name = String(req.body.church_name || '').trim().slice(0, 120);
      const lat = Number(req.body.church_lat);
      const lng = Number(req.body.church_lng);
      if (!osmId || !name) return res.status(400).json({ error: 'invalid_church' });
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: 'invalid_church_location' });
      updates.church_osm_id = osmId;
      updates.church_name = name;
      updates.church_lat = lat;
      updates.church_lng = lng;
      updates.church_address = req.body.church_address ? String(req.body.church_address).trim().slice(0, 200) : null;
    }
  }

  const keys = Object.keys(updates);
  if (!keys.length) return res.status(400).json({ error: 'no_fields' });

  const setClause = keys.map(k => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE users SET ${setClause} WHERE id = @id`).run({ ...updates, id: uid });

  const { password_hash, email, ...safeUser } = db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
  res.json({ ok: true, user: safeUser });
});

// ---- Bible: real, public-domain (KJV/WEB) text, FTS5-backed fast search. ----
// Coverage is a verified public-domain subset, expanding over time. See the live
// /api/bible/coverage endpoint for the exact books/chapters currently loaded —
// never hardcode a coverage claim here, it drifts. Ingestion: scripts/ingest-bible.js.
router.get('/bible/passage/:book/:chapter', (req, res) => {
  const { book, chapter } = req.params;
  const rows = db.prepare('SELECT book, chapter, verse, text, translation FROM bible_verses WHERE book = ? AND chapter = ? ORDER BY verse')
    .all(book, Number(chapter));
  if (!rows.length) return res.status(404).json({ error: 'not_found', hint: 'This chapter is not yet in our verified library.' });
  res.json({ book, chapter: Number(chapter), translation: rows[0].translation, verses: rows });
});

router.get('/bible/search', (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'missing_query' });
  // Prefix-match each word so partial terms like "streng" still find "strengtheneth".
  const ftsQuery = q.replace(/["*]/g, '').trim().split(/\s+/).map(w => `${w}*`).join(' ');

  // Pagination — result volume grows with coverage, so cap per-page and expose total.
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const page = Math.max(1, Number(req.query.page) || 1);
  const offset = (page - 1) * limit;

  const total = db.prepare(`
    SELECT COUNT(*) c FROM bible_verses_fts WHERE bible_verses_fts MATCH ?
  `).get(ftsQuery).c;

  const rows = db.prepare(`
    SELECT bv.book, bv.chapter, bv.verse, bv.text, bv.translation
    FROM bible_verses_fts f
    JOIN bible_verses bv ON bv.rowid = f.rowid
    WHERE bible_verses_fts MATCH ?
    ORDER BY rank
    LIMIT ? OFFSET ?
  `).all(ftsQuery, limit, offset);

  res.json({ query: q, page, limit, total, count: rows.length, results: rows });
});

router.get('/bible/random', (req, res) => {
  const row = db.prepare('SELECT book, chapter, verse, text, translation FROM bible_verses ORDER BY RANDOM() LIMIT 1').get();
  if (!row) return res.status(404).json({ error: 'no_verses_loaded' });
  res.json(row);
});

router.get('/bible/coverage', (req, res) => {
  const rows = db.prepare('SELECT book, translation, MIN(chapter) min_ch, MAX(chapter) max_ch, COUNT(DISTINCT chapter) chapters, COUNT(*) verse_count FROM bible_verses GROUP BY book, translation ORDER BY book').all();
  const total = db.prepare('SELECT COUNT(*) c FROM bible_verses').get().c;
  res.json({ note: 'Verified public-domain subset (KJV/WEB via bible-api.com), not the full canon.', total_verses: total, books: rows.length, coverage: rows });
});

// ---- Location-based church discovery (free OpenStreetMap Overpass API, no key) ----
router.get('/churches/search', async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  const radiusKm = Math.min(50, Math.max(0.5, Number(req.query.radius_km) || 5));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: 'invalid_coordinates' });
  try {
    const results = await searchNearbyChurches({ lat, lng, radiusM: Math.round(radiusKm * 1000) });
    res.json(results);
  } catch (err) {
    console.error('[churches/search] error:', err.message);
    res.status(502).json({ error: 'search_failed', hint: 'Could not reach the church directory. Try again shortly.' });
  }
});

// ---- Church daily devotionals (YouTube, gated behind YOUTUBE_API_KEY) ----
router.get('/youtube/configured', (req, res) => {
  res.json({ configured: youtube.isConfigured() });
});

router.get('/youtube/search-channels', requireAuth, async (req, res) => {
  if (!youtube.isConfigured()) return res.status(404).json({ error: 'not_configured' });
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'missing_query' });
  try {
    const results = await youtube.searchChannels(q);
    res.json(results);
  } catch (err) {
    console.error('[youtube/search-channels] error:', err.message);
    res.status(502).json({ error: 'search_failed' });
  }
});

router.post('/churches/:osmId/link-youtube', requireAuth, (req, res) => {
  const osmId = req.params.osmId;
  const { channel_id, channel_title } = req.body || {};
  if (!youtube.isConfigured()) return res.status(404).json({ error: 'not_configured' });
  if (!channel_id) return res.status(400).json({ error: 'missing_channel_id' });

  // The requesting user's own profile is the source of truth for this osm_id's
  // name/lat/lng when the church row doesn't exist yet.
  const me = db.prepare('SELECT church_osm_id, church_name FROM users WHERE id = ?').get(req.session.userId);
  if (!me || me.church_osm_id !== osmId) return res.status(400).json({ error: 'church_not_on_profile', hint: 'Select this church on your profile before linking a channel.' });

  const existing = db.prepare('SELECT id FROM churches WHERE osm_id = ?').get(osmId);
  const title = channel_title ? String(channel_title).trim().slice(0, 120) : null;
  if (existing) {
    db.prepare('UPDATE churches SET youtube_channel_id = ?, youtube_channel_title = ? WHERE id = ?')
      .run(String(channel_id).trim(), title, existing.id);
  } else {
    db.prepare('INSERT INTO churches (id, osm_id, name, youtube_channel_id, youtube_channel_title) VALUES (?, ?, ?, ?, ?)')
      .run(randomUUID(), osmId, me.church_name, String(channel_id).trim(), title);
  }
  res.json({ ok: true });
});

router.get('/devotionals/today', requireAuth, (req, res) => {
  const me = db.prepare('SELECT church_osm_id FROM users WHERE id = ?').get(req.session.userId);
  if (!me || !me.church_osm_id) return res.json({ devotional: null });
  const church = db.prepare('SELECT id, name FROM churches WHERE osm_id = ?').get(me.church_osm_id);
  if (!church) return res.json({ devotional: null });
  const today = new Date().toISOString().slice(0, 10);
  const row = db.prepare('SELECT video_id, title, thumbnail_url, published_at FROM church_devotionals WHERE church_id = ? AND fetched_date = ?')
    .get(church.id, today);
  if (!row) return res.json({ devotional: null });
  res.json({ devotional: { ...row, church_name: church.name } });
});

// ---- Curated video library (real YouTube channels, gated behind YOUTUBE_API_KEY) ----
router.get('/videos', (req, res) => {
  const category = String(req.query.category || '').trim();
  const allowed = new Set(['kids', 'fitness', 'motivational']);
  if (!allowed.has(category)) return res.status(400).json({ error: 'invalid_category' });
  const rows = db.prepare(
    'SELECT video_id, title, description, thumbnail_url, channel_title, published_at FROM videos WHERE category = ? ORDER BY published_at DESC LIMIT 20'
  ).all(category);
  res.json(rows);
});

// ---- AI sermon summary ("10 minute podcast review") ----
// ISO week key, e.g. "2026-W28" — stable per calendar week (Mon-Sun, ISO 8601).
function isoWeekKey(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function getUserChurch(userId) {
  const me = db.prepare('SELECT church_osm_id FROM users WHERE id = ?').get(userId);
  if (!me || !me.church_osm_id) return null;
  return db.prepare('SELECT id, name, youtube_channel_id FROM churches WHERE osm_id = ?').get(me.church_osm_id) || null;
}

router.get('/church/service/this-week', requireAuth, (req, res) => {
  const church = getUserChurch(req.session.userId);
  if (!church) return res.json({ service: null });
  const week = isoWeekKey(new Date());
  const row = db.prepare('SELECT video_id, title, duration_sec, published_at, transcript FROM church_services WHERE church_id = ? AND fetched_week = ?')
    .get(church.id, week);
  res.json({ service: row || null });
});

// No LLM/AI summarization here by design — this app never calls the Claude/
// Anthropic API or any other paid LLM. This finds this week's real service
// video and fetches its real (auto-generated) caption track, so the client
// can read the actual transcript aloud via the browser's free Web Speech
// API. If no transcript exists, that's reported plainly, never faked.
router.post('/church/service/summarize', requireAuth, async (req, res) => {
  const church = getUserChurch(req.session.userId);
  if (!church) return res.status(400).json({ error: 'no_church', hint: 'Select a church on your profile first.' });
  if (!church.youtube_channel_id) return res.status(400).json({ error: 'no_youtube_channel', hint: 'Link your church\'s YouTube channel first.' });
  if (!youtube.isConfigured()) return res.status(404).json({ error: 'youtube_not_configured' });

  const week = isoWeekKey(new Date());
  let row = db.prepare('SELECT * FROM church_services WHERE church_id = ? AND fetched_week = ?').get(church.id, week);

  if (!row) {
    let video;
    try {
      video = await youtube.fetchWeeklyServiceVideo(church.youtube_channel_id);
    } catch (err) {
      console.error('[church/service/summarize] video lookup failed:', err.message);
      return res.status(502).json({ error: 'video_lookup_failed' });
    }
    if (!video) return res.status(404).json({ error: 'no_service_found', hint: 'No full-service video was found for this week yet.' });
    db.prepare(`
      INSERT INTO church_services (id, church_id, video_id, title, duration_sec, published_at, fetched_week)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(church_id, fetched_week) DO UPDATE SET
        video_id=excluded.video_id, title=excluded.title, duration_sec=excluded.duration_sec, published_at=excluded.published_at
    `).run(randomUUID(), church.id, video.videoId, video.title, video.durationSec, video.publishedAt, week);
    row = db.prepare('SELECT * FROM church_services WHERE church_id = ? AND fetched_week = ?').get(church.id, week);
  }

  let transcript = row.transcript;
  if (!transcript) {
    transcript = await sermonSummary.fetchTranscript(row.video_id);
    if (!transcript) return res.status(404).json({ error: 'no_transcript', hint: 'No captions were available for this week\'s service video.' });
    db.prepare('UPDATE church_services SET transcript = ? WHERE id = ?').run(transcript, row.id);
  }

  res.json({ transcript, video_title: row.title, duration_sec: row.duration_sec });
});

module.exports = router;
