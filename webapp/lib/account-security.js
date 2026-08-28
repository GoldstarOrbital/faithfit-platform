'use strict';

const { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual, createCipheriv, createDecipheriv } = require('crypto');
const db = require('./db');

const ABSOLUTE_TIMEOUT_MS = Math.max(1, Number(process.env.SESSION_ABSOLUTE_DAYS) || 30) * 24 * 60 * 60 * 1000;
// Defaults to the same window as the absolute session lifetime. This is a
// fitness/social app, not a banking session -- a member who opens the app
// after being away for a few hours or days (the normal usage pattern) should
// stay signed in for the full 30 days their session cookie is valid for, the
// same way Instagram or any other social app behaves, not get bounced back to
// the sign-in screen for mere inactivity. Previously this defaulted to 30
// minutes, which meant almost every real-world app open forced a fresh login.
// SESSION_IDLE_MINUTES remains available for a context that actually wants a
// tighter idle window.
const IDLE_TIMEOUT_MS = process.env.SESSION_IDLE_MINUTES
  ? Math.max(15, Number(process.env.SESSION_IDLE_MINUTES)) * 60 * 1000
  : ABSOLUTE_TIMEOUT_MS;
const TERMS_VERSION = '2026-08-11';
const PRIVACY_VALUES = {
  profile_visibility: new Set(['public', 'followers', 'private']),
  follower_list_visibility: new Set(['public', 'followers', 'private']),
  message_permission: new Set(['everyone', 'followers', 'nobody']),
  tag_permission: new Set(['everyone', 'followers', 'nobody']),
  comment_permission: new Set(['everyone', 'followers', 'nobody']),
};

function init() {
  const cols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
  const add = (name, ddl) => { if (!cols.includes(name)) db.exec(`ALTER TABLE users ADD COLUMN ${ddl}`); };
  add('date_of_birth', 'date_of_birth TEXT');
  add('terms_version', 'terms_version TEXT');
  add('terms_accepted_at', 'terms_accepted_at TEXT');
  add('profile_visibility', "profile_visibility TEXT NOT NULL DEFAULT 'public'");
  add('follower_list_visibility', "follower_list_visibility TEXT NOT NULL DEFAULT 'followers'");
  add('message_permission', "message_permission TEXT NOT NULL DEFAULT 'followers'");
  add('tag_permission', "tag_permission TEXT NOT NULL DEFAULT 'followers'");
  add('comment_permission', "comment_permission TEXT NOT NULL DEFAULT 'everyone'");
  add('suspended_at', 'suspended_at TEXT');
  add('suspension_reason', 'suspension_reason TEXT');

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      device_name TEXT NOT NULL,
      user_agent TEXT,
      ip_hash TEXT,
      auth_method TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      reauthenticated_at TEXT NOT NULL,
      revoked_at TEXT,
      revoked_reason TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id, revoked_at, last_seen_at);

    CREATE TABLE IF NOT EXISTS account_security_events (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      event_type TEXT NOT NULL,
      detail TEXT,
      ip_hash TEXT,
      device_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_security_events_user ON account_security_events(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS login_attempts (
      attempt_key TEXT PRIMARY KEY,
      failures INTEGER NOT NULL DEFAULT 0,
      first_failure_at TEXT,
      last_failure_at TEXT,
      blocked_until TEXT
    );

    CREATE TABLE IF NOT EXISTS account_relationship_controls (
      actor_id TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      control TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (actor_id, subject_id, control)
    );

    CREATE TABLE IF NOT EXISTS user_mfa (
      user_id TEXT PRIMARY KEY,
      secret_cipher TEXT NOT NULL,
      enabled_at TEXT,
      last_counter INTEGER NOT NULL DEFAULT -1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS mfa_backup_codes (
      user_id TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, code_hash)
    );

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS native_auth_codes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      code_hash TEXT NOT NULL UNIQUE,
      handoff_challenge TEXT NOT NULL,
      auth_method TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_native_auth_codes_expiry ON native_auth_codes(expires_at, used_at);

    CREATE TABLE IF NOT EXISTS moderation_queue (
      id TEXT PRIMARY KEY,
      report_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      reporter_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      reviewer TEXT,
      review_note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      reviewed_at TEXT,
      UNIQUE(report_type,target_id,reporter_id)
    );
    CREATE INDEX IF NOT EXISTS idx_moderation_queue_status ON moderation_queue(status,created_at);
  `);
  // Demo identities are fictional fixtures, not people accepting a contract.
  // Give them a stable adult fixture value so the demo remains explorable while
  // every real or OAuth-created account must complete the explicit gate.
  db.prepare(`UPDATE users SET date_of_birth=COALESCE(date_of_birth,'1990-01-01'),age=COALESCE(age,36),
    terms_version=COALESCE(terms_version,?),terms_accepted_at=COALESCE(terms_accepted_at,datetime('now'))
    WHERE email LIKE '%@functioningfaith.demo'`).run(TERMS_VERSION);
}

function hash(value) {
  return createHash('sha256').update(String(value || '')).digest('hex');
}

function clientIp(req) {
  return String(req.ip || req.socket?.remoteAddress || '').slice(0, 120);
}

function ipHash(req) {
  return hash(clientIp(req));
}

function deviceName(req) {
  const ua = String(req.get?.('user-agent') || '').slice(0, 300);
  if (/iphone|ipad/i.test(ua)) return 'Apple mobile device';
  if (/android/i.test(ua)) return 'Android device';
  if (/edg/i.test(ua)) return 'Microsoft Edge';
  if (/chrome/i.test(ua)) return 'Google Chrome';
  if (/safari/i.test(ua)) return 'Safari';
  if (/firefox/i.test(ua)) return 'Firefox';
  return 'Unknown device';
}

function audit(userId, eventType, req, detail) {
  db.prepare(`INSERT INTO account_security_events
    (id,user_id,event_type,detail,ip_hash,device_name) VALUES (?,?,?,?,?,?)`)
    .run(randomUUID(), userId || null, String(eventType).slice(0, 80), detail ? JSON.stringify(detail).slice(0, 2000) : null,
      req ? ipHash(req) : null, req ? deviceName(req) : null);
}

function startSession(req, userId, authMethod, options = {}) {
  const now = new Date().toISOString();
  const currentDevice = deviceName(req);
  const currentIpHash = ipHash(req);
  const known = db.prepare(`SELECT 1 FROM user_sessions
    WHERE user_id=? AND device_name=? AND ip_hash=? AND revoked_at IS NULL LIMIT 1`)
    .get(userId, currentDevice, currentIpHash);
  const sid = randomUUID();
  db.prepare(`INSERT INTO user_sessions
    (id,user_id,device_name,user_agent,ip_hash,auth_method,created_at,last_seen_at,reauthenticated_at)
    VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(sid, userId, currentDevice, String(req.get?.('user-agent') || '').slice(0, 300), currentIpHash,
      String(authMethod || 'password').slice(0, 40), now, now, now);
  req.session.userId = userId;
  req.session.sid = sid;
  req.session.mfaPending = null;
  audit(userId, known ? 'login' : 'new_device_login', req, { auth_method: authMethod });
  return { sid, newDevice: !known && !options.initialRegistration, deviceName: currentDevice };
}

function validateSession(req) {
  if (!req.session?.userId) return { ok: false, error: 'not_signed_in' };
  const userId = req.session.userId;
  const user = db.prepare('SELECT suspended_at FROM users WHERE id=?').get(userId);
  if (!user) return { ok: false, error: 'not_signed_in' };
  if (user.suspended_at) return { ok:false,error:'account_suspended' };

  // Seamlessly move sessions issued before server-side device tracking into the
  // revocable model. The existing cookie is signed and HttpOnly.
  if (!req.session.sid) {
    startSession(req, userId, 'legacy_session');
  }
  const row = db.prepare('SELECT * FROM user_sessions WHERE id=? AND user_id=?').get(req.session.sid, userId);
  if (!row || row.revoked_at) return { ok: false, error: 'session_revoked' };
  const created = Date.parse(row.created_at);
  const seen = Date.parse(row.last_seen_at);
  if (!Number.isFinite(created) || Date.now() - created > ABSOLUTE_TIMEOUT_MS) return { ok: false, error: 'session_expired' };
  if (!Number.isFinite(seen) || Date.now() - seen > IDLE_TIMEOUT_MS) return { ok: false, error: 'session_inactive' };
  if (Date.now() - seen > 5 * 60 * 1000) {
    db.prepare('UPDATE user_sessions SET last_seen_at=? WHERE id=?').run(new Date().toISOString(), row.id);
  }
  return { ok: true, row };
}

function endSession(req, reason = 'logout') {
  if (req.session?.sid) db.prepare('UPDATE user_sessions SET revoked_at=?, revoked_reason=? WHERE id=? AND revoked_at IS NULL')
    .run(new Date().toISOString(), reason, req.session.sid);
}

function listSessions(userId, currentId) {
  return db.prepare(`SELECT id,device_name,auth_method,created_at,last_seen_at,reauthenticated_at
    FROM user_sessions WHERE user_id=? AND revoked_at IS NULL ORDER BY last_seen_at DESC`).all(userId)
    .map(row => ({ ...row, current: row.id === currentId }));
}

function revokeSession(userId, sessionId, reason = 'remote_logout') {
  return db.prepare(`UPDATE user_sessions SET revoked_at=?,revoked_reason=?
    WHERE id=? AND user_id=? AND revoked_at IS NULL`).run(new Date().toISOString(), reason, sessionId, userId).changes > 0;
}

function revokeOtherSessions(userId, currentId) {
  return db.prepare(`UPDATE user_sessions SET revoked_at=?,revoked_reason='logout_others'
    WHERE user_id=? AND id<>? AND revoked_at IS NULL`).run(new Date().toISOString(), userId, currentId || '').changes;
}

function recentlyReauthenticated(req, minutes = 10) {
  if (!req.session?.sid) return false;
  const row = db.prepare('SELECT reauthenticated_at FROM user_sessions WHERE id=? AND user_id=? AND revoked_at IS NULL')
    .get(req.session.sid, req.session.userId);
  return !!row && Date.now() - Date.parse(row.reauthenticated_at) <= minutes * 60 * 1000;
}

function markReauthenticated(req) {
  const now = new Date().toISOString();
  db.prepare('UPDATE user_sessions SET reauthenticated_at=? WHERE id=? AND user_id=?').run(now, req.session.sid, req.session.userId);
}

function loginKey(req, email) { return hash(`${ipHash(req)}|${String(email || '').toLowerCase()}`); }

function loginAllowed(req, email) {
  const row = db.prepare('SELECT * FROM login_attempts WHERE attempt_key=?').get(loginKey(req, email));
  if (!row?.blocked_until) return { ok: true };
  const retryMs = Date.parse(row.blocked_until) - Date.now();
  return retryMs > 0 ? { ok: false, retryAfter: Math.max(1, Math.ceil(retryMs / 1000)) } : { ok: true };
}

function recordLoginFailure(req, email) {
  const key = loginKey(req, email);
  const old = db.prepare('SELECT * FROM login_attempts WHERE attempt_key=?').get(key);
  const now = new Date();
  const first = old?.first_failure_at && now - new Date(old.first_failure_at) < 60 * 60 * 1000 ? old.first_failure_at : now.toISOString();
  const failures = first === old?.first_failure_at ? Number(old.failures || 0) + 1 : 1;
  const delaySeconds = failures < 5 ? 0 : Math.min(3600, 2 ** Math.min(12, failures - 5));
  const blockedUntil = delaySeconds ? new Date(now.getTime() + delaySeconds * 1000).toISOString() : null;
  db.prepare(`INSERT INTO login_attempts(attempt_key,failures,first_failure_at,last_failure_at,blocked_until)
    VALUES(?,?,?,?,?) ON CONFLICT(attempt_key) DO UPDATE SET failures=excluded.failures,
    first_failure_at=excluded.first_failure_at,last_failure_at=excluded.last_failure_at,blocked_until=excluded.blocked_until`)
    .run(key, failures, first, now.toISOString(), blockedUntil);
  audit(null, 'login_failed', req, { email_hash: hash(String(email || '').toLowerCase()), failures });
  return { failures, retryAfter: delaySeconds };
}

function clearLoginFailures(req, email) {
  db.prepare('DELETE FROM login_attempts WHERE attempt_key=?').run(loginKey(req, email));
}

function passwordPolicy(password) {
  const value = String(password || '');
  if (value.length < 12) return { ok: false, hint: 'Use at least 12 characters.' };
  if (value.length > 256) return { ok: false, hint: 'Password is too long.' };
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter(re => re.test(value)).length;
  if (classes < 3) return { ok: false, hint: 'Use at least three of: lowercase, uppercase, number, or symbol.' };
  const common = new Set(['password123!', 'password1234', 'functioningfaith', 'qwerty123456']);
  if (common.has(value.toLowerCase())) return { ok: false, hint: 'Choose a less common password.' };
  return { ok: true };
}

function ageFromDob(value) {
  const dob = new Date(`${String(value || '')}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) || Number.isNaN(dob.getTime()) || dob > new Date()) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  if (now.getUTCMonth() < dob.getUTCMonth() || (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() < dob.getUTCDate())) age--;
  return age;
}

function privacy(userId) {
  return db.prepare(`SELECT profile_visibility,follower_list_visibility,message_permission,
    tag_permission,comment_permission FROM users WHERE id=?`).get(userId);
}

function updatePrivacy(userId, values) {
  const current = privacy(userId);
  const next = { ...current };
  for (const [key, choices] of Object.entries(PRIVACY_VALUES)) {
    if (values[key] != null) {
      if (!choices.has(values[key])) throw Object.assign(new Error(`Invalid ${key}`), { code: 'invalid_privacy_setting' });
      next[key] = values[key];
    }
  }
  db.prepare(`UPDATE users SET profile_visibility=?,follower_list_visibility=?,message_permission=?,
    tag_permission=?,comment_permission=? WHERE id=?`).run(next.profile_visibility,next.follower_list_visibility,
      next.message_permission,next.tag_permission,next.comment_permission,userId);
  return next;
}

function relationship(actorId, subjectId, control, enabled) {
  if (!['mute', 'restrict'].includes(control) || !subjectId || actorId === subjectId) return false;
  if (enabled) db.prepare('INSERT OR IGNORE INTO account_relationship_controls(actor_id,subject_id,control) VALUES(?,?,?)').run(actorId,subjectId,control);
  else db.prepare('DELETE FROM account_relationship_controls WHERE actor_id=? AND subject_id=? AND control=?').run(actorId,subjectId,control);
  return true;
}

function hasRelationship(actorId, subjectId, control) {
  return !!db.prepare('SELECT 1 FROM account_relationship_controls WHERE actor_id=? AND subject_id=? AND control=?').get(actorId,subjectId,control);
}

function encryptionKey() {
  const source = process.env.DATA_ENCRYPTION_KEY || process.env.MFA_ENCRYPTION_KEY || process.env.SESSION_SECRET;
  if (!source) return null;
  return createHash('sha256').update(source).digest();
}

function encrypt(value) {
  const key = encryptionKey();
  if (!key) throw Object.assign(new Error('MFA encryption is not configured.'), { code: 'mfa_not_configured' });
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${body.toString('base64url')}`;
}

function decrypt(value) {
  const [iv, tag, body] = String(value || '').split('.').map(x => Buffer.from(x, 'base64url'));
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv); decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}
function protectSecret(value){return value==null?null:encrypt(value);}
function unprotectSecret(value){if(value==null)return null;if(String(value).split('.').length!==3)return String(value);try{return decrypt(value);}catch{throw Object.assign(new Error('Stored integration credential could not be decrypted.'),{code:'credential_decryption_failed'});}}

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(buf) {
  let bits = '', out = '';
  for (const byte of buf) bits += byte.toString(2).padStart(8, '0');
  for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  return out;
}
function base32Decode(value) {
  let bits = '';
  for (const char of String(value).replace(/=+$/,'').toUpperCase()) { const i=B32.indexOf(char); if(i<0) throw new Error('invalid_base32'); bits += i.toString(2).padStart(5,'0'); }
  const bytes=[]; for(let i=0;i+8<=bits.length;i+=8) bytes.push(parseInt(bits.slice(i,i+8),2)); return Buffer.from(bytes);
}
function totp(secret, counter = Math.floor(Date.now() / 30000)) {
  const msg=Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(counter));
  const digest=createHmac('sha1',base32Decode(secret)).update(msg).digest(); const off=digest[digest.length-1]&15;
  return String((((digest[off]&127)<<24)|((digest[off+1]&255)<<16)|((digest[off+2]&255)<<8)|(digest[off+3]&255))%1000000).padStart(6,'0');
}
function safeEqualText(a,b){ const x=Buffer.from(String(a)),y=Buffer.from(String(b)); return x.length===y.length&&timingSafeEqual(x,y); }

function beginMfa(userId, email) {
  const secret=base32Encode(randomBytes(20));
  db.prepare(`INSERT INTO user_mfa(user_id,secret_cipher,enabled_at,last_counter) VALUES(?,?,NULL,-1)
    ON CONFLICT(user_id) DO UPDATE SET secret_cipher=excluded.secret_cipher,enabled_at=NULL,last_counter=-1`).run(userId,encrypt(secret));
  return { secret, otpauth_uri:`otpauth://totp/${encodeURIComponent('Functioning Faith:'+email)}?secret=${secret}&issuer=${encodeURIComponent('Functioning Faith')}` };
}
function mfaEnabled(userId){ return !!db.prepare('SELECT 1 FROM user_mfa WHERE user_id=? AND enabled_at IS NOT NULL').get(userId); }
function verifyMfa(userId, code, allowPending=false) {
  const row=db.prepare(`SELECT * FROM user_mfa WHERE user_id=? ${allowPending?'':'AND enabled_at IS NOT NULL'}`).get(userId);
  if (!row) return false;
  const normalized=String(code||'').replace(/\s|-/g,'');
  if (/^\d{6}$/.test(normalized)) {
    const secret=decrypt(row.secret_cipher); const current=Math.floor(Date.now()/30000);
    for(let offset=-1;offset<=1;offset++){ const counter=current+offset; if(counter>row.last_counter&&safeEqualText(totp(secret,counter),normalized)){ db.prepare('UPDATE user_mfa SET last_counter=? WHERE user_id=?').run(counter,userId); return true; } }
  }
  if (!allowPending && /^[A-Z0-9]{10}$/.test(normalized.toUpperCase())) {
    const codeHash=hash(normalized.toUpperCase()); const backup=db.prepare('SELECT 1 FROM mfa_backup_codes WHERE user_id=? AND code_hash=? AND used_at IS NULL').get(userId,codeHash);
    if(backup){ db.prepare('UPDATE mfa_backup_codes SET used_at=? WHERE user_id=? AND code_hash=?').run(new Date().toISOString(),userId,codeHash); return true; }
  }
  return false;
}
function enableMfa(userId, code) {
  if(!verifyMfa(userId,code,true)) return null;
  const codes=Array.from({length:10},()=>randomBytes(5).toString('hex').toUpperCase());
  const now=new Date().toISOString();
  db.prepare('UPDATE user_mfa SET enabled_at=? WHERE user_id=?').run(now,userId);
  db.prepare('DELETE FROM mfa_backup_codes WHERE user_id=?').run(userId);
  const insert=db.prepare('INSERT INTO mfa_backup_codes(user_id,code_hash) VALUES(?,?)'); codes.forEach(c=>insert.run(userId,hash(c)));
  return codes;
}
function disableMfa(userId){ db.prepare('DELETE FROM mfa_backup_codes WHERE user_id=?').run(userId); db.prepare('DELETE FROM user_mfa WHERE user_id=?').run(userId); }

function securityEvents(userId) {
  return db.prepare('SELECT event_type,detail,device_name,created_at FROM account_security_events WHERE user_id=? ORDER BY created_at DESC LIMIT 100').all(userId)
    .map(r=>({...r,detail:r.detail?JSON.parse(r.detail):null}));
}

async function requestPasswordReset(email, baseUrl, req) {
  const user=db.prepare('SELECT id,email FROM users WHERE lower(email)=lower(?)').get(String(email||'').trim());
  if(!user||!process.env.RESEND_API_KEY||!process.env.EMAIL_FROM) return { queued:false };
  const token=randomBytes(32).toString('base64url'),now=new Date(),expires=new Date(now.getTime()+20*60*1000).toISOString();
  db.prepare("DELETE FROM password_reset_tokens WHERE user_id=? OR expires_at<datetime('now')").run(user.id);
  db.prepare('INSERT INTO password_reset_tokens(id,user_id,token_hash,expires_at) VALUES(?,?,?,?)').run(randomUUID(),user.id,hash(token),expires);
  const link=`${String(baseUrl).replace(/\/$/,'')}/?reset_token=${encodeURIComponent(token)}`;
  const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{authorization:`Bearer ${process.env.RESEND_API_KEY}`,'content-type':'application/json'},
    body:JSON.stringify({from:process.env.EMAIL_FROM||'Functioning Faith <security@functioningfaith.com>',to:[user.email],subject:'Reset your Functioning Faith password',
      html:`<p>A password reset was requested for your Functioning Faith account.</p><p><a href="${link}">Reset password</a></p><p>This link expires in 20 minutes. If you did not request it, no action is needed.</p>`}),signal:AbortSignal.timeout(8000)});
  if(!response.ok) throw new Error('recovery_email_failed');
  audit(user.id,'password_reset_requested',req);
  return { queued:true };
}

function consumePasswordReset(token) {
  const row=db.prepare("SELECT * FROM password_reset_tokens WHERE token_hash=? AND used_at IS NULL AND expires_at>datetime('now')").get(hash(String(token||'')));
  if(!row) return null;
  db.prepare('UPDATE password_reset_tokens SET used_at=? WHERE id=?').run(new Date().toISOString(),row.id);
  revokeOtherSessions(row.user_id,'');
  return row.user_id;
}

function issueNativeAuthCode(userId, authMethod, handoffChallenge) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(String(handoffChallenge || ''))) {
    throw Object.assign(new Error('Invalid native handoff challenge.'), { code: 'invalid_handoff_challenge' });
  }
  const code = randomBytes(32).toString('base64url');
  const now = new Date();
  db.prepare("DELETE FROM native_auth_codes WHERE used_at IS NOT NULL OR expires_at<datetime('now')").run();
  db.prepare(`INSERT INTO native_auth_codes
    (id,user_id,code_hash,handoff_challenge,auth_method,expires_at) VALUES(?,?,?,?,?,?)`)
    .run(randomUUID(), userId, hash(code), handoffChallenge, String(authMethod || 'oauth').slice(0, 40),
      new Date(now.getTime() + 2 * 60 * 1000).toISOString());
  return code;
}

function consumeNativeAuthCode(code, handoffVerifier) {
  const challenge = createHash('sha256').update(String(handoffVerifier || '')).digest('base64url');
  const row = db.prepare(`SELECT * FROM native_auth_codes
    WHERE code_hash=? AND used_at IS NULL AND expires_at>datetime('now')`).get(hash(String(code || '')));
  if (!row || !safeEqualText(row.handoff_challenge, challenge)) return null;
  const changed = db.prepare('UPDATE native_auth_codes SET used_at=? WHERE id=? AND used_at IS NULL')
    .run(new Date().toISOString(), row.id).changes;
  return changed === 1 ? { userId: row.user_id, authMethod: row.auth_method } : null;
}

module.exports = {
  init, audit, startSession, validateSession, endSession, listSessions, revokeSession, revokeOtherSessions,
  recentlyReauthenticated, markReauthenticated, loginAllowed, recordLoginFailure, clearLoginFailures,
  passwordPolicy, ageFromDob, privacy, updatePrivacy, relationship, hasRelationship,
  beginMfa, enableMfa, verifyMfa, disableMfa, mfaEnabled, securityEvents,
  requestPasswordReset,consumePasswordReset,
  issueNativeAuthCode,consumeNativeAuthCode,
  protectSecret,unprotectSecret,
  TERMS_VERSION, IDLE_TIMEOUT_MS, ABSOLUTE_TIMEOUT_MS,
};
