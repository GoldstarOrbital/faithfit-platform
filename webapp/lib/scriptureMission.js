/**
 * "Scripture in Motion" -- Home's card steering a member toward Scripture or
 * Training first. Distinct from the live workout-trigger pipeline
 * (pipeline.js), which reacts to real biometric signals mid-session.
 *
 * Two pieces move on different clocks, deliberately:
 *   - the VERSE re-rolls on every single call, free of charge -- picked
 *     locally from an authored pool and resolved against real scripture
 *     text, no AI involved, so the card can feel fresh every time someone
 *     opens Home without ever touching a metered API.
 *   - the COACHING line is genuinely AI-personalized, but a member re-opening
 *     Home five times in an hour does not need five different sentences of
 *     encouragement -- it is generated at most once per real day per member
 *     (see dailyInsight below) and shown under whichever verse the pick
 *     above lands on that visit.
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
// as an invitation to move, and checked references only. Kept much wider than
// a typical pool (24 refs, not 8) because this card is meant to be re-rolled
// on every single Home visit rather than once a day -- a member can open Home
// dozens of times in a day, and an 8-ref pool cycled back to a repeat almost
// immediately.
const POOLS = {
  consistent: {
    headline: 'Move with strength',
    refs: [
      'Isaiah 40:31', 'Philippians 4:13', 'Habakkuk 3:19', '1 Corinthians 9:24', 'Psalm 18:32', 'Ephesians 6:10', 'Nehemiah 8:10', 'Psalm 28:7',
      'Psalm 27:1', '2 Corinthians 12:9', 'Psalm 46:1', 'Zechariah 4:6', 'Colossians 1:11', 'Psalm 68:35', '1 Chronicles 16:11', 'Psalm 138:3',
      '2 Samuel 22:33', 'Psalm 20:7', 'Joshua 1:7', '1 Peter 5:10', 'Romans 15:13', 'Exodus 15:2', 'Psalm 71:16', 'Isaiah 12:2',
    ],
  },
  returning: {
    headline: 'Move with courage',
    refs: [
      'Joshua 1:9', 'Deuteronomy 31:6', '2 Timothy 1:7', 'Psalm 27:14', 'Isaiah 41:10', 'Deuteronomy 31:8', '1 Chronicles 28:20', 'Psalm 31:24',
      '1 Corinthians 16:13', 'Psalm 56:3', 'Deuteronomy 3:22', 'Isaiah 43:1', 'Joshua 1:6', 'Psalm 3:6', '2 Chronicles 32:7', 'Psalm 118:6',
      'Matthew 14:27', 'Acts 18:9', 'Psalm 27:3', 'Isaiah 35:4', 'John 16:33', 'Mark 6:50', 'Psalm 112:7', '1 Samuel 17:37',
    ],
  },
  resting: {
    headline: 'Move with peace',
    refs: [
      'Matthew 11:28', 'Psalm 23:2', 'Exodus 33:14', 'Psalm 46:10', 'Psalm 62:1', 'John 14:27', 'Isaiah 30:15', 'Psalm 4:8',
      'Philippians 4:7', 'Psalm 29:11', 'Isaiah 26:3', 'Colossians 3:15', 'Psalm 37:7', 'Matthew 11:29', 'Psalm 116:7', '2 Thessalonians 3:16',
      'Psalm 94:19', 'John 14:1', 'Isaiah 32:17', 'Psalm 55:22', '1 Peter 5:7', 'Psalm 131:2', 'Numbers 6:26', 'Jeremiah 6:16',
    ],
  },
  starting: {
    headline: 'Move with perseverance',
    refs: [
      'Hebrews 12:1', 'Galatians 6:9', 'James 1:12', 'Romans 5:3', 'Philippians 1:6', '2 Corinthians 4:16', 'Isaiah 43:19', 'Lamentations 3:23',
      'Romans 5:4', 'James 1:4', 'Philippians 3:14', '1 Corinthians 15:58', 'Hebrews 10:36', 'Isaiah 40:29', 'Ecclesiastes 3:1', 'Proverbs 3:5',
      'Psalm 37:5', '2 Peter 1:6', 'Colossians 3:23', 'Isaiah 43:2', 'Joshua 1:8', 'Psalm 40:1', '1 Timothy 6:12', 'Hebrews 6:12',
    ],
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

const FALLBACK_COACHING = 'Take a short movement break, notice your breath, and let this verse ' +
  'shape what comes next — not a performance test, but a practice of presence.';

/**
 * The AI-personalized coaching line, generated at most once per calendar day
 * per member. Piggybacks on lib/gloo.js's own cache (keyed on the exact
 * prompt) rather than a bespoke table: baking today's date and this member's
 * id into the prompt text makes the cache key naturally stable for the rest
 * of the day, and `cacheDays: 1` lets it lapse on its own tomorrow.
 *
 * Deliberately NOT told which specific verse the card is showing -- that
 * would tie the cache key to the verse pick and defeat the whole point, and
 * the line was always written to stand on its own ("let this verse shape
 * what comes next") rather than react to particular verse text.
 *
 * This card is meant to render instantly on every Home visit (see `next`
 * below) -- but the FIRST visit of a member's day used to block on a live AI
 * round trip right here, which is exactly the "takes a second to load"
 * latency members were hitting. Only a genuine cache HIT is awaited now
 * (gloo._cache is a synchronous local DB read, not a network call); a miss
 * returns the fallback immediately for this visit and kicks off the real
 * generation in the background so it's cached and instant by the next one.
 */
function dailyInsight(userId, pool, shape) {
  if (!gloo.isConfigured()) return FALLBACK_COACHING;

  const today = new Date().toISOString().slice(0, 10);
  const facts = shape.facts && shape.facts.length
    ? shape.facts.map(f => '- ' + f).join('\n')
    : '- no recent activity data available';

  const prompt =
    `You are writing one short, warm sentence of encouragement for a member of a ` +
    `Christian fitness and community app (member id ${userId}), for ${today}.\n` +
    `Their current rhythm this week: "${pool.headline}".\n` +
    `What is actually true about their recent activity:\n${facts}\n\n` +
    `Write ONE sentence, max 28 words, inviting them into a short movement break today. ` +
    `Do NOT quote, paraphrase, or reference any specific Bible verse -- a real verse is ` +
    `shown separately beside your sentence. Speak to them directly and warmly, grounded ` +
    `in real presence rather than performance.\n\n` +
    `Reply with ONLY the sentence -- no quotes, no JSON, no preamble.`;

  const opts = {
    kind: 'scripture_mission_daily_insight',
    userId,
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 120,
    cacheDays: 1,
  };

  const cached = gloo.peekCache(opts);
  if (cached && cached.text) return companion.cleanNote(cached.text, 30) || FALLBACK_COACHING;

  // Fire-and-forget: populates gloo's cache for the next visit. Errors are
  // gloo.chat's own concern (it already returns null and logs internally on
  // any failure) -- nothing here needs to react to them.
  gloo.chat(opts).catch(() => {});
  return FALLBACK_COACHING;
}

/**
 * A fresh, free verse pick every call -- the point of this card is to feel
 * new each time a member returns to Home, not to hold steady like the
 * morning verse does. No AI call: candidates are already hand-vetted per
 * theme, so a local random pick (excluding what was just shown) is enough,
 * and it costs nothing no matter how often someone re-opens Home.
 */
async function next(userId) {
  init();

  const me = db.prepare('SELECT tradition, bible_version_id FROM users WHERE id = ?').get(userId) || {};
  const shape = daily.weekShape(userId);
  const pool = POOLS[shape.pool] || POOLS.starting;
  const seen = recentRefs(userId, 12);
  const candidates = pool.refs.filter(r => !seen.includes(r));
  const pickFrom = shuffled(candidates.length ? candidates : pool.refs);

  let picked = null;
  for (const ref of pickFrom) {
    const hit = await companion.resolveRef(ref, me.bible_version_id);
    if (hit) { picked = { reference: hit.reference, text: hit.text }; break; }
  }
  if (!picked) return null;

  const coaching = await dailyInsight(userId, pool, shape);

  const row = { id: randomUUID(), user_id: userId, headline: pool.headline, reference: picked.reference, text: picked.text, coaching };
  db.prepare(`INSERT INTO scripture_mission_log (id, user_id, headline, reference, text, coaching)
              VALUES (@id, @user_id, @headline, @reference, @text, @coaching)`).run(row);
  return row;
}

/** Fisher-Yates -- these lists are short (4-8 refs), so this is plenty. */
function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

module.exports = { next, POOLS };
