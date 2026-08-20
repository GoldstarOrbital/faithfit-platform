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
const reels = require('../lib/reels');
const apikeys = require('../lib/apikeys');
const push = require('../lib/push');
const daily = require('../lib/daily');
const reminders = require('../lib/reminders');
const segments = require('../lib/segments');
const overlay = require('../lib/overlay');
const usernames = require('../lib/usernames');
const youversion = require('../lib/youversion');
const motivation = require('../lib/motivation');
const gloo = require('../lib/gloo');
const companion = require('../lib/companion');
const breathwork = require('../lib/breathwork');
const dms = require('../lib/dms');
const athletes = require('../lib/athletes');
const coaches = require('../lib/coaches');
const schools = require('../lib/schools');
const mentions = require('../lib/mentions');
const records = require('../lib/records');
const circle = require('../lib/circle');
const oauth = require('../lib/oauth');
const strava = require('../lib/strava');
const googleHealth = require('../lib/google-health');
const wearables = require('../lib/wearables');
const recovery = require('../lib/recovery');
const { searchNearbyChurches } = require('../lib/overpass');
const youtube = require('../lib/youtube');
const sermonSummary = require('../lib/sermon-summary');
const { fetchChurchWebsiteEmbeds, isHttpUrl } = require('../lib/church-website');
const webhooks = require('../lib/webhooks');
const accountSecurity = require('../lib/account-security');
const developerVerification = require('../lib/developer-verification');
const admin = require('../lib/admin');
const launchNotify = require('../lib/launch-notify');
const news = require('../lib/news');
const media = require('../lib/media');
const retention = require('../lib/retention');
const workoutKudos = require('../lib/workout-kudos');
const scripturePractice = require('../lib/scripture-practice');
const verseSaves = require('../lib/verse-saves');

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
  { type: 'Pickleball', icon: '🏓', d: true },
  { type: 'Tennis', icon: '🎾', d: false },
  { type: 'Basketball', icon: '🏀', d: false },
  { type: 'Skiing', icon: '⛷️', d: true },
  { type: 'Workout', icon: '💪', d: false },
];
const ACTIVITY_SET = new Set(ACTIVITY_TYPES.map(a => a.type));

const router = express.Router();
const postRateWindow = new Map();
const webhookTestWindow = new Map();
const dmRateWindow = new Map();
const commentRateWindow = new Map();
const churchSearchWindow = new Map();
const demoAuthWindow = new Map();
const churchVideosWindow = new Map();

// ---- auth: real email + password accounts (scrypt-hashed). ----
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// 'circle' sits between private and followers: a named subset of your own
// followers. See lib/circle.js for why this is safe to add incrementally --
// every visibility check in this file matches positively, so any surface not
// taught about circle posts excludes them rather than leaking them.
const VISIBILITIES = ['private', 'circle', 'followers', 'public'];
const DEMO_LOGIN_EMAILS = Object.freeze([
  'alex@functioningfaith.demo',
  'priya@functioningfaith.demo',
  'sam@functioningfaith.demo',
]);
const SYNTHETIC_ACCOUNT_TOKEN_RE = /\b(?:test|qa|e2e|probe|check|verify|monitor|synthetic|smoke|load|bot)\b/i;

function isDemoLoginEmail(email) {
  return DEMO_LOGIN_EMAILS.includes(String(email || '').trim().toLowerCase());
}

function isLikelySyntheticAccount(row) {
  const email = String(row?.email || '').trim().toLowerCase();
  const localPart = email.split('@')[0].replace(/[._+-]+/g, ' ');
  const displayName = String(row?.display_name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  if (email.endsWith('@functioningfaith.demo')) return true;
  return SYNTHETIC_ACCOUNT_TOKEN_RE.test(localPart) || SYNTHETIC_ACCOUNT_TOKEN_RE.test(displayName);
}

function demoChurchVideos(limit = 4) {
  return db.prepare(`
    SELECT provider, video_id, title, thumbnail_url, published_at
    FROM videos
    ORDER BY datetime(COALESCE(published_at, datetime('now'))) DESC
    LIMIT ?
  `).all(limit).map(v => ({
    provider: v.provider || 'youtube',
    video_id: v.video_id,
    title: v.title || 'Church video',
    thumbnail_url: v.thumbnail_url || null,
    published_at: v.published_at || null,
  }));
}

async function captchaAccepted(req) {
  if (!process.env.TURNSTILE_SECRET_KEY) return true;
  const token=String(req.body?.captcha_token||'');
  if(!token) return false;
  try {
    const body=new URLSearchParams({secret:process.env.TURNSTILE_SECRET_KEY,response:token,remoteip:String(req.ip||'')});
    const response=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',body,signal:AbortSignal.timeout(5000)});
    const result=await response.json(); return result.success===true;
  } catch { return false; }
}

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
  if (typeof dataUrl !== 'string') return { ok: false, error: 'invalid_image', hint: 'Choose a JPEG, PNG, or WebP image.' };
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) {
    return { ok: false, error: 'invalid_image', hint: 'Choose a JPEG, PNG, or WebP image.' };
  }
  let decoded;
  try { decoded = Buffer.from(match[2], 'base64'); } catch { return { ok: false, error: 'invalid_image' }; }
  if (!decoded.length || decoded.length > MAX_IMAGE_BYTES) {
    return { ok: false, error: 'image_too_large', hint: `Image must be under ${Math.round(MAX_IMAGE_BYTES / 1024)}KB after resizing.` };
  }
  const jpeg = decoded.length >= 3 && decoded[0] === 0xff && decoded[1] === 0xd8 && decoded[2] === 0xff;
  const png = decoded.length >= 8 && decoded.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
  const webp = decoded.length >= 12 && decoded.subarray(0, 4).toString() === 'RIFF' && decoded.subarray(8, 12).toString() === 'WEBP';
  if ((match[1] === 'jpeg' && !jpeg) || (match[1] === 'png' && !png) || (match[1] === 'webp' && !webp)) {
    return { ok: false, error: 'invalid_image', hint: 'The file contents do not match the image type.' };
  }
  return { ok: true, bytes: decoded.length };
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
  const details = extra || {};
  const destination = isSafeInternalNotificationUrl(details.url) ? details.url : notificationDestination(type, details);
  const payload = { message, ...details, url: destination };
  db.prepare('INSERT INTO notifications (id, user_id, type, payload) VALUES (?, ?, ?, ?)')
    .run(randomUUID(), userId, type, JSON.stringify(payload));
  // Push respects the member's explicit social/reminder category choice. It is
  // fire-and-forget so a browser push outage never delays the app action.
  push.send(userId, notificationPushCategory(type), { title: 'Functioning Faith', body: message, url: destination, tag: `${type}:${details.post_id || details.thread_id || details.event_id || details.invite_id || 'notification'}` }).catch(() => {});
}
function notificationPushCategory(type) {
  if (type === 'security' || type === 'moderation') return 'security';
  if (type === 'verse' || type === 'reflection') return 'verse_reply';
  return ['challenge_complete', 'streak', 'effort', 'journey', 'badge', 'quest'].includes(type) ? 'reminders' : 'social';
}
function isSafeInternalNotificationUrl(value) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//');
}
function notificationDestination(type, details) {
  details = { ...details, ...(details && details.data && typeof details.data === 'object' ? details.data : {}) };
  const q = new URLSearchParams();
  if (type === 'reflection' && details.reference) { q.set('open', 'verse'); q.set('ref', details.reference); }
  else if (details.post_id) { q.set('open', 'post'); q.set('post_id', details.post_id); }
  else if (details.thread_id && ['dm', 'workout_invite', 'workout_invite_response'].includes(type)) { q.set('open', 'dm'); q.set('thread_id', details.thread_id); }
  else if (details.group_id || details.event_id) { q.set('open', 'group'); if (details.group_id) q.set('group_id', details.group_id); if (details.event_id) q.set('event_id', details.event_id); }
  else if (details.workout_id) { q.set('open', 'workout'); q.set('workout_id', details.workout_id); }
  else if (details.story_id) { q.set('open', 'story'); q.set('story_id', details.story_id); }
  else if (details.reference) { q.set('open', 'verse'); q.set('ref', details.reference); }
  else if (type === 'journey' || type === 'segment') { q.set('open', 'journeys'); if (details.journey_key) q.set('journey_key', details.journey_key); }
  else if (['challenge_complete', 'quest'].includes(type)) { q.set('open', 'challenges'); }
  else if (type === 'follow') { q.set('open', 'profile'); if (details.follower_id) q.set('user_id', details.follower_id); }
  else if (type === 'badge') { q.set('open', 'profile'); }
  else if (['streak', 'effort'].includes(type)) { q.set('open', 'stats'); }
  else { q.set('open', 'home'); }
  return '/?' + q.toString();
}
function displayName(userId) {
  return db.prepare('SELECT display_name FROM users WHERE id = ?').get(userId)?.display_name || 'Someone';
}

// Create a real account. Password is scrypt-hashed; email is stored lowercased
// and must be unique. Signs the new user in on success.
router.post('/auth/register', async (req, res) => {
  const { email, password, display_name, date_of_birth, terms_accepted } = req.body || {};
  const mail = String(email || '').trim().toLowerCase();
  const name = String(display_name || '').trim().slice(0, 60);
  const pw = String(password || '');
  if (!(await captchaAccepted(req))) return res.status(400).json({ error:'captcha_required' });

  if (!EMAIL_RE.test(mail)) return res.status(400).json({ error: 'invalid_email' });
  const policy = accountSecurity.passwordPolicy(pw);
  if (!policy.ok) return res.status(400).json({ error: 'weak_password', hint: policy.hint });
  if (!name) return res.status(400).json({ error: 'missing_display_name' });
  const age = accountSecurity.ageFromDob(date_of_birth);
  if (age == null) return res.status(400).json({ error: 'date_of_birth_required' });
  if (age < 13) return res.status(403).json({ error: 'minimum_age', hint: 'Functioning Faith accounts are currently available to people age 13 and older.' });
  if (!terms_accepted) return res.status(400).json({ error: 'terms_required', terms_version: accountSecurity.TERMS_VERSION });

  const existing = db.prepare('SELECT 1 FROM users WHERE email = ?').get(mail);
  if (existing) return res.status(409).json({ error: 'email_taken' });

  // Names are unique, so people can be found and mentioned unambiguously.
  const nameCheck = usernames.check(name, null);
  if (nameCheck.error) return res.status(409).json(nameCheck);

  const id = randomUUID();
  db.prepare(`INSERT INTO users
    (id,email,display_name,password_hash,date_of_birth,age,terms_version,terms_accepted_at)
    VALUES (?,?,?,?,?,?,?,?)`)
    .run(id, mail, nameCheck.name, await hashPassword(pw), date_of_birth, age,
      accountSecurity.TERMS_VERSION, new Date().toISOString());
  // Teen accounts begin private by design. They can deliberately broaden an
  // audience later, but registration never exposes a minor by default.
  if (age < 18) db.prepare(`UPDATE users SET profile_visibility='private',
    follower_list_visibility='private',message_permission='followers',
    tag_permission='nobody',comment_permission='followers',default_visibility='private'
    WHERE id=?`).run(id);
  db.prepare('INSERT OR IGNORE INTO user_xp (user_id, xp, level) VALUES (?, 0, 1)').run(id);

  accountSecurity.startSession(req, id, 'password', { initialRegistration: true });
  accountSecurity.audit(id, 'terms_accepted', req, { version: accountSecurity.TERMS_VERSION });
  res.status(201).json({ ok: true, user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)) });
});

// Sign in with email + password.
router.post('/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  const mail = String(email || '').trim().toLowerCase();
  if (!(await captchaAccepted(req))) return res.status(400).json({ error:'captcha_required' });
  const allowed = accountSecurity.loginAllowed(req, mail);
  if (!allowed.ok) { res.setHeader('Retry-After', String(allowed.retryAfter)); return res.status(429).json({ error: 'too_many_attempts', retry_after: allowed.retryAfter }); }
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(mail);
  // Constant-ish response: same error whether the email is unknown or the
  // password is wrong, so we don't leak which emails have accounts.
  if (!row || !(await verifyPassword(String(password || ''), row.password_hash))) {
    const failed = accountSecurity.recordLoginFailure(req, mail);
    if (failed.retryAfter) res.setHeader('Retry-After', String(failed.retryAfter));
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  accountSecurity.clearLoginFailures(req, mail);
  if (accountSecurity.mfaEnabled(row.id)) {
    req.session.mfaPending = { userId: row.id, method: 'password', createdAt: Date.now() };
    return res.status(202).json({ mfa_required: true });
  }
  const started = accountSecurity.startSession(req, row.id, 'password');
  if (started.newDevice) notify(row.id, 'security', `New sign-in on ${started.deviceName}.`, { url: '/?open=profile&settings=security' });
  res.json({ ok: true, user: publicUser(row) });
});

router.post('/auth/mfa/complete', (req, res) => {
  const pending = req.session?.mfaPending;
  if (!pending || Date.now() - pending.createdAt > 5 * 60 * 1000) return res.status(401).json({ error: 'mfa_session_expired' });
  if (!accountSecurity.verifyMfa(pending.userId, req.body?.code)) return res.status(401).json({ error: 'invalid_mfa_code' });
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(pending.userId);
  if (pending.native) {
    try {
      const code = accountSecurity.issueNativeAuthCode(pending.userId, `${pending.method}+mfa`, pending.handoffChallenge);
      req.session.mfaPending = null;
      return res.json({ ok: true, native_callback: nativeOAuthCallback({ code }) });
    } catch (err) {
      return res.status(400).json({ error: err.code || 'native_handoff_failed' });
    }
  }
  const started = accountSecurity.startSession(req, pending.userId, `${pending.method}+mfa`);
  if (started.newDevice) notify(user.id, 'security', `New sign-in on ${started.deviceName}.`, { url: '/?open=profile&settings=security' });
  res.json({ ok: true, user: publicUser(user) });
});

router.post('/auth/recovery/request', async (req,res) => {
  const mail=String(req.body?.email||'').trim().toLowerCase();
  const allowed=accountSecurity.loginAllowed(req,`recovery:${mail}`);
  if(!allowed.ok) return res.status(429).json({error:'too_many_attempts'});
  accountSecurity.recordLoginFailure(req,`recovery:${mail}`);
  try { await accountSecurity.requestPasswordReset(mail,baseUrl(req),req); }
  catch(err){ console.error('[security] recovery email failed:',err.message); }
  res.json({ok:true,message:'If that account exists and recovery email is configured, a reset link is on its way.'});
});
router.post('/auth/recovery/complete', async (req,res) => {
  const policy=accountSecurity.passwordPolicy(req.body?.password);
  if(!policy.ok) return res.status(400).json({error:'weak_password',hint:policy.hint});
  const userId=accountSecurity.consumePasswordReset(req.body?.token);
  if(!userId) return res.status(400).json({error:'invalid_or_expired_reset'});
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(await hashPassword(req.body.password),userId);
  accountSecurity.audit(userId,'password_reset_completed',req);
  const started=accountSecurity.startSession(req,userId,'password_recovery');
  notify(userId,'security',`Your password was reset on ${started.deviceName}.`,{url:'/?open=profile&settings=security'});
  res.json({ok:true});
});

router.post('/auth/logout', (req, res) => {
  accountSecurity.endSession(req);
  req.session = null;
  res.json({ ok: true });
});

// Sign in as one of the seeded EXAMPLE accounts (no password). Kept so people can
// explore a populated app instantly — clearly optional demo content, not the
// primary way to use Functioning Faith. Only works for the pre-seeded demo emails.
router.post('/auth/demo', (req, res) => {
  if (!allowWindow(demoAuthWindow, `demo:${req.ip}`, 20, 60 * 1000)) {
    return res.status(429).json({ error: 'too_many_attempts' });
  }
  const { user_id } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(user_id);
  if (!user || !isDemoLoginEmail(user.email)) return res.status(404).json({ error: 'demo_user_not_found' });
  accountSecurity.startSession(req, user.id, 'demo');
  res.json({ ok: true, user: publicUser(user) });
});

router.get('/users', requireAuth, (req, res) => {
  res.json(db.prepare(`
    SELECT id, display_name, bio_verse_ref,
      CASE WHEN avatar_data IS NOT NULL THEN 1 ELSE 0 END AS has_avatar
    FROM users u WHERE id = ? OR (profile_visibility <> 'private' AND NOT EXISTS (
      SELECT 1 FROM dm_blocks b WHERE (b.blocker_id=? AND b.blocked_id=u.id) OR (b.blocker_id=u.id AND b.blocked_id=?)))
  `).all(req.session.userId, req.session.userId, req.session.userId));
});

// Dedicated lightweight endpoint for fetching a user's real avatar image lazily.
// Kept out of list/feed responses so those payloads don't bloat with base64 images.
router.get('/users/:id/avatar', (req, res) => {
  const row = db.prepare('SELECT avatar_data,profile_visibility FROM users WHERE id = ?').get(req.params.id);
  if (!row || !row.avatar_data) return res.status(404).json({ error: 'no_avatar' });
  const me=req.session?.userId||null,own=me===req.params.id;
  const follows=me&&!!db.prepare('SELECT 1 FROM followers WHERE follower_id=? AND followee_id=?').get(me,req.params.id);
  if(!own&&(row.profile_visibility==='private'||(row.profile_visibility==='followers'&&!follows))) return res.status(404).json({error:'no_avatar'});
  if(me&&dms.isBlockedEitherWay(me,req.params.id)) return res.status(404).json({error:'no_avatar'});
  if(!validateDataUrlImage(row.avatar_data).ok) return res.status(404).json({error:'no_avatar'});
  res.json({ avatar_data: row.avatar_data });
});

// ---- OAuth / SSO sign-in (Google, Apple, Microsoft — generic OIDC connector) ----
// Only providers with real credentials configured (env vars) are reported —
// the frontend hides buttons for anything not actually wired up.
router.get('/auth/providers', (req, res) => {
  res.json({ providers: oauth.listConfiguredProviders() });
});
router.get('/auth/security-config', (req,res) => res.json({ turnstile_site_key:(process.env.TURNSTILE_SITE_KEY&&process.env.TURNSTILE_SECRET_KEY)?process.env.TURNSTILE_SITE_KEY:null }));

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
  const native = req.query.native === '1' && !link;
  const handoffChallenge = native ? String(req.query.handoff_challenge || '') : null;
  if (native && !/^[A-Za-z0-9_-]{43}$/.test(handoffChallenge)) {
    return res.status(400).json({ error: 'invalid_handoff_challenge' });
  }
  if (link && !accountSecurity.recentlyReauthenticated(req)) {
    return res.status(403).json({ error: 'recent_reauthentication_required', hint: 'Sign in again before linking a new identity.' });
  }

  req.session.oauthPending = { provider, state, nonce, verifier, link, native, handoffChallenge,
    userId: link ? req.session.userId : null, createdAt: Date.now() };
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
  const fail = (reason) => res.redirect(pending?.native
    ? nativeOAuthCallback({ error: reason })
    : `/?oauth_error=${encodeURIComponent(reason)}`);

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

    if (pending.link) {
      // Linking to an already-signed-in account.
      const existingOther = db.prepare('SELECT user_id FROM user_identities WHERE provider = ? AND provider_user_id = ?').get(provider, claims.sub);
      if (existingOther && existingOther.user_id !== pending.userId) { req.session.oauthPending = null; return fail('identity_linked_elsewhere'); }
      db.prepare(`INSERT INTO user_identities (id,user_id,provider,provider_user_id,email,email_verified) VALUES (?,?,?,?,?,?)
                  ON CONFLICT(provider,provider_user_id) DO UPDATE SET email=excluded.email,email_verified=excluded.email_verified`)
        .run(randomUUID(), pending.userId, provider, claims.sub, email, emailVerified ? 1 : 0);
      accountSecurity.audit(pending.userId, 'identity_linked', req, { provider });
      notify(pending.userId,'security',`${oauth.PROVIDERS[provider].label} sign-in was linked to your account.`,{url:'/?open=profile&settings=security'});
      req.session.oauthPending = null;
      return res.redirect('/?linked=' + provider);
    }

    // Sign-in-or-create.
    let userId;
    try { userId = resolveOauthUser(provider, claims); }
    catch (err) { req.session.oauthPending = null; return fail(err.code || 'sign_in_failed'); }
    req.session.oauthPending = null;
    if (accountSecurity.mfaEnabled(userId)) {
      req.session.mfaPending = { userId, method: provider, native: !!pending.native,
        handoffChallenge: pending.handoffChallenge || null, createdAt: Date.now() };
      return res.redirect(pending.native ? '/?mfa_required=1&native_oauth=1' : '/?mfa_required=1');
    }
    if (pending.native) {
      const code = accountSecurity.issueNativeAuthCode(userId, provider, pending.handoffChallenge);
      return res.redirect(nativeOAuthCallback({ code }));
    }
    const started = accountSecurity.startSession(req, userId, provider);
    if (started.newDevice) notify(userId, 'security', `New sign-in on ${started.deviceName}.`, { url: '/?open=profile&settings=security' });
    res.redirect('/?account_setup=1');
  } catch (err) {
    req.session.oauthPending = null;
    console.error(`[oauth] ${provider} callback failed:`, err.message);
    fail('sign_in_failed');
  }
}
router.get('/auth/oauth/:provider/callback', handleOauthCallback);
router.post('/auth/oauth/:provider/callback', handleOauthCallback); // Apple uses form_post

function nativeOAuthCallback({ code, error }) {
  const params = new URLSearchParams();
  if (code) params.set('code', code);
  if (error) params.set('error', error);
  return `functioningfaith://oauth/callback?${params.toString()}`;
}

// Exchanges the short-lived custom-scheme callback for the native app's normal
// signed, HttpOnly session cookie. A second PKCE verifier binds the callback to
// the app instance that initiated it, and every code can be redeemed once.
router.post('/auth/native/exchange', (req, res) => {
  if (req.get('x-functioning-faith-client') !== 'ios-native-v1' || !req.is('application/json')) {
    return res.status(400).json({ error: 'native_client_required' });
  }
  const grant = accountSecurity.consumeNativeAuthCode(req.body?.code, req.body?.handoff_verifier);
  if (!grant) return res.status(401).json({ error: 'invalid_or_expired_native_code' });
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(grant.userId);
  if (!user || user.suspended_at) return res.status(401).json({ error: 'account_unavailable' });
  const started = accountSecurity.startSession(req, user.id, grant.authMethod);
  if (started.newDevice) notify(user.id, 'security', `New sign-in on ${started.deviceName}.`, { url: '/?open=profile&settings=security' });
  const age = accountSecurity.ageFromDob(user.date_of_birth);
  const accountSetupRequired = age == null || age < 13 || !user.terms_accepted_at || user.terms_version !== accountSecurity.TERMS_VERSION;
  res.json({ ok: true, account_setup_required: accountSetupRequired });
});

// Native Sign in with Apple. Apple verifies the human and signs the identity
// token; this endpoint independently verifies signature, issuer, app audience,
// expiry, and the SHA-256 nonce before creating a Functioning Faith session.
router.post('/auth/native/apple', async (req, res) => {
  if (req.get('x-functioning-faith-client') !== 'ios-native-v1' || !req.is('application/json')) {
    return res.status(400).json({ error: 'native_client_required' });
  }
  const identityToken = String(req.body?.identity_token || '');
  const rawNonce = String(req.body?.nonce || '');
  if (!identityToken || rawNonce.length < 32 || rawNonce.length > 128) {
    return res.status(400).json({ error: 'invalid_apple_credential' });
  }
  try {
    const expectedNonce = require('crypto').createHash('sha256').update(rawNonce).digest('hex');
    const audience = process.env.APPLE_NATIVE_CLIENT_ID || 'com.functioningfaith.app';
    const claims = await oauth.verifyIdToken('apple', identityToken, { nonce: expectedNonce, audience });
    const userId = resolveOauthUser('apple', claims, req.body?.display_name);
    if (accountSecurity.mfaEnabled(userId)) {
      req.session.mfaPending = { userId, method: 'apple', native: false, createdAt: Date.now() };
      return res.status(202).json({ mfa_required: true });
    }
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(userId);
    const started = accountSecurity.startSession(req, userId, 'apple');
    if (started.newDevice) notify(userId, 'security', `New sign-in on ${started.deviceName}.`, { url: '/?open=profile&settings=security' });
    const age = accountSecurity.ageFromDob(user.date_of_birth);
    const accountSetupRequired = age == null || age < 13 || !user.terms_accepted_at || user.terms_version !== accountSecurity.TERMS_VERSION;
    res.json({ ok: true, account_setup_required: accountSetupRequired });
  } catch (err) {
    const status = err.code === 'account_link_required' ? 409 : 401;
    res.status(status).json({ error: err.code || 'invalid_apple_credential' });
  }
});

function resolveOauthUser(provider, claims, suppliedName) {
  const email = claims.email ? String(claims.email).trim().toLowerCase() : null;
  const emailVerified = claims.email_verified === true || claims.email_verified === 'true';
  const identity = db.prepare('SELECT user_id FROM user_identities WHERE provider=? AND provider_user_id=?').get(provider, claims.sub);
  if (identity) return identity.user_id;
  if (email && emailVerified && db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) {
    throw Object.assign(new Error('Existing account must explicitly link this identity.'), { code: 'account_link_required' });
  }
  const userId = randomUUID();
  const uniqueEmail = email || `${provider}-${claims.sub}@login.functioning-faith`;
  const fallback = email ? email.split('@')[0] : `${oauth.PROVIDERS[provider]?.label || provider} user`;
  const chosen = usernames.suggest(String(suppliedName || claims.name || fallback).trim().slice(0, 60) || 'Friend', null);
  db.prepare(`INSERT INTO users (id,email,display_name,terms_version,terms_accepted_at)
    VALUES (?,?,?,NULL,NULL)`).run(userId, uniqueEmail, chosen);
  db.prepare('INSERT OR IGNORE INTO user_xp (user_id,xp,level) VALUES (?,0,1)').run(userId);
  db.prepare('INSERT INTO user_identities (id,user_id,provider,provider_user_id,email,email_verified) VALUES (?,?,?,?,?,?)')
    .run(randomUUID(), userId, provider, claims.sub, email, emailVerified ? 1 : 0);
  return userId;
}

// Linked sign-in identities + connected data connectors for the current user —
// full transparency into what's linked, shown in Profile settings.
router.get('/auth/connections', requireAuth, (req, res) => {
  const uid = req.session.userId;
  const identities = db.prepare('SELECT provider, email, linked_at FROM user_identities WHERE user_id = ?').all(uid);
  const connectors = db.prepare('SELECT provider, scope, connected_at, last_synced_at FROM user_connectors WHERE user_id = ?').all(uid);
  res.json({ identities, connectors });
});

router.post('/auth/identities/:provider/unlink', requireAuth, (req, res) => {
  if (!accountSecurity.recentlyReauthenticated(req)) return res.status(403).json({ error: 'recent_reauthentication_required' });
  const user = db.prepare('SELECT password_hash FROM users WHERE id=?').get(req.session.userId);
  const count = db.prepare('SELECT COUNT(*) c FROM user_identities WHERE user_id=?').get(req.session.userId).c;
  if (!user?.password_hash && count <= 1) return res.status(409).json({ error: 'last_sign_in_method' });
  db.prepare('DELETE FROM user_identities WHERE user_id = ? AND provider = ?').run(req.session.userId, req.params.provider);
  accountSecurity.audit(req.session.userId, 'identity_unlinked', req, { provider: req.params.provider });
  notify(req.session.userId,'security',`${req.params.provider} sign-in was unlinked from your account.`,{url:'/?open=profile&settings=security'});
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
      .run(randomUUID(), pending.userId, 'strava', String(tokens.athlete?.id || ''), accountSecurity.protectSecret(tokens.access_token), accountSecurity.protectSecret(tokens.refresh_token),
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

// ---- Device / wearable sync via Google Health (Fitbit + anything else a
// member has synced into their Google Health account). Same shape as the
// Strava connector above -- OAuth start/callback into user_connectors,
// idempotent import via imported_activities -- with a second data path for
// daily step totals, which have no natural "workout" to attach to. ----
router.get('/connectors/google-health/configured', (req, res) => res.json({ configured: googleHealth.isConfigured() }));

router.get('/connectors/google-health/start', requireAuth, (req, res) => {
  if (!googleHealth.isConfigured()) return res.status(404).json({ error: 'google_health_not_configured' });
  const state = oauth.b64url(require('crypto').randomBytes(16));
  req.session.googleHealthPending = { state, userId: req.session.userId, createdAt: Date.now() };
  const redirectUri = `${baseUrl(req)}/api/connectors/google-health/callback`;
  res.redirect(googleHealth.buildAuthorizationUrl({ redirectUri, state }));
});

router.get('/connectors/google-health/callback', async (req, res) => {
  const pending = req.session.googleHealthPending;
  const fail = (reason) => res.redirect(`/?google_health_error=${encodeURIComponent(reason)}`);
  if (!pending || Date.now() - pending.createdAt > 10 * 60 * 1000) { req.session.googleHealthPending = null; return fail('session_expired'); }
  if (req.query.error) { req.session.googleHealthPending = null; return fail('access_denied'); }
  if (req.query.state !== pending.state) { req.session.googleHealthPending = null; return fail('state_mismatch'); }

  try {
    const redirectUri = `${baseUrl(req)}/api/connectors/google-health/callback`;
    const tokens = await googleHealth.exchangeCodeForTokens(req.query.code, redirectUri);
    // Google's token response has no stable per-provider user id the way
    // Strava's athlete.id does -- users/me is resolved per-request from the
    // access token itself, so provider_user_id is left empty here.
    db.prepare(`INSERT INTO user_connectors (id, user_id, provider, provider_user_id, access_token, refresh_token, expires_at, scope)
                VALUES (?,?,?,?,?,?,?,?)
                ON CONFLICT(user_id, provider) DO UPDATE SET
                  access_token=excluded.access_token,
                  refresh_token=COALESCE(excluded.refresh_token, user_connectors.refresh_token),
                  expires_at=excluded.expires_at, scope=excluded.scope`)
      .run(randomUUID(), pending.userId, 'google_health', '',
        accountSecurity.protectSecret(tokens.access_token),
        accountSecurity.protectSecret(tokens.refresh_token || ''),
        new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString(),
        tokens.scope || googleHealth.SCOPES.join(' '));
    req.session.googleHealthPending = null;
    await syncGoogleHealthForUser(pending.userId).catch(err => console.error('[google-health] initial sync failed:', err.message));
    res.redirect('/?connected=google_health');
  } catch (err) {
    req.session.googleHealthPending = null;
    console.error('[google-health] callback failed:', err.message);
    fail('connect_failed');
  }
});

router.post('/connectors/google-health/sync', requireAuth, async (req, res) => {
  try {
    const result = await syncGoogleHealthForUser(req.session.userId);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(502).json({ error: 'sync_failed', detail: err.message });
  }
});

// Exercise sessions import as workouts (source='google_health', dedup via
// imported_activities, same as Strava); steps have no workout to attach to
// and go into their own daily-totals table instead.
async function syncGoogleHealthForUser(userId) {
  let conn = db.prepare('SELECT * FROM user_connectors WHERE user_id = ? AND provider = ?').get(userId, 'google_health');
  if (!conn) throw new Error('not_connected');
  conn = { ...conn, access_token: accountSecurity.unprotectSecret(conn.access_token), refresh_token: accountSecurity.unprotectSecret(conn.refresh_token) };

  if (new Date(conn.expires_at).getTime() < Date.now() + 60000) {
    if (!conn.refresh_token) throw new Error('no_refresh_token');
    const fresh = await googleHealth.refreshTokens(conn.refresh_token);
    db.prepare('UPDATE user_connectors SET access_token = ?, expires_at = ? WHERE user_id = ? AND provider = ?')
      .run(accountSecurity.protectSecret(fresh.access_token),
        new Date(Date.now() + (fresh.expires_in || 3600) * 1000).toISOString(), userId, 'google_health');
    conn = { ...conn, access_token: fresh.access_token };
  }

  const sinceIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(); // last 30 days
  let stepDays = 0, imported = 0, checked = 0;

  try {
    const stepPoints = await googleHealth.listDataPoints(conn.access_token, 'steps', { sinceIso });
    const daily = googleHealth.summariseSteps(stepPoints);
    const upsertSteps = db.prepare(`INSERT INTO google_health_daily_steps (user_id, date, steps, synced_at) VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(user_id, date) DO UPDATE SET steps = excluded.steps, synced_at = datetime('now')`);
    for (const d of daily) upsertSteps.run(userId, d.date, d.steps);
    stepDays = daily.length;
  } catch (err) {
    console.error('[google-health] steps sync failed:', err.message); // partial sync should not fail the whole connector
  }

  try {
    const exercisePoints = await googleHealth.listDataPoints(conn.access_token, 'exercise', { sinceIso });
    checked = exercisePoints.length;
    for (const raw of exercisePoints) {
      const session = googleHealth.mapExercisePoint(raw);
      if (!session.externalId || !session.startTime) continue;
      const already = db.prepare('SELECT 1 FROM imported_activities WHERE provider = ? AND external_id = ?').get('google_health', session.externalId);
      if (already) continue;

      const type = googleHealth.mapActivityType(session.activityType);
      const durationSec = session.endTime ? Math.max(0, Math.round((Date.parse(session.endTime) - Date.parse(session.startTime)) / 1000)) : 0;
      const workoutId = randomUUID();
      db.prepare(`INSERT INTO workouts (id, user_id, type, start_time, end_time, calories, avg_hr, duration_sec, note, source)
                  VALUES (?,?,?,?,?,?,?,?,?, 'google_health')`)
        .run(workoutId, userId, type, session.startTime, session.endTime || session.startTime,
          session.calories ? Math.round(session.calories) : null,
          session.avgHeartRate ? Math.round(session.avgHeartRate) : null,
          durationSec, 'Synced from Google Health');
      db.prepare('INSERT INTO imported_activities (id, user_id, provider, external_id, workout_id) VALUES (?,?,?,?,?)')
        .run(randomUUID(), userId, 'google_health', session.externalId, workoutId);

      publish('workout.completed', { user_id: userId, workout_id: workoutId, calories: session.calories || 0, avg_hr: session.avgHeartRate || null });
      imported++;
    }
  } catch (err) {
    console.error('[google-health] exercise sync failed:', err.message);
  }

  db.prepare('UPDATE user_connectors SET last_synced_at = ? WHERE user_id = ? AND provider = ?').run(new Date().toISOString(), userId, 'google_health');
  return { imported, checked, step_days_synced: stepDays };
}

// ---- Apple Health sync (native iOS app only). ----
// HealthKit data never leaves the device except through the native app's own
// authenticated session -- there is no OAuth handshake the way Strava/Google
// Health need one, so this is a plain authenticated POST, not a connector
// with a /start redirect. The native client (ios/FunctioningFaith) already
// maps HKWorkoutActivityType to this app's own vocabulary and only reads
// (never writes) HealthKit data; this route re-validates rather than
// trusting the client blindly, the same way every other user-submitted
// number in this API is bounds-checked before being stored.
const APPLE_HEALTH_MAX_BATCH = 200;
router.post('/connectors/apple-health/sync', requireAuth, (req, res) => {
  const uid = req.session.userId;
  const body = req.body || {};
  const workouts = Array.isArray(body.workouts) ? body.workouts.slice(0, APPLE_HEALTH_MAX_BATCH) : [];
  const dailySteps = Array.isArray(body.daily_steps) ? body.daily_steps.slice(0, 90) : [];

  let stepDays = 0;
  const upsertSteps = db.prepare(`INSERT INTO apple_health_daily_steps (user_id, date, steps, synced_at) VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, date) DO UPDATE SET steps = excluded.steps, synced_at = datetime('now')`);
  for (const d of dailySteps) {
    const date = String(d?.date || '');
    const steps = Math.round(Number(d?.steps));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(steps) || steps < 0 || steps > 200000) continue; // 200k/day is already an absurd upper bound, not a real cap
    upsertSteps.run(uid, date, steps);
    stepDays++;
  }

  let imported = 0, checked = 0;
  for (const w of workouts) {
    checked++;
    const externalId = String(w?.externalID || w?.external_id || '');
    const startTime = w?.startTime || w?.start_time;
    const endTime = w?.endTime || w?.end_time;
    if (!externalId || !startTime || !endTime || isNaN(Date.parse(startTime)) || isNaN(Date.parse(endTime))) continue;
    const already = db.prepare('SELECT 1 FROM imported_activities WHERE provider = ? AND external_id = ?').get('apple_health', externalId);
    if (already) continue;

    const rawType = w?.activityType || w?.activity_type;
    const type = ACTIVITY_SET.has(rawType) ? rawType : 'Workout'; // never trust an arbitrary client-supplied type string into a column other code assumes is from ACTIVITY_TYPES
    const durationSec = Math.max(0, Math.round((Date.parse(endTime) - Date.parse(startTime)) / 1000));
    const calories = Number.isFinite(Number(w?.calories)) && Number(w.calories) >= 0 ? Math.round(Number(w.calories)) : null;
    const avgHr = Number.isFinite(Number(w?.avgHeartRate ?? w?.avg_heart_rate)) ? Math.round(Number(w.avgHeartRate ?? w.avg_heart_rate)) : null;
    const distanceKm = Number.isFinite(Number(w?.distanceMeters ?? w?.distance_meters)) && Number(w.distanceMeters ?? w.distance_meters) > 0
      ? +(Number(w.distanceMeters ?? w.distance_meters) / 1000).toFixed(2) : null;

    const workoutId = randomUUID();
    db.prepare(`INSERT INTO workouts (id, user_id, type, start_time, end_time, calories, avg_hr, distance_km, duration_sec, note, source)
                VALUES (?,?,?,?,?,?,?,?,?,?, 'apple_health')`)
      .run(workoutId, uid, type, new Date(startTime).toISOString(), new Date(endTime).toISOString(), calories, avgHr, distanceKm, durationSec, 'Synced from Apple Health');
    db.prepare('INSERT INTO imported_activities (id, user_id, provider, external_id, workout_id) VALUES (?,?,?,?,?)')
      .run(randomUUID(), uid, 'apple_health', externalId, workoutId);

    publish('workout.completed', { user_id: uid, workout_id: workoutId, calories: calories || 0, avg_hr: avgHr });
    imported++;
  }

  res.json({ ok: true, imported, checked, step_days_synced: stepDays });
});

router.post('/connectors/:provider/disconnect', requireAuth, (req, res) => {
  db.prepare('DELETE FROM user_connectors WHERE user_id = ? AND provider = ?').run(req.session.userId, req.params.provider);
  accountSecurity.audit(req.session.userId, 'connector_disconnected', req, { provider: req.params.provider });
  res.json({ ok: true });
});

// Pull recent Strava activities and import any not already seen, mapped into
// Functioning Faith's own workout model (source='strava'). Idempotent — dedupes by
// Strava's activity id via imported_activities. Auto-refreshes an expired
// access token using the stored refresh token.
async function syncStravaForUser(userId) {
  let conn = db.prepare('SELECT * FROM user_connectors WHERE user_id = ? AND provider = ?').get(userId, 'strava');
  if (!conn) throw new Error('not_connected');
  conn={...conn,access_token:accountSecurity.unprotectSecret(conn.access_token),refresh_token:accountSecurity.unprotectSecret(conn.refresh_token)};

  if (new Date(conn.expires_at).getTime() < Date.now() + 60000) {
    const fresh = await strava.refreshTokens(conn.refresh_token);
    db.prepare('UPDATE user_connectors SET access_token = ?, refresh_token = ?, expires_at = ? WHERE user_id = ? AND provider = ?')
      .run(accountSecurity.protectSecret(fresh.access_token), accountSecurity.protectSecret(fresh.refresh_token), new Date(fresh.expires_at * 1000).toISOString(), userId, 'strava');
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
    SELECT id, display_name, bio_verse_ref FROM users
    WHERE lower(email) IN (?, ?, ?)
    ORDER BY CASE lower(email)
      WHEN ? THEN 1
      WHEN ? THEN 2
      WHEN ? THEN 3
      ELSE 99
    END
  `).all(
    DEMO_LOGIN_EMAILS[0], DEMO_LOGIN_EMAILS[1], DEMO_LOGIN_EMAILS[2],
    DEMO_LOGIN_EMAILS[0], DEMO_LOGIN_EMAILS[1], DEMO_LOGIN_EMAILS[2],
  ));
});

// Back-compat: the old demo picker POSTed here. Route it through the demo path so
// existing sessions/clients keep working, but restrict to seeded demo accounts.
router.post('/session', (req, res) => {
  if (!allowWindow(demoAuthWindow, `session:${req.ip}`, 20, 60 * 1000)) {
    return res.status(429).json({ error: 'too_many_attempts' });
  }
  const { user_id } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(user_id);
  if (!user || !isDemoLoginEmail(user.email)) return res.status(404).json({ error: 'user_not_found' });
  accountSecurity.startSession(req, user.id, 'demo');
  res.json({ ok: true, user: publicUser(user) });
});

router.get('/me', (req, res) => {
  const checked = accountSecurity.validateSession(req);
  if (!checked.ok) { req.session = null; return res.status(401).json({ error: checked.error }); }
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
  const age = accountSecurity.ageFromDob(userRow.date_of_birth);
  const accountSetupRequired = age == null || age < 13 || !userRow.terms_accepted_at || userRow.terms_version !== accountSecurity.TERMS_VERSION;
  res.json({ user, xp, badges, consents, stats, account_setup_required: accountSetupRequired });
});

// Direct Fitbit/Oura cloud connectors. Garmin devices are intentionally offered
// through Strava above because Garmin's direct Health API is partner-gated.
router.get('/connectors/configured', (req, res) => {
  res.json({ providers: Object.entries(wearables.PROVIDERS).map(([name, p]) => ({ name, label: p.label, configured: wearables.isConfigured(name) })) });
});
router.get('/connectors/:provider/configured', (req, res) => {
  res.json({ configured: wearables.isConfigured(req.params.provider) });
});
router.get('/connectors/:provider/start', requireAuth, (req, res) => {
  const name = req.params.provider;
  if (!wearables.isConfigured(name)) return res.status(404).json({ error: 'provider_not_configured' });
  const state = oauth.b64url(require('crypto').randomBytes(16));
  req.session.wearablePending = { state, provider: name, userId: req.session.userId, createdAt: Date.now() };
  res.redirect(wearables.buildAuthorizationUrl(name, { redirectUri: `${baseUrl(req)}/api/connectors/${name}/callback`, state }));
});
router.get('/connectors/:provider/callback', async (req, res) => {
  const name = req.params.provider; const pending = req.session.wearablePending;
  const fail = reason => res.redirect(`/?wearable_error=${encodeURIComponent(reason)}`);
  if (!pending || pending.provider !== name || Date.now() - pending.createdAt > 10 * 60 * 1000) { req.session.wearablePending = null; return fail('session_expired'); }
  if (req.query.error || req.query.state !== pending.state) { req.session.wearablePending = null; return fail(req.query.error ? 'access_denied' : 'state_mismatch'); }
  try {
    const tokens = await wearables.exchangeCodeForTokens(name, req.query.code, `${baseUrl(req)}/api/connectors/${name}/callback`);
    db.prepare(`INSERT INTO user_connectors (id,user_id,provider,provider_user_id,access_token,refresh_token,expires_at,scope)
      VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(user_id,provider) DO UPDATE SET access_token=excluded.access_token,refresh_token=excluded.refresh_token,expires_at=excluded.expires_at,scope=excluded.scope`)
      .run(randomUUID(), pending.userId, name, String(tokens.user_id || tokens.user?.id || ''), accountSecurity.protectSecret(tokens.access_token), accountSecurity.protectSecret(tokens.refresh_token || null), new Date(Date.now() + Number(tokens.expires_in || 3600) * 1000).toISOString(), tokens.scope || wearables.provider(name).scope);
    req.session.wearablePending = null;
    await syncWearableForUser(pending.userId, name).catch(err => console.error(`[${name}] initial sync failed:`, err.message));
    res.redirect(`/?connected=${name}`);
  } catch (err) { req.session.wearablePending = null; console.error(`[${name}] callback failed:`, err.message); fail('connect_failed'); }
});
router.post('/connectors/:provider/sync', requireAuth, async (req, res) => {
  try { res.json({ ok: true, ...(await syncWearableForUser(req.session.userId, req.params.provider)) }); }
  catch (err) { res.status(502).json({ error: 'sync_failed', detail: err.message }); }
});

async function syncWearableForUser(userId, provider) {
  if (!wearables.provider(provider)) throw new Error('unsupported_wearable');
  let conn = db.prepare('SELECT * FROM user_connectors WHERE user_id = ? AND provider = ?').get(userId, provider);
  if (!conn) throw new Error('not_connected');
  conn={...conn,access_token:accountSecurity.unprotectSecret(conn.access_token),refresh_token:accountSecurity.unprotectSecret(conn.refresh_token)};
  if (conn.expires_at && new Date(conn.expires_at).getTime() < Date.now() + 60000 && conn.refresh_token) {
    const fresh = await wearables.refreshTokens(provider, conn.refresh_token);
    db.prepare('UPDATE user_connectors SET access_token=?, refresh_token=?, expires_at=? WHERE user_id=? AND provider=?').run(accountSecurity.protectSecret(fresh.access_token), accountSecurity.protectSecret(fresh.refresh_token || conn.refresh_token), new Date(Date.now() + Number(fresh.expires_in || 3600) * 1000).toISOString(), userId, provider);
    conn = { ...conn, access_token: fresh.access_token };
  }
  const payload = await wearables.fetchRecent(provider, conn.access_token); let imported = 0;
  for (const raw of payload.activities || []) {
    const a = wearables.normalizeActivity(provider, raw);
    if (!a.externalId || db.prepare('SELECT 1 FROM imported_activities WHERE provider=? AND external_id=?').get(provider, a.externalId)) continue;
    const durationSec = Math.max(0, a.durationSec || 0); const end = new Date(a.start.getTime() + durationSec * 1000).toISOString();
    const workoutId = randomUUID();
    db.prepare(`INSERT INTO workouts (id,user_id,type,start_time,end_time,calories,avg_hr,max_hr,distance_km,duration_sec,note,source) VALUES (?,?,?,?,?,?,?,?,?,?,? ,?)`).run(workoutId,userId,a.type,a.start.toISOString(),end,a.calories,a.avgHr,a.maxHr,a.distanceKm,durationSec,a.note,provider);
    db.prepare('INSERT INTO imported_activities (id,user_id,provider,external_id,workout_id) VALUES (?,?,?,?,?)').run(randomUUID(),userId,provider,a.externalId,workoutId);
    publish('workout.completed',{user_id:userId,workout_id:workoutId,calories:a.calories||0,avg_hr:a.avgHr||null}); imported++;
  }
  for (const m of wearables.normalizeRecovery(provider, payload)) db.prepare(`INSERT INTO wearable_metrics (id,user_id,provider,metric_date,sleep_score,sleep_sec,readiness_score,hrv,raw_json) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,provider,metric_date) DO UPDATE SET sleep_score=excluded.sleep_score,sleep_sec=excluded.sleep_sec,readiness_score=excluded.readiness_score,hrv=excluded.hrv,raw_json=excluded.raw_json,updated_at=datetime('now')`).run(randomUUID(),userId,provider,m.date,m.sleep_score||null,m.sleep_sec||null,m.readiness_score||null,m.hrv||null,JSON.stringify(m.raw||{}));
  db.prepare('UPDATE user_connectors SET last_synced_at=? WHERE user_id=? AND provider=?').run(new Date().toISOString(),userId,provider);
  return { imported, checked: (payload.activities || []).length, recovery_days: wearables.normalizeRecovery(provider, payload).length };
}
function allowWindow(map,key,limit,windowMs){const now=Date.now(),recent=(map.get(key)||[]).filter(t=>now-t<windowMs);if(recent.length>=limit)return false;recent.push(now);map.set(key,recent);return true;}
function linkWarning(text){const urls=String(text||'').match(/https?:\/\/[^\s]+/gi)||[];for(const raw of urls){try{const u=new URL(raw);if(u.protocol!=='https:'||u.username||u.password||u.hostname.startsWith('xn--')||/^\d+\.\d+\.\d+\.\d+$/.test(u.hostname)||/\.(zip|mov|top|click|country)$/i.test(u.hostname))return 'This message contains an unfamiliar or disguised link. Verify the sender and destination before opening it.';}catch{return 'This message contains a malformed link. Do not open it.';}}return null;}

// The full accomplishment shelf: earned badges stay visible, while locked
// badges show the next honest milestone instead of disappearing.
router.get('/badges', requireAuth, (req, res) => {
  const uid = req.session.userId;
  const workouts = db.prepare("SELECT COUNT(*) c FROM workouts WHERE user_id = ? AND end_time IS NOT NULL").get(uid).c;
  const verses = db.prepare('SELECT COUNT(*) c FROM scripture_triggers WHERE user_id = ?').get(uid).c;
  const earned = db.prepare('SELECT badge_id, earned_at FROM user_badges WHERE user_id = ?').all(uid);
  const earnedMap = new Map(earned.map(b => [b.badge_id, b.earned_at]));
  const rows = db.prepare('SELECT * FROM badges ORDER BY name').all();
  const targetFor = { 'b-first-workout': 1, 'b-verse-seeker': 5, 'b-five-workouts': 5 };
  const progressFor = { 'b-first-workout': workouts, 'b-verse-seeker': verses, 'b-five-workouts': workouts };
  return res.json(rows.map(b => {
    const target = targetFor[b.id] || null;
    const progress = progressFor[b.id] ?? null;
    return { ...b, earned: earnedMap.has(b.id), earned_at: earnedMap.get(b.id) || null,
      progress, target, percent: target ? Math.min(100, Math.round((progress / target) * 100)) : null };
  }));
});

function requireAuth(req, res, next) {
  const checked = accountSecurity.validateSession(req);
  if (!checked.ok) {
    req.session = null;
    return res.status(401).json({ error: checked.error });
  }
  next();
}

// 404, not 403 -- same reasoning as reviewerAuthorized elsewhere in this file:
// an unauthorized caller should not learn that an admin surface exists at all.
function requireAdmin(req, res, next) {
  const checked = accountSecurity.validateSession(req);
  if (!checked.ok || !admin.isAdmin(req.session.userId)) {
    return res.status(404).json({ error: 'not_found' });
  }
  next();
}

function requireCommunityAccess(req, res, next) {
  const user = db.prepare('SELECT date_of_birth,terms_version,terms_accepted_at FROM users WHERE id=?').get(req.session.userId);
  const age = accountSecurity.ageFromDob(user?.date_of_birth);
  if (age == null || age < 13) return res.status(403).json({ error: 'age_confirmation_required' });
  if (!user?.terms_accepted_at || user.terms_version !== accountSecurity.TERMS_VERSION) {
    return res.status(403).json({ error: 'terms_acceptance_required', terms_version: accountSecurity.TERMS_VERSION });
  }
  next();
}

router.post('/account/setup', requireAuth, (req, res) => {
  const dob = String(req.body?.date_of_birth || '');
  const age = accountSecurity.ageFromDob(dob);
  if (age == null) return res.status(400).json({ error: 'invalid_date_of_birth' });
  if (age < 13) return res.status(403).json({ error: 'minimum_age' });
  if (!req.body?.terms_accepted) return res.status(400).json({ error: 'terms_required' });
  const now = new Date().toISOString();
  db.prepare('UPDATE users SET date_of_birth=?,age=?,terms_version=?,terms_accepted_at=? WHERE id=?')
    .run(dob, age, accountSecurity.TERMS_VERSION, now, req.session.userId);
  // OAuth-created accounts only learn their age here, so apply the same safe
  // defaults as password registration when the member is under 18.
  if (age < 18) db.prepare(`UPDATE users SET profile_visibility='private',
    follower_list_visibility='private',message_permission='followers',
    tag_permission='nobody',comment_permission='followers',default_visibility='private'
    WHERE id=?`).run(req.session.userId);
  accountSecurity.audit(req.session.userId, 'terms_accepted', req, { version: accountSecurity.TERMS_VERSION });
  res.json({ ok: true, age_band: age < 18 ? 'minor' : 'adult', terms_version: accountSecurity.TERMS_VERSION });
});

router.get('/security/capabilities', (req, res) => res.json({
  password_login: true,
  oauth_providers: oauth.listConfiguredProviders(),
  native_google_sign_in: oauth.isConfigured('google'),
  native_apple_sign_in: true,
  totp_mfa: !!(process.env.DATA_ENCRYPTION_KEY || process.env.MFA_ENCRYPTION_KEY || process.env.SESSION_SECRET),
  passkeys_biometric: false,
  sms_mfa: false,
  captcha: !!(process.env.TURNSTILE_SECRET_KEY && process.env.TURNSTILE_SITE_KEY),
  recovery_email: !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM),
  end_to_end_encrypted_dms: false,
  session_idle_minutes: Math.round(accountSecurity.IDLE_TIMEOUT_MS / 60000),
}));

router.get('/security/sessions', requireAuth, (req, res) => {
  res.json({ sessions: accountSecurity.listSessions(req.session.userId, req.session.sid) });
});
router.delete('/security/sessions/:id', requireAuth, (req, res) => {
  if (!accountSecurity.revokeSession(req.session.userId, req.params.id)) return res.status(404).json({ error: 'session_not_found' });
  accountSecurity.audit(req.session.userId, 'session_revoked', req, { session_id: req.params.id });
  const current = req.params.id === req.session.sid;
  if (current) req.session = null;
  res.json({ ok: true, current });
});
router.post('/security/sessions/logout-others', requireAuth, (req, res) => {
  const revoked = accountSecurity.revokeOtherSessions(req.session.userId, req.session.sid);
  accountSecurity.audit(req.session.userId, 'other_sessions_revoked', req, { count: revoked });
  res.json({ ok: true, revoked });
});
router.get('/security/activity', requireAuth, (req, res) => res.json({ events: accountSecurity.securityEvents(req.session.userId) }));

router.post('/security/reauthenticate', requireAuth, async (req, res) => {
  const user = db.prepare('SELECT password_hash FROM users WHERE id=?').get(req.session.userId);
  if (!user?.password_hash) return res.status(409).json({ error: 'oauth_reauthentication_required' });
  if (!(await verifyPassword(String(req.body?.password || ''), user.password_hash))) return res.status(401).json({ error: 'invalid_credentials' });
  accountSecurity.markReauthenticated(req);
  accountSecurity.audit(req.session.userId, 'reauthenticated', req);
  res.json({ ok: true });
});

router.get('/security/mfa', requireAuth, (req, res) => res.json({ enabled: accountSecurity.mfaEnabled(req.session.userId) }));
router.post('/security/mfa/setup', requireAuth, (req, res) => {
  if (!accountSecurity.recentlyReauthenticated(req)) return res.status(403).json({ error: 'recent_reauthentication_required' });
  const user = db.prepare('SELECT email FROM users WHERE id=?').get(req.session.userId);
  try { res.json(accountSecurity.beginMfa(req.session.userId, user.email)); }
  catch (err) { res.status(503).json({ error: err.code || 'mfa_not_configured' }); }
});
router.post('/security/mfa/enable', requireAuth, (req, res) => {
  const backupCodes = accountSecurity.enableMfa(req.session.userId, req.body?.code);
  if (!backupCodes) return res.status(400).json({ error: 'invalid_mfa_code' });
  accountSecurity.audit(req.session.userId, 'mfa_enabled', req);
  notify(req.session.userId, 'security', 'Two-factor authentication was enabled.', { url: '/?open=profile&settings=security' });
  res.json({ ok: true, backup_codes: backupCodes, warning: 'Store these one-time backup codes somewhere safe. They will not be shown again.' });
});
router.post('/security/mfa/disable', requireAuth, (req, res) => {
  if (!accountSecurity.recentlyReauthenticated(req)) return res.status(403).json({ error: 'recent_reauthentication_required' });
  if (!accountSecurity.verifyMfa(req.session.userId, req.body?.code)) return res.status(401).json({ error: 'invalid_mfa_code' });
  accountSecurity.disableMfa(req.session.userId);
  accountSecurity.audit(req.session.userId, 'mfa_disabled', req);
  notify(req.session.userId, 'security', 'Two-factor authentication was disabled.', { url: '/?open=profile&settings=security' });
  res.json({ ok: true });
});

router.get('/privacy', requireAuth, (req, res) => res.json(accountSecurity.privacy(req.session.userId)));
router.patch('/privacy', requireAuth, (req, res) => {
  try {
    const settings = accountSecurity.updatePrivacy(req.session.userId, req.body || {});
    accountSecurity.audit(req.session.userId, 'privacy_settings_changed', req, settings);
    res.json(settings);
  } catch (err) { res.status(400).json({ error: err.code || 'invalid_privacy_setting' }); }
});
// Everyone you have muted, restricted or blocked, in one place. Blocking was
// already reachable from a profile, but unblocking meant navigating back to
// the profile of the person you blocked -- which is exactly what blocking
// makes hard to find. Mute and restrict were enforced server-side (feed
// filtering at api.js:1015, DM open/send in lib/dms.js) with no button at all.
router.get('/me/relationships', requireAuth, (req, res) => {
  const me = req.session.userId;
  const controls = db.prepare(`
    SELECT rc.subject_id user_id, rc.control, rc.created_at, u.display_name,
           CASE WHEN u.avatar_data IS NOT NULL THEN 1 ELSE 0 END AS has_avatar
    FROM account_relationship_controls rc JOIN users u ON u.id = rc.subject_id
    WHERE rc.actor_id = ? ORDER BY rc.created_at DESC
  `).all(me);
  const blocked = db.prepare(`
    SELECT b.blocked_id user_id, 'block' AS control, b.created_at, u.display_name,
           CASE WHEN u.avatar_data IS NOT NULL THEN 1 ELSE 0 END AS has_avatar
    FROM dm_blocks b JOIN users u ON u.id = b.blocked_id
    WHERE b.blocker_id = ? ORDER BY b.created_at DESC
  `).all(me);
  res.json({
    muted: controls.filter(c => c.control === 'mute'),
    restricted: controls.filter(c => c.control === 'restrict'),
    blocked,
  });
});

router.put('/users/:id/:control(mute|restrict)', requireAuth, (req, res) => {
  if (!db.prepare('SELECT 1 FROM users WHERE id=?').get(req.params.id)) return res.status(404).json({ error: 'user_not_found' });
  if (!accountSecurity.relationship(req.session.userId, req.params.id, req.params.control, true)) return res.status(400).json({ error: 'invalid_control' });
  res.json({ ok: true, [req.params.control]: true });
});
router.delete('/users/:id/:control(mute|restrict)', requireAuth, (req, res) => {
  accountSecurity.relationship(req.session.userId, req.params.id, req.params.control, false);
  res.json({ ok: true, [req.params.control]: false });
});

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
  accountSecurity.audit(req.session.userId, 'consent_changed', req, { scope, granted: !!granted });
  res.json({ ok: true });
});

// ---- feed ----
router.get('/feed', (req, res) => {
  const meId = req.session.userId || null;
  const followingOnly = req.query.scope === 'following' && !!meId;
  const before = String(req.query.before || '').slice(0, 40);
  const limit = Math.max(10, Math.min(30, Number(req.query.limit) || 20));
  // Visibility rules: public → everyone; followers → the author's followers (and
  // the author); private → author only.
  const posts = db.prepare(`
    SELECT p.id, p.content, p.created_at, p.user_id author_id, u.display_name author,
           CASE WHEN u.avatar_data IS NOT NULL THEN 1 ELSE 0 END AS author_has_avatar,
           CASE WHEN EXISTS(SELECT 1 FROM developer_applications da WHERE da.user_id=u.id AND da.status='verified') THEN 1 ELSE 0 END AS author_verified_developer,
           p.visibility, p.workout_id, p.photo_data, p.photo_category, p.video_data, p.video_category,
           p.show_route, p.route_privacy_m, w.gps_path,
           w.type workout_type, w.calories, w.avg_hr, w.start_time, w.end_time, w.distance_km,
           v.reference verse_reference, v.text verse_text, v.youversion_id,
           (SELECT COUNT(*) FROM post_comments pc WHERE pc.post_id = p.id) AS comment_count
    FROM posts p
    JOIN users u ON u.id = p.user_id
    LEFT JOIN workouts w ON w.id = p.workout_id
    LEFT JOIN scripture_verses v ON v.id = p.verse_id
    WHERE (
      p.visibility = 'public'
      OR p.user_id = @me
      OR (p.visibility = 'followers' AND EXISTS (
            SELECT 1 FROM followers f WHERE f.followee_id = p.user_id AND f.follower_id = @me))
      OR (p.visibility = 'circle' AND EXISTS (
            SELECT 1 FROM circle_members c WHERE c.owner_id = p.user_id AND c.member_id = @me))
    )
      AND (@following_only = 0 OR p.user_id = @me OR EXISTS (
            SELECT 1 FROM followers ff WHERE ff.follower_id = @me AND ff.followee_id = p.user_id))
      AND (@me IS NULL OR NOT EXISTS (
            SELECT 1 FROM dm_blocks blocked
            WHERE (blocked.blocker_id = @me AND blocked.blocked_id = p.user_id)
               OR (blocked.blocker_id = p.user_id AND blocked.blocked_id = @me)))
      AND (@me IS NULL OR NOT EXISTS (
            SELECT 1 FROM account_relationship_controls rc
            WHERE rc.actor_id=@me AND rc.subject_id=p.user_id AND rc.control='mute'))
      AND (@before = '' OR p.created_at < @before)
    ORDER BY p.created_at DESC LIMIT @limit
  `).all({ me: meId, following_only: followingOnly ? 1 : 0, before, limit });

  const withSocial = posts.map(p => {
    if (p.photo_data && !validateDataUrlImage(p.photo_data).ok) p.photo_data = null;
    // Replace the raw trace with only what the author chose to publish, so the
    // full path never leaves the server on a post that did not opt in.
    const route = publishedRoute(p);
    delete p.gps_path;
    delete p.route_privacy_m;
    p.route = route;
    p.has_route = !!route;
    const likeCount = db.prepare('SELECT COUNT(*) c FROM post_likes WHERE post_id = ?').get(p.id).c;
    const likedByMe = meId ? !!db.prepare('SELECT 1 FROM post_likes WHERE post_id = ? AND user_id = ?').get(p.id, meId) : false;
    const savedByMe = meId ? !!db.prepare('SELECT 1 FROM post_saves WHERE post_id = ? AND user_id = ?').get(p.id, meId) : false;
    let pace = null, distanceKm = p.distance_km ?? null;
    if (p.workout_type && p.start_time && p.end_time) {
      const mins = (new Date(p.end_time) - new Date(p.start_time)) / 60000;
      if (distanceKm == null) distanceKm = +(mins / 6).toFixed(1); // fallback estimate when no real GPS data
      pace = distanceKm > 0 ? (mins / distanceKm).toFixed(1) : null;
    }
    const commentCount = Number(p.comment_count || 0);
    delete p.comment_count;
    return { ...p, like_count: likeCount, liked_by_me: likedByMe, saved_by_me: savedByMe, comment_count: commentCount, distance_km: distanceKm, pace_min_per_km: pace };
  });
  res.json({ posts: withSocial, next_cursor: withSocial.length === limit ? withSocial[withSocial.length - 1].created_at : null });
});

// A compact, dedicated read for the home page's "Friends' workouts" widget --
// only real workout posts (not every post) from people the viewer actually
// follows, respecting the exact same visibility/block/mute rules as the
// main feed rather than a looser variant of them.
router.get('/feed/friends-workouts', requireAuth, (req, res) => {
  const meId = req.session.userId;
  const limit = Math.max(1, Math.min(10, Number(req.query.limit) || 5));
  const rows = db.prepare(`
    SELECT p.id, p.user_id author_id, u.display_name author, w.id workout_id,
           CASE WHEN u.avatar_data IS NOT NULL THEN 1 ELSE 0 END AS author_has_avatar,
           w.type workout_type, w.distance_km, w.calories, w.avg_hr, w.start_time, w.end_time, p.created_at,
           (SELECT COUNT(*) FROM workout_kudos k WHERE k.workout_id=w.id) AS kudos_count,
           EXISTS(SELECT 1 FROM workout_kudos k WHERE k.workout_id=w.id AND k.user_id=@me) AS kudos_by_me
    FROM posts p
    JOIN users u ON u.id = p.user_id
    JOIN workouts w ON w.id = p.workout_id
    WHERE p.workout_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM followers f WHERE f.follower_id = @me AND f.followee_id = p.user_id)
      AND (p.visibility = 'public' OR (p.visibility = 'followers'))
      AND NOT EXISTS (SELECT 1 FROM dm_blocks b WHERE (b.blocker_id=@me AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=@me))
      AND NOT EXISTS (SELECT 1 FROM account_relationship_controls rc WHERE rc.actor_id=@me AND rc.subject_id=p.user_id AND rc.control='mute')
    ORDER BY p.created_at DESC LIMIT @limit
  `).all({ me: meId, limit });
  res.json({ workouts: rows.map(w => ({ ...w, kudos_count: Number(w.kudos_count || 0), kudos_by_me: !!w.kudos_by_me })) });
});

// Workout-specific encouragement. This is deliberately scoped to a workout a
// member can already see through the followed-friends rail—never a global
// popularity counter or an invitation to compare performance.
router.post('/workouts/:id/kudos', requireAuth, (req, res) => {
  const me = req.session.userId;
  const row = db.prepare(`
    SELECT w.id, w.user_id, u.display_name FROM workouts w JOIN users u ON u.id=w.user_id
    WHERE w.id=@id AND w.user_id!=@me
      AND EXISTS (SELECT 1 FROM posts p WHERE p.workout_id=w.id AND (p.visibility='public' OR p.visibility='followers'))
      AND EXISTS (SELECT 1 FROM followers f WHERE f.follower_id=@me AND f.followee_id=w.user_id)
      AND NOT EXISTS (SELECT 1 FROM dm_blocks b WHERE (b.blocker_id=@me AND b.blocked_id=w.user_id) OR (b.blocker_id=w.user_id AND b.blocked_id=@me))
      AND NOT EXISTS (SELECT 1 FROM account_relationship_controls rc WHERE rc.actor_id=@me AND rc.subject_id=w.user_id AND rc.control='mute')
  `).get({ id: req.params.id, me });
  if (!row) return res.status(404).json({ error: 'workout_not_found' });
  const result = workoutKudos.toggle(row.id, me);
  if (result.given) notify(row.user_id, 'workout_kudos', `${displayName(me)} gave you kudos for your workout.`, { workout_id: row.id, url: '/?open=home' });
  res.json({ ...result });
});

// Comments are fetched only when a member opens a thread. This keeps the feed
// fast while retaining the same visibility rules as the post itself.
function postVisibleTo(post, viewerId) {
  if (!post || !viewerId) return false;
  const audience = post.user_id === viewerId || post.visibility === 'public' ||
    (post.visibility === 'followers' && !!db.prepare('SELECT 1 FROM followers WHERE follower_id = ? AND followee_id = ?').get(viewerId, post.user_id)) ||
    (post.visibility === 'circle' && circle.isInCircle(post.user_id, viewerId));
  return audience && !dms.isBlockedEitherWay(viewerId, post.user_id);
}

router.get('/posts/:id/comments', requireAuth, (req, res) => {
  const me = req.session.userId;
  const post = db.prepare('SELECT id, user_id, visibility FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'post_not_found' });
  if (!postVisibleTo(post, me)) return res.status(404).json({ error: 'post_not_found' });
  const comments = db.prepare(`
    SELECT c.id, c.content, c.created_at, u.display_name author, c.user_id author_id,
           -- Decided here rather than in the client: the delete route enforces
           -- the same rule, and the UI should never have to infer authority.
           CASE WHEN c.user_id = @me OR @postAuthor = @me THEN 1 ELSE 0 END AS can_delete,
           (SELECT COUNT(*) FROM comment_likes cl WHERE cl.comment_id = c.id) AS like_count,
           CASE WHEN EXISTS (SELECT 1 FROM comment_likes mine WHERE mine.comment_id = c.id AND mine.user_id = @me) THEN 1 ELSE 0 END AS liked_by_me
    FROM post_comments c JOIN users u ON u.id = c.user_id
    WHERE c.post_id = @post
      AND NOT EXISTS (SELECT 1 FROM dm_blocks b
                      WHERE (b.blocker_id = @me AND b.blocked_id = c.user_id)
                         OR (b.blocker_id = c.user_id AND b.blocked_id = @me))
    ORDER BY c.created_at ASC
  `).all({ post: post.id, me, postAuthor: post.user_id });
  res.json({ comments });
});

router.post('/posts/:id/like', requireAuth, (req, res) => {
  const post = db.prepare('SELECT id, user_id, visibility FROM posts WHERE id = ?').get(req.params.id);
  if (!post || !postVisibleTo(post, req.session.userId)) return res.status(404).json({ error: 'post_not_found' });
  const existing = db.prepare('SELECT 1 FROM post_likes WHERE post_id = ? AND user_id = ?').get(req.params.id, req.session.userId);
  if (existing) {
    db.prepare('DELETE FROM post_likes WHERE post_id = ? AND user_id = ?').run(req.params.id, req.session.userId);
  } else {
    db.prepare('INSERT INTO post_likes (post_id, user_id) VALUES (?, ?)').run(req.params.id, req.session.userId);
    // Tell the author someone cheered them on — but never notify yourself.
    if (post && post.user_id !== req.session.userId) {
      notify(post.user_id, 'kudos', `${displayName(req.session.userId)} gave you kudos`, { post_id: req.params.id });
    }
  }
  const likeCount = db.prepare('SELECT COUNT(*) c FROM post_likes WHERE post_id = ?').get(req.params.id).c;
  res.json({ liked: !existing, like_count: likeCount });
});

router.post('/posts/:id/save', requireAuth, (req, res) => {
  const post = db.prepare('SELECT id, user_id, visibility FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'post_not_found' });
  const me = req.session.userId;
  if (!postVisibleTo(post, me)) return res.status(404).json({ error: 'post_not_found' });
  const existing = db.prepare('SELECT 1 FROM post_saves WHERE post_id = ? AND user_id = ?').get(post.id, me);
  if (existing) db.prepare('DELETE FROM post_saves WHERE post_id = ? AND user_id = ?').run(post.id, me);
  else db.prepare('INSERT INTO post_saves (post_id, user_id) VALUES (?, ?)').run(post.id, me);
  res.json({ saved: !existing });
});

router.get('/posts/saved', requireAuth, (req, res) => {
  const me = req.session.userId;
  const posts = db.prepare(`
    SELECT p.id, p.content, p.created_at, p.visibility, p.photo_data, p.photo_category, p.video_data, p.video_category,
           u.display_name author, CASE WHEN u.avatar_data IS NOT NULL THEN 1 ELSE 0 END author_has_avatar,
           w.type workout_type, w.distance_km, w.calories, w.avg_hr, v.reference verse_reference, v.text verse_text,
           s.created_at saved_at
      FROM post_saves s JOIN posts p ON p.id = s.post_id JOIN users u ON u.id = p.user_id
      LEFT JOIN workouts w ON w.id = p.workout_id LEFT JOIN scripture_verses v ON v.id = p.verse_id
     WHERE s.user_id = ? AND (p.user_id = ? OR p.visibility = 'public' OR (p.visibility = 'followers' AND EXISTS (
            SELECT 1 FROM followers f WHERE f.follower_id = ? AND f.followee_id = p.user_id))
            OR (p.visibility = 'circle' AND EXISTS (
            SELECT 1 FROM circle_members c WHERE c.owner_id = p.user_id AND c.member_id = ?)))
       AND NOT EXISTS (SELECT 1 FROM dm_blocks b WHERE (b.blocker_id = ? AND b.blocked_id = p.user_id) OR (b.blocker_id = p.user_id AND b.blocked_id = ?))
     ORDER BY s.created_at DESC LIMIT 100
  `).all(me, me, me, me, me, me);
  res.json({ posts: posts.map(p => ({ ...p, saved_by_me: true })) });
});

router.post('/posts/:id/comments', requireAuth, requireCommunityAccess, (req, res) => {
  if(!allowWindow(commentRateWindow,req.session.userId,12,60_000)) return res.status(429).json({error:'commenting_too_fast'});
  const post = db.prepare('SELECT id, user_id, visibility FROM posts WHERE id = ?').get(req.params.id);
  if (!post || !postVisibleTo(post, req.session.userId)) return res.status(404).json({ error: 'post_not_found' });
  const permission = db.prepare('SELECT comment_permission FROM users WHERE id=?').get(post.user_id)?.comment_permission || 'everyone';
  const follows = !!db.prepare('SELECT 1 FROM followers WHERE follower_id=? AND followee_id=?').get(req.session.userId,post.user_id);
  if (post.user_id !== req.session.userId && (permission === 'nobody' || (permission === 'followers' && !follows))) {
    return res.status(403).json({ error: 'comments_closed' });
  }
  const content = String(req.body?.content || '').trim().slice(0, 500);
  if (!content) return res.status(400).json({ error: 'empty_comment' });
  const id = randomUUID();
  db.prepare('INSERT INTO post_comments (id, post_id, user_id, content) VALUES (?, ?, ?, ?)').run(id, req.params.id, req.session.userId, content);
  const comment = db.prepare(`SELECT c.id, c.content, c.created_at, u.display_name author FROM post_comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?`).get(id);

  const snippet = content.slice(0, 60);
  if (post && post.user_id !== req.session.userId) {
    notify(post.user_id, 'comment', `${displayName(req.session.userId)} commented: "${snippet}"`, { post_id: req.params.id });
  }
  // A direct @mention is the more specific signal, so those people get the
  // mention notification and are excluded from the generic "also replied"
  // broadcast below rather than being told twice about the same comment.
  const mentionedIds = new Set(notifyMentions(content, req.session.userId, { post_id: req.params.id })
    .map(m => m.user_id));
  // Conversation, not broadcast: everyone already in the thread hears the reply too.
  const others = db.prepare(`
    SELECT DISTINCT user_id FROM post_comments WHERE post_id = ? AND user_id != ? AND user_id != ?
  `).all(req.params.id, req.session.userId, post ? post.user_id : '');
  for (const o of others) {
    if (mentionedIds.has(o.user_id)) continue;
    notify(o.user_id, 'comment', `${displayName(req.session.userId)} also replied: "${snippet}"`, { post_id: req.params.id });
  }
  res.json(comment);
});

// ---- Taking it back down. ----
// Until now the only way a member could remove something they had written was
// to report themselves to a moderator or delete their whole account: the only
// DELETE FROM posts in the codebase were the moderation cascade and the
// account-deletion cascade. DELETE /workouts/:id even orphaned the post
// (UPDATE posts SET workout_id = NULL) rather than removing it. For an app
// whose most valuable content is a prayer request or a testimony written in
// the middle of a hard week, being unable to take that back is the wrong
// default -- and Moments already had author-delete, so the 24-hour content was
// retractable while the permanent content was not.
router.delete('/posts/:id', requireAuth, (req, res) => {
  const me = req.session.userId;
  const post = db.prepare('SELECT id, user_id FROM posts WHERE id = ?').get(req.params.id);
  // 404 rather than 403 for someone else's post -- consistent with the rest of
  // this file, an unauthorized caller learns nothing about what exists.
  if (!post || post.user_id !== me) return res.status(404).json({ error: 'post_not_found' });
  const commentIds = db.prepare('SELECT id FROM post_comments WHERE post_id = ?').all(post.id).map(c => c.id);
  if (commentIds.length) {
    const marks = commentIds.map(() => '?').join(',');
    db.prepare(`DELETE FROM comment_likes WHERE comment_id IN (${marks})`).run(...commentIds);
  }
  db.prepare('DELETE FROM post_comments WHERE post_id = ?').run(post.id);
  db.prepare('DELETE FROM post_likes WHERE post_id = ?').run(post.id);
  db.prepare('DELETE FROM post_saves WHERE post_id = ?').run(post.id);
  // Leave any moderation report in place: a member deleting a reported post
  // should not erase the report trail a reviewer may still need.
  db.prepare('DELETE FROM posts WHERE id = ?').run(post.id);
  res.json({ ok: true });
});

// Either the comment's own author or the author of the post it sits under.
// The post author matters most here: when something abrasive lands on someone's
// prayer request, reporting it only queues it for review while it stays
// visible. The person who published the vulnerable thing needs to be able to
// clean up underneath it themselves.
router.delete('/comments/:id', requireAuth, (req, res) => {
  const me = req.session.userId;
  const comment = db.prepare(`SELECT c.id, c.user_id, p.user_id post_author
    FROM post_comments c JOIN posts p ON p.id = c.post_id WHERE c.id = ?`).get(req.params.id);
  if (!comment || (comment.user_id !== me && comment.post_author !== me)) {
    return res.status(404).json({ error: 'comment_not_found' });
  }
  db.prepare('DELETE FROM comment_likes WHERE comment_id = ?').run(comment.id);
  db.prepare('DELETE FROM post_comments WHERE id = ?').run(comment.id);
  res.json({ ok: true, by: comment.user_id === me ? 'author' : 'post_author' });
});

router.post('/comments/:id/like', requireAuth, (req, res) => {
  const me = req.session.userId;
  const comment = db.prepare(`SELECT c.id, c.user_id, p.id post_id, p.user_id post_author, p.visibility
    FROM post_comments c JOIN posts p ON p.id = c.post_id WHERE c.id = ?`).get(req.params.id);
  if (!comment) return res.status(404).json({ error: 'comment_not_found' });
  if (!postVisibleTo({ user_id: comment.post_author, visibility: comment.visibility }, me) || dms.isBlockedEitherWay(me, comment.user_id)) return res.status(404).json({ error: 'comment_not_found' });
  const existing = db.prepare('SELECT 1 FROM comment_likes WHERE comment_id = ? AND user_id = ?').get(comment.id, me);
  if (existing) db.prepare('DELETE FROM comment_likes WHERE comment_id = ? AND user_id = ?').run(comment.id, me);
  else {
    db.prepare('INSERT INTO comment_likes (comment_id, user_id) VALUES (?, ?)').run(comment.id, me);
    if (comment.user_id !== me) notify(comment.user_id, 'comment_like', `${displayName(me)} liked your comment`, { post_id: comment.post_id });
  }
  const count = db.prepare('SELECT COUNT(*) AS count FROM comment_likes WHERE comment_id = ?').get(comment.id).count;
  res.json({ liked: !existing, like_count: Number(count) });
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
    const exists = db.prepare('SELECT tag_permission FROM users WHERE id = ?').get(partnerId);
    if (!exists) { errors.push({ partner_user_id: partnerId, error: 'user_not_found' }); continue; }
    const connected=!!db.prepare('SELECT 1 FROM followers WHERE follower_id=? AND followee_id=?').get(partnerId,taggerId);
    if(dms.isBlockedEitherWay(taggerId,partnerId)||exists.tag_permission==='nobody'||(exists.tag_permission==='followers'&&!connected)){
      errors.push({partner_user_id:partnerId,error:'tag_permission'});continue;
    }
    const id = randomUUID();
    try {
      db.prepare('INSERT INTO workout_partners (id, workout_id, tagged_by, partner_user_id, status) VALUES (?, ?, ?, ?, ?)')
        .run(id, workoutId, taggerId, partnerId, 'pending');
      db.prepare('INSERT INTO notifications (id, user_id, type, payload) VALUES (?, ?, ?, ?)')
        .run(randomUUID(), partnerId, 'workout_partner_tag', JSON.stringify({
          workout_partner_id: id, workout_id: workoutId, message: `${taggerName} tagged you as a workout partner — confirm to both get bonus XP`,
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
  // One intentional opening word: personalize it from the member's history,
  // consent, and chosen activity, then keep it stable until the workout earns
  // a meaningful moment transition.
  const uid = req.session.userId;
  const user = db.prepare('SELECT max_hr, birth_year, tradition FROM users WHERE id = ?').get(uid) || {};
  const consents = db.prepare('SELECT scope FROM user_consents WHERE user_id = ? AND revoked_at IS NULL').all(uid).map(r => r.scope);
  const candidateVerses = db.prepare('SELECT id, reference, youversion_id, themes FROM scripture_verses').all()
    .map(v => ({ ...v, themes: v.themes.split(',') }));
  const history = db.prepare('SELECT verse_id, 0 AS engaged FROM scripture_triggers WHERE user_id = ? ORDER BY timestamp DESC LIMIT 20').all(uid);
  const workout = db.prepare('SELECT * FROM workouts WHERE id = ?').get(id);
  const maxInfo = effortLib.maxHrInfo(user);
  const startSignals = computeEffortSignals(workout, [], maxInfo && maxInfo.value, {});
  const startResult = runPipeline({
    rawSnapshot: { heart_rate: null, workout_type: type, movement: { intensity: 0.4 }, stress_level: 0 },
    candidateVerses, userHistory: history, userPreferences: {
      preferred_themes: [String(type).toLowerCase(), 'strength', 'perseverance'],
      tradition: user.tradition || null,
    }, personalizationEnabled: consents.includes('scripture_personalization'),
    verseTextLookup: (yid) => db.prepare('SELECT text FROM scripture_verses WHERE youversion_id = ?').get(yid),
    effort: startSignals, lookupReference: lookupBibleReference, ftsSearch: bibleFtsSearch,
    sessionVerseIds: [], recentVerseIds: history.map(h => h.verse_id),
  });
  db.prepare('INSERT INTO scripture_triggers (id, user_id, verse_id, trigger_type, biometric_snapshot, workout_id, moment) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(randomUUID(), uid, startResult.verse.id, 'workout_start', JSON.stringify(startSignals), id, 'starting_out');
  publish('verse.triggered', { user_id: uid, verse_id: startResult.verse.id, youversion_id: startResult.verse.youversion_id, trigger_type: 'workout_start', payload: startResult.payload });
  publish('workout.started', { user_id: req.session.userId, workout_id: id, type });
  res.json({ id, type, start_time: workout.start_time, start_verse: startResult.payload, start_moment: 'starting_out', start_moment_label: 'Starting out' });
});

// Gloo's coaching layer uses the member's real training history to create a
// short intention before the workout. It never invents metrics, diagnoses, or
// writes scripture; scripture remains in the verified verse pipeline above.
router.post('/workouts/coach', requireAuth, async (req, res) => {
  if (!gloo.isConfigured()) return res.status(503).json({ error: 'gloo_not_configured' });
  const type = String((req.body || {}).type || 'Run').slice(0, 40);
  const uid = req.session.userId;
  const user = db.prepare('SELECT display_name, tradition FROM users WHERE id = ?').get(uid) || {};
  const recent = db.prepare(`SELECT type, duration_sec, distance_km, effort_score
    FROM workouts WHERE user_id = ? AND end_time IS NOT NULL ORDER BY end_time DESC LIMIT 8`).all(uid);
  const facts = recent.map(w => `${w.type}: ${Math.round((w.duration_sec || 0) / 60)} min` +
    (w.distance_km ? `, ${Number(w.distance_km).toFixed(1)} km` : '') +
    (w.effort_score != null ? `, effort ${Math.round(w.effort_score)}/100` : '')).join('; ') || 'No completed workouts yet';
  const out = await gloo.chatJson({
    kind: 'workout_coach', userId: uid, tradition: gloo.normaliseTradition(user.tradition), cacheDays: 1, maxTokens: 400,
    messages: [{ role: 'user', content:
      `Create a concise faith-aligned training cue for a Christian fitness app. ` +
      `Activity: ${type}. Recent completed workouts: ${facts}. ` +
      `Return only JSON: {"focus":"one short focus","cue":"one encouraging sentence","finish_line":"one practical finish instruction"}. ` +
      `Use no scripture quotations, no medical advice, no claims about emotions or fitness level, and do not invent data.` }],
  });
  const j = out && out.json;
  if (!j) return res.status(502).json({ error: 'gloo_unavailable' });
  res.json({ focus: String(j.focus || '').slice(0, 120), cue: String(j.cue || '').slice(0, 220), finish_line: String(j.finish_line || '').slice(0, 180), chosen_by: 'gloo' });
});

router.post('/workouts/:id/sample', requireAuth, async (req, res) => {
  // Heart rate is only ever a REAL reading from a paired monitor. When there is no
  // monitor the client sends nothing, and we store NULL — we never substitute a
  // default, and every zone/effort surface downstream degrades to "unknown".
  const rawHr = (req.body || {}).heart_rate;
  const rawStress = (req.body || {}).stress_level;
  const heart_rate = Number.isFinite(Number(rawHr)) && Number(rawHr) > 0 ? Math.round(Number(rawHr)) : null;
  const stress_level = Number.isFinite(Number(rawStress)) ? Math.round(Number(rawStress)) : null;
  const workout = db.prepare('SELECT * FROM workouts WHERE id = ? AND user_id = ?').get(req.params.id, req.session.userId);
  if (!workout) return res.status(404).json({ error: 'not_found' });
  if ((heart_rate != null || stress_level != null) && !hasActiveConsent(req.session.userId, 'biometric_ingest')) {
    return res.status(403).json({ error: 'biometric_consent_required' });
  }
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
  const lastTrigger = db.prepare('SELECT moment, timestamp FROM scripture_triggers WHERE workout_id = ? ORDER BY timestamp DESC LIMIT 1').get(workout.id);

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

  // Sampling remains frequent for telemetry, but scripture is event-driven:
  // never replace the card for the same moment, and never introduce a new
  // moment before two minutes have passed in the session.
  const elapsed = Number(signals.elapsed_sec) || 0;
  const meaningfulTransition = !lastTrigger || result.moment !== lastTrigger.moment;
  if (!meaningfulTransition || elapsed < 120) {
    return res.json({ context: result.context, verse: null, suppressed: true, moment: result.moment,
      moment_label: result.moment_label, zone: signals.zone,
      zone_source: signals.zone == null ? null : (maxInfo ? maxInfo.source : null), trend: signals.trend, elapsed_sec: elapsed });
  }

  db.prepare('INSERT INTO scripture_triggers (id, user_id, verse_id, trigger_type, biometric_snapshot, workout_id, moment) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(randomUUID(), req.session.userId, result.verse.id, result.context, JSON.stringify({ ...result.snapshot, ...signals }), workout.id, result.moment);

  publish('verse.triggered', { user_id: req.session.userId, verse_id: result.verse.id, youversion_id: result.verse.youversion_id, trigger_type: result.context, payload: result.payload });

  // Closed-device encouragement is reserved for hard transitions, and only if
  // the member opted into reminders. The on-site card remains the primary path.
  if (['climbing', 'the_wall', 'finishing'].includes(result.moment)) {
    push.send(req.session.userId, 'reminders', {
      title: `${result.moment_label} · Functioning Faith`,
      body: `${result.payload.reference} — ${result.payload.snippet || 'Keep going with courage.'}`,
      url: notificationDestination('verse', { reference: result.payload.reference }), tag: `workout-${workout.id}-${result.moment}`,
    }).catch(() => {});
  }

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
  // Personal bests, read back from the row we just wrote so the record is
  // measured from what was actually stored rather than from the request body.
  const newRecords = records.record(db.prepare('SELECT * FROM workouts WHERE id = ?').get(workout.id));
  for (const r of newRecords) {
    notify(req.session.userId, 'personal_record',
      `New personal record — ${r.label.toLowerCase()} for ${r.activity_type}: ${r.value} ${r.unit}`,
      { workout_id: workout.id, metric: r.metric });
  }

  res.json({
    id: workout.id, calories, avg_hr: avgHr, max_hr: maxHr, distance_km: gps_distance_km || null, duration_sec: durationSec,
    completed_challenges: completedChallenges.map(c => c.name), partner_tag_errors: partners.errors,
    personal_records: newRecords,
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
// Turn the completed workout into a useful, member-written reflection prompt.
router.post('/workouts/:id/reflection', requireAuth, async (req, res) => {
  if (!gloo.isConfigured()) return res.status(503).json({ error: 'gloo_not_configured' });
  const workout = db.prepare('SELECT type, duration_sec, distance_km, effort_score FROM workouts WHERE id = ? AND user_id = ? AND end_time IS NOT NULL')
    .get(req.params.id, req.session.userId);
  if (!workout) return res.status(404).json({ error: 'not_found' });
  const words = String((req.body || {}).reflection || '').trim().slice(0, 500);
  const user = db.prepare('SELECT tradition FROM users WHERE id = ?').get(req.session.userId) || {};
  const facts = `${workout.type}, ${Math.round((workout.duration_sec || 0) / 60)} minutes` +
    (workout.distance_km ? `, ${Number(workout.distance_km).toFixed(1)} km` : '') +
    (workout.effort_score != null ? `, effort ${Math.round(workout.effort_score)}/100` : '');
  const out = await gloo.chatJson({
    kind: 'workout_reflection', userId: req.session.userId, tradition: gloo.normaliseTradition(user.tradition), cache: false, maxTokens: 350,
    messages: [{ role: 'user', content:
      `Help a member reflect on a completed workout. Facts: ${facts}. Their own note: "${words || 'No note yet'}". ` +
      `Return only JSON: {"summary":"one warm sentence","next_step":"one practical next step"}. ` +
      `Do not add measurements, medical advice, scripture quotations, or guessed feelings.` }],
  });
  const j = out && out.json;
  if (!j) return res.status(502).json({ error: 'gloo_unavailable' });
  res.json({ summary: String(j.summary || '').slice(0, 240), next_step: String(j.next_step || '').slice(0, 180), chosen_by: 'gloo' });
});

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
  if ((Number(avg_hr) > 0 || (Array.isArray(hr_samples) && hr_samples.length)) && !hasActiveConsent(uid, 'biometric_ingest')) {
    return res.status(403).json({ error: 'biometric_consent_required' });
  }
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
  const newRecords = records.record(db.prepare('SELECT * FROM workouts WHERE id = ?').get(id));
  for (const r of newRecords) {
    notify(uid, 'personal_record',
      `New personal record — ${r.label.toLowerCase()} for ${r.activity_type}: ${r.value} ${r.unit}`,
      { workout_id: id, metric: r.metric });
  }
  res.status(201).json({
    id, type, calories: cal, distance_km: dist, duration_sec: durSec,
    completed_challenges: completed.map(c => c.name),
    partner_tag_errors: partners.errors,
    personal_records: newRecords,
    // Encouragement that cites what actually happened, or nothing at all.
    effort: effortSummary || null,
    effort_note: effortSummary
      ? effortLib.describeEffort(effortSummary, personalBests(uid, id))
      : null,
  });
});

// Your own bests, per activity type. Personal only -- see lib/records.js on
// why this is deliberately not a leaderboard.
router.get('/records', requireAuth, (req, res) => {
  res.json({ records: records.forUser(req.session.userId) });
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
        workout_id: tag.workout_id, message: `${partnerName} confirmed the workout partner tag — you both earned +${PARTNER_XP_BONUS} XP!`,
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
const PHOTO_CATEGORIES = ['workout', 'nature', 'animal', 'group'];
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

function storyVisible(story, viewerId) {
  if (!story || !viewerId) return false;
  if (story.user_id === viewerId || story.visibility === 'public') return true;
  return story.visibility === 'followers' && !!db.prepare(
    'SELECT 1 FROM followers WHERE follower_id = ? AND followee_id = ?'
  ).get(viewerId, story.user_id);
}

router.get('/stories', requireAuth, (req, res) => {
  const me = req.session.userId;
  const rows = db.prepare(`
    SELECT s.id, s.user_id, s.content, s.photo_data, s.photo_category,
           s.visibility, s.created_at, s.expires_at, u.display_name author,
           CASE WHEN u.avatar_data IS NOT NULL THEN 1 ELSE 0 END AS author_has_avatar,
           CASE WHEN sv.story_id IS NULL THEN 0 ELSE 1 END AS viewed,
           (SELECT COUNT(*) FROM story_reactions sr WHERE sr.story_id = s.id) AS reaction_count,
           (SELECT emoji FROM story_reactions mine WHERE mine.story_id = s.id AND mine.user_id = @me) AS my_reaction
      FROM stories s JOIN users u ON u.id = s.user_id
      LEFT JOIN story_views sv ON sv.story_id = s.id AND sv.viewer_id = @me
     WHERE s.expires_at > datetime('now')
       AND (s.visibility = 'public' OR s.user_id = @me OR (s.visibility = 'followers' AND EXISTS (
            SELECT 1 FROM followers f WHERE f.follower_id = @me AND f.followee_id = s.user_id)))
       AND NOT EXISTS (SELECT 1 FROM dm_blocks b
                       WHERE (b.blocker_id = @me AND b.blocked_id = s.user_id)
                          OR (b.blocker_id = s.user_id AND b.blocked_id = @me))
     ORDER BY s.created_at DESC LIMIT 80
  `).all({ me });
  res.json({ stories: rows });
});

router.post('/stories', requireAuth, requireCommunityAccess, (req, res) => {
  const { content, photo_data, photo_category, visibility } = req.body || {};
  const text = String(content || '').trim().slice(0, 280);
  let photoData = null;
  if (photo_data) {
    const check = validateDataUrlImage(photo_data);
    if (!check.ok) return res.status(400).json({ error: check.error, hint: check.hint });
    if (!PHOTO_CATEGORIES.includes(photo_category)) return res.status(400).json({ error: 'invalid_photo_category', hint: 'Moment photos must be nature, animals, or groups of people.' });
    photoData = photo_data;
  }
  if (!text && !photoData) return res.status(400).json({ error: 'moment_empty', hint: 'Add a short thought or a photo.' });
  const vis = VISIBILITIES.includes(visibility) ? visibility : 'public';
  const id = randomUUID();
  db.prepare(`INSERT INTO stories (id, user_id, content, photo_data, photo_category, visibility, expires_at)
              VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+24 hours'))`)
    .run(id, req.session.userId, text || null, photoData, photoData ? photo_category : null, vis);
  res.status(201).json({ id, visibility: vis, expires_in_hours: 24 });
});

router.post('/stories/:id/view', requireAuth, (req, res) => {
  const story = db.prepare('SELECT * FROM stories WHERE id = ? AND expires_at > datetime(\'now\')').get(req.params.id);
  if (!story || !storyVisible(story, req.session.userId) || dms.isBlockedEitherWay(req.session.userId, story.user_id)) return res.status(404).json({ error: 'story_not_found' });
  db.prepare('INSERT INTO story_views (story_id, viewer_id) VALUES (?, ?) ON CONFLICT(story_id, viewer_id) DO UPDATE SET viewed_at = datetime(\'now\')')
    .run(story.id, req.session.userId);
  res.json({ ok: true });
});

function hasActiveConsent(userId, scope) {
  return !!db.prepare('SELECT 1 FROM user_consents WHERE user_id=? AND scope=? AND revoked_at IS NULL').get(userId, scope);
}

const STORY_REACTIONS = ['❤️', '🙏', '🔥', '💪', '👏'];
router.post('/stories/:id/reaction', requireAuth, (req, res) => {
  const story = db.prepare('SELECT * FROM stories WHERE id = ? AND expires_at > datetime(\'now\')').get(req.params.id);
  if (!story || !storyVisible(story, req.session.userId) || dms.isBlockedEitherWay(req.session.userId, story.user_id)) return res.status(404).json({ error: 'story_not_found' });
  const emoji = String(req.body?.emoji || '');
  if (!STORY_REACTIONS.includes(emoji)) return res.status(400).json({ error: 'invalid_reaction' });
  const current = db.prepare('SELECT emoji FROM story_reactions WHERE story_id = ? AND user_id = ?').get(story.id, req.session.userId);
  if (current?.emoji === emoji) {
    db.prepare('DELETE FROM story_reactions WHERE story_id = ? AND user_id = ?').run(story.id, req.session.userId);
  } else {
    db.prepare(`INSERT INTO story_reactions (story_id, user_id, emoji) VALUES (?, ?, ?)
                ON CONFLICT(story_id, user_id) DO UPDATE SET emoji = excluded.emoji, created_at = datetime('now')`)
      .run(story.id, req.session.userId, emoji);
    if (story.user_id !== req.session.userId) notify(story.user_id, 'story_reaction', `${displayName(req.session.userId)} reacted ${emoji} to your moment`, { story_id: story.id });
  }
  const count = db.prepare('SELECT COUNT(*) AS count FROM story_reactions WHERE story_id = ?').get(story.id).count;
  const active = current?.emoji === emoji ? null : emoji;
  res.json({ emoji: active, reaction_count: Number(count) });
});

// A Moment reply is an ordinary protected DM with context, not a new public
// comment surface. That preserves the recipient's message settings, block and
// restriction controls, minor safeguards, and existing abuse protections.
router.post('/stories/:id/reply', requireAuth, requireCommunityAccess, (req, res) => {
  const me = req.session.userId;
  const story = db.prepare("SELECT * FROM stories WHERE id = ? AND expires_at > datetime('now')").get(req.params.id);
  if (!story || story.user_id === me || !storyVisible(story, me) || dms.isBlockedEitherWay(me, story.user_id)) {
    return res.status(404).json({ error: 'story_not_found' });
  }
  const body = String(req.body?.body || '').trim().slice(0, dms.MAX_LEN);
  if (!body) return res.status(400).json({ error: 'empty_reply', hint: 'Write a short reply first.' });
  const opened = dms.openThread(me, story.user_id);
  if (opened.error) return res.status(403).json({ error: opened.error, hint: 'This member is not accepting a new message from you.' });
  const excerpt = String(story.content || (story.photo_data ? 'A photo moment' : 'A moment')).slice(0, 120);
  const sent = dms.send(me, opened.thread.id, body, { kind: 'story_reply', metadata: { story_id: story.id, story_excerpt: excerpt } });
  if (sent.error) return res.status(sent.error === 'blocked' ? 403 : 400).json(sent);
  notify(story.user_id, 'dm', `${displayName(me)} replied to your moment.`, { thread_id: opened.thread.id, story_id: story.id });
  res.status(201).json({ thread_id: opened.thread.id, message: sent.message });
});

router.delete('/stories/:id', requireAuth, (req, res) => {
  const result = db.prepare('DELETE FROM stories WHERE id = ? AND user_id = ?').run(req.params.id, req.session.userId);
  if (!result.changes) return res.status(404).json({ error: 'story_not_found' });
  db.prepare('DELETE FROM story_views WHERE story_id = ?').run(req.params.id);
  res.json({ ok: true });
});

async function matchedScriptureForPost(userId, content, workoutId, requestedId) {
  if (requestedId) {
    const selected=db.prepare('SELECT id,reference,text FROM scripture_verses WHERE id=?').get(String(requestedId));
    if (selected) return { verse:selected, source:'member', reason:'Verse selected by the member.' };
  }
  const workout=workoutId?db.prepare('SELECT type FROM workouts WHERE id=? AND user_id=?').get(workoutId,userId):null;
  const activityTheme={Run:'endurance perseverance',Walk:'peace gratitude',Hike:'creation strength',Cycle:'endurance courage',Strength:'strength discipline',HIIT:'discipline perseverance',Yoga:'peace stillness',Swim:'renewal courage'};
  const terms=`${activityTheme[workout?.type]||'faith encouragement'} ${String(content||'').replace(/[^A-Za-z\s]/g,' ').slice(0,180)}`;
  let candidates=bibleFtsSearch(terms).slice(0,8);
  if(!candidates.length) candidates=db.prepare('SELECT id,book,chapter,verse,text,translation FROM bible_verses ORDER BY RANDOM() LIMIT 8').all().map(mirrorVerse);
  if(!candidates.length) return null;
  let picked=candidates[0],source='verified_fallback',reason=`Matched to ${workout?.type||'the post'} using verified Bible text.`;
  if(gloo.isConfigured()) {
    try {
      const user=db.prepare('SELECT tradition FROM users WHERE id=?').get(userId)||{};
      const out=await gloo.chatJson({kind:'post_scripture_match',userId,tradition:gloo.normaliseTradition(user.tradition),cache:false,maxTokens:180,
        messages:[{role:'user',content:`Choose exactly one candidate id for this Christian fitness/community post. Do not write or alter scripture. Return JSON {"id":"...","reason":"..."}. Post context: ${String(content||'').slice(0,300)}. Activity: ${workout?.type||'none'}. Candidates: ${JSON.stringify(candidates.map(v=>({id:v.id,reference:v.reference,text:v.text})))}`}]});
      const chosen=out?.json&&candidates.find(v=>v.id===out.json.id);
      if(chosen){picked=chosen;source='gloo_verified_candidates';reason=String(out.json.reason||reason).slice(0,240);}
    } catch { /* verified fallback remains */ }
  }
  return {verse:picked,source,reason};
}

router.post('/posts', requireAuth, requireCommunityAccess, async (req, res) => {
  const { content, workout_id, verse_id, visibility, photo_data, photo_category,
          video_data, video_category, show_route, route_privacy_m } = req.body || {};
  const uid = req.session.userId;
  if (video_data && !admin.featureEnabled('member_reels')) {
    return res.status(503).json({ error: 'member_reels_paused', hint: 'Member Reel publishing is temporarily paused.' });
  }
  if(!allowWindow(postRateWindow,uid,6,60_000)) return res.status(429).json({error:'posting_too_fast'});

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

  // Same anti-vanity gate as photos, enforced on real container bytes rather
  // than the declared MIME type (see lib/media.js). A post carries at most one
  // piece of media, so a video makes a photo on the same post redundant.
  let videoData = null, videoCategory = null, videoFormat = null, videoBytes = null, videoDurationS = null;
  if (video_data) {
    if (photoData) return res.status(400).json({ error: 'photo_and_video_not_allowed', hint: 'Attach either a photo or a video, not both.' });
    const check = media.validateVideo(video_data, video_category);
    if (!check.ok) return res.status(400).json({ error: check.error, hint: check.hint });
    videoData = video_data;
    videoCategory = check.category;
    videoFormat = check.format;
    videoBytes = check.bytes;
    videoDurationS = check.duration_s;
  }

  const userDefault = db.prepare('SELECT default_visibility FROM users WHERE id = ?').get(uid)?.default_visibility || 'public';
  const vis = VISIBILITIES.includes(visibility) ? visibility : userDefault;

  const id = randomUUID();
  // The route is published only for the author's own workout, only when asked
  // for, and with a privacy trim capped to something sane.
  const wantsRoute = !!show_route && !!workout_id ? 1 : 0;
  const privacyM = Math.max(0, Math.min(1000, Math.round(Number(route_privacy_m) || 0)));
  const scripture = await matchedScriptureForPost(uid,content,workout_id,verse_id);
  if (!scripture) return res.status(503).json({ error:'scripture_unavailable', hint:'A verified verse could not be resolved, so the post was not published.' });

  db.prepare(`INSERT INTO posts (id,user_id,content,workout_id,verse_id,visibility,
              photo_data,photo_category,show_route,route_privacy_m,verse_match_source,verse_match_reason,
              video_data,video_category,video_format,video_bytes,video_duration_s)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id,uid,(content||'').toString().slice(0,1000),workout_id||null,scripture.verse.id,vis,
         photoData,photoCategory,wantsRoute,privacyM,scripture.source,scripture.reason,
         videoData,videoCategory,videoFormat,videoBytes,videoDurationS);

  // Topic index and @mention notifications. Both read the same text the post
  // stored, so a mention only ever notifies someone actually named in it.
  const tags = mentions.replaceHashtagsFor(id, content || '');
  const mentioned = notifyMentions(content || '', uid, { post_id: id }, vis === 'private');

  res.status(201).json({ id,visibility:vis,share_url:vis==='public'?`/w/${id}`:null,
    hashtags: tags, mentioned: mentioned.map(m => m.display_name),
    scripture:{reference:scripture.verse.reference,text:scripture.verse.text,chosen_by:scripture.source,reason:scripture.reason} });
});

/**
 * Notify everyone named with an @mention.
 *
 * Two rules worth stating: a private post notifies nobody (telling someone
 * they were named in something they cannot open is worse than silence), and
 * someone who has blocked -- or been blocked by -- the author is never
 * notified, matching how every other surface in this file treats a block.
 */
function notifyMentions(text, authorId, payload, silent = false) {
  if (silent) return [];
  const found = mentions.resolveMentions(text, { excludeUserId: authorId });
  const name = displayName(authorId);
  const out = [];
  for (const person of found) {
    if (dms.isBlockedEitherWay(authorId, person.user_id)) continue;
    notify(person.user_id, 'mention', `${name} mentioned you`, payload);
    out.push(person);
  }
  return out;
}

// ---- Topics. ----
// Discovery here was only ever the follow graph plus follow-suggestions, with
// nothing between "people I already know" and "everyone". A tag is the cheap
// third axis -- #prayerrequest, #marathontraining, #lent -- and it is the one
// that makes the new standalone composer worth having.
router.get('/hashtags/trending', requireAuth, (req, res) => {
  res.json({ tags: mentions.trendingTags(req.query.days, req.query.limit) });
});

router.get('/hashtags/:tag', requireAuth, (req, res) => {
  const ids = mentions.postIdsForTag(req.params.tag, req.query.limit);
  if (!ids.length) return res.json({ tag: String(req.params.tag).toLowerCase(), posts: [] });
  // Named placeholders throughout -- the visibility clause below needs @me, and
  // node:sqlite will not bind a mix of positional and named parameters.
  const params = { me: req.session.userId };
  const marks = ids.map((id, i) => { params[`p${i}`] = id; return `@p${i}`; }).join(',');
  // Visibility is re-applied here rather than trusted from the tag index: the
  // index knows nothing about who may read a post.
  const rows = db.prepare(`
    SELECT p.id, p.content, p.created_at, p.visibility, p.photo_data, p.photo_category,
           p.user_id author_id, u.display_name author,
           CASE WHEN u.avatar_data IS NOT NULL THEN 1 ELSE 0 END AS author_has_avatar
    FROM posts p JOIN users u ON u.id = p.user_id
    WHERE p.id IN (${marks})
      AND (p.visibility = 'public'
           OR p.user_id = @me
           OR (p.visibility = 'followers' AND EXISTS (
               SELECT 1 FROM followers f WHERE f.followee_id = p.user_id AND f.follower_id = @me))
           OR (p.visibility = 'circle' AND EXISTS (
               SELECT 1 FROM circle_members c WHERE c.owner_id = p.user_id AND c.member_id = @me)))
      AND NOT EXISTS (SELECT 1 FROM dm_blocks b
                      WHERE (b.blocker_id = @me AND b.blocked_id = p.user_id)
                         OR (b.blocker_id = p.user_id AND b.blocked_id = @me))
      AND NOT EXISTS (SELECT 1 FROM account_relationship_controls rc
                      WHERE rc.actor_id = @me AND rc.subject_id = p.user_id AND rc.control = 'mute')
    ORDER BY p.created_at DESC
  `).all(params);
  res.json({ tag: String(req.params.tag).toLowerCase(), posts: rows });
});

// Community-enforcement report. No moderation queue/UI yet in this pass — this is
// a foundation for a future admin review flow, not a complete moderation system.
router.post('/posts/:id/report', requireAuth, (req, res) => {
  const post = db.prepare('SELECT id,user_id,visibility FROM posts WHERE id = ?').get(req.params.id);
  if (!post || !postVisibleTo(post,req.session.userId)) return res.status(404).json({ error: 'not_found' });
  if (post.user_id === req.session.userId) return res.status(400).json({ error: 'cannot_report_own_post' });
  const reason = (req.body && req.body.reason ? String(req.body.reason) : '').trim().slice(0, 300);
  if (reason.length < 5) return res.status(400).json({ error: 'reason_required' });
  const recent = db.prepare("SELECT COUNT(*) c FROM moderation_queue WHERE reporter_id=? AND created_at>=datetime('now','-1 day')").get(req.session.userId).c;
  if (recent >= 10) return res.status(429).json({ error: 'report_limit_reached' });
  if (db.prepare("SELECT 1 FROM moderation_queue WHERE report_type='post' AND target_id=? AND reporter_id=?").get(post.id,req.session.userId)) {
    return res.status(409).json({ error: 'already_reported' });
  }
  const reportId = randomUUID();
  db.prepare('INSERT INTO post_reports (id, post_id, reporter_id, reason) VALUES (?, ?, ?, ?)')
    .run(reportId, post.id, req.session.userId, reason);
  db.prepare("INSERT INTO moderation_queue(id,report_type,target_id,reporter_id,reason) VALUES(?,'post',?,?,?)")
    .run(reportId,post.id,req.session.userId,reason);
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
    SELECT p.id, p.content, p.created_at, p.visibility, p.photo_data, p.photo_category,
           p.video_data, p.video_category, u.display_name author,
           w.type workout_type, w.calories, w.avg_hr, w.max_hr, w.distance_km,
           w.start_time, w.end_time, w.gps_path, p.show_route, p.route_privacy_m,
           v.reference verse_reference, v.text verse_text
    FROM posts p
    JOIN users u ON u.id = p.user_id
    LEFT JOIN workouts w ON w.id = p.workout_id
    LEFT JOIN scripture_verses v ON v.id = p.verse_id
    WHERE p.id = ?
  `).get(req.params.id);

  if (!p || p.visibility !== 'public') return res.status(404).json({ error: 'not_found' });
  if (p.photo_data && !validateDataUrlImage(p.photo_data).ok) p.photo_data = null;
  if (p.video_data && !media.validateVideo(p.video_data).ok) p.video_data = null;

  const route = publishedRoute(p);

  let durationMin = null, pace = null, distanceKm = p.distance_km ?? null;
  if (p.start_time && p.end_time) durationMin = +(((new Date(p.end_time) - new Date(p.start_time)) / 60000).toFixed(1));
  if (distanceKm > 0 && durationMin > 0) pace = +(durationMin / distanceKm).toFixed(1);

  res.json({
    id: p.id,
    author: p.author,
    content: p.content,
    created_at: p.created_at,
    photo_data: p.photo_data,
    photo_category: p.photo_category,
    video_data: p.video_data,
    video_category: p.video_category,
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
  const pending = db.prepare('SELECT 1 FROM follow_requests WHERE requester_id = ? AND target_id = ?').get(me, target);
  const meName = db.prepare('SELECT display_name FROM users WHERE id = ?').get(me)?.display_name || 'Someone';

  if (already) {
    db.prepare('DELETE FROM followers WHERE follower_id = ? AND followee_id = ?').run(me, target);
    // A circle is a subset of your followers. Someone who stops following you
    // must stop seeing your circle posts too, or unfollowing would leave them
    // with MORE access than an ordinary follower.
    circle.pruneOnUnfollow(target, me);
  } else if (pending) {
    db.prepare('DELETE FROM follow_requests WHERE requester_id = ? AND target_id = ?').run(me, target); // withdraw
  } else {
    // Anyone could previously insert themselves straight into `followers`, and
    // `followers` is the tier that gates followers-only posts, comments,
    // stories and profile visibility -- so "followers-only" meant "anyone who
    // presses Follow". Every account that is not public now requires approval,
    // which includes every under-18 account (registration and OAuth setup both
    // force minors to private).
    const targetRow = db.prepare('SELECT profile_visibility FROM users WHERE id = ?').get(target);
    const needsApproval = (targetRow?.profile_visibility || 'public') !== 'public';
    if (needsApproval) {
      db.prepare('INSERT OR IGNORE INTO follow_requests (requester_id, target_id) VALUES (?, ?)').run(me, target);
      notify(target, 'follow_request', `${meName} asked to follow you`, { requester_id: me });
      const followersNow = db.prepare('SELECT COUNT(*) c FROM followers WHERE followee_id = ?').get(target).c;
      return res.json({ following: false, requested: true, followers_count: followersNow });
    }
    db.prepare('INSERT OR IGNORE INTO followers (follower_id, followee_id) VALUES (?, ?)').run(me, target);
    db.prepare('INSERT INTO notifications (id, user_id, type, payload) VALUES (?, ?, ?, ?)')
      .run(randomUUID(), target, 'follow', JSON.stringify({ follower_id: me, message: `${meName} started following you` }));
    publish('user.followed', { follower_id: me, followee_id: target });
  }
  const followers = db.prepare('SELECT COUNT(*) c FROM followers WHERE followee_id = ?').get(target).c;
  res.json({ following: !already && !pending, requested: false, followers_count: followers });
});

// ---- Trusted circle. ----
// A named subset of your own followers, for the post that "everyone who
// follows me" is too wide for and "only me" defeats the point of.
router.get('/circle', requireAuth, (req, res) => {
  res.json({ members: circle.list(req.session.userId), max: circle.MAX_CIRCLE });
});

// Candidates are your followers, so the picker cannot be used to push private
// content at someone who never chose to follow you.
router.get('/circle/candidates', requireAuth, (req, res) => {
  const me = req.session.userId;
  const rows = db.prepare(`
    SELECT u.id user_id, u.display_name,
           CASE WHEN u.avatar_data IS NOT NULL THEN 1 ELSE 0 END AS has_avatar,
           CASE WHEN c.member_id IS NULL THEN 0 ELSE 1 END AS in_circle
    FROM followers f JOIN users u ON u.id = f.follower_id
    LEFT JOIN circle_members c ON c.owner_id = @me AND c.member_id = u.id
    WHERE f.followee_id = @me
      AND NOT EXISTS (SELECT 1 FROM dm_blocks b
                      WHERE (b.blocker_id = @me AND b.blocked_id = u.id)
                         OR (b.blocker_id = u.id AND b.blocked_id = @me))
    ORDER BY in_circle DESC, u.display_name
  `).all({ me });
  res.json({ candidates: rows });
});

router.put('/circle/:userId', requireAuth, (req, res) => {
  const r = circle.add(req.session.userId, req.params.userId);
  if (r.error) return res.status(400).json(r);
  res.json({ ok: true, in_circle: true });
});

router.delete('/circle/:userId', requireAuth, (req, res) => {
  res.json({ ...circle.remove(req.session.userId, req.params.userId), in_circle: false });
});

// Incoming requests waiting on you.
router.get('/follow-requests', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT fr.requester_id user_id, fr.created_at, u.display_name, u.bio_verse_ref,
           CASE WHEN u.avatar_data IS NOT NULL THEN 1 ELSE 0 END AS has_avatar
    FROM follow_requests fr JOIN users u ON u.id = fr.requester_id
    WHERE fr.target_id = ?
      AND NOT EXISTS (SELECT 1 FROM dm_blocks b
                      WHERE (b.blocker_id = fr.target_id AND b.blocked_id = fr.requester_id)
                         OR (b.blocker_id = fr.requester_id AND b.blocked_id = fr.target_id))
    ORDER BY fr.created_at DESC
  `).all(req.session.userId);
  res.json({ requests: rows });
});

router.post('/follow-requests/:requesterId/:decision(accept|decline)', requireAuth, (req, res) => {
  const me = req.session.userId;
  const requester = req.params.requesterId;
  const row = db.prepare('SELECT 1 FROM follow_requests WHERE requester_id = ? AND target_id = ?').get(requester, me);
  if (!row) return res.status(404).json({ error: 'no_such_request' });
  db.prepare('DELETE FROM follow_requests WHERE requester_id = ? AND target_id = ?').run(requester, me);
  if (req.params.decision === 'accept') {
    db.prepare('INSERT OR IGNORE INTO followers (follower_id, followee_id) VALUES (?, ?)').run(requester, me);
    notify(requester, 'follow_accepted', `${displayName(me)} accepted your follow request`, { user_id: me });
    publish('user.followed', { follower_id: requester, followee_id: me });
  }
  // A decline is silent -- telling someone they were turned down invites the
  // exact re-request loop the approval step exists to prevent.
  res.json({ ok: true, decision: req.params.decision });
});

// People to follow: users the viewer doesn't already follow (and isn't), ranked by
// follower count so there's always something to discover.
router.get('/users/suggested', requireAuth, (req, res) => {
  const me = req.session.userId;
  const rows = db.prepare(`
    WITH following AS (SELECT followee_id FROM followers WHERE follower_id = @me)
    SELECT u.id, u.display_name, u.bio_verse_ref, u.email,
           (SELECT COUNT(*) FROM followers f WHERE f.followee_id = u.id) AS followers_count,
           (SELECT COUNT(*) FROM followers mutual
             WHERE mutual.followee_id = u.id
               AND mutual.follower_id IN (SELECT followee_id FROM following)) AS mutual_count,
           CASE WHEN @church IS NOT NULL AND @church != '' AND u.church = @church THEN 1 ELSE 0 END AS shared_church,
           CASE WHEN @group_name IS NOT NULL AND @group_name != '' AND u.fitness_group = @group_name THEN 1 ELSE 0 END AS shared_group
    FROM users u
    WHERE u.id != @me
      AND u.id NOT IN (SELECT followee_id FROM following)
    ORDER BY shared_church DESC, shared_group DESC, mutual_count DESC, followers_count DESC, u.display_name
    LIMIT 48
  `).all({
    me,
    church: db.prepare('SELECT church FROM users WHERE id = ?').get(me)?.church || null,
    group_name: db.prepare('SELECT fitness_group FROM users WHERE id = ?').get(me)?.fitness_group || null,
  }).filter(row => !isLikelySyntheticAccount(row))
    .slice(0, 12)
    .map(row => ({
    ...row,
    reason: row.shared_church ? 'From your church' : row.shared_group ? 'In your fitness group' : row.mutual_count ? `${row.mutual_count} mutual connection${row.mutual_count === 1 ? '' : 's'}` : 'Popular in the community',
    email: undefined,
    shared_church: undefined,
    shared_group: undefined,
  }));
  res.json(rows);
});

function socialList(req, res, userId, kind) {
  const targetUser = db.prepare('SELECT follower_list_visibility FROM users WHERE id = ?').get(userId);
  if (!targetUser) return res.status(404).json({ error: 'user_not_found' });
  const isMe = userId === req.session.userId;
  const follows = !!db.prepare('SELECT 1 FROM followers WHERE follower_id=? AND followee_id=?').get(req.session.userId,userId);
  if (!isMe && (targetUser.follower_list_visibility === 'private' || (targetUser.follower_list_visibility === 'followers' && !follows))) {
    return res.status(404).json({ error: 'not_found' });
  }
  const idColumn = kind === 'followers' ? 'f.follower_id' : 'f.followee_id';
  const targetColumn = kind === 'followers' ? 'f.followee_id' : 'f.follower_id';
  const rows = db.prepare(`
    SELECT u.id, u.display_name, u.bio_verse_ref,
           CASE WHEN u.avatar_data IS NOT NULL THEN 1 ELSE 0 END AS has_avatar,
           CASE WHEN mine.follower_id IS NULL THEN 0 ELSE 1 END AS is_following
      FROM followers f JOIN users u ON u.id = ${idColumn}
      LEFT JOIN followers mine ON mine.follower_id = @me AND mine.followee_id = u.id
     WHERE ${targetColumn} = @target
       AND NOT EXISTS (SELECT 1 FROM dm_blocks b
                       WHERE (b.blocker_id = @me AND b.blocked_id = u.id)
                          OR (b.blocker_id = u.id AND b.blocked_id = @me))
     ORDER BY u.display_name LIMIT 100
  `).all({ me: req.session.userId, target: userId });
  res.json({ kind, members: rows });
}
router.get('/users/:id/followers', requireAuth, (req, res) => socialList(req, res, req.params.id, 'followers'));
router.get('/users/:id/following', requireAuth, (req, res) => socialList(req, res, req.params.id, 'following'));

// Public-facing profile for any user. Never exposes private fields (job/church/
// gym/age/email). Posts respect the viewer's visibility (public to all; followers
// if the viewer follows; everything if it's the viewer's own profile).
router.get('/users/:id', (req, res) => {
  const me = req.session.userId || null;
  const u = db.prepare(`
    SELECT id,display_name,bio_verse_ref,bio_verse_text,bio_link_url,bio_link_label,profile_visibility,follower_list_visibility,
           CASE WHEN EXISTS(SELECT 1 FROM developer_applications da WHERE da.user_id=users.id AND da.status='verified') THEN 1 ELSE 0 END AS verified_developer,
           CASE WHEN avatar_data IS NOT NULL THEN 1 ELSE 0 END AS has_avatar
    FROM users WHERE id = ?
  `).get(req.params.id);
  if (!u) return res.status(404).json({ error: 'user_not_found' });

  const is_me = me === u.id;
  const is_following = me ? !!db.prepare('SELECT 1 FROM followers WHERE follower_id = ? AND followee_id = ?').get(me, u.id) : false;
  if (me && dms.isBlockedEitherWay(me,u.id)) return res.status(404).json({ error: 'user_not_found' });
  if (!is_me && (u.profile_visibility === 'private' || (u.profile_visibility === 'followers' && !is_following))) {
    return res.status(404).json({ error: 'user_not_found' });
  }
  delete u.profile_visibility;

  const stats = {
    workouts: db.prepare("SELECT COUNT(*) c FROM workouts WHERE user_id = ? AND end_time IS NOT NULL").get(u.id).c,
    followers: db.prepare('SELECT COUNT(*) c FROM followers WHERE followee_id = ?').get(u.id).c,
    following: db.prepare('SELECT COUNT(*) c FROM followers WHERE follower_id = ?').get(u.id).c,
  };
  const followerStatsVisible=is_me||u.follower_list_visibility==='public'||(u.follower_list_visibility==='followers'&&is_following);
  if(!followerStatsVisible){stats.followers=null;stats.following=null;}
  delete u.follower_list_visibility;
  const posts = db.prepare(`
    SELECT p.id, p.content, p.created_at, p.visibility, p.workout_id, p.photo_data, p.photo_category, p.video_data, p.video_category,
           w.type workout_type, w.calories, w.avg_hr, w.distance_km,
           v.reference verse_reference, v.text verse_text
    FROM posts p
    LEFT JOIN workouts w ON w.id = p.workout_id
    LEFT JOIN scripture_verses v ON v.id = p.verse_id
    WHERE p.user_id = @uid AND (
      p.visibility = 'public'
      OR @me = @uid
      OR (p.visibility = 'followers' AND EXISTS (SELECT 1 FROM followers f WHERE f.followee_id = @uid AND f.follower_id = @me))
      OR (p.visibility = 'circle' AND EXISTS (SELECT 1 FROM circle_members c WHERE c.owner_id = @uid AND c.member_id = @me)))
    ORDER BY p.created_at DESC LIMIT 20
  `).all({ uid: u.id, me });

  posts.forEach(p => { if (p.photo_data && !validateDataUrlImage(p.photo_data).ok) p.photo_data = null; });

  res.json({ user: u, stats, is_me, is_following,
    is_blocked: me ? dms.isBlockedEitherWay(me, u.id) : false,
    // Both are one-sided and silent by design -- the other person is never
    // told -- so these reflect only what the viewer has done to them.
    is_muted: me ? accountSecurity.hasRelationship(me, u.id, 'mute') : false,
    is_restricted: me ? accountSecurity.hasRelationship(me, u.id, 'restrict') : false,
    follow_requested: me ? !!db.prepare('SELECT 1 FROM follow_requests WHERE requester_id = ? AND target_id = ?').get(me, u.id) : false,
    posts });
});

router.post('/users/:id/block', requireAuth, (req, res) => {
  if (req.params.id === req.session.userId) return res.status(400).json({ error: 'invalid_recipient' });
  if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(req.params.id)) return res.status(404).json({ error: 'user_not_found' });
  res.json(dms.block(req.session.userId, req.params.id));
});

router.delete('/users/:id/block', requireAuth, (req, res) => {
  res.json(dms.unblock(req.session.userId, req.params.id));
});

router.post('/users/:id/report', requireAuth, (req, res) => {
  if (req.params.id === req.session.userId) return res.status(400).json({ error: 'cannot_report_self' });
  if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(req.params.id)) return res.status(404).json({ error: 'user_not_found' });
  const reason = String(req.body?.reason || '').trim().slice(0, 300);
  if (reason.length<5) return res.status(400).json({ error: 'reason_required' });
  const recent=db.prepare("SELECT COUNT(*) c FROM moderation_queue WHERE reporter_id=? AND created_at>=datetime('now','-1 day')").get(req.session.userId).c;
  if(recent>=10)return res.status(429).json({error:'report_limit_reached'});
  if(db.prepare("SELECT 1 FROM moderation_queue WHERE report_type='user' AND target_id=? AND reporter_id=?").get(req.params.id,req.session.userId))return res.status(409).json({error:'already_reported'});
  const id=randomUUID();
  db.prepare('INSERT INTO user_reports (id, reported_user_id, reporter_id, reason) VALUES (?, ?, ?, ?)')
    .run(id, req.params.id, req.session.userId, reason);
  db.prepare("INSERT INTO moderation_queue(id,report_type,target_id,reporter_id,reason) VALUES(?,'user',?,?,?)").run(id,req.params.id,req.session.userId,reason);
  res.status(201).json({ ok: true });
});

// ---- explore ----
router.get('/explore', (req, res) => {
  // Private groups are excluded here for everyone but their own members --
  // this is the general discovery listing, and "private" only means
  // anything if it isn't just handed to every visitor regardless.
  const me = req.session.userId;
  const groups = db.prepare(`SELECT g.*, COUNT(gm.user_id) AS member_count
    FROM groups g LEFT JOIN group_members gm ON gm.group_id = g.id
    WHERE g.visibility = 'public' OR EXISTS (SELECT 1 FROM group_members m WHERE m.group_id = g.id AND m.user_id = ?)
    GROUP BY g.id ORDER BY g.name`).all(me || null);
  const quests = db.prepare('SELECT * FROM quests').all();
  res.json({ groups, quests });
});

// ---- group detail: chat (polling) + run meetups with RSVP ----
function isGroupMember(groupId, userId) {
  return !!db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?').get(groupId, userId);
}
// Admin is either the group's creator or anyone carrying the 'admin' role on
// their membership row. Checking creator_id alone used to be the whole test,
// which meant the role column -- written on create, backfilled for legacy
// groups, and reassigned when a creator's account is deleted -- authorized
// nothing, and a promoted admin got no powers.
function isGroupAdmin(groupId, userId) {
  if (!userId) return false;
  if (db.prepare('SELECT 1 FROM groups WHERE id = ? AND creator_id = ?').get(groupId, userId)) return true;
  return !!db.prepare("SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ? AND role = 'admin'")
    .get(groupId, userId);
}
function groupUsername(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
}
function groupInvitePayload(group, token) {
  const base = process.env.APP_BASE_URL || 'https://faithfit-demo-production.up.railway.app';
  const link = `${base}/?group_invite=${encodeURIComponent(token)}`;
  return { link, token, qr_url: `https://quickchart.io/qr?size=320&text=${encodeURIComponent(link)}` };
}

router.post('/groups', requireAuth, requireCommunityAccess, (req, res) => {
  const { name, description, username, church_osm_id, church_name, location_name, lat, lng, sport, visibility } = req.body || {};
  const cleanName = String(name || '').trim().slice(0, 80);
  const handle = groupUsername(username || name);
  const vis = visibility === 'private' ? 'private' : 'public';
  const hasLat = lat !== undefined && lat !== null && String(lat).trim() !== '';
  const hasLng = lng !== undefined && lng !== null && String(lng).trim() !== '';
  const groupLat = hasLat ? Number(lat) : null;
  const groupLng = hasLng ? Number(lng) : null;
  if (!cleanName) return res.status(400).json({ error: 'name_required' });
  if (!/^[a-z0-9][a-z0-9_-]{2,29}$/.test(handle)) return res.status(400).json({ error: 'invalid_username', hint: 'Use 3–30 lowercase letters, numbers, hyphens, or underscores.' });
  if (hasLat !== hasLng || (hasLat && (!Number.isFinite(groupLat) || !Number.isFinite(groupLng) || groupLat < -90 || groupLat > 90 || groupLng < -180 || groupLng > 180))) {
    return res.status(400).json({ error: 'invalid_group_location', hint: 'Use a valid approximate latitude and longitude, or leave both blank.' });
  }
  if (db.prepare('SELECT 1 FROM groups WHERE username = ?').get(handle)) return res.status(409).json({ error: 'username_taken' });
  const id = randomUUID();
  db.prepare(`INSERT INTO groups (id, name, description, username, creator_id, church_osm_id, church_name,
    location_name, lat, lng, sport, visibility, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`)
    .run(id, cleanName, String(description || '').trim().slice(0, 500) || null, handle, req.session.userId,
      church_osm_id ? String(church_osm_id).slice(0, 80) : null, church_name ? String(church_name).trim().slice(0, 120) : null,
      location_name ? String(location_name).trim().slice(0, 120) : null, groupLat,
      groupLng, sport ? String(sport).trim().slice(0, 50) : null, vis);
  db.prepare("INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, 'admin')").run(id, req.session.userId);
  res.status(201).json({ group: db.prepare('SELECT * FROM groups WHERE id = ?').get(id), is_admin: true });
});

// Public groups near a point -- only groups with lat/lng set and
// visibility='public' are discoverable this way. Private groups never show
// up here regardless of distance; they're found only through an invite link.
router.get('/groups/nearby', requireAuth, (req, res) => {
  const lat = Number(req.query.lat), lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: 'lat_lng_required' });
  const radiusKm = Math.min(200, Math.max(1, Number(req.query.radius_km) || 25));
  const sport = req.query.sport ? String(req.query.sport).trim().slice(0, 50) : null;

  const rows = db.prepare(`
    SELECT g.*, COUNT(gm.user_id) AS member_count
    FROM groups g LEFT JOIN group_members gm ON gm.group_id = g.id
    WHERE g.visibility = 'public' AND g.lat IS NOT NULL AND g.lng IS NOT NULL
      ${sport ? 'AND g.sport = @sport' : ''}
    GROUP BY g.id
  `).all(sport ? { sport } : {});

  const nearby = rows
    .map(g => ({ ...g, distance_km: Math.round(haversineMetres([lat, lng], [g.lat, g.lng]) / 100) / 10 }))
    .filter(g => g.distance_km <= radiusKm)
    .sort((a, b) => a.distance_km - b.distance_km)
    .slice(0, 50);

  res.json({ groups: nearby });
});

router.get('/groups/username/:username', requireAuth, (req, res) => {
  const group = db.prepare('SELECT id, name, username, description, church_name, location_name, sport, visibility FROM groups WHERE username = ?')
    .get(groupUsername(req.params.username));
  if (!group || (group.visibility === 'private' && !isGroupMember(group.id, req.session.userId))) {
    return res.status(404).json({ error: 'not_found' });
  }
  delete group.visibility;
  res.json(group);
});

// Gloo recommends from the real group catalog; it never invents group IDs.
router.get('/groups/recommended', requireAuth, async (req, res) => {
  const user = db.prepare('SELECT church, church_name, fitness_group, tradition FROM users WHERE id = ?').get(req.session.userId) || {};
  const groups = db.prepare(`SELECT g.id, g.name, g.username, g.description, g.church_name, g.location_name, g.sport,
      COUNT(gm.user_id) AS member_count FROM groups g LEFT JOIN group_members gm ON gm.group_id = g.id GROUP BY g.id`).all();
  if (!groups.length) return res.json({ groups: [], chosen_by: 'fallback' });
  let ranked = groups.map(g => ({ ...g, reason: 'A community that matches your movement.' }));
  if (gloo.isConfigured()) {
    const out = await gloo.chatJson({ kind: 'group_recommendations', userId: req.session.userId, tradition: gloo.normaliseTradition(user.tradition), cacheDays: 1,
      maxTokens: 500, messages: [{ role: 'system', content: 'Recommend groups only from the supplied catalog. Return strict JSON: {"groups":[{"id":"existing id","reason":"short reason"}]}. Never invent ids.' },
        { role: 'user', content: JSON.stringify({ member: { church: user.church_name || user.church, fitness_group: user.fitness_group }, catalog: groups }) }] });
    const picks = out && out.json && Array.isArray(out.json.groups) ? out.json.groups : [];
    const byId = new Map(groups.map(g => [g.id, g]));
    const valid = picks.filter(p => byId.has(p.id)).slice(0, 8);
    if (valid.length) ranked = valid.map(p => ({ ...byId.get(p.id), reason: String(p.reason || 'A community selected for you.').slice(0, 180) }));
  }
  res.json({ groups: ranked.slice(0, 8), chosen_by: gloo.isConfigured() ? 'gloo' : 'fallback' });
});

router.post('/groups/:id/gloo-sync', requireAuth, async (req, res) => {
  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.id);
  if (!group) return res.status(404).json({ error: 'not_found' });
  if (!isGroupAdmin(group.id, req.session.userId)) return res.status(403).json({ error: 'admin_only' });
  if (!gloo.isConfigured()) return res.status(503).json({ error: 'gloo_not_configured' });
  const out = await gloo.chatJson({ kind: 'group_sync', userId: req.session.userId, cache: false, maxTokens: 300,
    messages: [{ role: 'system', content: 'Clean up this Christian fitness group profile. Return strict JSON with only description (max 240 chars), sport (max 40 chars), and welcome (max 180 chars). Do not change the group name or invent affiliations.' },
      { role: 'user', content: JSON.stringify({ name: group.name, description: group.description, sport: group.sport, church: group.church_name, location: group.location_name }) }] });
  const suggestion = out && out.json;
  if (!suggestion) return res.status(502).json({ error: 'gloo_unavailable' });
  db.prepare("UPDATE groups SET description = ?, sport = ?, gloo_synced_at = datetime('now') WHERE id = ?")
    .run(String(suggestion.description || group.description || '').slice(0, 500), String(suggestion.sport || group.sport || '').slice(0, 50) || null, group.id);
  res.json({ group: db.prepare('SELECT * FROM groups WHERE id = ?').get(group.id), welcome: String(suggestion.welcome || '').slice(0, 180), chosen_by: 'gloo' });
});

router.post('/groups/:id/invites', requireAuth, (req, res) => {
  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.id);
  if (!group) return res.status(404).json({ error: 'not_found' });
  if (!isGroupAdmin(group.id, req.session.userId)) return res.status(403).json({ error: 'admin_only' });
  let invite = db.prepare('SELECT token FROM group_invites WHERE group_id = ? ORDER BY created_at DESC LIMIT 1').get(group.id);
  if (!invite) {
    invite = { token: randomUUID().replace(/-/g, '') };
    db.prepare('INSERT INTO group_invites (id, group_id, token, created_by) VALUES (?, ?, ?, ?)').run(randomUUID(), group.id, invite.token, req.session.userId);
  }
  res.json(groupInvitePayload(group, invite.token));
});

router.get('/groups/invites/:token', (req, res) => {
  const invite = db.prepare(`SELECT i.token, g.id, g.name, g.username, g.description, g.church_name, g.location_name, g.sport
    FROM group_invites i JOIN groups g ON g.id = i.group_id WHERE i.token = ?`).get(String(req.params.token));
  if (!invite) return res.status(404).json({ error: 'invalid_invite' });
  res.json({ group: invite });
});

router.post('/groups/invites/:token/join', requireAuth, (req, res) => {
  const invite = db.prepare('SELECT group_id FROM group_invites WHERE token = ?').get(String(req.params.token));
  if (!invite) return res.status(404).json({ error: 'invalid_invite' });
  db.prepare("INSERT OR IGNORE INTO group_members (group_id, user_id, role) VALUES (?, ?, 'member')").run(invite.group_id, req.session.userId);
  res.json({ ok: true, group_id: invite.group_id });
});

router.get('/groups/:id', requireAuth, (req, res) => {
  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.id);
  if (!group) return res.status(404).json({ error: 'not_found' });
  const memberCount = db.prepare('SELECT COUNT(*) c FROM group_members WHERE group_id = ?').get(group.id).c;
  const isMember = isGroupMember(group.id, req.session.userId);
  const messages = isMember ? db.prepare(`
    SELECT m.id, m.content, m.created_at, m.user_id author_id, u.display_name author
    FROM group_messages m JOIN users u ON u.id = m.user_id
    WHERE m.group_id = ? ORDER BY m.created_at ASC LIMIT 50
  `).all(group.id) : [];
  const events = isMember ? db.prepare(`
    SELECT e.*,
      (SELECT COUNT(*) FROM event_rsvps r WHERE r.event_id = e.id AND r.status = 'going') going_count,
      (SELECT COUNT(*) FROM event_rsvps r WHERE r.event_id = e.id AND r.status = 'interested') interested_count,
      (SELECT status FROM event_rsvps r WHERE r.event_id = e.id AND r.user_id = @me) my_rsvp
    FROM group_events e
    WHERE e.group_id = @gid AND e.event_time >= datetime('now')
    ORDER BY e.event_time ASC
  `).all({ gid: group.id, me: req.session.userId }) : [];
  res.json({ group, member_count: memberCount, is_member: isMember, is_admin: isGroupAdmin(group.id, req.session.userId), messages, events });
});

router.post('/groups/:id/join', requireAuth, (req, res) => {
  const group = db.prepare('SELECT id, visibility FROM groups WHERE id = ?').get(req.params.id);
  if (!group) return res.status(404).json({ error: 'not_found' });
  // A private group is joinable only through an invite link (POST
  // /groups/invites/:token/join, already inserts membership directly) --
  // this generic route is the "friends with your friends" open door and
  // must not double as a way around that for a group marked private.
  if (group.visibility === 'private') return res.status(403).json({ error: 'private_group_requires_invite' });
  db.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)').run(group.id, req.session.userId);
  res.json({ ok: true });
});

router.post('/groups/:id/leave', requireAuth, (req, res) => {
  const me = req.session.userId;
  db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(req.params.id, me);
  // Hand the group on if the person leaving was running it. Without this the
  // group kept a creator_id pointing at someone who is no longer a member, so
  // nobody could administer it ever again -- the account-deletion path already
  // did this reassignment, the ordinary "leave" path did not.
  const group = db.prepare('SELECT id, creator_id FROM groups WHERE id = ?').get(req.params.id);
  if (group && group.creator_id === me) {
    const next = db.prepare(`SELECT user_id FROM group_members WHERE group_id = ?
      ORDER BY (role = 'admin') DESC, rowid LIMIT 1`).get(group.id);
    if (next) {
      db.prepare('UPDATE groups SET creator_id = ? WHERE id = ?').run(next.user_id, group.id);
      db.prepare("UPDATE group_members SET role = 'admin' WHERE group_id = ? AND user_id = ?").run(group.id, next.user_id);
      notify(next.user_id, 'group_admin', 'You are now the organiser of a group you belong to.', { group_id: group.id });
    } else {
      db.prepare('DELETE FROM groups WHERE id = ?').run(group.id); // last member out
    }
  }
  res.json({ ok: true });
});

// ---- Group administration. ----
// group_members.role existed and was maintained, but no route ever read it to
// authorize anything: the only ways a member left a group were their own
// choice or deleting their account. A small-group leader with a disruptive
// member had no group-scoped tool at all -- every other member had to
// independently discover and block that person, and the leader could not
// protect the group they are responsible for.
router.get('/groups/:id/members', requireAuth, (req, res) => {
  const group = db.prepare('SELECT id FROM groups WHERE id = ?').get(req.params.id);
  if (!group) return res.status(404).json({ error: 'not_found' });
  if (!isGroupMember(group.id, req.session.userId)) return res.status(404).json({ error: 'not_found' });
  const members = db.prepare(`
    SELECT m.user_id, m.role, u.display_name,
           CASE WHEN u.avatar_data IS NOT NULL THEN 1 ELSE 0 END AS has_avatar
    FROM group_members m JOIN users u ON u.id = m.user_id
    WHERE m.group_id = ?
    ORDER BY (m.role = 'admin') DESC, u.display_name
  `).all(group.id);
  res.json({ members, is_admin: isGroupAdmin(group.id, req.session.userId) });
});

router.delete('/groups/:id/members/:userId', requireAuth, (req, res) => {
  const group = db.prepare('SELECT id, creator_id FROM groups WHERE id = ?').get(req.params.id);
  if (!group || !isGroupAdmin(group.id, req.session.userId)) return res.status(404).json({ error: 'not_found' });
  const target = req.params.userId;
  // Leaving is a separate, deliberate action -- an organiser removing
  // themselves here would strand the group without triggering handover.
  if (target === req.session.userId) return res.status(400).json({ error: 'use_leave', hint: 'Use Leave group to step down.' });
  // The creator outranks other admins; nobody removes the person who owns it.
  if (target === group.creator_id) return res.status(403).json({ error: 'cannot_remove_owner' });
  const removed = db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(group.id, target);
  if (!removed.changes) return res.status(404).json({ error: 'not_a_member' });
  // Note: group invites are shareable link tokens, not per-person rows, so
  // there is nothing user-specific to revoke here. A removed member holding a
  // live invite link to a public group can rejoin -- the organiser's remedy is
  // to rotate the link. Worth tightening if per-user invites ever land.
  notify(target, 'group_removed', 'You were removed from a group.', { group_id: group.id });
  res.json({ ok: true });
});

// ---- Group announcements. ----
// Chat scrolls; the meeting time does not. A small-group leader had nowhere to
// put "we now meet at 6:30, the church car park is closed" that a member
// joining next week would still see -- it drowned in group_messages within a
// day. One pinned note per group, organiser-only, always shown at the top.
router.put('/groups/:id/announcement', requireAuth, (req, res) => {
  const group = db.prepare('SELECT id FROM groups WHERE id = ?').get(req.params.id);
  if (!group || !isGroupAdmin(group.id, req.session.userId)) return res.status(404).json({ error: 'not_found' });
  const text = String((req.body || {}).text || '').trim().slice(0, 500);
  db.prepare(`UPDATE groups SET announcement = ?, announcement_at = ?, announcement_by = ?  WHERE id = ?`)
    .run(text || null, text ? new Date().toISOString() : null, text ? req.session.userId : null, group.id);
  // Tell the group there is something new to read -- but only for a real
  // announcement, never for clearing one.
  if (text) {
    const members = db.prepare('SELECT user_id FROM group_members WHERE group_id = ? AND user_id != ?')
      .all(group.id, req.session.userId);
    for (const m of members) {
      notify(m.user_id, 'group_announcement', `New announcement in your group: ${text.slice(0, 80)}`, { group_id: group.id });
    }
  }
  res.json({ ok: true, announcement: text || null });
});

// The message's own author, or a group admin cleaning up their group.
router.delete('/groups/:id/messages/:messageId', requireAuth, (req, res) => {
  const group = db.prepare('SELECT id FROM groups WHERE id = ?').get(req.params.id);
  if (!group || !isGroupMember(group.id, req.session.userId)) return res.status(404).json({ error: 'not_found' });
  const msg = db.prepare('SELECT id, user_id FROM group_messages WHERE id = ? AND group_id = ?')
    .get(req.params.messageId, group.id);
  if (!msg) return res.status(404).json({ error: 'not_found' });
  if (msg.user_id !== req.session.userId && !isGroupAdmin(group.id, req.session.userId)) {
    return res.status(404).json({ error: 'not_found' });
  }
  db.prepare('DELETE FROM group_messages WHERE id = ?').run(msg.id);
  res.json({ ok: true });
});

const GROUP_PULSE_KINDS = new Set(['moved', 'prayed', 'rested']);
const GROUP_PULSE_THEMES = { moved: 'strength', prayed: 'prayer', rested: 'peace' };
function groupPulseDay(value) {
  const today = new Date().toISOString().slice(0, 10);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : today;
  const distance = Math.abs(Date.parse(`${day}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`));
  return Number.isFinite(distance) && distance <= 86400000 ? day : today;
}
function groupPulseVerse(kind) {
  const theme = GROUP_PULSE_THEMES[kind] || 'encouragement';
  return db.prepare(`SELECT id FROM scripture_verses
    WHERE lower(COALESCE(themes,'')) LIKE ? ORDER BY reference LIMIT 1`).get(`%${theme}%`)?.id
    || db.prepare('SELECT id FROM scripture_verses ORDER BY reference LIMIT 1').get()?.id
    || null;
}

// Group Pulse is deliberately finite: one editable check-in per member/day,
// no leaderboard, and no streak-loss language. It builds reciprocal support
// without turning private spiritual or recovery rhythms into a competition.
router.get('/groups/:id/pulse', requireAuth, (req, res) => {
  const group = db.prepare('SELECT id FROM groups WHERE id=?').get(req.params.id);
  if (!group) return res.status(404).json({ error: 'not_found' });
  if (!isGroupMember(group.id, req.session.userId)) return res.status(403).json({ error: 'not_a_member' });
  const rows = db.prepare(`SELECT c.id,c.group_id,c.user_id,c.day,c.kind,c.note,c.created_at,c.updated_at,
      u.display_name author,v.reference verse_reference,v.text verse_text,
      (SELECT COUNT(*) FROM group_pulse_encouragements e WHERE e.checkin_id=c.id) encouragement_count,
      EXISTS(SELECT 1 FROM group_pulse_encouragements e WHERE e.checkin_id=c.id AND e.user_id=@me) encouraged_by_me
    FROM group_pulse_checkins c JOIN users u ON u.id=c.user_id
    LEFT JOIN scripture_verses v ON v.id=c.verse_id
    WHERE c.group_id=@group AND c.day>=date('now','-6 days')
    ORDER BY c.day DESC,c.updated_at DESC LIMIT 100`).all({ group: group.id, me: req.session.userId });
  const checkins = rows.map(row => ({ ...row, encouraged_by_me: !!row.encouraged_by_me }));
  const today = groupPulseDay(req.query?.day);
  const mine = checkins.find(row => row.user_id === req.session.userId && row.day === today) || null;
  const todayCount = db.prepare('SELECT COUNT(*) c FROM group_pulse_checkins WHERE group_id=? AND day=?').get(group.id, today).c;
  res.json({ day: today, today_count: todayCount, mine, checkins });
});

router.post('/groups/:id/pulse', requireAuth, requireCommunityAccess, (req, res) => {
  const group = db.prepare('SELECT id FROM groups WHERE id=?').get(req.params.id);
  if (!group) return res.status(404).json({ error: 'not_found' });
  if (!isGroupMember(group.id, req.session.userId)) return res.status(403).json({ error: 'not_a_member' });
  const kind = String(req.body?.kind || '').toLowerCase();
  if (!GROUP_PULSE_KINDS.has(kind)) return res.status(400).json({ error: 'invalid_pulse_kind' });
  const note = String(req.body?.note || '').trim().replace(/\s+/g, ' ').slice(0, 160) || null;
  const day = groupPulseDay(req.body?.day);
  const existing = db.prepare('SELECT id FROM group_pulse_checkins WHERE group_id=? AND user_id=? AND day=?')
    .get(group.id, req.session.userId, day);
  const id = existing?.id || randomUUID();
  db.prepare(`INSERT INTO group_pulse_checkins(id,group_id,user_id,day,kind,note,verse_id)
    VALUES(?,?,?,?,?,?,?) ON CONFLICT(group_id,user_id,day) DO UPDATE SET
      kind=excluded.kind,note=excluded.note,verse_id=excluded.verse_id,updated_at=datetime('now')`)
    .run(id, group.id, req.session.userId, day, kind, note, groupPulseVerse(kind));
  const row = db.prepare(`SELECT c.id,c.group_id,c.user_id,c.day,c.kind,c.note,c.created_at,c.updated_at,
      u.display_name author,v.reference verse_reference,v.text verse_text,0 encouragement_count,0 encouraged_by_me
    FROM group_pulse_checkins c JOIN users u ON u.id=c.user_id LEFT JOIN scripture_verses v ON v.id=c.verse_id
    WHERE c.id=?`).get(id);
  res.status(existing ? 200 : 201).json({ ...row, encouraged_by_me: false });
});

router.post('/groups/:id/pulse/:checkinId/encourage', requireAuth, requireCommunityAccess, (req, res) => {
  if (!isGroupMember(req.params.id, req.session.userId)) return res.status(403).json({ error: 'not_a_member' });
  const checkin = db.prepare('SELECT id,user_id FROM group_pulse_checkins WHERE id=? AND group_id=?')
    .get(req.params.checkinId, req.params.id);
  if (!checkin) return res.status(404).json({ error: 'not_found' });
  if (checkin.user_id === req.session.userId) return res.status(400).json({ error: 'cannot_encourage_self' });
  const added = db.prepare('INSERT OR IGNORE INTO group_pulse_encouragements(checkin_id,user_id) VALUES(?,?)')
    .run(checkin.id, req.session.userId).changes === 1;
  if (added) notify(checkin.user_id, 'group_pulse', `${displayName(req.session.userId)} encouraged your group check-in.`,
    { group_id: req.params.id, checkin_id: checkin.id });
  const count = db.prepare('SELECT COUNT(*) c FROM group_pulse_encouragements WHERE checkin_id=?').get(checkin.id).c;
  res.json({ encouraged: true, encouragement_count: count });
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

router.post('/groups/:id/messages', requireAuth, requireCommunityAccess, (req, res) => {
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
  if (!isGroupMember(group.id, req.session.userId)) return res.status(403).json({ error: 'not_a_member' });
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
      notify(event.creator_id, 'event_rsvp', `${displayName(req.session.userId)} ${verb} "${event.title}"`, { event_id: event.id, group_id: event.group_id });
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

router.get('/stats/recovery', requireAuth, (req, res) => {
  res.json(recovery.summary(req.session.userId));
});

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

// ---- account deletion and transparent data export ----------------------
router.delete('/me', requireAuth, (req, res) => {
  const uid = req.session.userId;
  if (!db.prepare('SELECT id FROM users WHERE id = ?').get(uid)) return res.status(404).json({ error: 'account_not_found' });
  const userTables = [
    'user_consents', 'workouts', 'biometric_samples', 'google_health_daily_steps', 'apple_health_daily_steps', 'scripture_triggers', 'user_xp',
    'saved_verses', 'user_badges', 'user_quests', 'notifications', 'post_comments', 'comment_likes', 'post_likes', 'post_saves',
    'stories',
    'breathing_sessions', 'user_challenges', 'user_identities', 'user_connectors',
    'imported_activities', 'group_messages', 'event_rsvps', 'group_pulse_checkins',
    'group_pulse_encouragements', 'user_journeys',
    'verse_reflections', 'verse_reflection_likes', 'training_goals', 'webhooks',
    'journey_segment_times', 'gloo_calls', 'api_keys', 'push_subscriptions',
    'push_log', 'user_reminders', 'motivation_seen', 'wearable_metrics',
    'overlay_tokens', 'overlay_state', 'user_sessions', 'account_security_events',
    'user_mfa', 'mfa_backup_codes', 'password_reset_tokens', 'native_auth_codes', 'developer_applications',
    'developer_content_submissions', 'developer_enforcement_cases', 'reel_impressions', 'reel_reactions', 'reel_hides',
  ];
  try {
    db.exec('BEGIN');
    const postIds = db.prepare('SELECT id FROM posts WHERE user_id = ?').all(uid).map(r => r.id);
    const workoutIds = db.prepare('SELECT id FROM workouts WHERE user_id = ?').all(uid).map(r => r.id);
    if (postIds.length) {
      const marks = postIds.map(() => '?').join(',');
      const commentIds = db.prepare(`SELECT id FROM post_comments WHERE post_id IN (${marks})`).all(...postIds).map(r => r.id);
      if (commentIds.length) { const commentMarks = commentIds.map(() => '?').join(','); db.prepare(`DELETE FROM comment_likes WHERE comment_id IN (${commentMarks})`).run(...commentIds); }
      db.prepare(`DELETE FROM post_likes WHERE post_id IN (${marks})`).run(...postIds);
      db.prepare(`DELETE FROM post_saves WHERE post_id IN (${marks})`).run(...postIds);
      db.prepare(`DELETE FROM post_comments WHERE post_id IN (${marks})`).run(...postIds);
      db.prepare(`DELETE FROM post_reports WHERE post_id IN (${marks})`).run(...postIds);
      db.prepare(`DELETE FROM moderation_queue WHERE report_type='post' AND target_id IN (${marks})`).run(...postIds);
      db.prepare(`DELETE FROM posts WHERE id IN (${marks})`).run(...postIds);
    }
    for (const hook of db.prepare('SELECT id FROM webhooks WHERE user_id=?').all(uid)) db.prepare('DELETE FROM webhook_deliveries WHERE webhook_id=?').run(hook.id);
    for (const key of db.prepare('SELECT id FROM api_keys WHERE user_id=?').all(uid)) db.prepare('DELETE FROM api_key_usage WHERE key_id=?').run(key.id);
    for (const item of db.prepare('SELECT id FROM developer_enforcement_cases WHERE user_id=?').all(uid)) db.prepare('DELETE FROM church_notification_outbox WHERE enforcement_case_id=?').run(item.id);
    db.prepare('UPDATE churches SET submitted_by=NULL WHERE submitted_by=?').run(uid);
    db.prepare('DELETE FROM account_relationship_controls WHERE actor_id=? OR subject_id=?').run(uid,uid);
    // Both directions: the circles they curated, and everyone else's circles
    // they were a member of.
    db.prepare('DELETE FROM circle_members WHERE owner_id=? OR member_id=?').run(uid,uid);
    db.prepare('DELETE FROM follow_requests WHERE requester_id=? OR target_id=?').run(uid,uid);
    db.prepare("DELETE FROM moderation_queue WHERE reporter_id=? OR (report_type='user' AND target_id=?)").run(uid,uid);
    db.prepare('DELETE FROM post_reports WHERE reporter_id=?').run(uid);
    if (workoutIds.length) {
      const marks = workoutIds.map(() => '?').join(',');
      db.prepare(`DELETE FROM workout_partners WHERE workout_id IN (${marks})`).run(...workoutIds);
      db.prepare(`DELETE FROM imported_activities WHERE workout_id IN (${marks})`).run(...workoutIds);
    }
    const threads = db.prepare('SELECT id FROM dm_threads WHERE user_a = ? OR user_b = ?').all(uid, uid).map(r => r.id);
    if (threads.length) {
      const marks = threads.map(() => '?').join(',');
      db.prepare(`DELETE FROM dm_messages WHERE thread_id IN (${marks})`).run(...threads);
      db.prepare(`DELETE FROM dm_threads WHERE id IN (${marks})`).run(...threads);
    }
    db.prepare('DELETE FROM dm_blocks WHERE blocker_id = ? OR blocked_id = ?').run(uid, uid);
    db.prepare('DELETE FROM user_reports WHERE reporter_id = ? OR reported_user_id = ?').run(uid, uid);
    db.prepare('DELETE FROM followers WHERE follower_id = ? OR followee_id = ?').run(uid, uid);
    db.prepare('DELETE FROM workout_partners WHERE tagged_by = ? OR partner_user_id = ?').run(uid, uid);
    db.prepare('DELETE FROM workout_invites WHERE sender_id = ? OR recipient_id = ?').run(uid, uid);
    db.prepare('DELETE FROM group_invites WHERE created_by = ?').run(uid);
    const pulseIds = db.prepare('SELECT id FROM group_pulse_checkins WHERE user_id=?').all(uid).map(row => row.id);
    if (pulseIds.length) {
      const marks = pulseIds.map(() => '?').join(',');
      db.prepare(`DELETE FROM group_pulse_encouragements WHERE checkin_id IN (${marks})`).run(...pulseIds);
    }
    db.prepare('DELETE FROM group_members WHERE user_id = ?').run(uid);
    db.prepare('DELETE FROM story_views WHERE viewer_id = ?').run(uid);
    db.prepare('DELETE FROM story_reactions WHERE user_id = ?').run(uid);
    for (const group of db.prepare('SELECT id FROM groups WHERE creator_id = ?').all(uid)) {
      const next = db.prepare('SELECT user_id FROM group_members WHERE group_id = ? ORDER BY rowid LIMIT 1').get(group.id);
      if (next) {
        db.prepare('UPDATE groups SET creator_id = ? WHERE id = ?').run(next.user_id, group.id);
        db.prepare("UPDATE group_members SET role = 'admin' WHERE group_id = ? AND user_id = ?").run(group.id, next.user_id);
      } else db.prepare('DELETE FROM groups WHERE id = ?').run(group.id);
    }
    for (const table of userTables) db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(uid);
    db.prepare('DELETE FROM users WHERE id = ?').run(uid);
    db.exec('COMMIT');
    req.session = null;
    res.json({ ok: true, deleted: true });
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch {}
    console.error('account deletion failed', err);
    res.status(500).json({ error: 'account_deletion_failed' });
  }
});

// ---- transparent data export: everything we hold on the signed-in user ----
router.get('/me/export', requireAuth, (req, res) => {
  const uid = req.session.userId;
  accountSecurity.audit(uid, 'data_exported', req);
  const { password_hash, ...profile } = db.prepare('SELECT * FROM users WHERE id = ?').get(uid) || {};
  const data = {
    exported_at: new Date().toISOString(),
    note: 'This is all the data Functioning Faith holds about your account. Email is included because this is your own export.',
    profile,
    workouts: db.prepare('SELECT * FROM workouts WHERE user_id = ?').all(uid),
    biometric_samples: db.prepare('SELECT * FROM biometric_samples WHERE user_id = ?').all(uid),
    google_health_daily_steps: db.prepare('SELECT * FROM google_health_daily_steps WHERE user_id = ?').all(uid),
    apple_health_daily_steps: db.prepare('SELECT * FROM apple_health_daily_steps WHERE user_id = ?').all(uid),
    posts: db.prepare('SELECT * FROM posts WHERE user_id = ?').all(uid),
    comments: db.prepare('SELECT * FROM post_comments WHERE user_id = ?').all(uid),
    followers: db.prepare('SELECT follower_id FROM followers WHERE followee_id = ?').all(uid),
    following: db.prepare('SELECT followee_id FROM followers WHERE follower_id = ?').all(uid),
    consents: db.prepare('SELECT scope, granted_at, revoked_at FROM user_consents WHERE user_id = ?').all(uid),
    saved_verses: verseSaves.list(uid),
    challenges: db.prepare('SELECT * FROM user_challenges WHERE user_id = ?').all(uid),
    xp: db.prepare('SELECT * FROM user_xp WHERE user_id = ?').get(uid),
    badges: db.prepare('SELECT badge_id, earned_at FROM user_badges WHERE user_id = ?').all(uid),
    sessions: db.prepare('SELECT id,device_name,auth_method,created_at,last_seen_at,revoked_at,revoked_reason FROM user_sessions WHERE user_id=?').all(uid),
    security_activity: accountSecurity.securityEvents(uid),
    identities: db.prepare('SELECT provider,email,email_verified,linked_at FROM user_identities WHERE user_id=?').all(uid),
    connectors: db.prepare('SELECT provider,provider_user_id,scope,connected_at,last_synced_at FROM user_connectors WHERE user_id=?').all(uid),
    groups: db.prepare('SELECT group_id,role FROM group_members WHERE user_id=?').all(uid),
    group_messages: db.prepare('SELECT group_id,content,created_at FROM group_messages WHERE user_id=?').all(uid),
    group_pulse_checkins: db.prepare('SELECT group_id,day,kind,note,verse_id,created_at,updated_at FROM group_pulse_checkins WHERE user_id=?').all(uid),
    group_pulse_encouragements: db.prepare('SELECT checkin_id,created_at FROM group_pulse_encouragements WHERE user_id=?').all(uid),
    direct_messages: db.prepare(`SELECT m.thread_id,m.sender_id,m.body,m.kind,m.metadata,m.created_at,m.read_at FROM dm_messages m JOIN dm_threads t ON t.id=m.thread_id WHERE t.user_a=? OR t.user_b=? ORDER BY m.created_at`).all(uid,uid),
    stories: db.prepare('SELECT * FROM stories WHERE user_id=?').all(uid),
    reminders: db.prepare('SELECT * FROM user_reminders WHERE user_id=?').all(uid),
    developer_application: db.prepare('SELECT * FROM developer_applications WHERE user_id=?').get(uid)||null,
    developer_content: db.prepare('SELECT * FROM developer_content_submissions WHERE user_id=?').all(uid),
    moderation_reports: db.prepare('SELECT report_type,target_id,reason,status,created_at,reviewed_at FROM moderation_queue WHERE reporter_id=?').all(uid),
  };
  res.setHeader('Content-Disposition', 'attachment; filename="functioning-faith-my-data.json"');
  res.json(data);
});

// ---- notifications ----
router.get('/notifications', requireAuth, (req, res) => {
  const uid = req.session.userId;
  const notifications = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY delivered_at DESC LIMIT 20').all(uid).map(n => {
    try { const p = JSON.parse(n.payload || '{}'); return { ...n, url: isSafeInternalNotificationUrl(p.url) ? p.url : notificationDestination(n.type, p) }; }
    catch { return { ...n, url: notificationDestination(n.type, {}) }; }
  });
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

// A quiet, in-app weekly recap: useful enough to invite a return, but never
// pushed automatically and never shared without an explicit member action.
router.get('/stats/recap', requireAuth, (req, res) => {
  const uid = req.session.userId;
  const cutoff = new Date(Date.now() - 7 * 86400000).toISOString();
  const workouts = db.prepare(`SELECT type, distance_km, duration_sec, start_time, end_time, calories FROM workouts WHERE user_id = ? AND end_time IS NOT NULL AND datetime(end_time) >= datetime(?)`).all(uid, cutoff);
  const duration = w => Number(w.duration_sec) || (w.start_time && w.end_time ? Math.max(0, (new Date(w.end_time) - new Date(w.start_time)) / 1000) : 0);
  const distance = +workouts.reduce((sum, w) => sum + (Number(w.distance_km) || 0), 0).toFixed(1);
  const minutes = Math.round(workouts.reduce((sum, w) => sum + duration(w), 0) / 60);
  const activeDays = new Set(workouts.map(w => String(w.end_time).slice(0, 10))).size;
  const posts = db.prepare('SELECT COUNT(*) c FROM posts WHERE user_id = ? AND datetime(created_at) >= datetime(?)').get(uid, cutoff).c;
  const kudos = db.prepare(`SELECT COUNT(*) c FROM post_likes l JOIN posts p ON p.id = l.post_id WHERE p.user_id = ? AND datetime(l.created_at) >= datetime(?)`).get(uid, cutoff).c;
  const replies = db.prepare(`SELECT COUNT(*) c FROM post_comments c JOIN posts p ON p.id = c.post_id WHERE p.user_id = ? AND datetime(c.created_at) >= datetime(?)`).get(uid, cutoff).c;
  const types = {};
  for (const w of workouts) types[w.type] = (types[w.type] || 0) + 1;
  const focus = Object.entries(types).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const highlights = [];
  if (workouts.length) highlights.push(`${workouts.length} workout${workouts.length === 1 ? '' : 's'}`);
  if (distance) highlights.push(`${distance} km`);
  if (minutes) highlights.push(`${minutes} minutes moving`);
  const shareText = highlights.length
    ? `This week I showed up for ${highlights.join(', ')}${focus ? ` — mostly ${focus.toLowerCase()}` : ''}. Grateful for the people moving with me.`
    : 'This week I made space for a fresh start. One small step at a time.';
  res.json({ workouts: workouts.length, distance_km: distance, minutes, active_days: activeDays, posts, kudos, replies, focus, share_text: shareText });
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
    const details = { ...message, ...(message.data && typeof message.data === 'object' ? message.data : {}) };
    const destination = notificationDestination(message.type, details);
    push.send(event.user_id, notificationPushCategory(message.type), {
      title: message.title || 'Functioning Faith', body: message.body || message.message,
      url: destination, tag: `${message.type}:${event.badge_id || event.quest_id || event.verse_id || 'notification'}`,
    }).catch(() => {});
  });
});

// ---- motivation / podcasts / breathing (new social+wellness surfaces) ----
router.get('/motivation', requireAuth, async (req, res) => {
  try {
    res.json(await motivation.next(req.session.userId));
  } catch (error) {
    console.error('[motivation] next quote failed', error);
    res.status(503).json({ error: 'motivation_unavailable' });
  }
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

router.get('/news', (req, res) => {
  if (!admin.featureEnabled('news')) return res.json({ items: [], sources: [], disabled: true });
  res.json({ items: news.list({ limit: req.query.limit }), sources: news.FEEDS.map(f => f.source) });
});

// Feature availability is intentionally public: clients need a truthful way
// to hide an unavailable surface instead of presenting a dead-end screen.
router.get('/features', (req, res) => res.json(admin.features()));

router.post('/support/tickets', requireAuth, (req, res) => {
  try { res.status(201).json({ ticket: admin.createTicket(req.session.userId, req.body || {}) }); }
  catch (err) { res.status(err.code === 'ticket_rate_limited' ? 429 : 400).json({ error: err.code || 'ticket_failed', hint: err.message }); }
});

// Public -- no account needed. Someone deciding whether this is worth an
// account yet is exactly who "notify me at launch" is for.
router.post('/launch-notify', (req, res) => {
  const r = launchNotify.signup((req.body || {}).email);
  if (!r.ok) return res.status(400).json({ error: r.error, hint: 'Enter a real email address.' });
  res.status(201).json({ ok: true });
});

router.get('/admin/metrics', requireAdmin, (req, res) => {
  res.json(admin.metrics());
});

router.get('/admin/content-counts', requireAdmin, (req, res) => {
  res.json(admin.contentCounts());
});

router.get('/admin/trend', requireAdmin, (req, res) => {
  res.json({ days: admin.dailyTrend(req.query.days) });
});

router.get('/admin/users', requireAdmin, (req, res) => {
  res.json(admin.listUsers({ q: req.query.q, limit: req.query.limit, offset: req.query.offset }));
});

router.get('/admin/features', requireAdmin, (req, res) => res.json(admin.features()));
router.put('/admin/features/:key', requireAdmin, (req, res) => {
  try { res.json(admin.setFeature(req.session.userId, req.params.key, req.body?.enabled === true)); }
  catch (err) { res.status(400).json({ error: err.code || 'feature_update_failed', hint: err.message }); }
});

router.get('/admin/issues', requireAdmin, (req, res) => {
  res.json({ summary: admin.issueSummary(), tickets: admin.listTickets(req.query.status) });
});
router.post('/admin/issues/:id/resolve', requireAdmin, (req, res) => {
  try { res.json({ ticket: admin.resolveTicket(req.session.userId, req.params.id, req.body?.note) }); }
  catch (err) { res.status(err.code === 'not_found' ? 404 : 400).json({ error: err.code || 'ticket_resolve_failed', hint: err.message }); }
});

router.post('/admin/users/:id/support-note', requireAdmin, (req, res) => {
  try { res.json(admin.sendSupportNote(req.session.userId, req.params.id, req.body?.message)); }
  catch (err) { res.status(err.code === 'not_found' ? 404 : 400).json({ error: err.code || 'support_note_failed', hint: err.message }); }
});

router.post('/admin/content/publish', requireAdmin, (req, res) => {
  try { res.status(201).json({ video: admin.publishVideo(req.session.userId, req.body || {}) }); }
  catch (err) { res.status(400).json({ error: err.code || 'content_publish_failed', hint: err.message }); }
});

function moderationRows(rawStatus) {
  const status = ['pending', 'reviewing', 'resolved'].includes(rawStatus) ? rawStatus : 'pending';
  return db.prepare(`
    SELECT q.id, q.report_type, q.target_id, q.reason, q.status, q.created_at,
           reporter.display_name AS reporter_name,
           subject.display_name AS subject_name,
           CASE WHEN q.report_type = 'post' THEN substr(COALESCE(p.content, ''), 1, 500) ELSE NULL END AS content_excerpt
    FROM moderation_queue q
    LEFT JOIN users reporter ON reporter.id = q.reporter_id
    LEFT JOIN posts p ON q.report_type = 'post' AND p.id = q.target_id
    LEFT JOIN users subject ON subject.id = CASE WHEN q.report_type = 'post' THEN p.user_id ELSE q.target_id END
    WHERE q.status = ?
    ORDER BY q.created_at ASC
    LIMIT 100
  `).all(status);
}

// One review implementation serves both the token-protected operations queue
// and the owner's Admin Headquarters. A human explicitly selects and records
// every outcome; an AI suggestion can never resolve a report by itself.
function reviewModerationReport(reportId, input, reviewer) {
  const report = db.prepare('SELECT * FROM moderation_queue WHERE id=?').get(reportId);
  if (!report) throw Object.assign(new Error('Report not found.'), { code: 'report_not_found' });
  if (report.status === 'resolved') throw Object.assign(new Error('This report was already reviewed.'), { code: 'already_reviewed' });
  const decision = String(input?.decision || '');
  if (!['no_violation', 'content_removed', 'account_suspended'].includes(decision)) {
    throw Object.assign(new Error('Choose a valid review decision.'), { code: 'invalid_decision' });
  }
  const note = String(input?.note || '').trim().slice(0, 800);
  let affectedUser = null;
  if (report.report_type === 'post') affectedUser = db.prepare('SELECT user_id FROM posts WHERE id=?').get(report.target_id)?.user_id || null;
  if (report.report_type === 'user') affectedUser = report.target_id;
  if (decision === 'content_removed' && report.report_type === 'post') {
    db.prepare('DELETE FROM post_likes WHERE post_id=?').run(report.target_id);
    db.prepare('DELETE FROM post_saves WHERE post_id=?').run(report.target_id);
    db.prepare('DELETE FROM post_comments WHERE post_id=?').run(report.target_id);
    db.prepare('DELETE FROM posts WHERE id=?').run(report.target_id);
  }
  if (decision === 'account_suspended' && affectedUser) {
    const why = note || 'Confirmed community standards violation';
    db.prepare('UPDATE users SET suspended_at=?,suspension_reason=? WHERE id=?').run(new Date().toISOString(), why.slice(0, 500), affectedUser);
    db.prepare("UPDATE user_sessions SET revoked_at=?,revoked_reason='account_suspended' WHERE user_id=? AND revoked_at IS NULL")
      .run(new Date().toISOString(), affectedUser);
  }
  db.prepare("UPDATE moderation_queue SET status='resolved',reviewer=?,review_note=?,reviewed_at=? WHERE id=?")
    .run(String(reviewer).slice(0, 120), `${decision}: ${note}`, new Date().toISOString(), report.id);
  if (affectedUser) notify(affectedUser, 'moderation',
    decision === 'no_violation' ? 'A report was reviewed and no violation was found.'
      : decision === 'content_removed' ? 'Content was removed after review.' : 'Your account was suspended after review.',
    { url: '/?open=profile' });
  return { ok: true, decision, affected_user_id: affectedUser };
}

router.get('/admin/moderation', requireAdmin, (req, res) => {
  res.json({ reports: moderationRows(req.query.status) });
});

router.post('/admin/moderation/:id/review', requireAdmin, (req, res) => {
  try {
    const result = reviewModerationReport(req.params.id, req.body || {}, displayName(req.session.userId));
    admin.audit(req.session.userId, 'moderation_review', 'moderation_report', req.params.id,
      `${result.decision}: ${String(req.body?.note || '').trim().slice(0, 800)}`);
    res.json(result);
  } catch (err) {
    res.status(err.code === 'report_not_found' ? 404 : err.code === 'already_reviewed' ? 409 : 400)
      .json({ error: err.code || 'moderation_review_failed', hint: err.message });
  }
});

router.get('/admin/launch-notify/stats', requireAdmin, (req, res) => {
  res.json(launchNotify.stats());
});

// Single-click, from the admin page only. Sends once to everyone not yet
// notified -- calling it again is safe and just catches anyone who signed up
// since the last send, never re-emails someone already notified.
router.post('/admin/launch-notify/send', requireAdmin, async (req, res) => {
  const b = req.body || {};
  const result = await launchNotify.notifyLaunch({ appStoreUrl: b.app_store_url, playStoreUrl: b.play_store_url });
  if (!result.configured) return res.status(503).json({ error: 'email_not_configured', hint: 'Set RESEND_API_KEY and EMAIL_FROM to send.' });
  res.json(result);
});

// One consolidated read of a member's own rhythm: streak, standing, what
// onboarding step is next, who would notice they showed up, and the single
// suggestion (if any) worth surfacing on Home. Never another member's data.
router.get('/retention/state', requireAuth, (req, res) => {
  const state = retention.memberState(req.session.userId);
  if (!state) return res.status(404).json({ error: 'not_found' });
  res.json(state);
});

router.get('/retention/history', requireAuth, (req, res) => {
  res.json({ nudges: retention.history(req.session.userId, req.query.limit) });
});

router.post('/retention/opt-out', requireAuth, (req, res) => {
  res.json(retention.setOptOut(req.session.userId, req.body?.opted_out !== false));
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
router.get('/churches/search', requireAuth, async (req, res) => {
  if(!allowWindow(churchSearchWindow,req.session.userId,10,60_000)) return res.status(429).json({error:'church_search_rate_limit'});
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

router.get('/youtube/search-channels', requireAuth, requireVerifiedDeveloper, async (req, res) => {
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

function requireVerifiedChurchAdmin(req,res,next){
  let verification;try{verification=developerVerification.requireVerified(req.session.userId);}catch{return res.status(403).json({error:'verified_church_admin_required'});}
  const church=db.prepare('SELECT id FROM churches WHERE osm_id=?').get(req.params.osmId);
  if(!church||verification.church_id!==church.id)return res.status(403).json({error:'verified_church_admin_required'});
  req.verifiedChurch=church;next();
}

router.post('/churches/:osmId/link-youtube', requireAuth, requireVerifiedChurchAdmin, (req, res) => {
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

// ---- Private daily Scripture practice --------------------------------------
// Reading is personal by default. A member may later choose to open the same
// verse's public conversation, but no note or completion is exposed there.
router.get('/scripture/practice', requireAuth, (req, res) => {
  res.json(scripturePractice.get(req.session.userId));
});

router.post('/scripture/practice/start', requireAuth, (req, res) => {
  res.json(scripturePractice.start(req.session.userId));
});

router.post('/scripture/practice/days/:day/complete', requireAuth, (req, res) => {
  const result = scripturePractice.complete(req.session.userId, req.params.day, req.body && req.body.note);
  if (result.error) return res.status(result.error === 'invalid_day' ? 400 : 409).json(result);
  res.json(result);
});

router.patch('/scripture/practice/days/:day/note', requireAuth, (req, res) => {
  const result = scripturePractice.updateNote(req.session.userId, req.params.day, req.body && req.body.note);
  if (result.error) return res.status(404).json(result);
  res.json(result);
});

// ---- Curated video library (real YouTube channels, gated behind YOUTUBE_API_KEY) ----
router.get('/videos', (req, res) => {
  const category = String(req.query.category || '').trim();
  const allowed = new Set(['kids', 'fitness', 'food', 'motivational', 'christian', 'veggietales', 'nickbare', 'reels']);
  if (!allowed.has(category)) return res.status(400).json({ error: 'invalid_category' });
  const rows = category === 'reels'
    ? db.prepare(`SELECT video_id, title, description, thumbnail_url, channel_title, published_at, category
        FROM (
          SELECT video_id, title, description, thumbnail_url, channel_title, published_at, category,
            ROW_NUMBER() OVER (
              PARTITION BY video_id
              ORDER BY CASE WHEN category = 'food' THEN 0 ELSE 1 END, published_at DESC
            ) AS reel_rank
          FROM videos
          WHERE is_short = 1 OR lower(title || '') LIKE '%#short%'
            OR lower(title || '') LIKE '%shorts%' OR lower(title || '') LIKE '%reel%'
            OR lower(description || '') LIKE '%#short%' OR lower(description || '') LIKE '%shorts%'
        )
        WHERE reel_rank = 1
        ORDER BY RANDOM() LIMIT 80`).all()
    : db.prepare(
      `SELECT video_id, title, description, thumbnail_url, channel_title, published_at, category
       FROM videos
       WHERE category = ? AND COALESCE(is_short, 0) = 0
         AND lower(title || '') NOT LIKE '%#short%'
         AND lower(title || '') NOT LIKE '%shorts%'
         AND lower(title || '') NOT LIKE '%reel%'
         AND lower(description || '') NOT LIKE '%#short%'
         AND lower(description || '') NOT LIKE '%shorts%'
       ORDER BY published_at DESC LIMIT 30`
    ).all(category);
  const blocked = /\b(porn|sex|onlyfans|cannabis|marijuana|weed|alcohol|beer|wine|vodka|drug|steroid|anorexia|bulimia|purge|starvation|pro[- ]ana|laxative)\b/i;
  res.json(rows.filter(v => !blocked.test(`${v.title || ''} ${v.description || ''}`)));
});

// Saved Reels are private by design. Keep them separate from the discovery
// ranking so a member can return to something intentionally bookmarked.
router.get('/reels/saved', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT r.video_id, COALESCE(p.content, v.title) AS title,
           COALESCE(p.content, v.description) AS description,
           v.thumbnail_url, COALESCE(u.display_name, v.channel_title) AS channel_title,
           COALESCE(p.created_at, v.published_at) AS published_at,
           COALESCE(p.video_category, v.category) AS category,
           CASE WHEN p.id IS NOT NULL THEN 'functioning_faith' ELSE v.provider END AS provider,
           v.source_url,
           CASE WHEN p.id IS NOT NULL THEN 'functioning_faith' ELSE v.source_kind END AS source_kind,
           p.video_data, sv.reference AS verse_reference, sv.text AS verse_text,
           r.created_at
      FROM reel_reactions r
      LEFT JOIN videos v ON v.video_id = r.video_id
      LEFT JOIN posts p ON p.id = r.video_id AND p.visibility = 'public' AND p.video_data IS NOT NULL
      LEFT JOIN users u ON u.id = p.user_id
      LEFT JOIN scripture_verses sv ON sv.id = p.verse_id
     WHERE r.user_id = ? AND r.kind = 'save'
       AND ((v.video_id IS NOT NULL AND v.dead_at IS NULL) OR p.id IS NOT NULL)
     ORDER BY r.created_at DESC
     LIMIT 100
  `).all(req.session.userId);
  res.json({ videos: rows.map(v => ({ ...v, like_count: 0, save_count: 1, liked_by_me: false, saved_by_me: true })) });
});

// The single social short-form feed. It combines library Shorts, the member's
// church videos, and Gloo's grounded curation of those church candidates. Gloo
// never invents a video ID here: it may only rank IDs we supplied.
router.get('/reels', requireAuth, async (req, res) => {
  if (!admin.featureEnabled('reels')) return res.status(503).json({ error: 'reels_paused', hint: 'Reels are temporarily paused.' });
  const blocked = /\b(porn|sex|onlyfans|cannabis|marijuana|weed|alcohol|beer|wine|vodka|drug|steroid|anorexia|bulimia|purge|starvation|pro[- ]ana|laxative)\b/i;
  const library = db.prepare(`SELECT video_id, title, description, thumbnail_url, channel_title, published_at, category, provider, source_url, source_kind
    FROM (SELECT video_id,title,description,thumbnail_url,channel_title,published_at,category,
      provider, source_url, source_kind,
        ROW_NUMBER() OVER (PARTITION BY video_id ORDER BY CASE WHEN category='food' THEN 0 ELSE 1 END,published_at DESC) reel_rank
      FROM videos WHERE is_short=1 OR lower(title||'') LIKE '%#short%' OR lower(title||'') LIKE '%shorts%'
        OR lower(title||'') LIKE '%reel%' OR lower(description||'') LIKE '%#short%' OR lower(description||'') LIKE '%shorts%')
    WHERE reel_rank=1 ORDER BY RANDOM() LIMIT 100`).all().filter(v => !blocked.test(`${v.title || ''} ${v.description || ''}`));
  const churchVideos = [];
  const me = db.prepare('SELECT church_osm_id, church_name FROM users WHERE id = ?').get(req.session.userId);
  const church = me?.church_osm_id ? db.prepare('SELECT * FROM churches WHERE osm_id = ?').get(me.church_osm_id) : null;
  if (church?.youtube_channel_id && youtube.isConfigured()) {
    try { for (const v of await youtube.fetchRecentUploads(church.youtube_channel_id, 12)) churchVideos.push({ video_id: v.videoId, title: v.title, description: v.description || '', thumbnail_url: v.thumbnailUrl, channel_title: church.youtube_channel_title || church.name, published_at: v.publishedAt, category: 'church', church_name: church.name, provider: 'youtube', source_url: `https://www.youtube.com/watch?v=${encodeURIComponent(v.videoId)}`, source_kind: 'church' }); } catch (err) { console.error('[reels/church] youtube fetch failed:', err.message); }
  }
  if (!churchVideos.length && church?.website_url) {
    try { for (const v of (await fetchChurchWebsiteEmbeds(church.website_url)).slice(0, 12)) churchVideos.push({ video_id: v.videoId, title: `${church.name} · Church video`, thumbnail_url: null, channel_title: church.name, published_at: null, category: 'church', church_name: church.name, provider: v.provider, source_url: v.url || null, source_kind: 'church' }); } catch (err) { console.error('[reels/church] website fetch failed:', err.message); }
  }
  let curatedChurch = churchVideos; let chosenBy = 'fallback';
  if (churchVideos.length && gloo.isConfigured()) {
    const candidateText = churchVideos.map(v => `${v.video_id} | ${v.title || ''} | ${v.description || ''}`).join('\n').slice(0, 9000);
    const out = await gloo.chatJson({ kind: 'church_reels_curation', userId: req.session.userId, cacheDays: 1, maxTokens: 500, messages: [
      { role: 'system', content: 'You curate a safe Christian fitness social feed. Return JSON only: {"video_ids":[{"id":"existing id","reason":"short reason"}]}. Keep every candidate appropriate for a church and family audience. You may only use IDs present in the candidate list.' },
      { role: 'user', content: `Select up to 12 church videos for a mixed short-form feed. Prefer encouraging, youth-safe, faith-and-life content. Candidates:\n${candidateText}` },
    ] });
    const allowed = new Map(churchVideos.map(v => [v.video_id, v]));
    const picks = Array.isArray(out?.json?.video_ids) ? out.json.video_ids : [];
    const ranked = picks.map(p => allowed.get(String(p.id))).filter(Boolean);
    if (ranked.length) { curatedChurch = ranked; chosenBy = 'gloo'; }
  }
  // The curated catalogue -- Goggins and the fight films, Lewis and Tolkien,
  // Walnut Grove and Highway to Heaven -- comes through the reels algorithm,
  // which handles freshness, the category mix, and what this member has already
  // been shown. See lib/reels.js.
  let curated = { videos: [], recycled: false };
  try { curated = reels.feed(req.session.userId, { limit: 30, familySafe: req.query.safe !== 'off' }); }
  catch (err) { console.error('[reels] feed failed:', err.message); }

  // Member-made Reels are deliberately first-class, but only public clips that
  // passed the byte/container/category gate at POST /posts enter this surface.
  // A post never becomes a Reel merely because someone attached arbitrary data.
  const owned = db.prepare(`
    SELECT p.id AS video_id, p.content AS title, p.content AS description,
           NULL AS thumbnail_url, u.display_name AS channel_title,
           p.created_at AS published_at, p.video_category AS category,
           'functioning_faith' AS provider, p.video_data, 'functioning_faith' AS source_kind,
           v.reference AS verse_reference, v.text AS verse_text
      FROM posts p
      JOIN users u ON u.id = p.user_id
      LEFT JOIN scripture_verses v ON v.id = p.verse_id
     WHERE p.visibility = 'public' AND p.video_data IS NOT NULL
       AND p.video_category IN ('workout','nature','animal','group')
     ORDER BY p.created_at DESC LIMIT 12
  `).all();

  const seen = new Set();
  let videos = [...owned, ...curated.videos, ...library, ...curatedChurch]
    .filter(v => v.video_id && !seen.has(v.video_id) && (seen.add(v.video_id), true));

  // This is strictly the requesting member's preference. It has no effect on
  // community visibility, creator metrics, or another member's recommendations.
  if (videos.length) {
    const hiddenIds = new Set(db.prepare(`SELECT video_id FROM reel_hides
      WHERE user_id = ? AND video_id IN (${videos.map(() => '?').join(',')})`)
      .all(req.session.userId, ...videos.map(v => String(v.video_id))).map(row => row.video_id));
    videos = videos.filter(video => !hiddenIds.has(String(video.video_id)));
  }

  // Engagement is joined after the catalogue is assembled because church
  // videos can be live candidates rather than rows in `videos`. That keeps the
  // feed flexible while returning one consistent shape to the client.
  const videoIds = videos.map(v => String(v.video_id));
  const reactionMap = new Map();
  if (videoIds.length) {
    const marks = videoIds.map(() => '?').join(',');
    const reactions = db.prepare(`
      SELECT video_id, kind, COUNT(*) AS count,
             MAX(CASE WHEN user_id = ? THEN 1 ELSE 0 END) AS mine
      FROM reel_reactions
      WHERE video_id IN (${marks})
      GROUP BY video_id, kind
    `).all(req.session.userId, ...videoIds);
    for (const row of reactions) {
      const item = reactionMap.get(row.video_id) || { like_count: 0, save_count: 0, liked_by_me: false, saved_by_me: false };
      if (row.kind === 'like') { item.like_count = Number(row.count); item.liked_by_me = !!row.mine; }
      if (row.kind === 'save') { item.save_count = Number(row.count); item.saved_by_me = !!row.mine; }
      reactionMap.set(row.video_id, item);
    }
  }
  for (const video of videos) Object.assign(video, reactionMap.get(String(video.video_id)) || {
    like_count: 0, save_count: 0, liked_by_me: false, saved_by_me: false,
  });

  res.json({
    videos,
    church_name: church?.name || me?.church_name || null,
    church_count: curatedChurch.length,
    chosen_by: chosenBy,
    curated_count: curated.videos.length,
    // Honest when the cooldown had to be relaxed: these are repeats, and the
    // client can say so rather than presenting them as new.
    recycled: !!curated.recycled,
  });
});

// A catalogue Reel becomes "seen" when a member opens it, not merely when it
// happened to be in a response below the fold. That distinction keeps the
// freshness promise honest and avoids burning through a whole feed on load.
// Church uploads and Functioning Faith originals are intentionally excluded:
// they are live/community material rather than ranked catalogue inventory.
router.post('/reels/:videoId/impression', requireAuth, (req, res) => {
  const videoId = String(req.params.videoId || '').trim().slice(0, 120);
  if (!/^[A-Za-z0-9_-]{6,120}$/.test(videoId)) return res.status(400).json({ error: 'invalid_reel' });
  const item = db.prepare(`SELECT video_id FROM videos
    WHERE video_id = ? AND dead_at IS NULL
      AND source_kind IN ('channel', 'seed', 'query') LIMIT 1`).get(videoId);
  if (!item) return res.status(204).end();
  try { reels.markSeen(req.session.userId, [item.video_id]); }
  catch (err) { console.error('[reels] mark seen failed:', err.message); return res.status(500).json({ error: 'reel_impression_failed' }); }
  res.json({ recorded: true });
});

// Reels are catalogue items rather than member-authored posts, so reactions
// do not generate author notifications. A toggle response includes the fresh
// aggregate count, making rapid taps converge without a second fetch.
router.post('/reels/:videoId/reaction', requireAuth, (req, res) => {
  const videoId = String(req.params.videoId || '').trim().slice(0, 120);
  const kind = String(req.body?.kind || '').trim();
  // Church uploads may be returned live from YouTube rather than persisted in
  // `videos`, so validate the opaque provider ID instead of requiring a local
  // catalogue row. The client can only reach this route from a feed item.
  if (!/^[A-Za-z0-9_-]{6,120}$/.test(videoId) || !['like', 'save'].includes(kind)) {
    return res.status(400).json({ error: 'invalid_reaction' });
  }
  const userId = req.session.userId;
  const current = db.prepare('SELECT 1 FROM reel_reactions WHERE user_id = ? AND video_id = ? AND kind = ?').get(userId, videoId, kind);
  if (current) {
    db.prepare('DELETE FROM reel_reactions WHERE user_id = ? AND video_id = ? AND kind = ?').run(userId, videoId, kind);
  } else {
    db.prepare('INSERT INTO reel_reactions (user_id, video_id, kind) VALUES (?, ?, ?)').run(userId, videoId, kind);
  }
  const count = db.prepare('SELECT COUNT(*) AS count FROM reel_reactions WHERE video_id = ? AND kind = ?').get(videoId, kind).count;
  res.json({ kind, active: !current, count: Number(count) });
});

// A quiet preference control, not a report or a penalty. A hidden Reel is
// excluded only from this member's feed; the action is idempotent so retries
// and a double tap cannot create more than one record.
router.post('/reels/:videoId/not-interested', requireAuth, (req, res) => {
  const videoId = String(req.params.videoId || '').trim().slice(0, 120);
  if (!/^[A-Za-z0-9_-]{6,120}$/.test(videoId)) return res.status(400).json({ error: 'invalid_reel' });
  try {
    db.prepare('INSERT OR IGNORE INTO reel_hides (user_id, video_id) VALUES (?, ?)')
      .run(req.session.userId, videoId);
  } catch (err) {
    console.error('[reels] not interested failed:', err.message);
    return res.status(500).json({ error: 'reel_preference_failed' });
  }
  res.json({ hidden: true });
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
router.post('/churches/:osmId/website', requireAuth, requireVerifiedChurchAdmin, (req, res) => {
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
  if (!admin.featureEnabled('journeys')) return res.json([]);
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

/**
 * The same, but able to reach the whole canon.
 *
 * The local library holds 22 books. Every other book — most of the Bible — used
 * to be unopenable: no verse thread, no bio verse, no conversation, because the
 * app could not prove the verse existed. With the YouVersion canon index loaded
 * it can, and with the Platform it can fetch the real text too.
 *
 * Still never invents. A reference outside the canon is rejected as before, and
 * one the Platform cannot serve is reported as unavailable rather than filled in.
 */
async function resolveVerseReferenceFull(raw) {
  const local = resolveVerseReference(raw);
  if (local.row || local.error === 'invalid_verse_format') return local;

  const ref = String(raw || '').trim();
  const m = ref.match(/^(.+?)\s+(\d+):(\d+)$/);
  const inCanon = youversion.canonHas(ref);
  if (inCanon === false) {
    return { error: 'not_in_canon', hint: 'That chapter or verse does not exist in the Bible.' };
  }

  const hit = await companion.resolveRef(ref, null);
  if (!hit) return local;                       // unchanged message when we simply cannot fetch it
  return {
    row: {
      text: hit.text,
      book: m[1].trim(), chapter: Number(m[2]), verse: Number(m[3]),
      translation: hit.source === 'youversion' ? 'YouVersion' : 'WEB',
    },
  };
}

// Saved verses are a private library, not a social signal. The resolver runs
// before a write so the collection can never contain a fabricated reference or
// text supplied by a browser.
router.get('/verses/saved', requireAuth, (req, res) => {
  res.json({ verses: verseSaves.list(req.session.userId) });
});

router.post('/verses/save', requireAuth, async (req, res) => {
  const { row, error, hint } = await resolveVerseReferenceFull(req.body && req.body.reference);
  if (error) return res.status(400).json({ error, hint });
  res.json(verseSaves.toggle(req.session.userId, row));
});

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
router.post('/verses/:reference/thread', requireAuth, async (req, res) => {
  const { row, error, hint } = await resolveVerseReferenceFull(req.params.reference);
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
router.get('/verses/:reference/thread', async (req, res) => {
  const { row, error, hint } = await resolveVerseReferenceFull(req.params.reference);
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

// --- Developer API keys ----------------------------------------------------
// The other half of the webhook story: webhooks push events out, keys let
// software ask questions. Both belong to a member, not to the platform.
function requireVerifiedDeveloper(req, res, next) {
  try { req.developerVerification = developerVerification.requireVerified(req.session.userId); next(); }
  catch (err) { res.status(403).json({ error: err.code || 'developer_verification_required', verification: err.verification || developerVerification.get(req.session.userId) }); }
}

// The review token is a single shared secret with no per-user identity behind
// it, so unlike a password there is no account to lock out -- without a rate
// limit here, it is guessable by brute force over the network at whatever
// rate the attacker's connection allows. 20 attempts/minute per IP is plenty
// for a real reviewer (who types or pastes the token once per browser
// session) and hostile to guessing a token of any real length.
const reviewerAuthWindow = new Map();
function reviewerAuthorized(req) {
  if (!allowWindow(reviewerAuthWindow, req.ip || 'unknown', 20, 60_000)) return false;
  const expected = process.env.DEVELOPER_REVIEW_TOKEN;
  const supplied = String(req.get('x-developer-review-token') || '');
  if (!expected || supplied.length !== expected.length) return false;
  return require('crypto').timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

// A separate token from DEVELOPER_REVIEW_TOKEN on purpose -- the ops agent
// (a second Railway service on its own schedule, see webapp/ops-agent.js)
// should be able to run maintenance chores without also being able to
// resolve moderation reports or suspend accounts. Least privilege between
// two things that happen to both be "a service account with a shared
// secret," not one token doing double duty.
const opsAgentAuthWindow = new Map();
function opsAgentAuthorized(req) {
  if (!allowWindow(opsAgentAuthWindow, req.ip || 'unknown', 20, 60_000)) return false;
  const expected = process.env.OPS_AGENT_TOKEN;
  const supplied = String(req.get('x-ops-agent-token') || '');
  if (!expected || supplied.length !== expected.length) return false;
  return require('crypto').timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

// Same bounded, non-AI chores as webapp/ops-agent.js used to run via direct
// SQLite access. Reworked to run in-process instead: a Railway volume can
// only be attached to one service, so a second service opening the same
// database file over a shared network volume was a real corruption risk,
// not a hypothetical one. This endpoint lets a separate, stateless service
// trigger the same maintenance over HTTPS instead -- no filesystem or
// volume access needed on that side at all.
router.post('/admin/ops/run', async (req, res) => {
  if (!opsAgentAuthorized(req)) return res.status(404).json({ error: 'not_found' });
  const results = {};
  let failures = 0;
  const tasks = [
    ['purge_expired_stories', () => {
      const r = db.prepare("DELETE FROM stories WHERE expires_at < datetime('now')").run();
      return { deleted: r.changes };
    }],
    ['purge_expired_sessions', () => {
      const idleMinutes = Math.max(15, Number(process.env.SESSION_IDLE_MINUTES) || 30);
      const absoluteDays = Math.max(1, Number(process.env.SESSION_ABSOLUTE_DAYS) || 30);
      const r = db.prepare(
        `DELETE FROM user_sessions WHERE revoked_at IS NOT NULL
           OR created_at < datetime('now', '-${absoluteDays} days')
           OR last_seen_at < datetime('now', '-${idleMinutes} minutes')`
      ).run();
      return { deleted: r.changes };
    }],
    ['refresh_feeds', async () => {
      const [n, p] = await Promise.all([
        news.refreshNews().catch(err => ({ error: err.message })),
        require('../lib/podcasts').refreshEpisodes().catch(err => ({ error: err.message })),
      ]);
      return { news: n, podcasts: p };
    }],
    ['retention_sweep', () => retention.runOnce()],
    // Only actually hits the network (a handful of paginated requests to
    // the Urban Institute's school directory) if the local copy is more
    // than 30 days old or has never been synced -- see schools.isStale().
    // A no-op on every other hourly run.
    ['schools_sync', () => schools.syncIfStale()],
  ];
  for (const [name, fn] of tasks) {
    try { results[name] = await fn(); }
    catch (err) { failures++; results[name] = { error: err.message }; }
  }
  res.status(failures ? 207 : 200).json({ ok: failures === 0, results, finished_at: new Date().toISOString() });
});

router.get('/developer/verification', requireAuth, (req, res) => res.json(developerVerification.get(req.session.userId)));
router.post('/developer/churches', requireAuth, requireCommunityAccess, (req, res) => {
  try { res.status(201).json({ church: developerVerification.createChurch(req.session.userId, req.body || {}) }); }
  catch (err) { res.status(400).json({ error: err.code || 'church_submission_failed', hint: err.message }); }
});
router.post('/developer/apply', requireAuth, requireCommunityAccess, (req, res) => {
  try { res.status(201).json(developerVerification.apply(req.session.userId, req.body || {})); }
  catch (err) { res.status(400).json({ error: err.code || 'developer_application_failed', hint: err.message }); }
});
router.post('/developer/review/:id', (req, res) => {
  if (!reviewerAuthorized(req)) return res.status(404).json({ error: 'not_found' });
  try {
    const result = developerVerification.review(req.params.id, req.body || {});
    if (['suspended','revoked'].includes(result.status)) {
      db.prepare("UPDATE api_keys SET revoked_at=datetime('now') WHERE user_id=? AND revoked_at IS NULL").run(result.user_id);
      db.prepare('UPDATE webhooks SET active=0 WHERE user_id=?').run(result.user_id);
    }
    res.json(result);
  } catch (err) { res.status(err.code === 'not_found' ? 404 : 400).json({ error: err.code || 'review_failed', hint: err.message }); }
});
router.get('/developer/content', requireAuth, requireVerifiedDeveloper, (req,res) => {
  res.json({ submissions: developerVerification.listContent(req.session.userId), categories:[...developerVerification.CONTENT_CATEGORIES] });
});
router.post('/developer/content', requireAuth, requireVerifiedDeveloper, (req,res) => {
  try { res.status(201).json({ submission: developerVerification.submitContent(req.session.userId,req.body||{}) }); }
  catch(err){ res.status(400).json({error:err.code||'content_submission_failed',hint:err.message}); }
});
router.post('/developer/content/:id/review', (req,res) => {
  if(!reviewerAuthorized(req)) return res.status(404).json({error:'not_found'});
  try { res.json({submission:developerVerification.reviewContent(req.params.id,req.body||{})}); }
  catch(err){ res.status(err.code==='not_found'?404:400).json({error:err.code||'review_failed',hint:err.message}); }
});
router.post('/developer/enforcement/:id', (req,res) => {
  if(!reviewerAuthorized(req)) return res.status(404).json({error:'not_found'});
  try { res.json(developerVerification.enforce(req.params.id,req.body||{})); }
  catch(err){ res.status(err.code==='not_found'?404:400).json({error:err.code||'enforcement_failed',hint:err.message}); }
});
router.get('/moderation/queue', (req,res) => {
  if(!reviewerAuthorized(req)) return res.status(404).json({error:'not_found'});
  res.json({reports:moderationRows(req.query.status)});
});
// Advisory only: a Gloo-suggested severity and category, computed on demand
// so it never runs against reports nobody is looking at. The reviewer sees
// it as a labelled suggestion alongside the raw report and still makes and
// records the actual decision through /review below -- this endpoint cannot
// resolve a report by itself, and nothing here is treated as ground truth.
router.post('/moderation/queue/:id/suggest', async (req,res) => {
  if(!reviewerAuthorized(req)) return res.status(404).json({error:'not_found'});
  const report=db.prepare('SELECT * FROM moderation_queue WHERE id=?').get(req.params.id);
  if(!report)return res.status(404).json({error:'report_not_found'});
  if(!gloo.isConfigured()) return res.json({suggestion:null,configured:false});

  let contentExcerpt = '';
  if (report.report_type === 'post') {
    const post = db.prepare('SELECT content FROM posts WHERE id=?').get(report.target_id);
    contentExcerpt = post?.content || '(post no longer exists)';
  } else if (report.report_type === 'user') {
    contentExcerpt = '(a user account, not a single piece of content)';
  } else {
    contentExcerpt = '(no content excerpt available for report type: ' + report.report_type + ')';
  }

  const out = await gloo.chatJson({
    kind: 'moderation_triage', cache: true, cacheDays: 3, maxTokens: 220,
    messages: [
      { role: 'system', content: 'You triage user reports for a faith-based fitness community app. '
        + 'Reply with ONLY a JSON object: {"category":"harassment|spam|explicit_content|misinformation|self_harm_risk|other",'
        + '"severity":"low|medium|high","reasoning":"one sentence, under 30 words","recommend_urgent_review":true|false}. '
        + 'You are advisory only -- a human reviewer makes the actual decision. When unsure, prefer a lower-confidence, honest read over guessing.' },
      { role: 'user', content: `Report type: ${report.report_type}\nReporter-stated reason: ${String(report.reason || '').slice(0,500)}\nReported content: ${String(contentExcerpt).slice(0,800)}` },
    ],
  });
  if (!out || !out.json) return res.json({suggestion:null,configured:true});
  res.json({suggestion:out.json, model:out.model});
});

router.post('/moderation/queue/:id/review', (req,res) => {
  if(!reviewerAuthorized(req)) return res.status(404).json({error:'not_found'});
  try { res.json(reviewModerationReport(req.params.id, req.body || {}, req.body?.reviewer || 'authorized reviewer')); }
  catch (err) { res.status(err.code === 'report_not_found' ? 404 : err.code === 'already_reviewed' ? 409 : 400).json({ error: err.code || 'review_failed', hint: err.message }); }
});

router.get('/dev/keys', requireAuth, requireVerifiedDeveloper, (req, res) => {
  res.json({ keys: apikeys.list(req.session.userId), scopes: apikeys.SCOPES });
});

router.post('/dev/keys', requireAuth, requireVerifiedDeveloper, (req, res) => {
  const b = req.body || {};
  // `key` appears in this response and nowhere else, ever again.
  let created;
  try { created = apikeys.create(req.session.userId, { name: b.name, scopes: b.scopes }); }
  catch (err) { return res.status(err.code === 'active_key_limit' ? 409 : 400).json({ error: err.code || 'key_creation_failed', hint: err.message }); }
  res.status(201).json({
    ...created,
    warning: 'Copy this key now — it is stored only as a hash and cannot be shown again.',
  });
});

router.post('/dev/keys/:id/rotate', requireAuth, requireVerifiedDeveloper, (req, res) => {
  const fresh = apikeys.rotate(req.session.userId, req.params.id);
  if (!fresh) return res.status(404).json({ error: 'not_found' });
  res.json({ ...fresh, warning: 'The previous key is now revoked. Copy this one — it cannot be shown again.' });
});

router.delete('/dev/keys/:id', requireAuth, requireVerifiedDeveloper, (req, res) => {
  if (!apikeys.revoke(req.session.userId, req.params.id)) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

// --- Push notifications -----------------------------------------------------
// Everything here is opt-in and per-category. The public key is served so the
// browser can subscribe; there is nothing secret about it.
router.get('/push/config', (req, res) => {
  res.json({
    enabled: push.isConfigured(),
    public_key: push.publicKey(),
    categories: push.CATEGORIES,
    defaults: push.DEFAULT_CATEGORIES,
    subscriptions: req.session.userId ? push.get(req.session.userId) : [],
  });
});

router.post('/push/subscribe', requireAuth, (req, res) => {
  if (!push.isConfigured()) return res.status(503).json({ error: 'push_not_configured' });
  const b = req.body || {};
  const subs = push.subscribe(req.session.userId, b.subscription, b.categories, req.get('user-agent'));
  if (!subs) return res.status(400).json({ error: 'invalid_subscription' });
  res.json({ subscriptions: subs });
});

router.post('/push/categories', requireAuth, (req, res) => {
  const b = req.body || {};
  if (!push.setCategories(req.session.userId, b.endpoint, b.categories)) {
    return res.status(404).json({ error: 'not_subscribed' });
  }
  res.json({ subscriptions: push.get(req.session.userId) });
});

router.post('/push/unsubscribe', requireAuth, (req, res) => {
  push.unsubscribe(req.session.userId, (req.body || {}).endpoint);
  res.json({ subscriptions: push.get(req.session.userId) });
});

// Called by public/native.js only inside the Capacitor wrapper. Web visitors
// never hit this route -- window.Capacitor doesn't exist for them.
router.post('/push/native-register', requireAuth, (req, res) => {
  const { platform, token, categories } = req.body || {};
  const result = push.registerNativeToken(req.session.userId, platform, token, categories);
  if (!result) return res.status(400).json({ error: 'invalid_token' });
  res.json(result);
});

router.post('/push/native-unregister', requireAuth, (req, res) => {
  push.unregisterNativeToken(req.session.userId, (req.body || {}).token);
  res.json({ ok: true });
});

// Send one to yourself, so permission and delivery can be proven immediately
// rather than by waiting until tomorrow morning.
router.post('/push/test', requireAuth, async (req, res) => {
  if (!push.isConfigured()) return res.status(503).json({ error: 'push_not_configured' });
  const r = await push.send(req.session.userId, 'daily_verse', {
    title: 'Functioning Faith',
    body: 'Notifications are working. Your morning verse will arrive here.',
    url: '/', tag: 'test',
  });
  res.json(r);
});

router.get('/push/history', requireAuth, (req, res) => {
  res.json({ sent: push.history(req.session.userId, req.query.limit) });
});

// A safe, canonical link that opens the verified verse in the app. The link is
// intentionally just a deep link; no private user/session data is embedded.
router.get('/verses/:reference/share', async (req, res) => {
  const { row, error, hint } = await resolveVerseReferenceFull(req.params.reference);
  if (error) return res.status(400).json({ error, hint });
  const reference = `${row.book} ${row.chapter}:${row.verse}`;
  const relative = `/?open=verse&ref=${encodeURIComponent(reference)}`;
  res.json({ reference, url: relative, absolute_url: `${baseUrl(req)}${relative}` });
});

// Personal motivation is opt-in and user-authored. The scheduler creates the
// in-app notification first, then attempts the home-screen push if reminders
// are enabled on one of the member's subscriptions.
router.get('/reminders', requireAuth, (req, res) => res.json(reminders.list(req.session.userId)));

router.post('/reminders', requireAuth, (req, res) => {
  const b = req.body || {};
  const title = String(b.title || 'Keep moving').trim().slice(0, 80);
  const body = String(b.body || '').trim().slice(0, 240);
  const when = new Date(b.scheduled_at);
  const repeat = ['once', 'daily', 'weekly'].includes(b.repeat_rule) ? b.repeat_rule : 'once';
  if (!body) return res.status(400).json({ error: 'message_required' });
  if (!title) return res.status(400).json({ error: 'title_required' });
  if (Number.isNaN(when.getTime()) || when.getTime() < Date.now() - 30000) return res.status(400).json({ error: 'invalid_time', hint: 'Choose a time in the future.' });
  const id = randomUUID();
  db.prepare(`INSERT INTO user_reminders (id, user_id, title, body, scheduled_at, repeat_rule)
    VALUES (?, ?, ?, ?, ?, ?)`).run(id, req.session.userId, title, body, reminders.sqlDate(when), repeat);
  res.status(201).json(db.prepare('SELECT * FROM user_reminders WHERE id = ?').get(id));
});

router.patch('/reminders/:id', requireAuth, (req, res) => {
  const current = db.prepare('SELECT * FROM user_reminders WHERE id = ? AND user_id = ?').get(req.params.id, req.session.userId);
  if (!current) return res.status(404).json({ error: 'not_found' });
  const enabled = req.body && req.body.enabled !== undefined ? (req.body.enabled ? 1 : 0) : current.enabled;
  db.prepare('UPDATE user_reminders SET enabled = ? WHERE id = ? AND user_id = ?').run(enabled, current.id, req.session.userId);
  res.json(db.prepare('SELECT * FROM user_reminders WHERE id = ?').get(current.id));
});

router.delete('/reminders/:id', requireAuth, (req, res) => {
  const r = db.prepare('DELETE FROM user_reminders WHERE id = ? AND user_id = ?').run(req.params.id, req.session.userId);
  if (!r.changes) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

// Send yourself today's morning verse now — the real thing, same code path.
router.post('/push/daily-now', requireAuth, async (req, res) => {
  if (!push.isConfigured()) return res.status(503).json({ error: 'push_not_configured' });
  const r = await daily.sendFor(req.session.userId);
  if (!r) return res.status(409).json({ error: 'nothing_to_send',
    hint: 'Subscribe to the daily verse category first, or you have had every verse in the pool recently.' });
  res.json(r);
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

  const { row, error, hint } = await resolveVerseReferenceFull(req.params.reference);
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
router.post('/churches/:osmId/auto-link', requireAuth, requireVerifiedChurchAdmin, async (req, res) => {
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
  if (!allowWindow(churchVideosWindow, `church-videos:${req.session.userId}`, 60, 60 * 1000)) {
    return res.status(429).json({ error: 'too_many_requests' });
  }
  const me = db.prepare('SELECT email, church_osm_id, church_name, church FROM users WHERE id = ?').get(req.session.userId);
  if (!me) return res.json({ videos: [], source: 'none', church_name: null });
  const churchName = me.church_name || me.church || null;
  let church = null;
  if (me.church_osm_id) church = db.prepare('SELECT * FROM churches WHERE osm_id = ?').get(me.church_osm_id);
  if (!church && churchName) {
    church = db.prepare('SELECT * FROM churches WHERE lower(name) = lower(?) ORDER BY website_url IS NOT NULL DESC, youtube_channel_id IS NOT NULL DESC LIMIT 1')
      .get(churchName);
  }
  if (!churchName && !church) return res.json({ videos: [], source: 'none', church_name: null });

  if (church && church.youtube_channel_id && youtube.isConfigured()) {
    try {
      const uploads = await youtube.fetchRecentUploads(church.youtube_channel_id, 4);
      if (uploads && uploads.length) {
        return res.json({
          church_name: church.name || churchName,
          source: 'youtube_channel',
          channel_title: church.youtube_channel_title,
          videos: uploads.map(v => ({ provider: 'youtube', video_id: v.videoId, title: v.title, thumbnail_url: v.thumbnailUrl, published_at: v.publishedAt })),
        });
      }
    } catch (err) {
      console.error('[church/videos] youtube fetch failed:', err.message);
    }
  }

  if (church && church.website_url) {
    try {
      const embeds = await fetchChurchWebsiteEmbeds(church.website_url);
      if (embeds && embeds.length) {
        return res.json({
          church_name: church.name || churchName,
          source: 'website',
          videos: embeds.slice(0, 4).map(e => ({ provider: e.provider, video_id: e.videoId, title: null, thumbnail_url: null, published_at: null })),
        });
      }
    } catch (err) {
      console.error('[church/videos] website fetch failed:', err.message);
    }
  }

  const fallbackDemoVideos = isDemoLoginEmail(me.email) ? demoChurchVideos(4) : [];
  res.json({
    videos: fallbackDemoVideos,
    source: fallbackDemoVideos.length ? 'demo_seed' : 'none',
    church_name: church?.name || churchName,
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

router.get('/webhooks', requireAuth, requireVerifiedDeveloper, (req, res) => {
  res.json({ webhooks: webhooks.list(req.session.userId) });
});

router.post('/webhooks', requireAuth, requireVerifiedDeveloper, (req, res) => {
  const r = webhooks.create(req.session.userId, req.body || {});
  if (r.error) return res.status(400).json(r);
  res.status(201).json(r);
});

router.patch('/webhooks/:id', requireAuth, requireVerifiedDeveloper, (req, res) => {
  const r = webhooks.update(req.session.userId, req.params.id, req.body || {});
  if (r.error) return res.status(r.error === 'not_found' ? 404 : 400).json(r);
  res.json(r);
});

router.post('/webhooks/:id/rotate', requireAuth, requireVerifiedDeveloper, (req, res) => {
  const r = webhooks.rotate(req.session.userId, req.params.id);
  if (r.error) return res.status(404).json(r);
  res.json(r);
});

router.get('/webhooks/:id/deliveries', requireAuth, requireVerifiedDeveloper, (req, res) => {
  const d = webhooks.deliveries(req.session.userId, req.params.id);
  if (!d) return res.status(404).json({ error: 'not_found' });
  res.json({ deliveries: d });
});

// A test event, so a developer can verify signature handling without waiting
// for a real workout. It is delivered through the identical signed path.
router.post('/webhooks/:id/test', requireAuth, requireVerifiedDeveloper, async (req, res) => {
  const key = `${req.session.userId}:${req.params.id}`; const now = Date.now();
  const recent = (webhookTestWindow.get(key) || []).filter(t => now - t < 60_000);
  if (recent.length >= 3) return res.status(429).json({ error: 'test_rate_limit', retry_after: 60 });
  recent.push(now); webhookTestWindow.set(key,recent);
  const result = await webhooks.testDelivery(req.session.userId,req.params.id);
  if (result.error) return res.status(404).json(result);
  res.json({ ok: true, note: 'A test event was delivered only to this webhook.' });
});

router.delete('/webhooks/:id', requireAuth, requireVerifiedDeveloper, (req, res) => {
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
  const biometricAllowed = hasActiveConsent(req.session.userId, 'biometric_ingest');
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
    hr: b.hr_measured && biometricAllowed ? b.hr : null,
    recent_hr: b.hr_measured && biometricAllowed ? b.recent_hr : null,
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
      hr: b.hr_measured && biometricAllowed ? b.hr : null,
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
router.get('/search', requireAuth, (req, res) => {
  const raw = String(req.query.q || '').trim();
  if (raw.length < 2) return res.json({ q: raw, groups: [], total: 0 });
  const like = '%' + raw.replace(/[%_]/g, m => '\\' + m) + '%';
  const limit = Math.min(Number(req.query.limit) || 6, 20);
  const groups = [];
  const add = (type, label, items) => { if (items.length) groups.push({ type, label, items }); };

  add('people', 'People', db.prepare(
    `SELECT u.id, u.display_name, u.bio_verse_ref,
            CASE WHEN u.avatar_data IS NOT NULL THEN 1 ELSE 0 END AS has_avatar
     FROM users u
     WHERE u.id != @me AND u.display_name LIKE @like ESCAPE '\\'
       AND NOT EXISTS (SELECT 1 FROM dm_blocks b
                       WHERE (b.blocker_id = @me AND b.blocked_id = u.id)
                          OR (b.blocker_id = u.id AND b.blocked_id = @me))
     ORDER BY length(u.display_name), u.display_name LIMIT @limit`).all({ like, me: req.session.userId, limit })
    .map(u => ({ id: u.id, title: u.display_name,
                 subtitle: u.bio_verse_ref || null,
                 has_avatar: !!u.has_avatar })));

  // Search respects the same visibility and block rules as the feed. This
  // makes search a way to re-find a useful conversation, not a side channel
  // around a member's audience choice.
  add('posts', 'Community posts', db.prepare(`
    SELECT p.id, p.content, p.created_at, u.display_name AS author
      FROM posts p JOIN users u ON u.id = p.user_id
     WHERE p.content LIKE @like ESCAPE '\\'
       AND (p.visibility = 'public' OR p.user_id = @me OR (p.visibility = 'followers' AND EXISTS (
            SELECT 1 FROM followers f WHERE f.followee_id = p.user_id AND f.follower_id = @me))
            OR (p.visibility = 'circle' AND EXISTS (
            SELECT 1 FROM circle_members c WHERE c.owner_id = p.user_id AND c.member_id = @me)))
       AND NOT EXISTS (SELECT 1 FROM dm_blocks b
                       WHERE (b.blocker_id = @me AND b.blocked_id = p.user_id)
                          OR (b.blocker_id = p.user_id AND b.blocked_id = @me))
     ORDER BY p.created_at DESC LIMIT @limit
  `).all({ like, me: req.session.userId, limit })
    .map(p => ({ id: p.id, title: p.author, subtitle: p.content })));

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
    `SELECT id, name, username, description FROM groups
     WHERE (name LIKE @like ESCAPE '\\' OR username LIKE @like ESCAPE '\\' OR description LIKE @like ESCAPE '\\')
       AND (visibility = 'public' OR EXISTS (SELECT 1 FROM group_members m WHERE m.group_id = groups.id AND m.user_id = @me))
     ORDER BY length(name) LIMIT @limit`).all({ like, me: req.session.userId, limit })
    .map(g => ({ id: g.id, title: g.name, subtitle: g.username ? '@' + g.username + ' · ' + (g.description || '') : g.description })));

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
router.post('/dms/with/:userId', requireAuth, requireCommunityAccess, (req, res) => {
  const r = dms.openThread(req.session.userId, req.params.userId);
  if (r.error) {
    const code = r.error === 'no_such_user' ? 404 : r.error === 'blocked' ? 403 : 400;
    return res.status(code).json(r);
  }
  res.json({ thread_id: r.thread.id, user: { id: r.other.id, display_name: r.other.display_name } });
});

// DM end-to-end encryption key exchange. Only the public half of each
// person's ECDH keypair ever reaches the server -- the private key is
// generated and stored client-side and is never sent here. Any authenticated
// user may read anyone else's public key: that is the point of a public key,
// and it carries no information about who someone has messaged.
// These MUST be registered before the /dms/:threadId routes below -- Express
// matches route patterns in registration order, so a wildcard :threadId
// route declared first would swallow "keys" as a literal thread id.
router.post('/dms/keys', requireAuth, (req, res) => {
  const jwk = req.body && req.body.public_key;
  if (!jwk || typeof jwk !== 'object' || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.x || !jwk.y) {
    return res.status(400).json({ error: 'invalid_public_key' });
  }
  db.prepare('UPDATE users SET e2e_public_key = ? WHERE id = ?').run(JSON.stringify(jwk), req.session.userId);
  res.json({ ok: true });
});

router.get('/dms/keys/:userId', requireAuth, (req, res) => {
  const row = db.prepare('SELECT e2e_public_key FROM users WHERE id = ?').get(req.params.userId);
  if (!row) return res.status(404).json({ error: 'user_not_found' });
  res.json({ public_key: row.e2e_public_key ? JSON.parse(row.e2e_public_key) : null });
});

router.get('/dms/:threadId', requireAuth, (req, res) => {
  const data = dms.messages(req.session.userId, req.params.threadId);
  if (!data) return res.status(404).json({ error: 'not_found' });
  res.json(data);
});

router.post('/dms/:threadId', requireAuth, requireCommunityAccess, (req, res) => {
  if(!allowWindow(dmRateWindow,req.session.userId,30,60_000)) return res.status(429).json({error:'messaging_too_fast'});
  // An end-to-end encrypted body is ciphertext -- the server cannot and must
  // not try to read it, so the link-safety scan only runs on plaintext
  // messages. This is a deliberate tradeoff of true E2E: the server-side
  // link/abuse scanning that protects plaintext DMs does not see inside
  // encrypted ones. The client shows its own best-effort warning before
  // encrypting, but nothing here can verify that client-side check ran.
  const isE2e = !!(req.body && req.body.e2e);
  const warning = isE2e ? null : linkWarning(req.body&&req.body.body);
  const r = dms.send(req.session.userId, req.params.threadId, req.body && req.body.body,
    { kind: isE2e ? 'e2e' : 'text', metadata: warning?{link_warning:warning}:null });
  if (r.error) {
    const code = r.error === 'not_found' ? 404 : r.error === 'blocked' ? 403 : 400;
    return res.status(code).json(r);
  }
  if(!accountSecurity.hasRelationship(r.recipient_id,req.session.userId,'mute')) notify(r.recipient_id, 'dm', `${displayName(req.session.userId)} sent you a message.`,
    { thread_id: req.params.threadId });
  res.status(201).json({ message: r.message, link_warning:warning });
});


router.post('/dms/:threadId/verse', requireAuth, async (req, res) => {
  const { row, error, hint } = await resolveVerseReferenceFull(req.body && req.body.reference);
  if (error) return res.status(400).json({ error, hint });
  const reference = `${row.book} ${row.chapter}:${row.verse}`;
  const thread = dms.threadFor(req.session.userId, req.params.threadId);
  if (!thread) return res.status(404).json({ error: 'not_found' });
  const shareUrl = `/?open=verse&ref=${encodeURIComponent(reference)}`;
  const sent = dms.send(req.session.userId, req.params.threadId, `Shared ${reference}`, {
    kind: 'verse', metadata: { reference, text: row.text, share_url: shareUrl },
  });
  if (sent.error) return res.status(sent.error === 'blocked' ? 403 : 400).json(sent);
  notify(sent.recipient_id, 'dm', `${displayName(req.session.userId)} shared ${reference} with you.`, { thread_id: req.params.threadId });
  res.status(201).json({ message: sent.message, verse: { reference, text: row.text }, share_url: shareUrl });
});

// Planned workout invitations travel as rich DM cards, so both people have the
// schedule in context and the recipient can accept or decline without leaving
// the conversation.
router.post('/workout-invites', requireAuth, (req, res) => {
  const senderId = req.session.userId;
  const b = req.body || {};
  const recipientId = String(b.recipient_id || '').trim();
  if (!recipientId || recipientId === senderId) return res.status(400).json({ error: 'invalid_recipient' });
  const recipient = db.prepare('SELECT id, display_name FROM users WHERE id = ?').get(recipientId);
  if (!recipient) return res.status(404).json({ error: 'user_not_found' });
  if (dms.isBlockedEitherWay(senderId, recipientId)) return res.status(403).json({ error: 'blocked' });

  const type = String(b.workout_type || 'Run').trim().slice(0, 40) || 'Run';
  const duration = b.duration_min === '' || b.duration_min == null ? null : Number(b.duration_min);
  if (duration != null && (!Number.isInteger(duration) || duration < 5 || duration > 1440)) {
    return res.status(400).json({ error: 'invalid_duration', hint: 'Duration must be between 5 minutes and 24 hours.' });
  }
  const scheduled = b.scheduled_at ? new Date(b.scheduled_at) : null;
  if (scheduled && Number.isNaN(scheduled.getTime())) return res.status(400).json({ error: 'invalid_time' });
  const invite = {
    id: randomUUID(), sender_id: senderId, recipient_id: recipientId,
    workout_type: type, scheduled_at: scheduled ? scheduled.toISOString() : null,
    duration_min: duration, location: b.location ? String(b.location).trim().slice(0, 120) : null,
    note: b.note ? String(b.note).trim().slice(0, 240) : null,
  };
  db.prepare(`INSERT INTO workout_invites
    (id, sender_id, recipient_id, workout_type, scheduled_at, duration_min, location, note)
    VALUES (?,?,?,?,?,?,?,?)`).run(invite.id, invite.sender_id, invite.recipient_id,
      invite.workout_type, invite.scheduled_at, invite.duration_min, invite.location, invite.note);
  const opened = dms.openThread(senderId, recipientId);
  if (opened.error) return res.status(403).json(opened);
  const summary = `${type} workout invite${scheduled ? ` for ${scheduled.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}` : ''}`;
  const sent = dms.send(senderId, opened.thread.id, summary, {
    kind: 'workout_invite', metadata: { invite_id: invite.id, ...invite },
  });
  if (sent.error) return res.status(403).json(sent);
  notify(recipientId, 'workout_invite', `${displayName(senderId)} invited you to a ${type.toLowerCase()} workout.`, {
    invite_id: invite.id, thread_id: opened.thread.id,
  });
  res.status(201).json({ invite, thread_id: opened.thread.id });
});

router.get('/workout-invites/pending', requireAuth, (req, res) => {
  const rows = db.prepare(`SELECT wi.*, u.display_name sender_name
    FROM workout_invites wi JOIN users u ON u.id = wi.sender_id
    WHERE wi.recipient_id = ? AND wi.status = 'pending' ORDER BY wi.created_at DESC`).all(req.session.userId);
  res.json(rows);
});

router.post('/workout-invites/:id/respond', requireAuth, (req, res) => {
  const invite = db.prepare('SELECT * FROM workout_invites WHERE id = ? AND recipient_id = ?').get(req.params.id, req.session.userId);
  if (!invite) return res.status(404).json({ error: 'invite_not_found' });
  if (invite.status !== 'pending') return res.status(409).json({ error: 'already_responded' });
  const accepted = !!(req.body || {}).accept;
  const status = accepted ? 'accepted' : 'declined';
  db.prepare("UPDATE workout_invites SET status = ?, responded_at = datetime('now') WHERE id = ? AND status = 'pending'").run(status, invite.id);
  const opened = dms.openThread(req.session.userId, invite.sender_id);
  if (!opened.error) {
    dms.send(req.session.userId, opened.thread.id, `${accepted ? 'Accepted' : 'Declined'} your ${invite.workout_type.toLowerCase()} workout invite.`, {
      kind: 'workout_invite_response', metadata: { invite_id: invite.id, status },
    });
  }
  notify(invite.sender_id, 'workout_invite_response', `${displayName(req.session.userId)} ${accepted ? 'accepted' : 'declined'} your workout invite.`, { invite_id: invite.id, status });
  res.json({ ok: true, status });
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

// The social view is deliberately a separate, read-only projection of an
// activity someone has actually posted. It never falls back to the private
// workout record, and the only route it returns is the same author-trimmed
// route used in the feed. This makes a friend activity feel complete without
// turning a shared card into an accidental health-data endpoint.
router.get('/workouts/:id/social', requireAuth, (req, res) => {
  const me = req.session.userId;
  const post = db.prepare(`
    SELECT p.id post_id, p.user_id, p.content, p.visibility, p.show_route, p.route_privacy_m,
           w.id workout_id, w.gps_path, w.type, w.start_time, w.end_time, w.duration_sec,
           w.distance_km, w.calories, w.avg_hr, u.display_name author,
           CASE WHEN u.avatar_data IS NOT NULL THEN 1 ELSE 0 END AS author_has_avatar,
           v.reference verse_reference, v.text verse_text
      FROM posts p
      JOIN workouts w ON w.id = p.workout_id
      JOIN users u ON u.id = p.user_id
 LEFT JOIN scripture_verses v ON v.id = p.verse_id
     WHERE p.workout_id = ?
     ORDER BY p.created_at DESC
     LIMIT 1
  `).get(req.params.id);
  if (!post || !postVisibleTo(post, me)) return res.status(404).json({ error: 'not_found' });
  if (db.prepare("SELECT 1 FROM account_relationship_controls WHERE actor_id=? AND subject_id=? AND control='mute'").get(me, post.user_id)) {
    return res.status(404).json({ error: 'not_found' });
  }

  const followsAuthor = !!db.prepare('SELECT 1 FROM followers WHERE follower_id=? AND followee_id=?').get(me, post.user_id);
  const mins = post.duration_sec > 0 ? post.duration_sec / 60 : null;
  const pace = mins && post.distance_km > 0.05 ? Math.round((mins / post.distance_km) * 100) / 100 : null;
  const route = publishedRoute(post);
  const kudosCount = db.prepare('SELECT COUNT(*) AS c FROM workout_kudos WHERE workout_id = ?').get(post.workout_id).c;
  const kudosByMe = !!db.prepare('SELECT 1 FROM workout_kudos WHERE workout_id = ? AND user_id = ?').get(post.workout_id, me);

  res.json({ activity: {
    id: post.workout_id, post_id: post.post_id, author_id: post.user_id, author: post.author,
    author_has_avatar: !!post.author_has_avatar, visibility: post.visibility, caption: post.content || '',
    type: post.type, start_time: post.start_time, duration_sec: post.duration_sec,
    distance_km: post.distance_km, calories: post.calories, avg_hr: post.avg_hr,
    pace_min_per_km: pace, verse_reference: post.verse_reference, verse_text: post.verse_text,
    route, kudos_count: Number(kudosCount || 0), kudos_by_me: kudosByMe,
    can_encourage: post.user_id !== me && followsAuthor,
  } });
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

// --- Athlete recruiting profiles -------------------------------------------
// The search/detail endpoints are deliberately unauthenticated: a college
// scout looking for a highschool athlete's stats is not expected to have a
// Functioning Faith account, and the whole point is to be findable. Only
// what the athlete explicitly marked public (is_public=1) is ever returned.

router.get('/athlete-profile/me', requireAuth, (req, res) => {
  const profile = athletes.get(req.session.userId);
  res.json({
    profile,
    visible: !!(profile && profile.is_public && profile.school_email_verified_at),
    sports: athletes.SPORTS,
  });
});

// Notifies every coach whose saved search matches this athlete, but only
// once the profile is actually visible in the directory (public AND
// verified -- the same two conditions athletes.search()'s WHERE clause
// checks). Called from both places that condition can newly become true:
// verifying a school email, and toggling is_public on after already being
// verified. Silently does nothing if the profile still isn't visible.
function notifyMatchingCoaches(athleteUserId) {
  const profile = athletes.publicProfile(athleteUserId);
  if (!profile) return;
  const matches = coaches.findMatchingCoaches({ sport: profile.sport, grad_year: profile.grad_year, position: profile.position });
  for (const m of matches) {
    if (m.coach_user_id === athleteUserId) continue;
    notify(m.coach_user_id, 'recruiting_match', `${profile.display_name} (${profile.sport}${profile.grad_year ? ', class of ' + profile.grad_year : ''}) matches your saved search.`,
      { url: '/?open=recruiting' });
  }
}

router.put('/athlete-profile', requireAuth, (req, res) => {
  const wasVisible = !!athletes.publicProfile(req.session.userId);
  const r = athletes.upsert(req.session.userId, req.body || {});
  if (r.error) return res.status(400).json(r);
  if (!wasVisible) notifyMatchingCoaches(req.session.userId);
  res.json(r);
});

router.get('/athlete-profile/analysis', requireAuth, async (req, res) => {
  const r = await athletes.analyze(req.session.userId);
  if (r.error) return res.status(400).json(r);
  res.json(r);
});

router.get('/athlete-profile/sport-fields/:sport', requireAuth, (req, res) => {
  res.json({ fields: athletes.SPORT_STAT_FIELDS[req.params.sport] || [] });
});

router.get('/athlete-profile/videos', requireAuth, (req, res) => res.json({ videos: athletes.listVideos(req.session.userId) }));
router.post('/athlete-profile/videos', requireAuth, (req, res) => {
  const r = athletes.addVideo(req.session.userId, req.body || {});
  if (r.error) return res.status(400).json(r);
  res.status(201).json(r);
});
router.delete('/athlete-profile/videos/:id', requireAuth, (req, res) => res.json(athletes.removeVideo(req.session.userId, req.params.id)));

router.get('/athlete-profile/teams', requireAuth, (req, res) => res.json({ teams: athletes.listTeams(req.session.userId) }));
router.post('/athlete-profile/teams', requireAuth, (req, res) => {
  const r = athletes.addTeam(req.session.userId, req.body || {});
  if (r.error) return res.status(400).json(r);
  res.status(201).json(r);
});
router.delete('/athlete-profile/teams/:id', requireAuth, (req, res) => res.json(athletes.removeTeam(req.session.userId, req.params.id)));

router.get('/athlete-profile/awards', requireAuth, (req, res) => res.json({ awards: athletes.listAwards(req.session.userId) }));
router.get('/athlete-profile/endorsements', requireAuth, (req, res) => res.json({ endorsements: athletes.listEndorsements(req.session.userId) }));
router.post('/athlete-profile/awards', requireAuth, (req, res) => {
  const r = athletes.addAward(req.session.userId, req.body || {});
  if (r.error) return res.status(400).json(r);
  res.status(201).json(r);
});
router.delete('/athlete-profile/awards/:id', requireAuth, (req, res) => res.json(athletes.removeAward(req.session.userId, req.params.id)));

// Coach endorsements: the coach must be .edu-verified, and the coach_user_id
// stamped on the endorsement always comes from the caller's own session --
// never from the request body -- so an athlete cannot write a fake
// endorsement "from" a coach who never wrote one.
router.post('/athlete-profile/:athleteId/endorse', requireAuth, (req, res) => {
  if (!coaches.isVerified(req.session.userId)) return res.status(403).json({ error: 'coach_not_verified' });
  const r = athletes.endorse(req.session.userId, req.params.athleteId, req.body && req.body.quote);
  if (r.error) return res.status(400).json(r);
  res.status(201).json(r);
});

// A public listing requires a verified school email -- see lib/athletes.js
// for why that's a narrower claim than "verified as a real school." The
// confirm link below is deliberately unauthenticated: the token itself is
// the credential, the same pattern as the password-reset link.
router.post('/athlete-profile/verify-email', requireAuth, async (req, res) => {
  try {
    const r = await athletes.requestEmailVerification(req.session.userId, req.body && req.body.email, baseUrl(req));
    if (r.error) return res.status(400).json(r);
    res.json(r);
  } catch (err) {
    res.status(502).json({ error: 'verification_email_failed' });
  }
});

router.get('/athlete-profile/verify-email/confirm', (req, res) => {
  const userId = athletes.confirmEmailVerification(req.query.token);
  res.setHeader('content-type', 'text/html');
  if (!userId) {
    return res.status(400).send('<!doctype html><meta charset="utf-8"><title>Link expired</title><body style="font-family:system-ui;max-width:480px;margin:60px auto;text-align:center"><h2>This link has expired or was already used.</h2><p>Go back to Profile Settings in Functioning Faith and send a new verification email.</p></body>');
  }
  notifyMatchingCoaches(userId);
  res.send('<!doctype html><meta charset="utf-8"><title>School email verified</title><body style="font-family:system-ui;max-width:480px;margin:60px auto;text-align:center"><h2>School email verified.</h2><p>Your athlete recruiting profile is now visible in the public directory, if you\'ve turned it on in Profile Settings.</p><p><a href="/">Back to Functioning Faith</a></p></body>');
});

router.get('/athlete-profile/score', requireAuth, (req, res) => {
  res.json(athletes.profileScore(req.session.userId));
});

router.get('/athlete-profile/sports', requireAuth, (req, res) => res.json({ sports: athletes.listSports(req.session.userId) }));
router.post('/athlete-profile/sports', requireAuth, (req, res) => {
  const r = athletes.addSport(req.session.userId, req.body || {});
  if (r.error) return res.status(400).json(r);
  res.status(201).json(r);
});
router.delete('/athlete-profile/sports/:id', requireAuth, (req, res) => res.json(athletes.removeSport(req.session.userId, req.params.id)));

// A coach vouching for one specific stat -- separate from an endorsement
// (a free-text quote about the athlete as a whole). Requires the same
// verified-coach gate as endorse() and the DM bypass.
router.post('/athlete-profile/:athleteId/confirm-stat', requireAuth, (req, res) => {
  if (!coaches.isVerified(req.session.userId)) return res.status(403).json({ error: 'coach_not_verified' });
  const r = athletes.confirmStat(req.session.userId, req.params.athleteId, req.body && req.body.stat_key);
  if (r.error) return res.status(400).json(r);
  res.json(r);
});

router.get('/athletes/search', (req, res) => {
  res.json({ athletes: athletes.search(req.query), sports: athletes.SPORTS });
});

router.get('/athletes/:userId', (req, res) => {
  const profile = athletes.publicProfile(req.params.userId);
  if (!profile) return res.status(404).json({ error: 'not_found' });
  res.json({ profile });
});

// US high school directory (lib/schools.js) -- public, no auth, same
// reasoning as the athlete directory itself: a coach searching for a
// school, or a scout following a roster link, isn't assumed to have an
// account. Typeahead search, then a school-scoped view of who on the
// platform is signed up there (same public+verified gate as the general
// athlete directory -- nothing here bypasses that).
router.get('/schools/search', (req, res) => {
  res.json({ schools: schools.search(req.query.q, req.query.state), last_synced: schools.lastSync() });
});

router.get('/schools/:ncessch', (req, res) => {
  const school = schools.get(req.params.ncessch);
  if (!school) return res.status(404).json({ error: 'not_found' });
  res.json({ school });
});

router.get('/schools/:ncessch/athletes', (req, res) => {
  const school = schools.get(req.params.ncessch);
  if (!school) return res.status(404).json({ error: 'not_found' });
  res.json({ school, athletes: athletes.search({ ...req.query, school_nces_id: req.params.ncessch }) });
});

// --- Coaches -----------------------------------------------------------
// Coach access (browsing the directory is already public; what's gated
// here is .edu-verified status, matching, and the DM bypass) requires a
// real .edu email confirmed by a one-time link -- see lib/coaches.js.

// The recruiting tab's first-visit choice ("are you a coach or a player"),
// saved as soon as it's made -- see lib/db.js for why this exists
// separately from whether a full athlete/coach profile has been saved yet.
router.put('/recruiting-role', requireAuth, (req, res) => {
  const role = req.body && req.body.role;
  if (role !== 'athlete' && role !== 'coach') return res.status(400).json({ error: 'invalid_role' });
  db.prepare('UPDATE users SET recruiting_role = ? WHERE id = ?').run(role, req.session.userId);
  res.json({ ok: true, role });
});

router.get('/coach-profile/me', requireAuth, (req, res) => {
  res.json({ profile: coaches.get(req.session.userId), sports: athletes.SPORTS });
});

router.put('/coach-profile', requireAuth, (req, res) => {
  const r = coaches.upsert(req.session.userId, req.body || {});
  if (r.error) return res.status(400).json(r);
  res.json(r);
});

router.post('/coach-profile/verify-email', requireAuth, async (req, res) => {
  try {
    const r = await coaches.requestEmailVerification(req.session.userId, req.body && req.body.email, baseUrl(req));
    if (r.error) return res.status(400).json(r);
    res.json(r);
  } catch { res.status(502).json({ error: 'verification_email_failed' }); }
});

router.get('/coach-profile/verify-email/confirm', (req, res) => {
  const userId = coaches.confirmEmailVerification(req.query.token);
  res.redirect(userId ? '/?coach_verified=1' : '/?coach_verify_failed=1');
});

router.get('/coach/match', requireAuth, async (req, res) => {
  const r = await coaches.matchAthletes(req.session.userId, { grad_year: req.query.grad_year, limit: req.query.limit });
  if (r.error) return res.status(403).json(r);
  res.json(r);
});

// Verified-coach DM entry point. Deliberately separate from the general
// /dms/with/:userId route: this is the one place message_permission is
// bypassed, and only after confirming (a) the caller is a verified coach
// and (b) the target is a real, public, verified athlete profile -- not
// just "any logged-in user", which the generic route would allow.
router.post('/coach/dms/with/:athleteId', requireAuth, requireCommunityAccess, (req, res) => {
  if (!coaches.isVerified(req.session.userId)) return res.status(403).json({ error: 'coach_not_verified' });
  if (!athletes.publicProfile(req.params.athleteId)) return res.status(404).json({ error: 'athlete_not_found' });
  const r = dms.openThread(req.session.userId, req.params.athleteId, { bypassMessagePermission: true });
  if (r.error) {
    const code = r.error === 'no_such_user' ? 404 : r.error === 'blocked' ? 403 : 400;
    return res.status(code).json(r);
  }
  res.json({ thread_id: r.thread.id, user: { id: r.other.id, display_name: r.other.display_name } });
});

// Saved searches drive the "athlete goes public" alert -- notifyMatchingCoaches
// above checks these whenever a profile newly becomes visible.
router.get('/coach/saved-searches', requireAuth, (req, res) => {
  if (!coaches.isVerified(req.session.userId)) return res.status(403).json({ error: 'coach_not_verified' });
  res.json({ searches: coaches.listSavedSearches(req.session.userId) });
});
router.post('/coach/saved-searches', requireAuth, (req, res) => {
  if (!coaches.isVerified(req.session.userId)) return res.status(403).json({ error: 'coach_not_verified' });
  const r = coaches.addSavedSearch(req.session.userId, req.body || {});
  if (r.error) return res.status(400).json(r);
  res.status(201).json(r);
});
router.delete('/coach/saved-searches/:id', requireAuth, (req, res) => {
  if (!coaches.isVerified(req.session.userId)) return res.status(403).json({ error: 'coach_not_verified' });
  res.json(coaches.removeSavedSearch(req.session.userId, req.params.id));
});

// A verified coach's own roster of platform athletes -- see lib/coaches.js
// for why membership requires the athlete to already be public+verified.
router.get('/coach/roster', requireAuth, (req, res) => {
  if (!coaches.isVerified(req.session.userId)) return res.status(403).json({ error: 'coach_not_verified' });
  res.json({ roster: coaches.listRoster(req.session.userId) });
});
router.post('/coach/roster/:athleteId', requireAuth, (req, res) => {
  if (!coaches.isVerified(req.session.userId)) return res.status(403).json({ error: 'coach_not_verified' });
  const r = coaches.addRosterMember(req.session.userId, req.params.athleteId, req.body || {});
  if (r.error) return res.status(400).json(r);
  res.status(201).json(r);
});
router.delete('/coach/roster/:id', requireAuth, (req, res) => {
  if (!coaches.isVerified(req.session.userId)) return res.status(403).json({ error: 'coach_not_verified' });
  res.json(coaches.removeRosterMember(req.session.userId, req.params.id));
});

// Public roster page -- no auth, same reasoning as the athlete directory:
// a scout or parent looking at a team roster isn't expected to have an
// account.
router.get('/coach/:coachUserId/roster', (req, res) => {
  const r = coaches.publicRoster(req.params.coachUserId);
  if (!r) return res.status(404).json({ error: 'not_found' });
  res.json(r);
});

module.exports = router;
