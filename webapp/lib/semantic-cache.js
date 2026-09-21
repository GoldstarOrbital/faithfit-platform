'use strict';

// A durable semantic intent cache for answers that already passed Scripture
// citation verification. It deliberately uses explainable intent/term matching
// rather than an opaque third-party embedding service: no member question is
// sent to another vendor, it works during provider outages, and every hit can
// be constrained exactly by translation, tradition, and (for explanations)
// the passage being discussed.
const { randomUUID } = require('crypto');
const db = require('./db');
const { Pool } = require('pg');

// Core member data remains on the existing SQLite volume during the staged
// cutover. High-volume, independently recoverable AI cache/telemetry is the
// first production workload on Postgres. A brief Postgres outage can never
// make Bible Answers fail: each operation transparently falls back to SQLite.
const postgresUrl = process.env.POSTGRES_DATABASE_URL;
const postgres = postgresUrl ? new Pool({ connectionString: postgresUrl, max: 5, idleTimeoutMillis: 10000 }) : null;
let postgresFailureLogged = false;

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

function sqliteEvent(kind, outcome, score = null) {
  db.prepare('INSERT INTO semantic_cache_events (kind, outcome, similarity) VALUES (?, ?, ?)')
    .run(kind, outcome, score);
}

function sqliteLookup(input) {
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
    sqliteEvent(s.kind, 'miss', best ? best.score : null);
    return null;
  }
  try {
    const answer = JSON.parse(best.row.answer_json);
    db.prepare(`UPDATE semantic_answer_cache
      SET hit_count = hit_count + 1, last_hit_at = datetime('now') WHERE id = ?`).run(best.row.id);
    sqliteEvent(s.kind, 'hit', best.score);
    return { ...answer, cached: true, semanticCached: true };
  } catch {
    // A malformed old row cannot break Bible Answers; discard it and generate.
    db.prepare('DELETE FROM semantic_answer_cache WHERE id = ?').run(best.row.id);
    sqliteEvent(s.kind, 'miss', null);
    return null;
  }
}

function sqliteStore(input, answer, ttlDays = 14) {
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
  sqliteEvent(s.kind, 'store', null);
  return true;
}

function sqliteStats(days = 7) {
  const safeDays = Math.max(1, Math.min(90, Number(days) || 7));
  return db.prepare(`SELECT kind,
    SUM(CASE WHEN outcome = 'hit' THEN 1 ELSE 0 END) AS hits,
    SUM(CASE WHEN outcome = 'miss' THEN 1 ELSE 0 END) AS misses,
    SUM(CASE WHEN outcome = 'store' THEN 1 ELSE 0 END) AS stores
    FROM semantic_cache_events
    WHERE created_at >= datetime('now', ?)
    GROUP BY kind`).all(`-${safeDays} days`);
}

async function postgresEvent(kind, outcome, score = null) {
  await postgres.query('INSERT INTO semantic_cache_events (kind, outcome, similarity) VALUES ($1, $2, $3)', [kind, outcome, score]);
}

async function postgresLookup(input) {
  const s = scope(input);
  const requested = signature(input.question);
  const result = await postgres.query(`SELECT id, intent, terms, answer_json FROM semantic_answer_cache
    WHERE kind = $1 AND reference = $2 AND tradition = $3 AND version_id = $4
      AND expires_at > NOW()`, [s.kind, s.reference, s.tradition, s.versionId]);
  let best = null;
  for (const row of result.rows) {
    if (row.intent !== requested.intent) continue;
    const score = similarity(requested.terms, typeof row.terms === 'string' ? JSON.parse(row.terms) : row.terms);
    if (!best || score > best.score) best = { row, score };
  }
  const safeHit = best && ((requested.terms.length >= 2 && best.score >= 0.8) || best.score === 1);
  if (!safeHit) {
    await postgresEvent(s.kind, 'miss', best ? best.score : null);
    return null;
  }
  try {
    const answer = typeof best.row.answer_json === 'string' ? JSON.parse(best.row.answer_json) : best.row.answer_json;
    await postgres.query('UPDATE semantic_answer_cache SET hit_count = hit_count + 1, last_hit_at = NOW() WHERE id = $1', [best.row.id]);
    await postgresEvent(s.kind, 'hit', best.score);
    return { ...answer, cached: true, semanticCached: true };
  } catch {
    await postgres.query('DELETE FROM semantic_answer_cache WHERE id = $1', [best.row.id]);
    await postgresEvent(s.kind, 'miss', null);
    return null;
  }
}

async function postgresStore(input, answer, ttlDays = 14) {
  const s = scope(input);
  const sig = signature(input.question);
  if (sig.terms.length < 2 || !answer || !String(answer.answer || '').trim()) return false;
  await postgres.query(`INSERT INTO semantic_answer_cache
    (id, kind, reference, tradition, version_id, intent, terms, answer_json, expires_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW() + ($9 * INTERVAL '1 day'))
    ON CONFLICT(kind, reference, tradition, version_id, intent, terms) DO UPDATE SET
      answer_json = EXCLUDED.answer_json, created_at = NOW(), expires_at = EXCLUDED.expires_at`, [
    randomUUID(), s.kind, s.reference, s.tradition, s.versionId, sig.intent,
    JSON.stringify(sig.terms), JSON.stringify(answer), ttlDays]);
  await postgresEvent(s.kind, 'store', null);
  return true;
}

async function postgresStats(days = 7) {
  const safeDays = Math.max(1, Math.min(90, Number(days) || 7));
  const result = await postgres.query(`SELECT kind,
    SUM(CASE WHEN outcome = 'hit' THEN 1 ELSE 0 END)::int AS hits,
    SUM(CASE WHEN outcome = 'miss' THEN 1 ELSE 0 END)::int AS misses,
    SUM(CASE WHEN outcome = 'store' THEN 1 ELSE 0 END)::int AS stores
    FROM semantic_cache_events
    WHERE created_at >= NOW() - ($1 * INTERVAL '1 day') GROUP BY kind`, [safeDays]);
  return result.rows;
}

async function usePostgres(operation, fallback) {
  if (!postgres) return fallback();
  try { return await operation(); }
  catch (error) {
    if (!postgresFailureLogged) {
      postgresFailureLogged = true;
      console.error('Postgres semantic cache unavailable; using SQLite fallback.', error.message);
    }
    return fallback();
  }
}

async function lookup(input) { return usePostgres(() => postgresLookup(input), () => sqliteLookup(input)); }
async function store(input, answer, ttlDays) { return usePostgres(() => postgresStore(input, answer, ttlDays), () => sqliteStore(input, answer, ttlDays)); }
async function stats(days) { return usePostgres(() => postgresStats(days), () => sqliteStats(days)); }

module.exports = { lookup, store, stats, signature, similarity };
