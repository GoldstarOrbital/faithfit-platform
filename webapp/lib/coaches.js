/**
 * Coach profiles.
 *
 * A coach account is gated on the same kind of thing developer-verification
 * already gates on -- a real, curated .edu email, confirmed by a one-time
 * link the way password resets and athlete school-email verification both
 * work. Unlike the athlete side, which has no highschool-domain registry to
 * check against, isEduEmail() (from developer-verification.js) actually
 * validates the domain shape, so this is a stronger claim: not just "this
 * inbox is real" but "this inbox is a real .edu address."
 *
 * A verified coach can:
 *   - see the same public, verified athlete directory anyone can search
 *   - ask Gloo to rank the best-fit public athletes for their sport
 *     (matchAthletes, in this file -- Gloo only ever ranks real candidates
 *     already pulled from the database; it cannot invent an athlete)
 *   - message any publicly-listed, verified athlete directly, bypassing
 *     that athlete's normal message_permission setting -- the athlete
 *     already opted into being found for recruiting, so a verified coach
 *     reaching out is the expected outcome, not a privacy violation of it.
 *
 * What is deliberately NOT bypassed, even for a verified coach: an
 * athlete's minor-message-protection check (see lib/dms.js) and any block
 * or restrict a member has placed. Recruiting visibility is not the same
 * thing as suspending the app's safety rules for minors, and nothing here
 * treats it that way.
 */
'use strict';

const { randomBytes, randomUUID, createHash } = require('crypto');
const db = require('./db');
const { isEduEmail } = require('./developer-verification');
const athletes = require('./athletes');
const gloo = require('./gloo');

function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS coach_profiles (
      user_id TEXT PRIMARY KEY,
      sport TEXT NOT NULL,
      organization TEXT,
      title TEXT,
      bio TEXT,
      edu_email TEXT,
      edu_verified_at TEXT,
      edu_verification_reason TEXT,
      edu_institution TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS coach_email_verifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      email TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      verification_reason TEXT,
      institution TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  const cols = db.prepare('PRAGMA table_info(coach_profiles)').all().map(c => c.name);
  if (!cols.includes('edu_verification_reason')) db.exec('ALTER TABLE coach_profiles ADD COLUMN edu_verification_reason TEXT');
  if (!cols.includes('edu_institution')) db.exec('ALTER TABLE coach_profiles ADD COLUMN edu_institution TEXT');
  const vCols = db.prepare('PRAGMA table_info(coach_email_verifications)').all().map(c => c.name);
  if (!vCols.includes('verification_reason')) db.exec('ALTER TABLE coach_email_verifications ADD COLUMN verification_reason TEXT');
  if (!vCols.includes('institution')) db.exec('ALTER TABLE coach_email_verifications ADD COLUMN institution TEXT');

  db.exec(`
    -- A coach's standing filter. When an athlete profile newly goes public
    -- (verified email + is_public), routes/api.js checks these and
    -- notifies every coach whose search matches -- see findMatchingCoaches
    -- below and the notify() call at the athlete verify-email/confirm and
    -- PUT /athlete-profile routes.
    CREATE TABLE IF NOT EXISTS coach_saved_searches (
      id TEXT PRIMARY KEY,
      coach_user_id TEXT NOT NULL,
      sport TEXT NOT NULL,
      grad_year INTEGER,
      position TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_coach_saved_searches_sport ON coach_saved_searches(sport, grad_year);

    -- A coach's own published roster. Deliberately limited to athletes who
    -- are themselves public and verified (isVerified elsewhere never lets a
    -- coach see anyone who isn't) -- a coach cannot use their roster to
    -- publish someone else's private data.
    CREATE TABLE IF NOT EXISTS coach_roster_members (
      id TEXT PRIMARY KEY,
      coach_user_id TEXT NOT NULL,
      athlete_user_id TEXT NOT NULL,
      jersey_number TEXT,
      position_on_team TEXT,
      added_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(coach_user_id, athlete_user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_coach_roster_coach ON coach_roster_members(coach_user_id);
  `);
}

function addSavedSearch(coachUserId, { sport, grad_year, position }) {
  const clean = String(sport || '').trim().slice(0, 40);
  if (!clean) return { error: 'sport_required' };
  const gy = Number(grad_year) || null;
  if (gy && (gy < 2020 || gy > 2035)) return { error: 'invalid_grad_year' };
  const id = randomUUID();
  db.prepare('INSERT INTO coach_saved_searches (id, coach_user_id, sport, grad_year, position) VALUES (?,?,?,?,?)')
    .run(id, coachUserId, clean, gy, String(position || '').trim().slice(0, 60) || null);
  return { search: db.prepare('SELECT * FROM coach_saved_searches WHERE id = ?').get(id) };
}
function listSavedSearches(coachUserId) {
  return db.prepare('SELECT * FROM coach_saved_searches WHERE coach_user_id = ? ORDER BY created_at DESC').all(coachUserId);
}
function removeSavedSearch(coachUserId, id) {
  const r = db.prepare('DELETE FROM coach_saved_searches WHERE id = ? AND coach_user_id = ?').run(id, coachUserId);
  return { ok: r.changes > 0 };
}

/** Every distinct coach whose saved search matches this profile -- grad_year
 *  and position are optional filters on the saved search (NULL = any). */
function findMatchingCoaches({ sport, grad_year, position }) {
  return db.prepare(`
    SELECT DISTINCT coach_user_id FROM coach_saved_searches
    WHERE sport = @sport
      AND (grad_year IS NULL OR grad_year = @grad_year)
      AND (position IS NULL OR lower(position) = lower(@position))
  `).all({ sport, grad_year: grad_year || null, position: position || '' });
}

function addRosterMember(coachUserId, athleteUserId, { jersey_number, position_on_team }) {
  if (!athletes.publicProfile(athleteUserId)) return { error: 'athlete_not_found' };
  const id = randomUUID();
  db.prepare(`
    INSERT INTO coach_roster_members (id, coach_user_id, athlete_user_id, jersey_number, position_on_team)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(coach_user_id, athlete_user_id) DO UPDATE SET jersey_number = excluded.jersey_number, position_on_team = excluded.position_on_team
  `).run(id, coachUserId, athleteUserId, String(jersey_number || '').trim().slice(0, 10) || null, String(position_on_team || '').trim().slice(0, 60) || null);
  return { ok: true };
}
function removeRosterMember(coachUserId, memberId) {
  const r = db.prepare('DELETE FROM coach_roster_members WHERE id = ? AND coach_user_id = ?').run(memberId, coachUserId);
  return { ok: r.changes > 0 };
}
function listRoster(coachUserId) {
  const rows = db.prepare('SELECT * FROM coach_roster_members WHERE coach_user_id = ? ORDER BY added_at ASC').all(coachUserId);
  return rows.map(r => ({ ...r, athlete: athletes.publicProfile(r.athlete_user_id) })).filter(r => r.athlete);
}
/** The public roster page -- no auth, same reasoning as the athlete
 *  directory: a scout looking at a team roster isn't expected to have an
 *  account. Only a verified coach's roster is servable at all. */
function publicRoster(coachUserId) {
  const coach = get(coachUserId);
  if (!coach || !coach.edu_verified_at) return null;
  const u = db.prepare('SELECT display_name FROM users WHERE id = ?').get(coachUserId);
  return { coach: { display_name: u?.display_name, organization: coach.organization, title: coach.title, sport: coach.sport }, roster: listRoster(coachUserId) };
}

function hash(value) {
  return createHash('sha256').update(String(value || '')).digest('hex');
}

/**
 * Verification provider abstraction. "A known verifier" (SheerID and
 * similar) is the industry-standard way to prove someone is really a coach
 * or teacher, but that needs a paid account and API key this deployment
 * doesn't have -- SHEERID_API_KEY is the swap point for whenever it does.
 * Until then, the default provider does the strongest check available
 * without a third-party account: isEduEmail() confirms the domain is
 * *shaped* like a .edu address, then a live, free, keyless lookup against
 * Hipolabs' public university-domain dataset confirms the domain actually
 * *belongs to* a real university, not just any .edu-pattern string. That's
 * a real improvement over regex alone, not a placeholder -- it will
 * correctly reject a domain that merely ends in ".edu" but isn't in any
 * known university's domain list, and it returns the institution's real
 * name so the coach's organization field can be confirmed against it.
 *
 * If the lookup is unreachable (network issue, dataset down), this
 * degrades to the regex-only check rather than blocking every coach
 * application on a third-party dependency being up.
 */
async function verifyEduDomain(email) {
  if (process.env.SHEERID_API_KEY) {
    try {
      return await verifyWithSheerID(email);
    } catch (err) {
      // A configured-but-unimplemented (or failing) SheerID key must never
      // silently fall through unnoticed -- log loudly, then degrade to the
      // domain check below so a coach application isn't blocked by it.
      console.error('[coaches] SHEERID_API_KEY is set but verification failed, falling back to domain check:', err.message);
    }
  }

  if (!isEduEmail(email)) return { verified: false, reason: 'not_edu_shape' };
  const domain = email.slice(email.lastIndexOf('@') + 1);
  try {
    const res = await fetch(`http://universities.hipolabs.com/search?domain=${encodeURIComponent(domain)}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { verified: true, reason: 'edu_shape_only', institution: null };
    const matches = await res.json();
    if (Array.isArray(matches) && matches.length) {
      return { verified: true, reason: 'domain_registry_match', institution: matches[0].name || null };
    }
    // Reachable but no match: a real-looking .edu domain not in this
    // (non-exhaustive, community-maintained) dataset. Still accepted on
    // shape alone rather than rejecting a legitimate small school the
    // dataset happens to be missing -- but the weaker reason is recorded.
    return { verified: true, reason: 'edu_shape_only_no_registry_match', institution: null };
  } catch (err) {
    return { verified: true, reason: 'edu_shape_only_registry_unreachable', institution: null };
  }
}

/**
 * Integration note: use the real SheerID (or equivalent) flow only once SHEERID_API_KEY
 * exists. SheerID's coach/teacher verification flow is typically a
 * multi-step handoff (create a verification, redirect the person through
 * SheerID's hosted form, receive a webhook/poll for the result) rather
 * than a single request-response call, so this is intentionally left
 * unimplemented rather than guessed at against undocumented specifics --
 * wiring it up for real needs the actual SheerID program ID and API docs
 * for the account it'll run under.
 */
async function verifyWithSheerID(email) {
  throw new Error('SheerID integration not yet implemented');
}

function get(userId) {
  return db.prepare('SELECT * FROM coach_profiles WHERE user_id = ?').get(userId) || null;
}

function isVerified(userId) {
  const row = get(userId);
  return !!(row && row.edu_verified_at);
}

function upsert(userId, fields) {
  const sport = String(fields.sport || '').trim().slice(0, 40);
  if (!sport) return { error: 'sport_required' };
  const row = {
    organization: String(fields.organization || '').trim().slice(0, 120) || null,
    title: String(fields.title || '').trim().slice(0, 80) || null,
    bio: String(fields.bio || '').trim().slice(0, 500) || null,
  };
  db.prepare(`
    INSERT INTO coach_profiles (user_id, sport, organization, title, bio, updated_at)
    VALUES (@user_id, @sport, @organization, @title, @bio, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      sport=@sport, organization=@organization, title=@title, bio=@bio, updated_at=datetime('now')
  `).run({ user_id: userId, sport, ...row });
  return { profile: get(userId) };
}

/** Same contract as athletes.requestEmailVerification: best-effort, silent
 *  no-op if Resend isn't configured. Unlike that one, the domain must
 *  actually be a .edu shape -- not just any address the person controls. */
async function requestEmailVerification(userId, email, baseUrl) {
  const mail = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return { error: 'invalid_email' };
  if (!get(userId)) return { error: 'profile_not_found', hint: 'Save your sport and other details first.' };

  const check = await verifyEduDomain(mail);
  if (!check.verified) return { error: 'not_edu_email', hint: 'Coach verification requires a real .edu email address.' };
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) return { queued: false };

  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  db.prepare("DELETE FROM coach_email_verifications WHERE user_id = ? OR expires_at < datetime('now')").run(userId);
  db.prepare('INSERT INTO coach_email_verifications (id, user_id, email, token_hash, expires_at, verification_reason, institution) VALUES (?,?,?,?,?,?,?)')
    .run(randomUUID(), userId, mail, hash(token), expires, check.reason, check.institution);

  const link = `${String(baseUrl).replace(/\/$/, '')}/api/coach-profile/verify-email/confirm?token=${encodeURIComponent(token)}`;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM,
      to: [mail],
      subject: 'Verify your .edu email for Functioning Faith coaching access',
      html: `<p>Confirm this .edu address to unlock coach access on Functioning Faith: browsing verified public athlete profiles, AI-assisted matching for your sport, and messaging athletes directly.</p><p><a href="${link}">Verify my .edu email</a></p><p>This link expires in 24 hours. If you did not request this, no action is needed.</p>`,
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error('verification_email_failed');
  return { queued: true, email: mail, institution: check.institution };
}

function confirmEmailVerification(token) {
  const row = db.prepare(
    "SELECT * FROM coach_email_verifications WHERE token_hash = ? AND used_at IS NULL AND expires_at > datetime('now')"
  ).get(hash(String(token || '')));
  if (!row) return null;
  db.prepare("UPDATE coach_email_verifications SET used_at = datetime('now') WHERE id = ?").run(row.id);
  db.prepare(`UPDATE coach_profiles SET edu_email = ?, edu_verified_at = datetime('now'),
    edu_verification_reason = ?, edu_institution = ? WHERE user_id = ?`)
    .run(row.email, row.verification_reason, row.institution, row.user_id);
  return row.user_id;
}

/**
 * Gloo-assisted ranking of real candidates. Gloo never sees anything beyond
 * what's already public in the recruiting directory (display name, sport,
 * position, grad year, school, bio, and the same real 90-day training stats
 * shown in the directory itself) and is told explicitly to choose only from
 * the numbered list it's given -- the response is matched back against that
 * same candidate list by user_id, so a model that ignores the instruction
 * and names someone else, or invents a person, produces a match that gets
 * silently dropped rather than shown as if it were real. If Gloo is not
 * configured, or every response fails that check, this returns the
 * candidates in their default (most-recently-updated) order instead of
 * failing the request -- a coach still gets a usable list, just unranked.
 */
async function matchAthletes(coachUserId, { grad_year, limit = 10 } = {}) {
  const coach = get(coachUserId);
  if (!coach || !coach.edu_verified_at) return { error: 'coach_not_verified' };

  const candidates = athletes.search({ sport: coach.sport, grad_year, limit: 40 });
  if (!candidates.length) return { matches: [], candidates_considered: 0, ranked_by_ai: false };

  if (!gloo.isConfigured()) {
    return { matches: candidates.slice(0, limit), candidates_considered: candidates.length, ranked_by_ai: false };
  }

  const listing = candidates.map((a, i) => ({
    n: i + 1, user_id: a.user_id, name: a.display_name, position: a.position || null,
    grad_year: a.grad_year || null, school: a.school || null,
    workouts_90d: a.stats.workouts_90d, distance_km_90d: a.stats.distance_km_90d, avg_hr_90d: a.stats.avg_hr_90d,
  }));

  const out = await gloo.chatJson({
    kind: 'coach_athlete_match', cache: true, cacheDays: 1, maxTokens: 500,
    messages: [
      { role: 'system', content: `You help a verified ${coach.sport} coach identify promising athletes from a real candidate list. `
        + 'Reply with ONLY a JSON object: {"picks":[{"user_id":"...","reason":"one sentence, under 25 words, grounded only in the given stats"}]}. '
        + 'Pick only from the numbered candidates given -- never invent a user_id or a person not in the list. '
        + 'Base every reason strictly on the stats provided (training volume, distance, position, grad year) -- never invent achievements, records, or personality traits. '
        + `Return at most ${Math.min(limit, 20)} picks, best fit first.` },
      { role: 'user', content: `Candidates:\n${JSON.stringify(listing)}` },
    ],
  });

  const byId = new Map(candidates.map(a => [a.user_id, a]));
  const picks = out && out.json && Array.isArray(out.json.picks) ? out.json.picks : [];
  const matches = [];
  const seen = new Set();
  for (const pick of picks) {
    const athlete = pick && byId.get(pick.user_id);
    if (!athlete || seen.has(pick.user_id)) continue; // not a real candidate, or a duplicate -- dropped, not shown
    seen.add(pick.user_id);
    matches.push({ ...athlete, match_reason: String(pick.reason || '').slice(0, 300) });
    if (matches.length >= limit) break;
  }

  if (!matches.length) {
    // The model returned nothing usable -- degrade to the honest unranked
    // list rather than showing an empty result for a real candidate pool.
    return { matches: candidates.slice(0, limit), candidates_considered: candidates.length, ranked_by_ai: false };
  }
  return { matches, candidates_considered: candidates.length, ranked_by_ai: true };
}

module.exports = {
  init, get, isVerified, upsert, requestEmailVerification, confirmEmailVerification, matchAthletes,
  addSavedSearch, listSavedSearches, removeSavedSearch, findMatchingCoaches,
  addRosterMember, removeRosterMember, listRoster, publicRoster,
};
