/**
 * Display names, and the rule that two people cannot share one.
 *
 * Names are assigned in three places — email registration, OAuth sign-up, and
 * editing a profile — so the rule lives here rather than being re-implemented
 * three times with three slightly different ideas of what "taken" means.
 *
 * Comparison is case- and space-insensitive: "Alex G", "alex g" and "ALEX  G"
 * are the same person as far as a mention or a search is concerned, so allowing
 * all three would defeat the point of making them unique.
 *
 * Registration and profile edits reject a clash and say so. OAuth cannot: a
 * name collision must never be the reason someone's Google sign-in fails, so
 * that path takes the nearest free variant instead.
 */
'use strict';

const db = require('./db');

const MIN = 2;
const MAX = 40;

/** Trim and collapse internal whitespace. What the user sees is what is stored. */
function normalise(name) {
  return String(name == null ? '' : name).replace(/\s+/g, ' ').trim();
}

/** The comparison key: what makes two names "the same name". */
function key(name) {
  return normalise(name).toLowerCase();
}

function validate(name) {
  const n = normalise(name);
  if (n.length < MIN) return { error: 'name_too_short', message: `Your name needs at least ${MIN} characters.` };
  if (n.length > MAX) return { error: 'name_too_long', message: `Names are limited to ${MAX} characters.` };
  // Keep names to things that render and can be searched for. Letters (any
  // script), digits, spaces and a few joining marks.
  if (!/^[\p{L}\p{N} '._-]+$/u.test(n)) {
    return { error: 'name_invalid_characters', message: 'Use letters, numbers, spaces, and . _ - only.' };
  }
  return { name: n };
}

/** Is this name already somebody else's? */
function isTaken(name, exceptUserId) {
  const row = db.prepare(
    `SELECT id FROM users WHERE lower(trim(display_name)) = ? AND id != ? LIMIT 1`
  ).get(key(name), exceptUserId || '');
  return !!row;
}

/**
 * Validate and check availability in one step, for the paths that are allowed
 * to refuse (registration, profile edit).
 */
function check(name, exceptUserId) {
  const v = validate(name);
  if (v.error) return v;
  if (isTaken(v.name, exceptUserId)) {
    return { error: 'name_taken', message: 'That name is already taken. Try another.' };
  }
  return { name: v.name };
}

/**
 * The nearest free variant of a name, for paths that cannot refuse. "Alex" then
 * "Alex 2", "Alex 3", and so on.
 */
function suggest(name, exceptUserId) {
  const base = normalise(name).slice(0, MAX - 4) || 'Friend';
  if (!isTaken(base, exceptUserId)) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base} ${i}`;
    if (!isTaken(candidate, exceptUserId)) return candidate;
  }
  // Practically unreachable; better than looping forever.
  return `${base} ${Date.now().toString(36)}`;
}

/**
 * Add the database-level guarantee, but only when the existing data can satisfy
 * it. Accounts created before this rule existed may already share a name, and
 * silently renaming somebody is not a migration's decision to make. When that
 * happens the constraint is skipped and the application-level check still
 * applies to every new name.
 */
function ensureUniqueIndex() {
  const dupes = db.prepare(
    `SELECT lower(trim(display_name)) AS k, COUNT(*) AS c
     FROM users WHERE display_name IS NOT NULL AND trim(display_name) != ''
     GROUP BY k HAVING c > 1`
  ).all();

  if (dupes.length) {
    console.warn('[usernames] unique index skipped; %d duplicate name(s) predate this rule: %s',
      dupes.length, dupes.map(d => `${d.k} (x${d.c})`).join(', '));
    return { indexed: false, duplicates: dupes.length };
  }

  try {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_display_name_unique
             ON users (lower(trim(display_name)))`);
    return { indexed: true, duplicates: 0 };
  } catch (e) {
    console.warn('[usernames] could not create unique index:', e.message);
    return { indexed: false, duplicates: 0, error: e.message };
  }
}

module.exports = { normalise, key, validate, isTaken, check, suggest, ensureUniqueIndex, MIN, MAX };
