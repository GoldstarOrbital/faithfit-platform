/**
 * @mentions and #hashtags in member-written text.
 *
 * Mentions are harder here than on most products because this app's usernames
 * ARE display names, and display names may contain spaces ("Alex G", "Maria
 * Testrunner"). So "@Maria Testrunner is praying" has no unambiguous end: a
 * naive \S+ match yields "Maria" and misses the real person. We therefore take
 * up to MAX_NAME_WORDS words after the "@" and try progressively shorter
 * prefixes, longest first, stopping at the first that resolves to a real
 * account. That makes "@Maria Testrunner" win over "@Maria" when both exist,
 * and costs at most MAX_NAME_WORDS indexed lookups per mention.
 *
 * Matching reuses usernames.key() so it agrees exactly with the uniqueness
 * rule that made names mentionable in the first place -- case- and
 * whitespace-insensitive. If the two ever diverged, a name could be unique but
 * unmentionable, or mentionable as two different people.
 *
 * Hashtags are the easy half: a single run of letters/digits/underscore, keyed
 * lowercase so #Lent, #lent and #LENT are one topic.
 */
'use strict';

const db = require('./db');
const usernames = require('./usernames');

const MAX_NAME_WORDS = 4;      // "Mary Anne van der Berg" is about the practical ceiling
const MAX_MENTIONS = 10;       // one post cannot notify the whole congregation
const MAX_HASHTAGS = 10;
const TAG_RE = /#([\p{L}\p{N}_]{1,50})/gu;

function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS post_hashtags (
      post_id TEXT NOT NULL,
      tag TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (post_id, tag)
    );
    CREATE INDEX IF NOT EXISTS idx_post_hashtags_tag ON post_hashtags(tag, created_at);
  `);
}

/** Distinct lowercase tags, in first-seen order, capped. */
function extractHashtags(text) {
  const out = [];
  const seen = new Set();
  for (const m of String(text || '').matchAll(TAG_RE)) {
    const tag = m[1].toLowerCase();
    if (seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= MAX_HASHTAGS) break;
  }
  return out;
}

function replaceHashtagsFor(postId, text) {
  const tags = extractHashtags(text);
  db.prepare('DELETE FROM post_hashtags WHERE post_id = ?').run(postId);
  if (!tags.length) return [];
  const ins = db.prepare('INSERT OR IGNORE INTO post_hashtags (post_id, tag) VALUES (?, ?)');
  for (const t of tags) ins.run(postId, t);
  return tags;
}

/** Posts carrying a tag, newest first. Visibility is the caller's job. */
function postIdsForTag(tag, limit = 50) {
  return db.prepare('SELECT post_id FROM post_hashtags WHERE tag = ? ORDER BY created_at DESC LIMIT ?')
    .all(String(tag || '').toLowerCase(), Math.min(Number(limit) || 50, 100))
    .map(r => r.post_id);
}

function trendingTags(days = 14, limit = 12) {
  return db.prepare(`
    SELECT tag, COUNT(*) c FROM post_hashtags
    WHERE created_at > datetime('now', ?)
    GROUP BY tag ORDER BY c DESC, tag LIMIT ?
  `).all(`-${Math.min(Number(days) || 14, 90)} days`, Math.min(Number(limit) || 12, 50));
}

/**
 * Resolve every @mention in `text` to a real user id.
 *
 * Returns [{ user_id, display_name, matched }] where `matched` is the exact
 * substring that resolved, so a caller can highlight precisely what was
 * matched rather than re-guessing the boundary.
 */
function resolveMentions(text, { excludeUserId = null } = {}) {
  const s = String(text || '');
  const found = [];
  const seen = new Set();
  const lookup = db.prepare('SELECT id, display_name FROM users WHERE lower(trim(display_name)) = ?');

  // Walk each "@", then try the longest plausible name first.
  const at = /@/g;
  let m;
  while ((m = at.exec(s)) !== null) {
    const after = s.slice(m.index + 1);
    // Allowed name characters mirror usernames.validate().
    const words = after.match(/^[\p{L}\p{N} '._-]+/u);
    if (!words) continue;
    const parts = words[0].split(' ').filter(Boolean).slice(0, MAX_NAME_WORDS);
    for (let take = parts.length; take >= 1; take--) {
      const candidate = parts.slice(0, take).join(' ');
      const row = lookup.get(usernames.key(candidate));
      if (!row) continue;
      if (row.id !== excludeUserId && !seen.has(row.id)) {
        seen.add(row.id);
        found.push({ user_id: row.id, display_name: row.display_name, matched: candidate });
      }
      break; // longest match wins; do not also match its shorter prefixes
    }
    if (found.length >= MAX_MENTIONS) break;
  }
  return found;
}

module.exports = {
  init, extractHashtags, replaceHashtagsFor, postIdsForTag, trendingTags, resolveMentions,
  MAX_MENTIONS, MAX_HASHTAGS,
};
