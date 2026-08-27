/**
 * "Scripture in Motion" -- Home's card steering a member toward Scripture or
 * Training first. Distinct from the live workout-trigger pipeline
 * (pipeline.js), which reacts to real biometric signals mid-session: this is
 * meant to feel fresh every time someone opens Home, not a single stable
 * pick for the day, so it never caches -- every call generates a new one.
 *
 * Reuses daily.js's own weekly-consistency read (weekShape) so the theme
 * offered reflects the member's real recent pattern -- a quiet week gets
 * "Move with peace," not a push to perform.
 */
'use strict';

const { randomUUID } = require('crypto');
const db = require('./db');
const gloo = require('./gloo');
const companion = require('./companion');
const daily = require('./daily');

// Distinct from daily.js's own POOLS (a morning greeting) -- these are framed
// as an invitation to move, and checked references only. Kept wider than a
// typical pool (8 refs, not 4-5) because this card is meant to be re-rolled
// on every visit rather than once a day, so a short list would cycle back to
// a repeat almost immediately.
const POOLS = {
  consistent: {
    headline: 'Move with strength',
    refs: ['Isaiah 40:31', 'Philippians 4:13', 'Habakkuk 3:19', '1 Corinthians 9:24', 'Psalm 18:32', 'Ephesians 6:10', 'Nehemiah 8:10', 'Psalm 28:7'],
  },
  returning: {
    headline: 'Move with courage',
    refs: ['Joshua 1:9', 'Deuteronomy 31:6', '2 Timothy 1:7', 'Psalm 27:14', 'Isaiah 41:10', 'Deuteronomy 31:8', '1 Chronicles 28:20', 'Psalm 31:24'],
  },
  resting: {
    headline: 'Move with peace',
    refs: ['Matthew 11:28', 'Psalm 23:2', 'Exodus 33:14', 'Psalm 46:10', 'Psalm 62:1', 'John 14:27', 'Isaiah 30:15', 'Psalm 4:8'],
  },
  starting: {
    headline: 'Move with perseverance',
    refs: ['Hebrews 12:1', 'Galatians 6:9', 'James 1:12', 'Romans 5:3', 'Philippians 1:6', '2 Corinthians 4:16', 'Isaiah 43:19', 'Lamentations 3:23'],
  },
};

function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS scripture_mission_log (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      headline TEXT NOT NULL,
      reference TEXT NOT NULL,
      text TEXT NOT NULL,
      coaching TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_scripture_mission_log_user ON scripture_mission_log(user_id, created_at);
  `);
}

/** The last few references this member was shown, most recent first. */
function recentRefs(userId, limit) {
  try {
    return db.prepare(`SELECT reference FROM scripture_mission_log
                        WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`)
      .all(userId, Number(limit) || 4)
      .map(r => r.reference);
  } catch { return []; }
}

/**
 * A fresh pick every call -- the point of this card is to feel new each time
 * a member returns to Home, not to hold steady like the morning verse does.
 */
async function next(userId) {
  init();

  const me = db.prepare('SELECT tradition, bible_version_id FROM users WHERE id = ?').get(userId) || {};
  const shape = daily.weekShape(userId);
  const pool = POOLS[shape.pool] || POOLS.starting;
  const seen = recentRefs(userId, 4);
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

  const row = { id: randomUUID(), user_id: userId, headline: pool.headline, reference: picked.reference, text: picked.text, coaching };
  db.prepare(`INSERT INTO scripture_mission_log (id, user_id, headline, reference, text, coaching)
              VALUES (@id, @user_id, @headline, @reference, @text, @coaching)`).run(row);
  return row;
}

module.exports = { next, POOLS };
