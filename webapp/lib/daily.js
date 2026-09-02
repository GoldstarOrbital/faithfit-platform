/**
 * The morning verse.
 *
 * The one part of this app that reaches someone who is not using it. Everything
 * else waits to be opened; this arrives.
 *
 * It is also where both platforms do their most ordinary and most useful work
 * together: Gloo chooses a verse against what the member actually did this week
 * and their own tradition, YouVersion supplies the text, and web push carries it
 * to a locked phone. The notification links back to that verse's thread, so the
 * path from a lock screen to a conversation with other people is one tap.
 *
 * Cheap by construction: one Gloo call per member per day at most, and members
 * with no push subscription are never considered at all.
 */
'use strict';

const db = require('./db');
const push = require('./push');
const gloo = require('./gloo');
const companion = require('./companion');

// Scripture for a morning, grouped by what the past week actually looked like.
// Each list is authored; Gloo chooses among them, and the choice is checked.
const POOLS = {
  consistent: {
    label: 'A steady week behind them',
    refs: ['Galatians 6:9', '1 Corinthians 15:58', 'Proverbs 13:4', 'Colossians 3:23', 'Psalm 90:17'],
  },
  returning: {
    label: 'Back after a gap',
    refs: ['Lamentations 3:23', 'Isaiah 43:19', 'Philippians 3:13', 'Joel 2:25', 'Psalm 51:12'],
  },
  resting: {
    label: 'A quiet week',
    refs: ['Psalm 23:2', 'Mark 6:31', 'Matthew 11:28', 'Exodus 33:14', 'Psalm 127:2'],
  },
  starting: {
    label: 'New here',
    refs: ['Jeremiah 29:11', 'Proverbs 3:5', 'Psalm 143:8', 'Isaiah 40:31', 'Philippians 1:6'],
  },
};

/**
 * What kind of week has this member had?
 *
 * Counted from real workouts, never inferred. The distinction that matters is
 * `resting` vs `returning`: a quiet week for someone who has been consistent
 * for months is rest, and telling them to get back on track would be both wrong
 * and unkind.
 */
function weekShape(userId) {
  const q = (sql, ...a) => { try { return db.prepare(sql).get(...a); } catch { return null; } };
  const week = q(`SELECT COUNT(*) c FROM workouts WHERE user_id = ?
                    AND start_time > datetime('now','-7 days')`, userId);
  const prior = q(`SELECT COUNT(*) c FROM workouts WHERE user_id = ?
                     AND start_time <= datetime('now','-7 days')
                     AND start_time > datetime('now','-35 days')`, userId);
  const ever = q('SELECT COUNT(*) c FROM workouts WHERE user_id = ?', userId);

  const w = week ? week.c : 0, p = prior ? prior.c : 0, e = ever ? ever.c : 0;
  if (e === 0) return { pool: 'starting', facts: ['no workouts logged yet'] };
  if (w >= 3) return { pool: 'consistent', facts: [`${w} workouts in the last 7 days`] };
  if (w === 0 && p >= 4) {
    return { pool: 'resting', facts: ['a quiet week', `${p} workouts in the month before it`] };
  }
  if (w === 0 && p === 0) return { pool: 'returning', facts: ['no workouts for over a month'] };
  if (w >= 1 && p === 0) return { pool: 'returning', facts: [`${w} workout(s) this week, after a long gap`] };
  return { pool: 'consistent', facts: [`${w} workout(s) in the last 7 days`] };
}

/** References this member has already had in a morning push recently. */
function recentRefs(userId, days) {
  try {
    return db.prepare(`SELECT body FROM push_log
                        WHERE user_id = ? AND category = 'daily_verse'
                          AND sent_at > datetime('now', ?)`)
      .all(userId, '-' + (Number(days) || 21) + ' days')
      .map(r => (/^([^—]+?)\s*—/.exec(r.body || '') || [])[1])
      .filter(Boolean).map(s => s.trim());
  } catch { return []; }
}

/**
 * Build and send one member's morning verse.
 * Returns null when there is nothing to send or nothing verified to send.
 */
async function sendFor(userId) {
  const webSubs = push.get(userId).filter(s => s.categories.includes('daily_verse'));
  const nativeOptedIn = db.prepare(`SELECT 1 FROM native_push_tokens
                                     WHERE user_id = ? AND platform = 'ios' AND categories LIKE '%daily_verse%'`)
    .get(userId);
  if (!webSubs.length && !nativeOptedIn) return null;  // never chosen, never sent

  const me = db.prepare('SELECT display_name, tradition, bible_version_id FROM users WHERE id = ?')
    .get(userId);
  if (!me) return null;

  const shape = weekShape(userId);
  // Real, measured listening data (Spotify's own audio-feature analysis),
  // when a member has connected it -- never a claim about how they feel,
  // only what was actually measured, same rule as every other fact here.
  const music = db.prepare('SELECT mood, worship_affinity FROM user_music_taste WHERE user_id = ?').get(userId);
  if (music?.mood === 'energized') shape.facts.push('recent listening has been upbeat and high-energy');
  else if (music?.mood === 'reflective') shape.facts.push('recent listening has been calm and reflective');
  else if (music?.mood === 'heavy') shape.facts.push('recent listening has trended toward heavier, more somber music');
  if (music?.worship_affinity) shape.facts.push('their own top artists already skew toward Christian worship music');
  const pool = POOLS[shape.pool];
  const seen = recentRefs(userId, 21);
  const candidates = pool.refs.filter(r => !seen.includes(r));
  if (!candidates.length) return null;           // rather nothing than a repeat

  let verse = null;
  if (gloo.isConfigured()) {
    try {
      verse = await companion.chooseVerse({
        kind: 'daily_verse',
        userId, tradition: me.tradition, versionId: me.bible_version_id,
        label: pool.label, blurb: 'The start of their day.',
        facts: shape.facts, candidates,
        framing: 'This arrives as a phone notification before they have opened ' +
                 'anything. Keep it warm and very short. Do not mention the app.',
      });
    } catch { verse = null; }
  }
  if (!verse) {
    // Authored fallback, resolved the same way as everything else.
    for (const ref of candidates) {
      const hit = await companion.resolveRef(ref, me.bible_version_id);
      if (hit) { verse = { reference: hit.reference, text: hit.text, note: null }; break; }
    }
  }
  if (!verse) return null;

  // Trimmed for a lock screen, but never mid-word and never presented as the
  // whole verse — the thread it links to carries the full text.
  const preview = verse.text.length > 140
    ? verse.text.slice(0, verse.text.lastIndexOf(' ', 137)) + '…'
    : verse.text;

  const res = await push.send(userId, 'daily_verse', {
    title: verse.reference,
    // The reference leads so `recentRefs` can read it back out.
    body: verse.reference + ' — ' + preview,
    url: '/?open=verse&ref=' + encodeURIComponent(verse.reference),
    tag: 'daily-verse',
  });
  return { reference: verse.reference, note: verse.note, ...res };
}

/**
 * Send to everyone due one.
 *
 * Deliberately keyed off local hour rather than a cron expression, because the
 * point is that it arrives in the morning where the member is. Without a stored
 * timezone we use the server's by default -- but a member can now set
 * `daily_verse_hour` (0-23, server-local) to pick their own hour instead of
 * the 6-10am default window, so this runs on every tick and decides who is
 * actually due itself, rather than the whole sweep being gated to one window.
 */
async function runOnce() {
  const h = new Date().getHours();
  const candidates = db.prepare(`
    SELECT ps.user_id AS user_id, u.daily_verse_hour AS daily_verse_hour
      FROM push_subscriptions ps JOIN users u ON u.id = ps.user_id
     WHERE ps.categories LIKE '%daily_verse%'
    UNION
    SELECT npt.user_id AS user_id, u.daily_verse_hour AS daily_verse_hour
      FROM native_push_tokens npt JOIN users u ON u.id = npt.user_id
     WHERE npt.platform = 'ios' AND npt.categories LIKE '%daily_verse%'
  `).all();
  let sent = 0;
  for (const { user_id: id, daily_verse_hour } of candidates) {
    // No preference set: keep the original default window. A preference
    // set: only that exact hour, whatever it is -- the whole point of
    // letting someone pick a time is that it stops arriving at the default one.
    const due = daily_verse_hour == null ? (h >= 6 && h < 10) : h === daily_verse_hour;
    if (!due) continue;
    // Once per member per day, whatever else happens.
    const already = db.prepare(`SELECT COUNT(*) c FROM push_log
                                 WHERE user_id = ? AND category = 'daily_verse'
                                   AND sent_at > datetime('now','-20 hours')`).get(id);
    if (already && already.c > 0) continue;
    try { if (await sendFor(id)) sent++; } catch { /* one member's failure is not everyone's */ }
    await new Promise(r => setTimeout(r, 200));       // be gentle on both APIs
  }
  if (sent) console.log('[daily] sent %d morning verse(s)', sent);
  return sent;
}

let timer = null;
function start() {
  // Web push (VAPID) and native iOS (APNs) are configured independently --
  // an APNs-only deployment (the normal case once this shipped as a native
  // app) must not sit dark just because no VAPID keypair was ever generated.
  if (!push.isConfigured() && !push.isNativeConfigured()) return;
  // Runs every tick now (not gated to a fixed hour range) since runOnce()
  // itself decides who is due, per-member, against their own chosen hour.
  timer = setInterval(() => runOnce().catch(() => {}), 30 * 60 * 1000);
  if (timer.unref) timer.unref();
  console.log('[daily] morning verse scheduled');
}

module.exports = { start, runOnce, sendFor, weekShape, POOLS };
