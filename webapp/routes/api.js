const express = require('express');
const { randomUUID } = require('crypto');
const db = require('../lib/db');
const { publish, subscribe } = require('../lib/events');
const { runPipeline } = require('../lib/pipeline');
const { xpForEvent, levelForXp, levelProgress } = require('../lib/xp');
const effortLib = require('../lib/effort');
const { advanceQuestProgress } = require('../lib/quests');
const { badgeEligibility } = require('../lib/badges');
const { composeForEvent } = require('../lib/composer');
const { loadBibleData } = require('../lib/bible-load');
const { hashPassword, verifyPassword } = require('../lib/password');
const { ensureChallenges, applyWorkoutToChallenges } = require('../lib/challenges');
const { ensureJourneys, applyWorkoutToJourneys, advanceJourney, lookupScriptureText } = require('../lib/journeys');
const moments = require('../lib/moments');
const contexts = require('../lib/contexts');
const segments = require('../lib/segments');
const overlay = require('../lib/overlay');
const usernames = require('../lib/usernames');
const youversion = require('../lib/youversion');
const gloo = require('../lib/gloo');
const companion = require('../lib/companion');
const breathwork = require('../lib/breathwork');
const dms = require('../lib/dms');
const oauth = require('../lib/oauth');
const strava = require('../lib/strava');
const { searchNearbyChurches } = require('../lib/overpass');
const youtube = require('../lib/youtube');
const sermonSummary = require('../lib/sermon-summary');
const { fetchChurchWebsiteEmbeds, isHttpUrl } = require('../lib/church-website');
const webhooks = require('../lib/webhooks');

// Load real, public-domain Bible text (KJV/WEB) into bible_verses once at startup.
loadBibleData();
// Seed / refresh the themed challenge catalog.
ensureChallenges();
// Seed / refresh the Journeys catalog (virtual routes + waypoints).
ensureJourneys();

// Activities Functioning Faith can track. Kept server-side so the client and validation
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
  // Tradition is deliberately not public. A member sets it so scripture is
  // chosen for them in their own theology — that is a setting, not a badge, and
  // publishing someone's denomination to everyone who opens their profile is
  // not what they agreed to. /me adds it back for the member themselves.
  const { password_hash, email, tradition, ...rest } = row;
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

// ---- notifications: one place to create them, so every surface behaves the same ----
// Never notifies a user about their own action (self-kudos, own comment, etc.).
function notify(userId, type, message, extra) {
  if (!userId) return;
  db.prepare('INSERT INTO notifications (id, user_id, type, payload) VALUES (?, ?, ?, ?)')
    .run(randomUUID(), userId, type, JSON.stringify({ message, ...(extra || {}) }));
}
function displayName(userId) {
  return db.prepare('SELECT display_name FROM users WHERE id = ?').get(userId)?.display_name || 'Someone';
}

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

  // Names are unique, so people can be found and mentioned unambiguously.
  const nameCheck = usernames.check(name, null);
  if (nameCheck.error) return res.status(409).json(nameCheck);

  const id = randomUUID();
  db.prepare('INSERT INTO users (id, email, display_name, password_hash) VALUES (?, ?, ?, ?)')
    .run(id, mail, nameCheck.name, hashPassword(pw));
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
// primary way to use Functioning Faith. Only works for the pre-seeded demo emails.
router.post('/auth/demo', (req, res) => {
  const { user_id } = req.body || {};
  const user = db.prepare("SELECT * FROM users WHERE id = ? AND email LIKE '%@functioningfaith.demo'").get(user_id);
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
      const uniqueEmail = email || `${provider}-${claims.sub}@login.functioning-faith`;
      // A name clash must never be why somebody's Google sign-in fails, so this
      // path takes the nearest free variant instead of refusing.
      const chosen = usernames.suggest(String(name || 'Friend'), null);
      db.prepare('INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)').run(userId, uniqueEmail, chosen);
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
// Functioning Faith's own workout model (source='strava'). Idempotent — dedupes by
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
    SELECT id, display_name, bio_verse_ref FROM users WHERE email LIKE '%@functioningfaith.demo' ORDER BY display_name
  `).all());
});

// Back-compat: the old demo picker POSTed here. Route it through the demo path so
// existing sessions/clients keep working, but restrict to seeded demo accounts.
router.post('/session', (req, res) => {
  const { user_id } = req.body || {};
  const user = db.prepare("SELECT * FROM users WHERE id = ? AND email LIKE '%@functioningfaith.demo'").get(user_id);
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
  // Tradition is stripped by publicUser for everyone else; you can see your own.
  const user = { ...publicUser(userRow), tradition: userRow.tradition || null };
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
           p.show_route, p.route_privacy_m, w.gps_path,
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
    // Replace the raw trace with only what the author chose to publish, so the
    // full path never leaves the server on a post that did not opt in.
    const route = publishedRoute(p);
    delete p.gps_path;
    delete p.route_privacy_m;
    p.route = route;
    p.has_route = !!route;
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
    // Tell the author someone cheered them on — but never notify yourself.
    const post = db.prepare('SELECT user_id FROM posts WHERE id = ?').get(req.params.id);
    if (post && post.user_id !== req.session.userId) {
      notify(post.user_id, 'kudos', `${displayName(req.session.userId)} gave you kudos`, { post_id: req.params.id });
    }
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

  const post = db.prepare('SELECT user_id FROM posts WHERE id = ?').get(req.params.id);
  const snippet = content.trim().slice(0, 60);
  if (post && post.user_id !== req.session.userId) {
    notify(post.user_id, 'comment', `${displayName(req.session.userId)} commented: "${snippet}"`, { post_id: req.params.id });
  }
  // Conversation, not broadcast: everyone already in the thread hears the reply too.
  const others = db.prepare(`
    SELECT DISTINCT user_id FROM post_comments WHERE post_id = ? AND user_id != ? AND user_id != ?
  `).all(req.params.id, req.session.userId, post ? post.user_id : '');
  for (const o of others) {
    notify(o.user_id, 'comment', `${displayName(req.session.userId)} also replied: "${snippet}"`, { post_id: req.params.id });
  }
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
  // Heart rate is only ever a REAL reading from a paired monitor. When there is no
  // monitor the client sends nothing, and we store NULL — we never substitute a
  // default, and every zone/effort surface downstream degrades to "unknown".
  const rawHr = (req.body || {}).heart_rate;
  const rawStress = (req.body || {}).stress_level;
  const heart_rate = Number.isFinite(Number(rawHr)) && Number(rawHr) > 0 ? Math.round(Number(rawHr)) : null;
  const stress_level = Number.isFinite(Number(rawStress)) ? Math.round(Number(rawStress)) : null;
  const workout = db.prepare('SELECT * FROM workouts WHERE id = ? AND user_id = ?').get(req.params.id, req.session.userId);
  if (!workout) return res.status(404).json({ error: 'not_found' });
  db.prepare('INSERT INTO biometric_samples (id, user_id, workout_id, time, heart_rate, stress_level) VALUES (?, ?, ?, ?, ?, ?)')
    .run(randomUUID(), req.session.userId, workout.id, new Date().toISOString(), heart_rate, stress_level);

  // Run the real scripture trigger pipeline on this live biometric sample.
  const consents = db.prepare('SELECT scope FROM user_consents WHERE user_id = ? AND revoked_at IS NULL').all(req.session.userId).map(r => r.scope);
  const personalizationEnabled = consents.includes('scripture_personalization');
  const candidateVerses = db.prepare('SELECT id, reference, youversion_id, themes FROM scripture_verses').all()
    .map(v => ({ ...v, themes: v.themes.split(',') }));
  const history = db.prepare('SELECT verse_id FROM scripture_triggers WHERE user_id = ? ORDER BY timestamp DESC LIMIT 20').all(req.session.userId);

  // Real physiological signals for this instant: current zone (null if we can't know
  // it), HR direction, how deep into the session we are, and dwell in the current band.
  const maxInfo = effortLib.maxHrInfo(db.prepare('SELECT max_hr, birth_year FROM users WHERE id = ?').get(req.session.userId));
  const sessionSamples = db.prepare('SELECT time, heart_rate FROM biometric_samples WHERE workout_id = ? ORDER BY time').all(workout.id);
  const signals = computeEffortSignals(workout, sessionSamples, maxInfo && maxInfo.value, req.body || {});
  const sessionVerseIds = db.prepare('SELECT verse_id FROM scripture_triggers WHERE workout_id = ?').all(workout.id).map(r => r.verse_id);

  const result = runPipeline({
    rawSnapshot: { heart_rate, workout_type: workout.type, movement: { intensity: 0.8 }, stress_level: stress_level ?? 0 },
    candidateVerses,
    userHistory: history.map(h => ({ verse_id: h.verse_id, engaged: false })),
    userPreferences: {},
    personalizationEnabled,
    verseTextLookup: (yid) => db.prepare('SELECT text FROM scripture_verses WHERE youversion_id = ?').get(yid),
    effort: signals,
    lookupReference: lookupBibleReference,
    ftsSearch: bibleFtsSearch,
    sessionVerseIds,
    recentVerseIds: history.map(h => h.verse_id),
  });

  db.prepare('INSERT INTO scripture_triggers (id, user_id, verse_id, trigger_type, biometric_snapshot, workout_id, moment) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(randomUUID(), req.session.userId, result.verse.id, result.context, JSON.stringify({ ...result.snapshot, ...signals }), workout.id, result.moment);

  publish('verse.triggered', { user_id: req.session.userId, verse_id: result.verse.id, youversion_id: result.verse.youversion_id, trigger_type: result.context, payload: result.payload });

  res.json({
    context: result.context,
    verse: result.payload,
    verse_id: result.verse.id,
    moment: result.moment,
    moment_label: result.moment_label,
    caption: result.caption,
    zone: signals.zone,
    zone_source: signals.zone == null ? null : (maxInfo ? maxInfo.source : null),
    trend: signals.trend,
    elapsed_sec: signals.elapsed_sec,
  });
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

  // --- effort summary: what the body actually did in this session ---
  const maxInfo = effortLib.maxHrInfo(db.prepare('SELECT max_hr, birth_year FROM users WHERE id = ?').get(req.session.userId));
  const effort = effortLib.summariseEffort(samples, maxInfo && maxInfo.value, durationSec);
  const pbs = personalBestsFor(req.session.userId, workout.id);
  const encouragement = effortLib.describeEffort(effort, pbs);
  const notable = effortLib.notableEffort(effort, pbs);

  db.prepare("UPDATE workouts SET end_time = datetime('now'), avg_hr = ?, max_hr = ?, calories = ?, distance_km = ?, gps_points = ?, gps_path = ?, duration_sec = ?, effort_score = ?, time_in_zone = ?, peak_zone = ? WHERE id = ?")
    .run(avgHr, maxHr, calories, gps_distance_km || null, pointCount, pathJson, durationSec,
         effort.effort_score, effort.time_in_zone ? JSON.stringify(effort.time_in_zone) : null, effort.peak_zone, workout.id);

  // Only notify when a real comparison against real history says this was notable.
  if (notable) notify(req.session.userId, 'effort', notable.message, { workout_id: workout.id, effort_type: notable.type });

  publish('workout.completed', { user_id: req.session.userId, workout_id: workout.id, calories, avg_hr: avgHr, max_hr: maxHr });
  const completedChallenges = applyWorkoutToChallenges(req.session.userId, { distance_km: gps_distance_km || 0, duration_sec: durationSec, type: workout.type });
  notifyChallengeCompletions(req.session.userId, completedChallenges);
  notifyJourneyProgress(req.session.userId, applyWorkoutToJourneys(req.session.userId, { distance_km: gps_distance_km || 0, duration_sec: durationSec, type: workout.type }));
  const partners = tagWorkoutPartners(req.session.userId, workout.id, partner_user_ids);

  res.json({
    id: workout.id, calories, avg_hr: avgHr, max_hr: maxHr, distance_km: gps_distance_km || null, duration_sec: durationSec,
    completed_challenges: completedChallenges.map(c => c.name), partner_tag_errors: partners.errors,
    effort: {
      ...effort,
      max_hr_reference: maxInfo ? maxInfo.value : null,
      max_hr_source: maxInfo ? maxInfo.source : null,
      max_hr_formula: maxInfo ? maxInfo.formula || null : null,
    },
    encouragement,
  });
});

// Manually log a completed workout (Strava-style "add activity" — no live tracking).
// Personal bests for effort encouragement, computed over the caller's own
// history excluding the workout just saved, so "your longest this month" is a
// real comparison rather than a comparison with itself.
function personalBests(uid, excludeWorkoutId) {
  const agg = db.prepare(`SELECT MAX(effort_score) AS bestEffortScore,
                                 COUNT(*) AS priorSessionsWithZones
                          FROM workouts
                          WHERE user_id = ? AND id != ? AND time_in_zone IS NOT NULL`)
    .get(uid, excludeWorkoutId) || {};

  // Has this person ever been in zone 5 before today?
  const everRows = db.prepare(`SELECT time_in_zone FROM workouts
                               WHERE user_id = ? AND id != ? AND time_in_zone IS NOT NULL`)
    .all(uid, excludeWorkoutId);
  let everZone5 = false;
  for (const r of everRows) {
    let z; try { z = JSON.parse(r.time_in_zone); } catch { continue; }
    if ((Number(z && z[5]) || 0) > 0) { everZone5 = true; break; }
  }

  // Longest single session at zone 4+ in the last 30 days, for "your longest
  // hard effort" to be a true statement rather than a flourish.
  const monthRows = db.prepare(`SELECT time_in_zone FROM workouts
                                WHERE user_id = ? AND id != ?
                                  AND start_time >= datetime('now', '-30 days')
                                  AND time_in_zone IS NOT NULL`).all(uid, excludeWorkoutId);
  let bestZone45Sec = 0;
  for (const r of monthRows) {
    let z; try { z = JSON.parse(r.time_in_zone); } catch { continue; }
    bestZone45Sec = Math.max(bestZone45Sec, (Number(z && z[4]) || 0) + (Number(z && z[5]) || 0));
  }

  return {
    everZone5,
    bestZone45Sec,
    bestEffortScore: Number(agg.bestEffortScore) || 0,
    priorSessionsWithZones: Number(agg.priorSessionsWithZones) || 0,
  };
}

router.post('/workouts/manual', requireAuth, (req, res) => {
  const uid = req.session.userId;
  let { type = 'Run', duration_min, distance_km, calories, note, date, avg_hr, partner_user_ids, skip_journeys, hr_samples } = req.body || {};
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

  // Measured heart rate from a live session: store the samples, then derive
  // zones and a TRIMP-style effort score from them. Only ever populated when a
  // real monitor was streaming — nothing here is modelled from pace.
  let effortSummary = null;
  if (Array.isArray(hr_samples) && hr_samples.length) {
    const clean = hr_samples
      .map(x => ({ hr: Math.round(Number(x && x.hr)), at: Math.round(Number(x && x.at) || 0) }))
      .filter(x => Number.isFinite(x.hr) && x.hr > 0 && x.hr <= 250)
      .slice(0, 20000);
    if (clean.length) {
      const insertSample = db.prepare('INSERT INTO biometric_samples (id, user_id, workout_id, time, heart_rate, stress_level) VALUES (?, ?, ?, ?, ?, ?)');
      const startMs = new Date(start).getTime();
      db.exec('BEGIN');
      try {
        for (const smp of clean) {
          insertSample.run(randomUUID(), uid, id, new Date(startMs + smp.at * 1000).toISOString(), smp.hr, null);
        }
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }

      const me = db.prepare('SELECT max_hr, resting_hr, birth_year FROM users WHERE id = ?').get(uid);
      const maxHr = effortLib.estimatedMaxHr(me || {});
      effortSummary = effortLib.summariseEffort(
        clean.map(x => ({ heart_rate: x.hr, time: new Date(startMs + x.at * 1000).toISOString() })),
        maxHr, durSec);
      const avg = Math.round(clean.reduce((a, b) => a + b.hr, 0) / clean.length);
      const peak = clean.reduce((a, b) => Math.max(a, b.hr), 0);
      db.prepare('UPDATE workouts SET avg_hr = ?, max_hr = ?, effort_score = ?, time_in_zone = ?, peak_zone = ? WHERE id = ?')
        .run(avg, peak, effortSummary.effort_score, JSON.stringify(effortSummary.time_in_zone || {}),
             effortSummary.peak_zone || null, id);
      avg_hr = avg;
    }
  }

  publish('workout.completed', { user_id: uid, workout_id: id, calories: cal, avg_hr: avg_hr || null });
  const completed = applyWorkoutToChallenges(uid, { distance_km: dist || 0, duration_sec: durSec, type });
  notifyChallengeCompletions(uid, completed);
  // A live journey session already advanced its route kilometre-by-kilometre as
  // it was ridden, so re-applying the finished workout here would count the same
  // distance twice. The client sets skip_journeys for that case.
  if (!skip_journeys) notifyJourneyProgress(uid, applyWorkoutToJourneys(uid, { distance_km: dist || 0, duration_sec: durSec, type }));
  const partners = tagWorkoutPartners(uid, id, partner_user_ids);
  res.status(201).json({
    id, type, calories: cal, distance_km: dist, duration_sec: durSec,
    completed_challenges: completed.map(c => c.name),
    partner_tag_errors: partners.errors,
    // Encouragement that cites what actually happened, or nothing at all.
    effort: effortSummary || null,
    effort_note: effortSummary
      ? effortLib.describeEffort(effortSummary, personalBests(uid, id))
      : null,
  });
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
// --- Published routes -------------------------------------------------------
// A GPS trace is the most identifying thing a fitness app holds: it normally
// begins and ends at the author's front door. So it is published only when the
// author asked for it, and optionally with the ends trimmed.

function haversineMetres(a, b) {
  const R = 6371000, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]), dLng = toRad(b[1] - a[1]);
  const s1 = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s1)));
}

/** Drop the first and last `metres` of a trace. Returns null if nothing is left. */
function trimRoute(points, metres) {
  if (!Array.isArray(points) || points.length < 2) return null;
  const m = Math.max(0, Number(metres) || 0);
  if (!m) return points;

  const cum = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + haversineMetres(points[i - 1], points[i]));
  const total = cum[cum.length - 1];
  // Trimming both ends off a short route would leave nothing worth drawing.
  if (total <= m * 2.5) return null;
  const kept = points.filter((_, i) => cum[i] >= m && cum[i] <= total - m);
  return kept.length >= 2 ? kept : null;
}

/** The route to publish for a post, or null. Never invents one. */
function publishedRoute(post) {
  if (!post || !post.show_route || !post.gps_path) return null;
  let pts;
  try { pts = JSON.parse(post.gps_path); } catch { return null; }
  if (!Array.isArray(pts) || pts.length < 2) return null;
  return trimRoute(pts, post.route_privacy_m);
}

router.post('/posts', requireAuth, (req, res) => {
  const { content, workout_id, verse_id, visibility, photo_data, photo_category,
          show_route, route_privacy_m } = req.body || {};
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
  // The route is published only for the author's own workout, only when asked
  // for, and with a privacy trim capped to something sane.
  const wantsRoute = !!show_route && !!workout_id ? 1 : 0;
  const privacyM = Math.max(0, Math.min(1000, Math.round(Number(route_privacy_m) || 0)));

  db.prepare(`INSERT INTO posts (id, user_id, content, workout_id, verse_id, visibility,
              photo_data, photo_category, show_route, route_privacy_m)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, uid, (content || '').toString().slice(0, 1000), workout_id || null, verse_id || null, vis,
         photoData, photoCategory, wantsRoute, privacyM);
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
  const event = db.prepare('SELECT id, creator_id, title FROM group_events WHERE id = ?').get(req.params.id);
  if (!event) return res.status(404).json({ error: 'not_found' });
  const { status } = req.body || {};
  if (status === 'going' || status === 'interested') {
    const had = db.prepare('SELECT status FROM event_rsvps WHERE event_id = ? AND user_id = ?').get(event.id, req.session.userId);
    db.prepare(`
      INSERT INTO event_rsvps (event_id, user_id, status) VALUES (?, ?, ?)
      ON CONFLICT(event_id, user_id) DO UPDATE SET status = excluded.status
    `).run(event.id, req.session.userId, status);
    // Let the organiser know someone's coming (only on a real change, not a re-click).
    if (event.creator_id !== req.session.userId && (!had || had.status !== status)) {
      const verb = status === 'going' ? 'is going to' : 'is interested in';
      notify(event.creator_id, 'event_rsvp', `${displayName(req.session.userId)} ${verb} "${event.title}"`, { event_id: event.id });
    }
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

// ---- premium progress: training log, load/freshness and custom goals ------
function periodBounds(period, now = new Date()) {
  const end = new Date(now);
  const start = new Date(now);
  if (period === 'year') start.setMonth(0, 1);
  else if (period === 'month') start.setDate(1);
  else {
    const day = start.getDay();
    start.setDate(start.getDate() - ((day + 6) % 7)); // Monday start
  }
  start.setHours(0, 0, 0, 0);
  return { start, end };
}

function workoutDuration(w) {
  return Number(w.duration_sec) || (w.start_time && w.end_time
    ? Math.max(0, (new Date(w.end_time) - new Date(w.start_time)) / 1000) : 0);
}

function goalValue(rows, metric) {
  if (metric === 'distance_km') return rows.reduce((n, w) => n + (Number(w.distance_km) || 0), 0);
  if (metric === 'duration_min') return rows.reduce((n, w) => n + workoutDuration(w) / 60, 0);
  if (metric === 'calories') return rows.reduce((n, w) => n + (Number(w.calories) || 0), 0);
  return rows.length;
}

router.get('/stats/performance', requireAuth, (req, res) => {
  const uid = req.session.userId;
  const rows = db.prepare(`SELECT type, distance_km, duration_sec, start_time, end_time, calories, effort_score
                           FROM workouts WHERE user_id = ? AND end_time IS NOT NULL
                           AND end_time >= ? ORDER BY end_time`).all(uid, new Date(Date.now() - 28 * 86400000).toISOString());
  const byDay = new Map();
  for (let i = 27; i >= 0; i--) {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
    byDay.set(d.toISOString().slice(0, 10), { date: d.toISOString().slice(0, 10), workouts: 0, distance_km: 0, duration_min: 0, calories: 0, load: 0 });
  }
  rows.forEach(w => {
    const day = byDay.get(new Date(w.end_time).toISOString().slice(0, 10));
    if (!day) return;
    const mins = workoutDuration(w) / 60;
    day.workouts++; day.distance_km += Number(w.distance_km) || 0; day.duration_min += mins;
    day.calories += Number(w.calories) || 0;
    day.load += Number(w.effort_score) || Math.max(1, mins);
  });
  const days = [...byDay.values()].map(d => ({ ...d, distance_km: +d.distance_km.toFixed(2), duration_min: Math.round(d.duration_min), load: Math.round(d.load) }));
  const load7 = days.slice(-7).reduce((n, d) => n + d.load, 0);
  const load28 = days.reduce((n, d) => n + d.load, 0);
  const activeDays = days.filter(d => d.workouts).length;
  const consistency = Math.round((activeDays / 28) * 100);
  // A transparent, non-medical training-readiness heuristic: recent load vs
  // four-week average. It is guidance, not a health or injury prediction.
  const baseline = load28 / 4;
  const freshness = baseline ? Math.round(100 - Math.min(100, Math.max(0, (load7 / baseline - 0.6) * 55))) : 100;
  res.json({ days, load7: Math.round(load7), load28: Math.round(load28), consistency, freshness, active_days: activeDays });
});

router.get('/goals', requireAuth, (req, res) => {
  const uid = req.session.userId;
  const goals = db.prepare('SELECT * FROM training_goals WHERE user_id = ? AND archived_at IS NULL ORDER BY created_at DESC').all(uid);
  const all = db.prepare(`SELECT type, distance_km, duration_sec, start_time, end_time, calories
                          FROM workouts WHERE user_id = ? AND end_time IS NOT NULL`).all(uid);
  res.json(goals.map(g => {
    const { start, end } = periodBounds(g.period);
    const rows = all.filter(w => new Date(w.end_time) >= start && new Date(w.end_time) <= end && (!g.activity_type || w.type === g.activity_type));
    const progress = goalValue(rows, g.metric);
    return { ...g, progress: +progress.toFixed(g.metric === 'distance_km' ? 2 : 0), percent: Math.min(100, Math.round((progress / g.target) * 100)), period_start: start.toISOString(), period_end: end.toISOString(), completed: progress >= g.target };
  }));
});

router.post('/goals', requireAuth, (req, res) => {
  const { title, metric, target, period = 'week', activity_type = null } = req.body || {};
  const metrics = new Set(['distance_km', 'duration_min', 'workouts', 'calories']);
  if (!String(title || '').trim() || !metrics.has(metric) || !['week', 'month', 'year'].includes(period) || !Number.isFinite(Number(target)) || Number(target) <= 0) {
    return res.status(400).json({ error: 'invalid_goal' });
  }
  const id = randomUUID();
  db.prepare('INSERT INTO training_goals (id, user_id, title, metric, target, period, activity_type) VALUES (?,?,?,?,?,?,?)')
    .run(id, req.session.userId, String(title).trim().slice(0, 80), metric, Number(target), period, activity_type ? String(activity_type).slice(0, 40) : null);
  res.status(201).json({ id });
});

router.delete('/goals/:id', requireAuth, (req, res) => {
  const result = db.prepare("UPDATE training_goals SET archived_at = datetime('now') WHERE id = ? AND user_id = ? AND archived_at IS NULL")
    .run(req.params.id, req.session.userId);
  if (!result.changes) return res.status(404).json({ error: 'goal_not_found' });
  res.json({ ok: true });
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
    note: 'This is all the data Functioning Faith holds about your account. Email is included because this is your own export.',
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
  res.setHeader('Content-Disposition', 'attachment; filename="functioning-faith-my-data.json"');
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
      const badgeRow = db.prepare('SELECT name, icon FROM badges WHERE id = ?').get(badgeId);
      publish('badge.awarded', { user_id: event.user_id, badge_id: badgeId, badge_name: badgeRow && badgeRow.name, badge_icon: badgeRow && badgeRow.icon });
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
  const { display_name, bio_verse_ref, job, church, fitness_group, gym, age, show_age, avatar_data, bio_link_url,
          tradition, bible_version_id } = req.body || {};

  const updates = {};

  // Theological tradition — the one profile field the AI actually acts on. It
  // is only ever set by the member: an empty value clears it, and clearing it
  // means Gloo calls go out unshaped rather than shaped by a guess.
  if (tradition !== undefined) {
    if (tradition === null || tradition === '') {
      updates.tradition = null;
    } else {
      const t = gloo.normaliseTradition(tradition);
      if (!t) return res.status(400).json({ error: 'unknown_tradition', hint: 'Choose one of: ' + gloo.TRADITIONS.join(', ') });
      updates.tradition = t;
    }
  }

  // Preferred YouVersion translation, validated against the versions the
  // platform actually told us about rather than any number the client sends.
  if (bible_version_id !== undefined) {
    if (bible_version_id === null || bible_version_id === '') {
      updates.bible_version_id = null;
    } else {
      const vid = Number(bible_version_id);
      const known = youversion.versions().some(v => v.id === vid);
      if (!known) return res.status(400).json({ error: 'unknown_version' });
      updates.bible_version_id = vid;
    }
  }

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
    const nameCheck = usernames.check(display_name, req.session.userId);
    if (nameCheck.error) return res.status(409).json(nameCheck);
    updates.display_name = nameCheck.name;
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

  // Heart-rate reference figures. Ranges are deliberately tight: a nonsense value
  // here would poison every zone the app ever shows this user, so we reject rather
  // than clamp. Passing null clears the field.
  const HR_FIELDS = {
    max_hr: { min: 120, max: 230 },
    resting_hr: { min: 30, max: 120 },
    birth_year: { min: 1900, max: new Date().getFullYear() - 10 },
  };
  for (const [field, range] of Object.entries(HR_FIELDS)) {
    const val = req.body ? req.body[field] : undefined;
    if (val === undefined) continue;
    if (val === null || val === '') { updates[field] = null; continue; }
    const n = Number(val);
    if (!Number.isInteger(n) || n < range.min || n > range.max) {
      return res.status(400).json({ error: `invalid_${field}`, hint: `${field} must be a whole number between ${range.min} and ${range.max}.` });
    }
    updates[field] = n;
  }
  if (updates.max_hr != null && updates.resting_hr != null && updates.resting_hr >= updates.max_hr) {
    return res.status(400).json({ error: 'invalid_hr_range', hint: 'Resting heart rate must be lower than max heart rate.' });
  }

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
  const allowed = new Set(['kids', 'fitness', 'motivational', 'christian', 'veggietales', 'nickbare']);
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

// ---- Church official website: a free, key-free complement to the YouTube Data
// API path. Most churches already embed their sermon player (YouTube/Vimeo
// iframe) directly on their own site — we read that real embed and reuse it,
// rather than requiring YOUTUBE_API_KEY just to find a channel. ----
router.post('/churches/:osmId/website', requireAuth, (req, res) => {
  const osmId = req.params.osmId;
  const { website_url } = req.body || {};

  // Same ownership check as link-youtube: only the user who has this real,
  // OSM-verified church on their own profile may set its official website.
  const me = db.prepare('SELECT church_osm_id, church_name FROM users WHERE id = ?').get(req.session.userId);
  if (!me || me.church_osm_id !== osmId) return res.status(400).json({ error: 'church_not_on_profile', hint: 'Select this church on your profile before adding its website.' });

  if (website_url === null || website_url === '') {
    const existing = db.prepare('SELECT id FROM churches WHERE osm_id = ?').get(osmId);
    if (existing) db.prepare('UPDATE churches SET website_url = NULL WHERE id = ?').run(existing.id);
    return res.json({ ok: true });
  }

  if (!isHttpUrl(website_url)) return res.status(400).json({ error: 'invalid_url', hint: 'Enter a full website address, e.g. https://yourchurch.org' });

  const existing = db.prepare('SELECT id FROM churches WHERE osm_id = ?').get(osmId);
  if (existing) {
    db.prepare('UPDATE churches SET website_url = ? WHERE id = ?').run(website_url, existing.id);
  } else {
    db.prepare('INSERT INTO churches (id, osm_id, name, website_url) VALUES (?, ?, ?, ?)').run(randomUUID(), osmId, me.church_name, website_url);
  }
  res.json({ ok: true });
});

// Fetch the church's real website and return whatever video embeds are
// literally present on it right now (fetched live — not cached/guessed).
router.get('/churches/:osmId/website-videos', requireAuth, async (req, res) => {
  const church = db.prepare('SELECT website_url FROM churches WHERE osm_id = ?').get(req.params.osmId);
  if (!church || !church.website_url) return res.status(400).json({ error: 'no_website', hint: "This church hasn't added an official website yet." });
  try {
    const embeds = await fetchChurchWebsiteEmbeds(church.website_url);
    res.json({ embeds });
  } catch (err) {
    console.error('[churches/website-videos] fetch failed:', err.message);
    res.status(502).json({ error: 'fetch_failed', hint: "Could not reach the church's website. Try again shortly." });
  }
});

// ---- journeys: Zwift-style virtual routes advanced by real workouts ----
// One notification per newly-crossed waypoint, plus one on completion.
function notifyJourneyProgress(userId, results) {
  for (const r of results || []) {
    for (const w of r.waypoints) {
      notify(userId, 'journey', `You reached ${w.title} on ${r.journey.name} — ${Number(w.km_mark).toFixed(1)} km in.`, {
        journey_key: r.journey.key, waypoint: w.title, km_mark: w.km_mark,
      });
      publish('journey.waypoint', {
        user_id: userId, journey_key: r.journey.key, journey_name: r.journey.name,
        waypoint: w.title, km_mark: w.km_mark, scripture_ref: w.scripture_ref || null,
      });
    }
    if (r.completed) {
      notify(userId, 'journey', `Journey complete: ${r.journey.name}. ${Number(r.journey.total_km)} km, all of it yours.`, {
        journey_key: r.journey.key, completed: true,
      });
      publish('journey.completed', {
        user_id: userId, journey_key: r.journey.key, journey_name: r.journey.name,
        total_km: r.journey.total_km,
      });
    }
  }
}

function journeyProgressRow(journeyId, userId) {
  if (!userId) return null;
  return db.prepare('SELECT * FROM user_journeys WHERE user_id = ? AND journey_id = ?').get(userId, journeyId) || null;
}

// Browsable without auth; per-user fields only appear when signed in.
router.get('/journeys', (req, res) => {
  const me = req.session.userId || null;
  const rows = db.prepare(`
    SELECT j.*, uj.progress_km, uj.started_at, uj.completed_at,
           (SELECT COUNT(*) FROM user_journeys u WHERE u.journey_id = j.id) AS travellers,
           (SELECT COUNT(*) FROM journey_waypoints w WHERE w.journey_id = j.id) AS waypoint_count
    FROM journeys j
    LEFT JOIN user_journeys uj ON uj.journey_id = j.id AND uj.user_id = @me
    ORDER BY j.world, j.total_km
  `).all({ me });

  const nextWp = db.prepare('SELECT title, km_mark FROM journey_waypoints WHERE journey_id = ? AND km_mark > ? ORDER BY km_mark LIMIT 1');
  res.json(rows.map(j => {
    const joined = !!j.started_at;
    const progress = joined ? Number(j.progress_km) || 0 : 0;
    const out = {
      ...j,
      joined,
      completed: !!j.completed_at,
      progress_km: joined ? progress : null,
      percent: joined ? Math.min(100, Math.round((progress / j.total_km) * 100)) : null,
      next_waypoint: null,
    };
    if (joined && !j.completed_at) {
      const w = nextWp.get(j.id, progress);
      if (w) out.next_waypoint = { title: w.title, km_mark: w.km_mark, km_remaining: Math.max(0, +(w.km_mark - progress).toFixed(2)) };
    }
    if (!me) { delete out.progress_km; delete out.percent; }
    return out;
  }));
});

router.post('/journeys/:key/join', requireAuth, (req, res) => {
  const j = db.prepare('SELECT id FROM journeys WHERE key = ? OR id = ?').get(req.params.key, req.params.key);
  if (!j) return res.status(404).json({ error: 'journey_not_found' });
  db.prepare('INSERT OR IGNORE INTO user_journeys (user_id, journey_id, progress_km, last_waypoint_km) VALUES (?, ?, 0, -1)')
    .run(req.session.userId, j.id);
  res.status(201).json({ ok: true, journey_id: j.id });
});

router.post('/journeys/:key/leave', requireAuth, (req, res) => {
  const j = db.prepare('SELECT id FROM journeys WHERE key = ? OR id = ?').get(req.params.key, req.params.key);
  if (!j) return res.status(404).json({ error: 'journey_not_found' });
  db.prepare('DELETE FROM user_journeys WHERE user_id = ? AND journey_id = ?').run(req.session.userId, j.id);
  res.json({ ok: true });
});

router.get('/journeys/:key', requireAuth, (req, res) => {
  const j = db.prepare('SELECT * FROM journeys WHERE key = ? OR id = ?').get(req.params.key, req.params.key);
  if (!j) return res.status(404).json({ error: 'journey_not_found' });
  const uj = journeyProgressRow(j.id, req.session.userId);
  const joined = !!uj;
  const progress = joined ? Number(uj.progress_km) || 0 : 0;
  const waypoints = db.prepare('SELECT * FROM journey_waypoints WHERE journey_id = ? ORDER BY km_mark').all(j.id)
    .map(w => ({ ...w, unlocked: joined && w.km_mark <= progress }));
  const next = waypoints.find(w => w.km_mark > progress) || null;
  res.json({
    journey: j,
    joined,
    completed: !!(uj && uj.completed_at),
    started_at: uj ? uj.started_at : null,
    completed_at: uj ? uj.completed_at : null,
    progress_km: progress,
    percent: Math.min(100, Math.round((progress / j.total_km) * 100)),
    waypoints,
    next_waypoint: next ? { title: next.title, km_mark: next.km_mark, km_remaining: Math.max(0, +(next.km_mark - progress).toFixed(2)) } : null,
  });
});

// =========================================================================
// Effort + physiological-moment support
// (function declarations, so they're available to the handlers defined above)
// =========================================================================

// YouVersion-style book codes for the books actually loaded into bible_verses.
const YV_BOOK_CODES = {
  Genesis: 'gen', Psalms: 'psa', Proverbs: 'pro', Matthew: 'mat', Mark: 'mrk',
  Luke: 'luk', John: 'jhn', Romans: 'rom', James: 'jas', Philippians: 'php',
  // books being ingested concurrently — codes ready so references resolve cleanly on merge
  Isaiah: 'isa', Hebrews: 'heb', '1 Corinthians': '1co', '2 Timothy': '2ti',
  Ephesians: 'eph', Exodus: 'exo', Numbers: 'num', Deuteronomy: 'deu',
  Joshua: 'jos', '1 Kings': '1ki', Acts: 'act',
};

/**
 * Resolve a scripture reference against the VERIFIED bible_verses table. Returns null
 * if the reference isn't in the library — callers skip it rather than serving an
 * unverified verse. Also mirrors the verse into scripture_verses (same id) so that
 * posts referencing it keep rendering through the existing LEFT JOIN.
 */
function lookupBibleReference(book, chapter, verse) {
  const row = db.prepare('SELECT id, book, chapter, verse, text, translation FROM bible_verses WHERE book = ? AND chapter = ? AND verse = ?')
    .get(book, chapter, verse);
  if (!row) return null;
  return mirrorVerse(row);
}

function mirrorVerse(row) {
  const reference = `${row.book} ${row.chapter}:${row.verse}`;
  const code = YV_BOOK_CODES[row.book];
  const youversion_id = code ? `${code}.${row.chapter}.${row.verse}` : row.id;
  db.prepare('INSERT OR IGNORE INTO scripture_verses (id, reference, text, translation, youversion_id, themes) VALUES (?, ?, ?, ?, ?, ?)')
    .run(row.id, reference, row.text, row.translation, youversion_id, '');
  return { id: row.id, reference, text: row.text, translation: row.translation, youversion_id };
}

/** FTS fallback: real verses matching a moment's keywords, ranked by FTS relevance. */
function bibleFtsSearch(terms) {
  const q = String(terms || '').replace(/["*]/g, '').trim().split(/\s+/).filter(Boolean).map(w => `${w}*`).join(' OR ');
  if (!q) return [];
  try {
    const rows = db.prepare(`
      SELECT bv.id, bv.book, bv.chapter, bv.verse, bv.text, bv.translation
      FROM bible_verses_fts f JOIN bible_verses bv ON bv.rowid = f.rowid
      WHERE bible_verses_fts MATCH ? ORDER BY rank LIMIT 12
    `).all(q);
    return rows.filter(r => r.text && r.text.length <= 260).map(mirrorVerse);
  } catch (e) {
    console.error('[effort] fts fallback failed:', e.message);
    return [];
  }
}

/**
 * Derive the live physiological signals for the current instant from REAL data:
 * the workout's start time and the actual sample series. Anything we cannot know
 * (zone without a max HR, elapsed fraction without a target duration) stays null.
 */
function computeEffortSignals(workout, samples, maxHr, body = {}) {
  const hrs = (samples || [])
    .filter(s => Number(s.heart_rate) > 0)
    .map(s => ({ t: Date.parse(s.time), hr: Number(s.heart_rate) }))
    .filter(s => Number.isFinite(s.t))
    .sort((a, b) => a.t - b.t);

  const now = Date.now();
  const started = Date.parse(workout.start_time);
  const elapsed_sec = Number.isFinite(started) ? Math.max(0, Math.round((now - started) / 1000)) : 0;

  const current = hrs.length ? hrs[hrs.length - 1].hr : null;
  const zone = effortLib.hrZone(current, maxHr);

  // Direction: mean of the last two readings vs the two before them. +/-3 bpm of
  // deadband so ordinary beat-to-beat noise doesn't read as a trend.
  let trend = null;
  if (hrs.length >= 4) {
    const avg = arr => arr.reduce((a, s) => a + s.hr, 0) / arr.length;
    const recent = avg(hrs.slice(-2)), prior = avg(hrs.slice(-4, -2));
    trend = recent - prior >= 3 ? 'rising' : recent - prior <= -3 ? 'falling' : 'steady';
  }

  // Dwell: how long we've been continuously in the current effort band. Zones 4 and 5
  // count as one band, so a threshold effort that ticks up to max doesn't reset "the wall".
  let dwell_sec = 0;
  if (zone != null && hrs.length) {
    const band = z => (z >= 4 ? 'hard' : String(z));
    const cur = band(zone);
    let i = hrs.length - 1;
    while (i > 0 && band(effortLib.hrZone(hrs[i - 1].hr, maxHr)) === cur) i--;
    dwell_sec = Math.max(0, Math.round((hrs[hrs.length - 1].t - hrs[i].t) / 1000));
  }

  // The client may know its target session length; if it doesn't, we don't pretend to.
  const target = Number(body.target_duration_sec);
  const elapsed_fraction = Number.isFinite(target) && target > 0
    ? Math.min(1, elapsed_sec / target)
    : (body.finishing === true ? 1 : null);

  return { zone, trend, elapsed_sec, elapsed_fraction, dwell_sec, hr: current };
}

/** Completed workouts that actually carry zone data, newest first. */
function zonedWorkouts(userId, excludeId) {
  return db.prepare(`SELECT id, end_time, duration_sec, effort_score, time_in_zone, peak_zone
                     FROM workouts WHERE user_id = ? AND end_time IS NOT NULL AND time_in_zone IS NOT NULL
                     ORDER BY end_time DESC`)
    .all(userId)
    .filter(w => w.id !== excludeId)
    .map(w => { try { return { ...w, zones: JSON.parse(w.time_in_zone) }; } catch { return null; } })
    .filter(Boolean);
}

/**
 * Real personal bests from the user's real history — the comparisons in
 * describeEffort()/notableEffort() are only allowed to be as true as this is.
 */
function personalBestsFor(userId, excludeWorkoutId) {
  const all = zonedWorkouts(userId, excludeWorkoutId);
  if (!all.length) return { priorSessionsWithZones: 0 };
  const cutoff = Date.now() - 30 * 86400000;
  const hard = w => (w.zones[4] || 0) + (w.zones[5] || 0);
  const last30 = all.filter(w => Date.parse(w.end_time) >= cutoff);
  return {
    priorSessionsWithZones: all.length,
    bestZone45Sec: last30.length ? Math.max(...last30.map(hard)) : 0,
    everZone5: all.some(w => (w.zones[5] || 0) > 0),
    bestEffortScore: all.some(w => w.effort_score != null) ? Math.max(...all.filter(w => w.effort_score != null).map(w => w.effort_score)) : null,
  };
}

/**
 * Time-in-zone distribution + effort trend for the Stats screen.
 * Degrades honestly: `zone_data: false` plus an explainer when the user has never
 * had a reference max HR, instead of any invented zone breakdown.
 */
router.get('/stats/effort', requireAuth, (req, res) => {
  const uid = req.session.userId;
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
  const user = db.prepare('SELECT max_hr, resting_hr, birth_year FROM users WHERE id = ?').get(uid);
  const maxInfo = effortLib.maxHrInfo(user);
  const sessions = zonedWorkouts(uid, null).slice(0, limit);

  if (!sessions.length) {
    return res.json({
      zone_data: false,
      max_hr: maxInfo ? maxInfo.value : null,
      max_hr_source: maxInfo ? maxInfo.source : null,
      sessions: [], totals: null, effort_trend: [],
      hint: maxInfo
        ? 'No heart-rate samples recorded yet — start a workout with your monitor paired to see time in zone.'
        : 'Zone insights need a heart-rate reading and your max heart rate. Pair a Bluetooth chest strap during a workout, and add your max HR (or birth year) in your profile.',
    });
  }

  const totals = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const s of sessions) for (const z of [1, 2, 3, 4, 5]) totals[z] += s.zones[z] || 0;

  res.json({
    zone_data: true,
    max_hr: maxInfo ? maxInfo.value : null,
    max_hr_source: maxInfo ? maxInfo.source : null,
    max_hr_formula: maxInfo ? maxInfo.formula || null : null,
    zone_labels: effortLib.ZONE_LABELS,
    totals,
    total_sec: Object.values(totals).reduce((a, b) => a + b, 0),
    sessions: sessions.map(s => ({
      id: s.id, end_time: s.end_time, duration_sec: s.duration_sec,
      effort_score: s.effort_score, peak_zone: s.peak_zone, zones: s.zones,
    })),
    // Oldest -> newest, so the client can draw the trend left to right.
    effort_trend: sessions.filter(s => s.effort_score != null)
      .map(s => ({ end_time: s.end_time, effort_score: s.effort_score })).reverse(),
  });
});

// ============================================================================
// Scripture as conversation, not broadcast.
// Every verse the app surfaces becomes an invitation to talk: one canonical
// thread per verse, reflections with one level of replies, likes, and a
// discovery surface of what's actually being discussed.
//
// Hard rule: a thread may only ever be opened on a verse that REALLY EXISTS in
// our verified local bible_verses table. No fabricated scripture, ever.
// ============================================================================

const REFLECTION_MAX_LEN = 1000;

// Parse "Book Chapter:Verse" and resolve it against the verified library.
// Mirrors the validation used by PUT /profile's bio_verse_ref handler.
// Returns { row } on success, or { error, hint } describing the rejection.
function resolveVerseReference(raw) {
  const ref = String(raw || '').trim();
  const m = ref.match(/^(.+?)\s+(\d+):(\d+)$/);
  if (!m) return { error: 'invalid_verse_format', hint: 'Use "Book Chapter:Verse", e.g. "Psalms 23:4"' };
  const [, book, chapter, verse] = m;
  const row = db.prepare('SELECT text, book, chapter, verse, translation FROM bible_verses WHERE book = ? AND chapter = ? AND verse = ?')
    .get(book.trim(), Number(chapter), Number(verse));
  if (!row) return { error: 'verse_not_found', hint: 'That verse is not in our verified library. Try another reference.' };
  return { row };
}

function reflectionRows(threadId, meId) {
  const rows = db.prepare(`
    SELECT r.id, r.parent_id, r.content, r.created_at, r.user_id,
           u.display_name AS author,
           CASE WHEN u.avatar_data IS NOT NULL THEN 1 ELSE 0 END AS has_avatar,
           (SELECT COUNT(*) FROM verse_reflection_likes l WHERE l.reflection_id = r.id) AS like_count
    FROM verse_reflections r
    JOIN users u ON u.id = r.user_id
    WHERE r.thread_id = ?
    ORDER BY r.created_at ASC
  `).all(threadId);

  const liked = new Set();
  if (meId && rows.length) {
    for (const l of db.prepare(`
      SELECT l.reflection_id FROM verse_reflection_likes l
      JOIN verse_reflections r ON r.id = l.reflection_id
      WHERE r.thread_id = ? AND l.user_id = ?
    `).all(threadId, meId)) liked.add(l.reflection_id);
  }

  const byId = new Map();
  const top = [];
  for (const r of rows) {
    const item = { ...r, liked_by_me: liked.has(r.id), replies: [] };
    byId.set(r.id, item);
  }
  for (const r of rows) {
    const item = byId.get(r.id);
    const parent = r.parent_id ? byId.get(r.parent_id) : null;
    if (parent) parent.replies.push(item); else top.push(item);
  }
  return top;
}

// Open (or return the existing) conversation for a real verse.
router.post('/verses/:reference/thread', requireAuth, (req, res) => {
  const { row, error, hint } = resolveVerseReference(req.params.reference);
  if (error) return res.status(400).json({ error, hint });

  const canonical = `${row.book} ${row.chapter}:${row.verse}`;
  const existing = db.prepare('SELECT * FROM verse_threads WHERE reference = ?').get(canonical);
  if (existing) {
    return res.json({ thread: existing, verse: row, created: false });
  }

  const prompt = req.body && req.body.prompt ? String(req.body.prompt).trim().slice(0, REFLECTION_MAX_LEN) : null;
  const id = randomUUID();
  db.prepare(`
    INSERT INTO verse_threads (id, reference, book, chapter, verse, opened_by, prompt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, canonical, row.book, row.chapter, row.verse, req.session.userId, prompt);
  const thread = db.prepare('SELECT * FROM verse_threads WHERE id = ?').get(id);
  res.status(201).json({ thread, verse: row, created: true });
});

// Read a verse conversation. Open to everyone; per-user fields only when signed in.
router.get('/verses/:reference/thread', (req, res) => {
  const { row, error, hint } = resolveVerseReference(req.params.reference);
  if (error) return res.status(400).json({ error, hint });
  const canonical = `${row.book} ${row.chapter}:${row.verse}`;
  const thread = db.prepare('SELECT * FROM verse_threads WHERE reference = ?').get(canonical);
  if (!thread) return res.json({ thread: null, verse: row, reflections: [] });
  const meId = req.session.userId || null;
  const opener = db.prepare('SELECT display_name FROM users WHERE id = ?').get(thread.opened_by);
  res.json({
    thread: { ...thread, opened_by_name: (opener && opener.display_name) || 'Someone' },
    verse: row,
    reflections: reflectionRows(thread.id, meId),
  });
});

// --- A heart rate that is up while the body is still -----------------------
// The third place scripture is supplied, alongside workouts and breathing: at a
// desk, mid-afternoon, when the number climbs and no effort explains it.
//
// This route reports a measurement and offers scripture and a way to breathe.
// It does not tell anyone what they are feeling — see lib/contexts.js. When the
// inputs are not there (no monitor, no resting baseline) it says exactly what
// is missing rather than producing a softer answer from thinner evidence.
router.post('/checkin/heart', requireAuth, async (req, res) => {
  const b = req.body || {};
  const me = db.prepare('SELECT max_hr, resting_hr, birth_year, tradition, bible_version_id FROM users WHERE id = ?')
    .get(req.session.userId) || {};

  const state = contexts.classifyRest({
    // Heart rate is passed through only when it came from a real monitor.
    hr: b.hr_measured ? b.hr : null,
    recent_hr: b.hr_measured ? b.recent_hr : null,
    resting_hr: me.resting_hr,
    max_hr: effortLib.estimatedMaxHr(me),
    moving: !!b.moving,
  });

  // Nothing measurable to act on: return the state and what would fix it.
  if (!state.context) return res.json({ ...state, verse: null, suggested_pattern: null });

  const seen = Array.isArray(b.seen_refs) ? b.seen_refs.map(String) : [];
  let verse = null;
  try {
    const picked = await companion.restVerse({
      userId: req.session.userId,
      tradition: me.tradition,
      versionId: me.bible_version_id,
      state, seenRefs: seen,
    });
    if (picked) verse = { ...picked, chosen_by: 'gloo' };
  } catch { /* authored fallback below */ }

  if (!verse) {
    const tried = seen.slice();
    for (let i = 0; i < 6 && !verse; i++) {
      const ref = contexts.pickRef(state.context, tried);
      if (!ref) break;
      const text = lookupScriptureText(ref);
      if (text) verse = { reference: ref, text, chosen_by: 'authored' };
      else tried.push(ref);
    }
  }

  const patternKey = contexts.suggestPattern(state.context);
  const pattern = patternKey ? breathwork.byKey(patternKey) : null;

  res.json({
    ...state,
    verse,
    suggested_pattern: pattern
      ? { key: pattern.key, name: pattern.name, tagline: pattern.tagline,
          minutes: pattern.default_minutes }
      : null,
  });
});

// --- Scripture for a breathing pattern -------------------------------------
// The catalogue ships one authored verse per pattern, identical for everyone.
// This chooses from the shortlist for what the pattern is *for*, in the
// member's tradition, and can take account of why they opened it.
router.post('/breathing/:key/verse', requireAuth, async (req, res) => {
  const pattern = breathwork.byKey(req.params.key);
  if (!pattern) return res.status(404).json({ error: 'unknown_pattern' });

  const me = db.prepare('SELECT resting_hr, tradition, bible_version_id FROM users WHERE id = ?')
    .get(req.session.userId) || {};
  const b = req.body || {};
  const context = contexts.contextForPattern(pattern.key);

  const seen = Array.isArray(b.seen_refs) ? b.seen_refs.map(String) : [];
  let verse = null;
  try {
    const picked = await companion.breathVerse({
      userId: req.session.userId,
      tradition: me.tradition,
      versionId: me.bible_version_id,
      context,
      patternName: pattern.name,
      minutes: pattern.default_minutes,
      breathsPerMin: Math.round((60 / breathwork.cycleSeconds(pattern)) * 10) / 10,
      // Carried over from a heart check-in, when that is why they came here.
      // Only ever a measured delta, never a mood.
      aboveResting: Number(b.above_resting) || null,
      restingHr: me.resting_hr || null,
      seenRefs: seen,
    });
    if (picked) verse = { ...picked, chosen_by: 'gloo' };
  } catch { /* authored fallback below */ }

  if (!verse) {
    const tried = seen.slice();
    for (let i = 0; i < 6 && !verse; i++) {
      const ref = contexts.pickRef(context, tried) || pattern.scripture_ref;
      const text = lookupScriptureText(ref);
      if (text) { verse = { reference: ref, text, chosen_by: 'authored' }; break; }
      tried.push(ref);
    }
  }

  res.json({ pattern: pattern.key, context, verse });
});

// What the AI integration is, and what it has actually been doing. Public and
// unauthenticated on purpose: the claim this app makes is that a model never
// puts words in scripture's mouth, and a claim like that should be checkable
// by anyone, not asserted in a README.
router.get('/ai/status', (req, res) => {
  const s = gloo.stats(7);
  const cited = s.reduce((a, r) => a + (r.refs_cited || 0), 0);
  const verified = s.reduce((a, r) => a + (r.refs_verified || 0), 0);
  res.json({
    gloo: {
      configured: gloo.isConfigured(),
      traditions: gloo.TRADITIONS,
      purpose: 'Chooses which scripture fits a moment and writes the words around it, shaped to the member\'s tradition.',
    },
    youversion: {
      configured: youversion.isConfigured(),
      versions: youversion.versions().length,
      purpose: 'Supplies the verse text itself. No model output is ever shown as scripture.',
    },
    guardrails: [
      'Completions that stop for length are discarded, not trimmed — a truncated reference is a different verse.',
      'Every scripture reference a model cites is resolved against YouVersion or the verified local library.',
      'A reply whose references cannot be resolved is dropped entirely; the app falls back to hand-authored scripture.',
      'Verse text always comes from the resolver, never from the model.',
    ],
    last_7_days: { by_kind: s, refs_cited: cited, refs_verified: verified },
  });
});

// --- The companion in the room --------------------------------------------
// A verse thread is a conversation between people. This answers the question
// that stalls one — what a word meant, who was being addressed — so the human
// conversation can carry on, in the asker's own tradition.
//
// It is deliberately not a participant: the answer is returned to the asker and
// is not written into the thread as a reflection. Nobody's thread fills up with
// machine text, and nothing here is attributable to another member.
router.post('/verses/:reference/ask', requireAuth, async (req, res) => {
  if (!gloo.isConfigured()) return res.status(503).json({ error: 'companion_unavailable' });

  const { row, error, hint } = resolveVerseReference(req.params.reference);
  if (error) return res.status(400).json({ error, hint });
  const canonical = `${row.book} ${row.chapter}:${row.verse}`;

  const question = String((req.body && req.body.question) || '').trim();
  if (!question) return res.status(400).json({ error: 'empty_question' });
  if (question.length > 500) return res.status(400).json({ error: 'question_too_long' });

  const me = db.prepare('SELECT tradition, bible_version_id FROM users WHERE id = ?')
    .get(req.session.userId) || {};

  const answer = await companion.askAboutVerse({
    userId: req.session.userId,
    tradition: me.tradition,
    versionId: me.bible_version_id,
    reference: canonical,
    question,
  });
  // Null covers every failure mode, including an answer that cited scripture
  // which does not exist. We say nothing rather than something unverified.
  if (!answer) return res.status(502).json({ error: 'no_verified_answer' });
  res.json(answer);
});

// Add a reflection, or a reply to one (exactly one level deep).
router.post('/verses/threads/:id/reflections', requireAuth, (req, res) => {
  const thread = db.prepare('SELECT * FROM verse_threads WHERE id = ?').get(req.params.id);
  if (!thread) return res.status(404).json({ error: 'thread_not_found' });

  const content = String((req.body && req.body.content) || '').trim();
  if (!content) return res.status(400).json({ error: 'empty_reflection' });
  if (content.length > REFLECTION_MAX_LEN) return res.status(400).json({ error: 'reflection_too_long', hint: `Keep it under ${REFLECTION_MAX_LEN} characters.` });

  let parentId = null;
  if (req.body && req.body.parent_id) {
    const parent = db.prepare('SELECT id, user_id, parent_id, thread_id FROM verse_reflections WHERE id = ?').get(String(req.body.parent_id));
    if (!parent || parent.thread_id !== thread.id) return res.status(400).json({ error: 'parent_not_found' });
    // Only one level of nesting: replying to a reply attaches to its top-level parent.
    parentId = parent.parent_id || parent.id;
  }

  const id = randomUUID();
  db.prepare('INSERT INTO verse_reflections (id, thread_id, user_id, parent_id, content) VALUES (?, ?, ?, ?, ?)')
    .run(id, thread.id, req.session.userId, parentId, content);

  const me = req.session.userId;
  const who = displayName(me);
  const snippet = content.slice(0, 60);
  const notified = new Set([me]);

  if (parentId) {
    const parentAuthor = db.prepare('SELECT user_id FROM verse_reflections WHERE id = ?').get(parentId);
    if (parentAuthor && !notified.has(parentAuthor.user_id)) {
      notified.add(parentAuthor.user_id);
      notify(parentAuthor.user_id, 'reflection', `${who} replied on ${thread.reference}: "${snippet}"`, { reference: thread.reference, thread_id: thread.id });
    }
  }
  if (!notified.has(thread.opened_by)) {
    notified.add(thread.opened_by);
    notify(thread.opened_by, 'reflection', `${who} reflected on ${thread.reference}: "${snippet}"`, { reference: thread.reference, thread_id: thread.id });
  }

  const created = db.prepare(`
    SELECT r.id, r.parent_id, r.content, r.created_at, r.user_id, u.display_name AS author
    FROM verse_reflections r JOIN users u ON u.id = r.user_id WHERE r.id = ?
  `).get(id);
  res.status(201).json({ ...created, like_count: 0, liked_by_me: false, replies: [] });
});

// Toggle a like on a reflection — mirrors /posts/:id/like.
router.post('/verses/reflections/:id/like', requireAuth, (req, res) => {
  const reflection = db.prepare('SELECT id, user_id, thread_id FROM verse_reflections WHERE id = ?').get(req.params.id);
  if (!reflection) return res.status(404).json({ error: 'reflection_not_found' });
  const uid = req.session.userId;
  const existing = db.prepare('SELECT 1 FROM verse_reflection_likes WHERE reflection_id = ? AND user_id = ?').get(reflection.id, uid);
  if (existing) {
    db.prepare('DELETE FROM verse_reflection_likes WHERE reflection_id = ? AND user_id = ?').run(reflection.id, uid);
  } else {
    db.prepare('INSERT INTO verse_reflection_likes (reflection_id, user_id) VALUES (?, ?)').run(reflection.id, uid);
    if (reflection.user_id !== uid) {
      const thread = db.prepare('SELECT reference FROM verse_threads WHERE id = ?').get(reflection.thread_id);
      notify(reflection.user_id, 'reflection', `${displayName(uid)} appreciated your reflection on ${thread ? thread.reference : 'a verse'}`, { reference: thread && thread.reference });
    }
  }
  const likeCount = db.prepare('SELECT COUNT(*) c FROM verse_reflection_likes WHERE reflection_id = ?').get(reflection.id).c;
  res.json({ liked: !existing, like_count: likeCount });
});

// Discovery surface: which verses people are actually talking about.
router.get('/verses/discussed', (req, res) => {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 12));
  const rows = db.prepare(`
    SELECT t.id, t.reference, t.book, t.chapter, t.verse, t.prompt, t.created_at,
           (SELECT COUNT(*) FROM verse_reflections r WHERE r.thread_id = t.id) AS reflection_count,
           COALESCE((SELECT MAX(r.created_at) FROM verse_reflections r WHERE r.thread_id = t.id), t.created_at) AS last_activity
    FROM verse_threads t
    ORDER BY last_activity DESC
    LIMIT ?
  `).all(limit);
  const withText = rows.map(t => {
    const v = db.prepare('SELECT text FROM bible_verses WHERE book = ? AND chapter = ? AND verse = ?').get(t.book, t.chapter, t.verse);
    return { ...t, text: v ? v.text : null };
  });
  res.json(withText);
});

// Lightweight counts so any verse card anywhere in the app can show its
// conversation state ("3 reflections" vs "Start the conversation").
router.get('/verses/thread-summary', (req, res) => {
  const raw = String(req.query.refs || '').trim();
  if (!raw) return res.json({});
  const refs = raw.split('|').map(s => s.trim()).filter(Boolean).slice(0, 25);
  const out = {};
  for (const ref of refs) {
    const t = db.prepare('SELECT id FROM verse_threads WHERE reference = ?').get(ref);
    out[ref] = t
      ? { thread_id: t.id, reflection_count: db.prepare('SELECT COUNT(*) c FROM verse_reflections WHERE thread_id = ?').get(t.id).c }
      : { thread_id: null, reflection_count: 0 };
  }
  res.json(out);
});

// ============================================================================
// Church at signup, with videos already embedded.
// ============================================================================

// Normalise a name for comparison: lowercase, strip accents and punctuation,
// collapse whitespace.
function normaliseName(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Words too generic to identify a specific church on their own.
const CHURCH_STOPWORDS = new Set(['the', 'of', 'and', 'a', 'at', 'in', 'st', 'saint', 'church', 'churches', 'parish', 'chapel', 'cathedral', 'ministries', 'ministry', 'fellowship', 'community', 'congregation', 'assembly', 'tabernacle', 'official', 'tv', 'live', 'online', 'channel']);

// CONFIDENT MATCH RULE (deliberately conservative — a wrong channel is worse
// than no channel). A YouTube channel is auto-linked to a church only if:
//   (a) the church's normalised name appears verbatim inside the normalised
//       channel title, OR
//   (b) EVERY distinctive token of the church name (tokens left after removing
//       generic stopwords like "church"/"saint"/"the") appears in the channel
//       title, AND there are at least 2 such distinctive tokens.
// Anything else → no link. We never guess.
function isConfidentChannelMatch(churchName, channelTitle) {
  const church = normaliseName(churchName);
  const channel = normaliseName(channelTitle);
  if (!church || !channel) return false;
  if (channel.includes(church)) return true;
  const distinctive = church.split(' ').filter(w => w && !CHURCH_STOPWORDS.has(w));
  if (distinctive.length < 2) return false;
  const channelTokens = new Set(channel.split(' '));
  return distinctive.every(w => channelTokens.has(w));
}

// Ensure a churches row exists for this osm_id, seeded from the caller's own
// (OSM-verified) profile church fields.
function ensureChurchRow(osmId, name) {
  let row = db.prepare('SELECT * FROM churches WHERE osm_id = ?').get(osmId);
  if (!row) {
    db.prepare('INSERT INTO churches (id, osm_id, name) VALUES (?, ?, ?)').run(randomUUID(), osmId, name || null);
    row = db.prepare('SELECT * FROM churches WHERE osm_id = ?').get(osmId);
  }
  return row;
}

// Auto-populate a church's videos the moment it's selected — no extra steps.
// Cascade: already-linked channel → confident YouTube search match → the
// church's own website embeds (free, key-free) → nothing (say so honestly).
router.post('/churches/:osmId/auto-link', requireAuth, async (req, res) => {
  const osmId = req.params.osmId;
  // Same ownership check as link-youtube.
  const me = db.prepare('SELECT church_osm_id, church_name FROM users WHERE id = ?').get(req.session.userId);
  if (!me || me.church_osm_id !== osmId) {
    return res.status(400).json({ error: 'church_not_on_profile', hint: 'Select this church on your profile before linking its videos.' });
  }

  const church = ensureChurchRow(osmId, me.church_name);

  // 1. Someone at this church already linked the real channel.
  if (church.youtube_channel_id) {
    return res.json({
      linked: true, method: 'existing_channel',
      channel_id: church.youtube_channel_id, channel_title: church.youtube_channel_title,
      message: `Linked from your church's channel${church.youtube_channel_title ? ` (${church.youtube_channel_title})` : ''}.`,
    });
  }

  // 2. Confident YouTube Data API match (only when a key is configured).
  if (youtube.isConfigured() && me.church_name) {
    try {
      const results = await youtube.searchChannels(me.church_name);
      const top = results && results[0];
      if (top && isConfidentChannelMatch(me.church_name, top.title)) {
        db.prepare('UPDATE churches SET youtube_channel_id = ?, youtube_channel_title = ? WHERE id = ?')
          .run(top.channelId, String(top.title).slice(0, 120), church.id);
        return res.json({
          linked: true, method: 'youtube_search',
          channel_id: top.channelId, channel_title: top.title,
          message: `Linked from your church's channel (${top.title}).`,
        });
      }
    } catch (err) {
      console.error('[churches/auto-link] youtube search failed:', err.message);
    }
  }

  // 3. Free, key-free fallback: real embeds already on the church's own site.
  if (church.website_url) {
    try {
      const embeds = await fetchChurchWebsiteEmbeds(church.website_url);
      if (embeds && embeds.length) {
        return res.json({
          linked: true, method: 'website_embeds', embeds,
          message: "Found videos on your church's website.",
        });
      }
    } catch (err) {
      console.error('[churches/auto-link] website fetch failed:', err.message);
    }
  }

  res.json({
    linked: false, method: 'none',
    youtube_configured: youtube.isConfigured(),
    message: youtube.isConfigured()
      ? "We couldn't confidently find your church's channel — search for it manually."
      : "We couldn't find videos for your church automatically. Add your church's website, or search for its channel manually once YouTube is configured.",
  });
});

// The current user's church's recent videos, for the home feed.
// Always HTTP 200 — an empty list is a normal, honest answer.
router.get('/church/videos', requireAuth, async (req, res) => {
  const me = db.prepare('SELECT church_osm_id, church_name FROM users WHERE id = ?').get(req.session.userId);
  if (!me || !me.church_osm_id) return res.json({ videos: [], source: 'none', church_name: null });
  const church = db.prepare('SELECT * FROM churches WHERE osm_id = ?').get(me.church_osm_id);
  if (!church) return res.json({ videos: [], source: 'none', church_name: me.church_name });

  if (church.youtube_channel_id && youtube.isConfigured()) {
    try {
      const uploads = await youtube.fetchRecentUploads(church.youtube_channel_id, 4);
      if (uploads && uploads.length) {
        return res.json({
          church_name: church.name || me.church_name,
          source: 'youtube_channel',
          channel_title: church.youtube_channel_title,
          videos: uploads.map(v => ({ provider: 'youtube', video_id: v.videoId, title: v.title, thumbnail_url: v.thumbnailUrl, published_at: v.publishedAt })),
        });
      }
    } catch (err) {
      console.error('[church/videos] youtube fetch failed:', err.message);
    }
  }

  if (church.website_url) {
    try {
      const embeds = await fetchChurchWebsiteEmbeds(church.website_url);
      if (embeds && embeds.length) {
        return res.json({
          church_name: church.name || me.church_name,
          source: 'website',
          videos: embeds.slice(0, 4).map(e => ({ provider: e.provider, video_id: e.videoId, title: null, thumbnail_url: null, published_at: null })),
        });
      }
    } catch (err) {
      console.error('[church/videos] website fetch failed:', err.message);
    }
  }

  res.json({
    videos: [], source: 'none',
    church_name: church.name || me.church_name,
    youtube_configured: youtube.isConfigured(),
  });
});


// ---- live journey session: stream real distance from a smart trainer,
// treadmill, GPS or a declared pace, persisted as it goes so a refresh or a
// dropped Bluetooth connection never erases the session. ----
router.post('/journeys/:key/progress', requireAuth, (req, res) => {
  const addKm = Number(req.body && req.body.add_km);
  if (!Number.isFinite(addKm) || addKm <= 0) return res.status(400).json({ error: 'invalid_distance' });
  // Guard against a runaway client loop sending absurd jumps in one tick.
  if (addKm > 5) return res.status(400).json({ error: 'implausible_jump', hint: 'Distance increments must be small and continuous.' });
  const result = advanceJourney(req.session.userId, req.params.key, addKm);
  if (!result) return res.status(404).json({ error: 'not_joined_or_complete' });
  notifyJourneyProgress(req.session.userId, [result]);
  res.json({
    progress_km: result.progress_km,
    percent: result.percent,
    completed: result.completed,
    crossed: result.waypoints,
  });
});

// --- Developer webhooks ----------------------------------------------------
// Register an HTTPS endpoint and receive your own account's events live. The
// secret is returned once, at creation and on rotation, and never again.

router.get('/webhooks/events', (req, res) => res.json({ events: webhooks.TOPICS }));

router.get('/webhooks', requireAuth, (req, res) => {
  res.json({ webhooks: webhooks.list(req.session.userId) });
});

router.post('/webhooks', requireAuth, (req, res) => {
  const r = webhooks.create(req.session.userId, req.body || {});
  if (r.error) return res.status(400).json(r);
  res.status(201).json(r);
});

router.patch('/webhooks/:id', requireAuth, (req, res) => {
  const r = webhooks.update(req.session.userId, req.params.id, req.body || {});
  if (r.error) return res.status(r.error === 'not_found' ? 404 : 400).json(r);
  res.json(r);
});

router.post('/webhooks/:id/rotate', requireAuth, (req, res) => {
  const r = webhooks.rotate(req.session.userId, req.params.id);
  if (r.error) return res.status(404).json(r);
  res.json(r);
});

router.get('/webhooks/:id/deliveries', requireAuth, (req, res) => {
  const d = webhooks.deliveries(req.session.userId, req.params.id);
  if (!d) return res.status(404).json({ error: 'not_found' });
  res.json({ deliveries: d });
});

// A test event, so a developer can verify signature handling without waiting
// for a real workout. It is delivered through the identical signed path.
router.post('/webhooks/:id/test', requireAuth, (req, res) => {
  const hook = webhooks.list(req.session.userId).find(h => h.id === req.params.id);
  if (!hook) return res.status(404).json({ error: 'not_found' });
  publish('workout.completed', {
    user_id: req.session.userId, workout_id: null, calories: 0,
    avg_hr: null, max_hr: null, test: true,
  });
  res.json({ ok: true, note: 'A test workout.completed event was dispatched.' });
});

router.delete('/webhooks/:id', requireAuth, (req, res) => {
  const r = webhooks.remove(req.session.userId, req.params.id);
  if (r.error) return res.status(404).json(r);
  res.json(r);
});

// --- The right word at the right physiological moment ----------------------
// The live session posts its telemetry here every so often and gets back the
// moment it is actually in, plus scripture chosen for that moment. Heart-rate
// derived moments are only ever returned when a real monitor is streaming;
// `measured` says which kind of read this was, and the client shows that.
router.post('/live/moment', requireAuth, async (req, res) => {
  const b = req.body || {};
  const me = db.prepare('SELECT max_hr, resting_hr, birth_year, tradition, bible_version_id FROM users WHERE id = ?')
    .get(req.session.userId);
  const maxHr = effortLib.estimatedMaxHr(me || {});

  const state = moments.classify({
    elapsed_sec: b.elapsed_sec,
    distance_km: b.distance_km,
    total_km: b.total_km,
    speed_kmh: b.speed_kmh,
    recent_speeds: b.recent_speeds,
    // Heart rate is passed through only when it came from a connected monitor.
    hr: b.hr_measured ? b.hr : null,
    recent_hr: b.hr_measured ? b.recent_hr : null,
    max_hr: maxHr,
    terrain: b.terrain,
    // The client says why it asked. A fade or an approaching climb is something
    // it can see and the classifier cannot.
    trigger: b.trigger,
    grade_ahead: b.grade_ahead,
  });

  // Resolve a verse we have not already shown this session. A reference that
  // does not resolve against the local library is skipped, never invented.
  const seen = Array.isArray(b.seen_refs) ? b.seen_refs.map(String) : [];
  let verse = null;

  // First ask Gloo to weigh this member's actual numbers against the authored
  // shortlist for the moment, in their own tradition, and to write a line about
  // the choice. The verse text still comes from YouVersion or the local
  // library — see lib/companion.js. Null means unconfigured, unreachable, or
  // an answer that failed a check, and the authored path below takes over.
  try {
    const picked = await companion.momentVerse({
      userId: req.session.userId,
      tradition: me && me.tradition,
      versionId: me && me.bible_version_id,
      moment: state.moment,
      seenRefs: seen,
      measured: state.measured,
      zone: state.zone,
      hr: b.hr_measured ? b.hr : null,
      distanceKm: Number(b.distance_km),
      totalKm: Number(b.total_km),
      elapsedSec: Number(b.elapsed_sec),
      gradeAhead: Number(b.grade_ahead),
      reason: state.reason,
    });
    if (picked) {
      verse = {
        reference: picked.reference,
        text: picked.text,
        note: picked.note,            // the only model-written words shown
        chosen_by: 'gloo',
        tradition: picked.tradition,
      };
    }
  } catch { /* the authored path is the fallback for everything */ }

  const tried = seen.slice();
  for (let i = 0; i < 6 && !verse; i++) {
    const ref = moments.pickRef(state.moment, tried);
    if (!ref) break;
    const text = lookupScriptureText(ref);
    if (text) verse = { reference: ref, text, chosen_by: 'authored' };
    else tried.push(ref);
  }

  // A strap with no max-HR reference can stream all day and never produce a
  // zone. Say so explicitly rather than degrading silently to 'steady'.
  res.json({
    ...state,
    verse,
    zone_available: !!maxHr,
    zone_hint: (!maxHr && b.hr_measured)
      ? 'Add your birth year or max heart rate in your profile to get zones and effort scoring.'
      : null,
  });
});

// --- Segments, leaderboards and ghosts -------------------------------------
// The stretch between two waypoints is a timed segment. Times are kept, ranked
// against every rider's own best, and replayed as ghosts so a route has company
// on it. Ghosts are built only from rides that actually happened.

function journeyByKey(key) {
  return db.prepare('SELECT * FROM journeys WHERE key = ?').get(key) || null;
}

router.get('/journeys/:key/segments', (req, res) => {
  const j = journeyByKey(req.params.key);
  if (!j) return res.status(404).json({ error: 'not_found' });
  const segs = segments.segmentsFor(j.id, j.total_km);
  const me = req.session.userId || null;
  res.json({
    segments: segs.map(sg => ({
      ...sg,
      leaderboard: segments.leaderboard(j.id, sg.index, 5),
      your_best_sec: me ? (db.prepare(`SELECT MIN(duration_sec) AS b FROM journey_segment_times
                                       WHERE user_id = ? AND journey_id = ? AND segment_index = ?`)
        .get(me, j.id, sg.index).b || null) : null,
    })),
  });
});

router.get('/journeys/:key/ghosts', (req, res) => {
  const j = journeyByKey(req.params.key);
  if (!j) return res.status(404).json({ error: 'not_found' });
  const me = req.session.userId || null;
  const others = segments.ghostsFor(j.id, { excludeUserId: me || '', limit: 4 });
  const mine = me ? segments.personalGhost(me, j.id) : null;
  res.json({
    ghosts: (mine ? [mine] : []).concat(others),
    // Said plainly so the client never has to guess why the road is empty.
    note: (!others.length && !mine)
      ? 'Nobody has ridden this road yet. Your times will set the first mark on it.'
      : null,
  });
});

// A segment was completed live. The client sends the elapsed time it measured
// for that stretch; the server decides whether it counts and where it ranks.
router.post('/journeys/:key/segments/:index/complete', requireAuth, (req, res) => {
  const j = journeyByKey(req.params.key);
  if (!j) return res.status(404).json({ error: 'not_found' });
  const idx = Number(req.params.index);
  const segs = segments.segmentsFor(j.id, j.total_km);
  const seg = segs.find(x => x.index === idx);
  if (!seg) return res.status(404).json({ error: 'no_such_segment' });

  const result = segments.recordSegment(
    req.session.userId, j.id, seg,
    Number(req.body && req.body.duration_sec),
    !!(req.body && req.body.measured));
  if (!result) return res.status(400).json({ error: 'implausible_time' });

  if (result.personal_best && result.previous_best_sec != null) {
    notify(req.session.userId, 'segment',
      `Personal best on ${seg.from} → ${seg.to}: ${Math.round(result.duration_sec)}s, ` +
      `${Math.round(result.previous_best_sec - result.duration_sec)}s faster than before.`,
      { journey_key: j.key, segment_index: idx });
  }
  publish('segment.completed', {
    user_id: req.session.userId, journey_key: j.key, segment_index: idx,
    duration_sec: result.duration_sec, personal_best: result.personal_best, rank: result.rank,
  });
  res.json({ ...result, from: seg.from, to: seg.to });
});

// --- Creator overlay -------------------------------------------------------
// A browser source for OBS. The streamer holds a capability token; the public
// read behind it exposes only what an overlay draws.

router.get('/overlay/token', requireAuth, (req, res) => {
  const t = overlay.tokenFor(req.session.userId);
  res.json({ token: t ? t.token : null, created_at: t ? t.created_at : null });
});

router.post('/overlay/token', requireAuth, (req, res) => {
  // Issuing again rotates, which is also how you revoke a URL you have shared.
  res.status(201).json({ ...overlay.issueToken(req.session.userId) });
});

router.delete('/overlay/token', requireAuth, (req, res) => {
  res.json(overlay.revokeToken(req.session.userId));
});

// The live session posts here while riding.
router.post('/overlay/state', requireAuth, (req, res) => {
  if (!overlay.tokenFor(req.session.userId)) return res.status(409).json({ error: 'overlay_not_enabled' });
  res.json(overlay.putState(req.session.userId, req.body));
});

// Public: read by token. No session, no cookies — OBS cannot sign in.
router.get('/overlay/s/:token', (req, res) => {
  const data = overlay.readByToken(req.params.token);
  if (!data) return res.status(404).json({ error: 'unknown_overlay' });
  res.set('cache-control', 'no-store');
  res.json(data);
});

// --- Name availability -----------------------------------------------------
router.get('/username-available', (req, res) => {
  const me = req.session.userId || null;
  const r = usernames.check(req.query.name || '', me);
  res.json({
    available: !r.error,
    error: r.error || null,
    message: r.message || null,
    suggestion: r.error === 'name_taken' ? usernames.suggest(req.query.name || '', me) : null,
  });
});

// --- Search across the whole app -------------------------------------------
// One query, grouped results: people, routes, challenges, groups, videos,
// podcasts and scripture. Scripture goes through the same verified table as
// everything else, so a search can never surface a verse we cannot trace.
router.get('/search', (req, res) => {
  const raw = String(req.query.q || '').trim();
  if (raw.length < 2) return res.json({ q: raw, groups: [], total: 0 });
  const like = '%' + raw.replace(/[%_]/g, m => '\\' + m) + '%';
  const limit = Math.min(Number(req.query.limit) || 6, 20);
  const groups = [];
  const add = (type, label, items) => { if (items.length) groups.push({ type, label, items }); };

  add('people', 'People', db.prepare(
    `SELECT id, display_name, church, job,
            CASE WHEN avatar_data IS NOT NULL THEN 1 ELSE 0 END AS has_avatar
     FROM users WHERE display_name LIKE ? ESCAPE '\\'
     ORDER BY length(display_name) LIMIT ?`).all(like, limit)
    .map(u => ({ id: u.id, title: u.display_name,
                 subtitle: [u.job, u.church].filter(Boolean).join(' · ') || null,
                 has_avatar: !!u.has_avatar })));

  add('journeys', 'Journeys', db.prepare(
    `SELECT key, name, subtitle, total_km FROM journeys
     WHERE name LIKE ? ESCAPE '\\' OR subtitle LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\'
     ORDER BY length(name) LIMIT ?`).all(like, like, like, limit)
    .map(j => ({ id: j.key, title: j.name, subtitle: j.subtitle })));

  add('challenges', 'Challenges', db.prepare(
    `SELECT key, name, description FROM challenges
     WHERE name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\'
     ORDER BY length(name) LIMIT ?`).all(like, like, limit)
    .map(c => ({ id: c.key, title: c.name, subtitle: c.description })));

  add('groups', 'Groups', db.prepare(
    `SELECT id, name, description FROM groups
     WHERE name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\'
     ORDER BY length(name) LIMIT ?`).all(like, like, limit)
    .map(g => ({ id: g.id, title: g.name, subtitle: g.description })));

  try {
    add('videos', 'Videos', db.prepare(
      `SELECT id, title, category FROM videos
       WHERE title LIKE ? ESCAPE '\\' ORDER BY length(title) LIMIT ?`).all(like, limit)
      .map(v => ({ id: v.id, title: v.title, subtitle: v.category })));
  } catch { /* video library table may not be populated */ }

  try {
    add('podcasts', 'Podcasts', db.prepare(
      `SELECT e.id, e.title, p.title AS show_title FROM podcast_episodes e
       JOIN podcasts p ON p.id = e.podcast_id
       WHERE e.title LIKE ? ESCAPE '\\' ORDER BY length(e.title) LIMIT ?`).all(like, limit)
      .map(e => ({ id: e.id, title: e.title, subtitle: e.show_title })));
  } catch { /* podcasts are optional */ }

  // Scripture: exact reference first, then full text.
  const verses = [];
  const refRow = db.prepare(
    `SELECT book, chapter, verse, text FROM bible_verses
     WHERE lower(book || ' ' || chapter || ':' || verse) = lower(?) LIMIT 1`).get(raw);
  if (refRow) verses.push(refRow);
  if (verses.length < limit) {
    for (const v of db.prepare(
      `SELECT book, chapter, verse, text FROM bible_verses
       WHERE text LIKE ? ESCAPE '\\' LIMIT ?`).all(like, limit - verses.length)) {
      if (!verses.some(x => x.book === v.book && x.chapter === v.chapter && x.verse === v.verse)) verses.push(v);
    }
  }
  add('scripture', 'Scripture', verses.map(v => ({
    id: `${v.book} ${v.chapter}:${v.verse}`,
    title: `${v.book} ${v.chapter}:${v.verse}`,
    subtitle: v.text,
  })));

  res.json({ q: raw, groups, total: groups.reduce((a, g) => a + g.items.length, 0) });
});

// The guided breathing catalogue. Verse text is resolved from the verified
// table, so a pattern can never carry scripture we cannot trace.
router.get('/breathing/patterns', (req, res) => {
  res.json({ patterns: breathwork.list(lookupScriptureText) });
});

// Levels for a batch of users, so the ring around every avatar on a screen can
// be filled in with one request rather than one per face.
//
// Deliberately not under /users/: the earlier /users/:id route matches first in
// Express, so /users/xp would be read as a user whose id is "xp".
router.get('/xp/levels', (req, res) => {
  const ids = String(req.query.ids || '').split(',').map(x => x.trim()).filter(Boolean).slice(0, 100);
  if (!ids.length) return res.json({ levels: {} });
  const marks = ids.map(() => '?').join(',');
  const rows = db.prepare(`SELECT user_id, xp FROM user_xp WHERE user_id IN (${marks})`).all(...ids);
  const levels = {};
  for (const id of ids) {
    const row = rows.find(r => r.user_id === id);
    levels[id] = levelProgress(row ? row.xp : 0);
  }
  res.json({ levels });
});

// --- Direct messages --------------------------------------------------------
// Every route here authorises on membership of the thread. A thread the caller
// is not in returns 404 rather than 403, so ids cannot be probed for existence.

router.get('/dms', requireAuth, (req, res) => {
  res.json({ threads: dms.inbox(req.session.userId), unread: dms.totalUnread(req.session.userId) });
});

router.get('/dms/unread', requireAuth, (req, res) => {
  res.json({ unread: dms.totalUnread(req.session.userId) });
});

// Open (or reopen) the conversation with someone. Idempotent: one pair, one thread.
router.post('/dms/with/:userId', requireAuth, (req, res) => {
  const r = dms.openThread(req.session.userId, req.params.userId);
  if (r.error) {
    const code = r.error === 'no_such_user' ? 404 : r.error === 'blocked' ? 403 : 400;
    return res.status(code).json(r);
  }
  res.json({ thread_id: r.thread.id, user: { id: r.other.id, display_name: r.other.display_name } });
});

router.get('/dms/:threadId', requireAuth, (req, res) => {
  const data = dms.messages(req.session.userId, req.params.threadId);
  if (!data) return res.status(404).json({ error: 'not_found' });
  res.json(data);
});

router.post('/dms/:threadId', requireAuth, (req, res) => {
  const r = dms.send(req.session.userId, req.params.threadId, req.body && req.body.body);
  if (r.error) {
    const code = r.error === 'not_found' ? 404 : r.error === 'blocked' ? 403 : 400;
    return res.status(code).json(r);
  }
  notify(r.recipient_id, 'dm', `${displayName(req.session.userId)} sent you a message.`,
    { thread_id: req.params.threadId });
  res.status(201).json({ message: r.message });
});

router.post('/dms/block/:userId', requireAuth, (req, res) => {
  res.json(dms.block(req.session.userId, req.params.userId));
});

router.delete('/dms/block/:userId', requireAuth, (req, res) => {
  res.json(dms.unblock(req.session.userId, req.params.userId));
});

// --- Your own training log --------------------------------------------------
// Every workout route until now was a POST: you could record a session and never
// see it again unless you happened to post it to the feed. These are the read
// side. Both are scoped to the caller — a workout is private to whoever did it,
// and an id belonging to somebody else is a 404 rather than a 403 so ids cannot
// be probed.

router.get('/workouts', requireAuth, (req, res) => {
  const uid = req.session.userId;
  const limit = Math.min(Number(req.query.limit) || 30, 100);
  const before = req.query.before || null;   // ISO cursor for older pages

  const rows = db.prepare(`
    SELECT w.id, w.type, w.start_time, w.end_time, w.duration_sec, w.distance_km,
           w.calories, w.avg_hr, w.max_hr, w.effort_score, w.peak_zone, w.note, w.source,
           CASE WHEN w.gps_path IS NOT NULL THEN 1 ELSE 0 END AS has_route,
           (SELECT p.id FROM posts p WHERE p.workout_id = w.id AND p.user_id = w.user_id LIMIT 1) AS post_id
    FROM workouts w
    WHERE w.user_id = @uid
      AND (@before IS NULL OR w.start_time < @before)
      AND w.end_time IS NOT NULL
    ORDER BY w.start_time DESC
    LIMIT @limit
  `).all({ uid, before, limit });

  const workouts = rows.map(w => ({
    ...w,
    has_route: !!w.has_route,
    shared: !!w.post_id,
    // Pace only where there is distance and time to derive it from.
    pace_min_per_km: (w.distance_km > 0.05 && w.duration_sec > 0)
      ? Math.round(((w.duration_sec / 60) / w.distance_km) * 100) / 100
      : null,
  }));

  res.json({
    workouts,
    // A cursor rather than a page number, so a new workout mid-scroll cannot
    // shift the window and duplicate a row.
    next_before: workouts.length === limit ? workouts[workouts.length - 1].start_time : null,
  });
});

router.get('/workouts/:id', requireAuth, (req, res) => {
  const uid = req.session.userId;
  const w = db.prepare('SELECT * FROM workouts WHERE id = ? AND user_id = ?').get(req.params.id, uid);
  if (!w) return res.status(404).json({ error: 'not_found' });

  // Heart-rate samples, for the trace. Absent when nothing was ever measured —
  // never filled in from pace.
  const samples = db.prepare(
    'SELECT time, heart_rate FROM biometric_samples WHERE workout_id = ? AND heart_rate IS NOT NULL ORDER BY time'
  ).all(w.id);

  let route = null;
  if (w.gps_path) { try { route = JSON.parse(w.gps_path); } catch { route = null; } }

  let timeInZone = null;
  if (w.time_in_zone) { try { timeInZone = JSON.parse(w.time_in_zone); } catch { timeInZone = null; } }

  const me = db.prepare('SELECT max_hr, resting_hr, birth_year FROM users WHERE id = ?').get(uid);
  const maxHrInfo = effortLib.maxHrInfo(me || {});

  const post = db.prepare('SELECT id, visibility, show_route FROM posts WHERE workout_id = ? AND user_id = ?')
    .get(w.id, uid) || null;

  res.json({
    workout: {
      id: w.id, type: w.type, start_time: w.start_time, end_time: w.end_time,
      duration_sec: w.duration_sec, distance_km: w.distance_km, calories: w.calories,
      avg_hr: w.avg_hr, max_hr: w.max_hr, effort_score: w.effort_score,
      peak_zone: w.peak_zone, note: w.note, source: w.source,
      pace_min_per_km: (w.distance_km > 0.05 && w.duration_sec > 0)
        ? Math.round(((w.duration_sec / 60) / w.distance_km) * 100) / 100
        : null,
    },
    // Your own workout, so you see your own full trace — the privacy trim
    // applies to what gets published, not to what you can see of your own ride.
    route,
    time_in_zone: timeInZone,
    hr_samples: samples.map(x => ({ t: x.time, hr: x.heart_rate })),
    max_hr_reference: maxHrInfo ? { value: maxHrInfo.value, source: maxHrInfo.source } : null,
    partners: db.prepare(`SELECT u.id, u.display_name, wp.status
                          FROM workout_partners wp JOIN users u ON u.id = wp.partner_user_id
                          WHERE wp.workout_id = ?`).all(w.id),
    post,
  });
});

// Remove a workout of your own. Scoped, and it takes its samples with it.
router.delete('/workouts/:id', requireAuth, (req, res) => {
  const uid = req.session.userId;
  const w = db.prepare('SELECT id FROM workouts WHERE id = ? AND user_id = ?').get(req.params.id, uid);
  if (!w) return res.status(404).json({ error: 'not_found' });
  db.prepare('DELETE FROM biometric_samples WHERE workout_id = ?').run(w.id);
  db.prepare('DELETE FROM workout_partners WHERE workout_id = ?').run(w.id);
  db.prepare('UPDATE posts SET workout_id = NULL WHERE workout_id = ?').run(w.id);
  db.prepare('DELETE FROM workouts WHERE id = ?').run(w.id);
  res.json({ ok: true });
});

// --- Scripture beyond the local library -------------------------------------
// The ingested library is 22 books. The YouVersion Platform covers the canon in
// eleven English translations, so a reference outside those books resolves to
// real text instead of being shown bare. Both paths return real text or nothing.

router.get('/bible/versions', (req, res) => {
  res.json({
    configured: youversion.isConfigured(),
    default_version_id: youversion.DEFAULT_VERSION,
    versions: youversion.versions(),
  });
});

/**
 * Resolve one reference. Local library first — it is verified, already here, and
 * needs no network. YouVersion fills the gaps and provides other translations.
 */
router.get('/bible/passage', async (req, res) => {
  const ref = String(req.query.ref || '').trim();
  if (!ref) return res.status(400).json({ error: 'missing_reference' });
  const wanted = req.query.version ? Number(req.query.version) : null;

  // Only prefer local when no specific translation was asked for.
  if (!wanted) {
    const local = lookupScriptureText(ref);
    if (local) {
      return res.json({
        reference: ref, text: local, source: 'local',
        translation: 'WEB',
        youversion_url: youversion.deepLink(ref, youversion.DEFAULT_VERSION),
      });
    }
  }

  const p = await youversion.passage(ref, wanted);
  if (!p) {
    // Say so plainly. A reference with no text behind it is shown as a
    // reference, exactly as before this API existed.
    return res.status(404).json({
      error: 'no_text_available', reference: ref,
      configured: youversion.isConfigured(),
    });
  }
  const v = youversion.versions().find(x => x.id === p.version_id);
  res.json({
    reference: p.reference, text: p.text, source: 'youversion',
    version_id: p.version_id,
    translation: v ? v.abbreviation : null,
    youversion_url: youversion.deepLink(ref, p.version_id),
  });
});

module.exports = router;
