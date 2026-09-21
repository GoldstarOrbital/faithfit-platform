'use strict';

// A durable semantic intent cache for answers that already passed Scripture
// citation verification. It deliberately uses explainable intent/term matching
// rather than an opaque third-party embedding service: no member question is
// sent to another vendor, it works during provider outages, and every hit can
// be constrained exactly by translation, tradition, and (for explanations)
// the passage being discussed.
const { randomUUID } = require('crypto');
const db = require('./db');

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'can', 'do', 'does', 'for',
  'from', 'how', 'i', 'in', 'is', 'it', 'me', 'my', 'of', 'on', 'or', 'please',
  'should', 'that', 'the', 'their', 'this', 'to', 'was', 'what', 'when', 'where',
  'which', 'who', 'why', 'with', 'would', 'you', 'your', 'about', 'bible', 'scripture', 'say',
]);
const SYNONYMS = new Map([
  ['mean', 'meaning'], ['meaning', 'meaning'], ['explain', 'meaning'],
  ['anxious', 'anxiety'], ['anxiety', 'anxiety'], ['worry', 'anxiety'], ['worried', 'anxiety'],
  ['forgive', 'forgiveness'], ['forgiven', 'forgiveness'], ['forgiveness', 'forgiveness'],
  ['saved', 'salvation'], ['save', 'salvation'], ['salvation', 'salvation'],
  ['strong', 'strength'], ['strength', 'strength'], ['strengthen', 'strength'],
  ['suffer', 'suffering'], ['suffering', 'suffering'], ['suffered', 'suffering'],
  ['pray', 'prayer'], ['praying', 'prayer'], ['prayer', 'prayer'],
  ['faithful', 'faith'], ['believe', 'faith'], ['belief', 'faith'],
  ['sinful', 'sin'], ['sinned', 'sin'], ['sins', 'sin'],
  ['love', 'love'], ['loving', 'love'], ['loved', 'love'],
]);
const INTENT_TERMS = new Set(['meaning', 'context', 'application', 'identity', 'practice', 'doctrine']);

function normalizeTerm(word) {
  const lower = String(word || '').toLowerCase();
  if (SYNONYMS.has(lower)) return SYNONYMS.get(lower);
  return lower.replace(/(?:ing|edly|edly|ed|es|s)$/u, '');
}

function signature(question) {
  const words = String(question || '').toLowerCase().match(/[a-z]{2,}/g) || [];
  const terms = [...new Set(words.map(normalizeTerm).filter((term) => term.length > 1 && !STOP_WORDS.has(term)))].sort();
  const q = String(question || '').toLowerCase();
  let intent = 'general';
  if (/\b(what does|what .*mean|meaning|mean in|explain)\b/.test(q)) intent = 'meaning';
  else if (/\b(context|background|who .* (writing|speaking)|audience)\b/.test(q)) intent = 'context';
  else if (/\b(how (do|can|should)|apply|live|practice)\b/.test(q)) intent = 'application';
  else if (/\b(who (is|was)|identity|person)\b/.test(q)) intent = 'identity';
  else if (/\b(is .* (sin|wrong)|doctrine|believe|teach)\b/.test(q)) intent = 'doctrine';
  return { intent, terms };
}

function scope(input) {
  return {
    kind: input.kind === 'verse_explanation' ? 'verse_explanation' : 'bible_answers',
    reference: String(input.reference || '').trim().toLowerCase(),
    tradition: String(input.tradition || '').trim().toLowerCase(),
    versionId: String(input.versionId || '').trim(),
  };
}

function similarity(a, b) {
  const left = new Set(a);
  const right = new Set(b);
  const union = new Set([...left, ...right]).size;
  if (!union) return 0;
  let intersect = 0;
  for (const term of left) if (right.has(term)) intersect += 1;
  return intersect / union;
}

function event(kind, outcome, score = null) {
  db.prepare('INSERT INTO semantic_cache_events (kind, outcome, similarity) VALUES (?, ?, ?)')
    .run(kind, outcome, score);
}

function lookup(input) {
  const s = scope(input);
  const requested = signature(input.question);
  // One generic word is not enough to safely reuse an answer. Exact matches
  // are still allowed, but semantic matches require at least two useful terms.
  const rows = db.prepare(`SELECT id, intent, terms, answer_json FROM semantic_answer_cache
    WHERE kind = ? AND reference = ? AND tradition = ? AND version_id = ?
      AND expires_at > datetime('now')`).all(s.kind, s.reference, s.tradition, s.versionId);
  let best = null;
  for (const row of rows) {
    if (row.intent !== requested.intent) continue;
    const score = similarity(requested.terms, JSON.parse(row.terms));
    if (!best || score > best.score) best = { row, score };
  }
  const safeHit = best && ((requested.terms.length >= 2 && best.score >= 0.8) || best.score === 1);
  if (!safeHit) {
    event(s.kind, 'miss', best ? best.score : null);
    return null;
  }
  try {
    const answer = JSON.parse(best.row.answer_json);
    db.prepare(`UPDATE semantic_answer_cache
      SET hit_count = hit_count + 1, last_hit_at = datetime('now') WHERE id = ?`).run(best.row.id);
    event(s.kind, 'hit', best.score);
    return { ...answer, cached: true, semanticCached: true };
  } catch {
    // A malformed old row cannot break Bible Answers; discard it and generate.
    db.prepare('DELETE FROM semantic_answer_cache WHERE id = ?').run(best.row.id);
    event(s.kind, 'miss', null);
    return null;
  }
}

function store(input, answer, ttlDays = 14) {
  const s = scope(input);
  const sig = signature(input.question);
  if (sig.terms.length < 2 || !answer || !String(answer.answer || '').trim()) return false;
  const expiresAt = new Date(Date.now() + ttlDays * 86400000).toISOString().replace('T', ' ').replace('Z', '');
  db.prepare(`INSERT INTO semantic_answer_cache
    (id, kind, reference, tradition, version_id, intent, terms, answer_json, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(kind, reference, tradition, version_id, intent, terms) DO UPDATE SET
      answer_json = excluded.answer_json, created_at = datetime('now'), expires_at = excluded.expires_at`).run(
    randomUUID(), s.kind, s.reference, s.tradition, s.versionId, sig.intent,
    JSON.stringify(sig.terms), JSON.stringify(answer), expiresAt);
  event(s.kind, 'store', null);
  return true;
}

function stats(days = 7) {
  const safeDays = Math.max(1, Math.min(90, Number(days) || 7));
  return db.prepare(`SELECT kind,
    SUM(CASE WHEN outcome = 'hit' THEN 1 ELSE 0 END) AS hits,
    SUM(CASE WHEN outcome = 'miss' THEN 1 ELSE 0 END) AS misses,
    SUM(CASE WHEN outcome = 'store' THEN 1 ELSE 0 END) AS stores
    FROM semantic_cache_events
    WHERE created_at >= datetime('now', ?)
    GROUP BY kind`).all(`-${safeDays} days`);
}

module.exports = { lookup, store, stats, signature, similarity };
