/**
 * "Scripture in Motion" -- the Home tab's daily invitation to a short
 * movement break, framed by one verse. Distinct from the live workout-trigger
 * pipeline (pipeline.js), which reacts to real biometric signals mid-session:
 * this is a single, stable pick for the day, shown whether or not the member
 * has worked out yet, so Home always has something to offer.
 *
 * Reuses daily.js's own weekly-consistency read (weekShape) so the theme
 * offered reflects the member's real recent pattern -- a quiet week gets
 * "Move with peace," not a push to perform.
 */
'use strict';

const db = require('./db');
const gloo = require('./gloo');
const companion = require('./companion');
const daily = require('./daily');

// Distinct from daily.js's own POOLS (a morning greeting) -- these are framed
// as an invitation to move, and checked references only.
const POOLS = {
  consistent: { headline: 'Move with strength', refs: ['Isaiah 40:31', 'Philippians 4:13', 'Habakkuk 3:19', '1 Corinthians 9:24'] },
  returning: { headline: 'Move with courage', refs: ['Joshua 1:9', 'Deuteronomy 31:6', '2 Timothy 1:7', 'Psalm 27:14'] },
  resting: { headline: 'Move with peace', refs: ['Matthew 11:28', 'Psalm 23:2', 'Exodus 33:14', 'Psalm 46:10'] },
  starting: { headline: 'Move with perseverance', refs: ['Hebrews 12:1', 'Galatians 6:9', 'James 1:12', 'Romans 5:3'] },
};

function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS scripture_mission_daily (
      user_id TEXT NOT NULL,
      date TEXT NOT NULL,
      headline TEXT NOT NULL,
      reference TEXT NOT NULL,
      text TEXT NOT NULL,
      coaching TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, date)
    );
  `);
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

/** References this member has already had as a mission recently. */
function recentRefs(userId, days) {
  try {
    return db.prepare(`SELECT reference FROM scripture_mission_daily
                        WHERE user_id = ? AND date > date('now', ?)`)
      .all(userId, '-' + (Number(days) || 14) + ' days')
      .map(r => r.reference);
  } catch { return []; }
}

/**
 * The stable pick for today -- computed once and cached, so re-opening Home
 * five times in one day shows the same mission instead of reshuffling.
 */
async function today(userId) {
  init();
  const date = todayKey();
  const cached = db.prepare('SELECT * FROM scripture_mission_daily WHERE user_id = ? AND date = ?').get(userId, date);
  if (cached) return cached;

  const me = db.prepare('SELECT tradition, bible_version_id FROM users WHERE id = ?').get(userId) || {};
  const shape = daily.weekShape(userId);
  const pool = POOLS[shape.pool] || POOLS.starting;
  const seen = recentRefs(userId, 14);
  const candidates = pool.refs.filter(r => !seen.includes(r));
  const pickFrom = candidates.length ? candidates : pool.refs;

  let picked = null;
  if (gloo.isConfigured()) {
    try {
      picked = await companion.chooseVerse({
        kind: 'scripture_mission',
        userId, tradition: me.tradition, versionId: me.bible_version_id,
        label: pool.headline, blurb: 'An invitation to a short movement break today.',
        facts: shape.facts, candidates: pickFrom,
        framing: 'This note sits above a "Begin the mission" button that starts a short ' +
                 'movement session. Keep it warm and grounded in real presence, not performance.',
      });
    } catch { picked = null; }
  }
  if (!picked) {
    for (const ref of pickFrom) {
      const hit = await companion.resolveRef(ref, me.bible_version_id);
      if (hit) { picked = { reference: hit.reference, text: hit.text, note: null }; break; }
    }
  }
  if (!picked) return null;

  const coaching = (picked.note ? picked.note + ' ' : '') +
    'Take a short movement break, notice your breath, and let this verse shape what comes next — not a performance test, but a practice of presence.';

  const row = { user_id: userId, date, headline: pool.headline, reference: picked.reference, text: picked.text, coaching };
  db.prepare(`INSERT OR REPLACE INTO scripture_mission_daily (user_id, date, headline, reference, text, coaching)
              VALUES (@user_id, @date, @headline, @reference, @text, @coaching)`).run(row);
  return row;
}

module.exports = { today, POOLS };
