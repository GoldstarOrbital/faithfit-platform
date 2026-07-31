/**
 * Gloo AI Platform — values-aligned inference.
 *
 * Gloo is an AI platform built for faith-based and mission-driven software. Two
 * things about it matter here, and neither is available from a general-purpose
 * model endpoint:
 *
 *   1. `tradition` — responses can be shaped to a theological perspective
 *      (evangelical, catholic, mainline, or none). A member's church already
 *      lives on their profile; this is the first thing in the app that can
 *      actually *use* it, instead of printing it under their name.
 *
 *   2. Alignment across six dimensions (physical, ethical, emotional, factual,
 *      theological, security). For an app that talks to people mid-effort,
 *      when they are tired and discouraged, that is not a nice-to-have.
 *
 * ---------------------------------------------------------------------------
 * THE RULE THAT GOVERNS EVERY CALL IN THIS FILE
 *
 *   Gloo never produces scripture.
 *
 * A language model asked for a verse will produce something verse-shaped, and
 * it will be wrong often enough to matter. So the division of labour is total:
 *
 *   Gloo   chooses a reference and writes the words *around* it.
 *   YouVersion supplies the verse text itself.
 *
 * Every reference a model hands back is resolved against the YouVersion
 * Platform (or the local public-domain library) before anything reaches a
 * member. A reference that does not resolve is dropped. A response whose
 * references all fail is discarded entirely and the caller falls back to
 * hand-authored scripture. This is enforced in code, in `verifyRefs`, not
 * merely requested in a prompt — see `lib/companion.js` for the callers.
 * ---------------------------------------------------------------------------
 *
 * Auth is OAuth2 client credentials, per Gloo's docs: base64 `id:secret`,
 * POST to the token endpoint, one-hour bearer token. Contract established from
 * https://docs.gloo.com/getting-started/quickstart-developers.
 *
 * Like every other integration in this app, this one degrades to nothing. With
 * no credentials configured the app behaves exactly as it did before: authored
 * verse lists, no companion, no generated reflection. Nothing is stubbed out
 * with a placeholder and nothing breaks.
 */
'use strict';

const crypto = require('crypto');
const db = require('./db');

const OAUTH_URL = 'https://platform.ai.gloo.com/oauth2/token';
const CHAT_URL = 'https://platform.ai.gloo.com/ai/v2/chat/completions';
const GROUNDED_URL = CHAT_URL + '/grounded';
const TIMEOUT_MS = 20000;

// Traditions the platform accepts. Anything else is sent as no tradition at
// all rather than passed through — an unrecognised value would be a silent
// 400 on every call.
const TRADITIONS = ['evangelical', 'catholic', 'mainline', 'not_faith_specific'];

function normaliseTradition(t) {
  const v = String(t || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return TRADITIONS.includes(v) ? v : null;
}

function clientId() { return process.env.GLOO_CLIENT_ID || null; }
function clientSecret() { return process.env.GLOO_CLIENT_SECRET || null; }
function isConfigured() { return !!(clientId() && clientSecret()); }

function init() {
  db.exec(`
    -- Responses are cached by a hash of the exact request. Inference costs
    -- money and takes seconds; the same question about the same verse from the
    -- same tradition should cost both once. Unlike scripture, model output is
    -- not eternal, so these carry an expiry.
    CREATE TABLE IF NOT EXISTS gloo_cache (
      key TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      response TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT
    );

    -- Every call is logged: what it cost, which model routing chose, whether
    -- the reference check passed. This is what makes the honesty rule auditable
    -- after the fact instead of a claim in a comment.
    CREATE TABLE IF NOT EXISTS gloo_calls (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      user_id TEXT,
      tradition TEXT,
      model TEXT,
      routing_tier TEXT,
      routing_confidence REAL,
      prompt_tokens INTEGER,
      completion_tokens INTEGER,
      refs_cited INTEGER,
      refs_verified INTEGER,
      ok INTEGER NOT NULL DEFAULT 1,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_gloo_calls_created ON gloo_calls(created_at);
  `);
}

// --- Token ------------------------------------------------------------------
// Tokens last an hour. Cached in memory and renewed a minute early, so a call
// never races the expiry. Not persisted: a restart getting a fresh token is
// cheaper than reasoning about a stale one on disk.
let token = null;          // { value, expiresAt }
let tokenInFlight = null;  // dedupes concurrent refreshes

async function accessToken() {
  if (!isConfigured()) return null;
  if (token && token.expiresAt > Date.now() + 60000) return token.value;
  if (tokenInFlight) return tokenInFlight;

  tokenInFlight = (async () => {
    const basic = Buffer.from(clientId() + ':' + clientSecret()).toString('base64');
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(OAUTH_URL, {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + basic,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials&scope=api/access',
        signal: ac.signal,
      });
      if (!res.ok) {
        console.log('[gloo] token request failed: %d', res.status);
        return null;
      }
      const json = await res.json();
      if (!json || !json.access_token) return null;
      const ttl = Number(json.expires_in) || 3600;
      token = { value: json.access_token, expiresAt: Date.now() + ttl * 1000 };
      return token.value;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
      tokenInFlight = null;
    }
  })();
  return tokenInFlight;
}

// --- Cache ------------------------------------------------------------------
function cacheKey(kind, payload) {
  return crypto.createHash('sha256')
    .update(kind + '\n' + JSON.stringify(payload))
    .digest('hex');
}

function cacheGet(key) {
  const row = db.prepare(
    `SELECT response FROM gloo_cache
      WHERE key = ? AND (expires_at IS NULL OR expires_at > datetime('now'))`
  ).get(key);
  if (!row) return null;
  try { return JSON.parse(row.response); } catch { return null; }
}

function cachePut(key, kind, value, ttlDays) {
  const expires = ttlDays ? `datetime('now', '+${Number(ttlDays)} days')` : 'NULL';
  db.prepare(
    `INSERT INTO gloo_cache (key, kind, response, expires_at)
     VALUES (?, ?, ?, ${expires})
     ON CONFLICT(key) DO UPDATE SET response = excluded.response,
       created_at = datetime('now'), expires_at = excluded.expires_at`
  ).run(key, kind, JSON.stringify(value));
}

// --- Logging ----------------------------------------------------------------
function logCall(rec) {
  try {
    db.prepare(
      `INSERT INTO gloo_calls (id, kind, user_id, tradition, model, routing_tier,
         routing_confidence, prompt_tokens, completion_tokens, refs_cited,
         refs_verified, ok, error)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(crypto.randomUUID(), rec.kind, rec.userId || null, rec.tradition || null,
      rec.model || null, rec.routingTier || null, rec.routingConfidence ?? null,
      rec.promptTokens ?? null, rec.completionTokens ?? null,
      rec.refsCited ?? null, rec.refsVerified ?? null,
      rec.ok ? 1 : 0, rec.error || null);
  } catch { /* telemetry must never break a request */ }
}

/** What the integration has actually been doing — surfaced on the dev page. */
function stats(days) {
  const d = Number(days) || 7;
  try {
    return db.prepare(
      `SELECT kind,
              COUNT(*)                       AS calls,
              SUM(ok)                        AS ok,
              SUM(COALESCE(prompt_tokens,0)) AS prompt_tokens,
              SUM(COALESCE(completion_tokens,0)) AS completion_tokens,
              SUM(COALESCE(refs_cited,0))    AS refs_cited,
              SUM(COALESCE(refs_verified,0)) AS refs_verified
         FROM gloo_calls
        WHERE created_at > datetime('now', '-${d} days')
        GROUP BY kind ORDER BY calls DESC`
    ).all();
  } catch { return []; }
}

// --- Calls ------------------------------------------------------------------
/**
 * A values-aligned chat completion.
 *
 * Exactly one of auto_routing / model / model_family must be set, per the API;
 * we default to auto_routing so Gloo picks a tier per request rather than us
 * pinning a model we would then have to maintain.
 *
 * Returns null on any failure — no credentials, no token, non-2xx, timeout,
 * malformed body. Callers treat null as "no AI available" and fall back.
 */
async function chat(opts) {
  const o = opts || {};
  if (!Array.isArray(o.messages) || !o.messages.length) return null;

  const body = {
    messages: o.messages,
    auto_routing: true,
    stream: false,
  };
  if (o.model) { body.model = o.model; delete body.auto_routing; }
  const trad = normaliseTradition(o.tradition);
  if (trad) body.tradition = trad;
  if (Number.isFinite(o.temperature)) body.temperature = o.temperature;
  if (Number.isFinite(o.maxTokens)) body.max_tokens = o.maxTokens;

  // Grounding in our own ingested content, when the caller asks for it and an
  // organisation publisher is configured.
  const grounded = !!(o.grounded && process.env.GLOO_PUBLISHER);
  if (grounded) {
    body.rag_publisher = process.env.GLOO_PUBLISHER;
    body.sources_limit = Math.min(10, Math.max(1, Number(o.sourcesLimit) || 3));
    body.include_citations = true;
  }

  const kind = o.kind || 'chat';
  const key = cacheKey(kind, body);
  if (o.cache !== false) {
    const hit = cacheGet(key);
    if (hit) return { ...hit, cached: true };
  }

  const tok = await accessToken();
  if (!tok) return null;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(grounded ? GROUNDED_URL : CHAT_URL, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + tok,
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    if (!res.ok) {
      // A 401 means our cached token was rejected; drop it so the next call
      // fetches a fresh one rather than repeating the failure for an hour.
      if (res.status === 401) token = null;
      logCall({ kind, userId: o.userId, tradition: trad, ok: false,
                error: 'http ' + res.status });
      return null;
    }
    const json = await res.json();
    const choice = json?.choices?.[0];
    const text = choice?.message?.content;
    if (typeof text !== 'string' || !text.trim()) {
      logCall({ kind, userId: o.userId, tradition: trad, ok: false, error: 'empty' });
      return null;
    }

    // A truncated completion is not a shorter answer, it is a corrupted one.
    // Observed live: a reply cut mid-reference turned "Philippians 4:13" into
    // "Philippians 4:1" — still a real verse, so no downstream reference check
    // could ever catch it. Length-stopped output is therefore discarded, not
    // trimmed and used.
    const finish = choice.finish_reason || null;
    if (finish && finish !== 'stop') {
      logCall({ kind, userId: o.userId, tradition: trad, ok: false,
                error: 'finish_reason ' + finish });
      return null;
    }

    const out = {
      text: text.trim(),
      finish_reason: finish,
      model: json.model || null,
      routing_tier: json.routing_tier || null,
      routing_confidence: json.routing_confidence ?? null,
      tradition: json.tradition || trad || null,
      citations: Array.isArray(json.citations) ? json.citations : [],
      usage: json.usage || null,
      cached: false,
    };
    if (o.cache !== false) cachePut(key, kind, out, o.cacheDays || 30);
    logCall({
      kind, userId: o.userId, tradition: trad, model: out.model,
      routingTier: out.routing_tier, routingConfidence: out.routing_confidence,
      promptTokens: out.usage?.prompt_tokens, completionTokens: out.usage?.completion_tokens,
      ok: true,
    });
    return out;
  } catch (e) {
    logCall({ kind, userId: o.userId, tradition: trad, ok: false,
              error: e && e.name === 'AbortError' ? 'timeout' : 'network' });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A chat call whose reply must be a JSON object.
 *
 * Models here wrap JSON in ```json fences even when told not to, so the fence
 * is stripped rather than fought. Returns null if the reply will not parse —
 * callers already have a fallback for null, and a half-understood object is
 * worse than none.
 */
async function chatJson(opts) {
  const res = await chat(opts);
  if (!res) return null;
  let body = res.text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(body);
  if (fenced) body = fenced[1].trim();
  try {
    const parsed = JSON.parse(body);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return { ...res, json: parsed };
  } catch {
    return null;
  }
}

// --- The honesty guardrail --------------------------------------------------
// Books are matched by name, including the numbered ones and the common
// abbreviations a model actually emits ("1 Cor.", "Phil", "Ps 23:1").
const BOOK_WORD =
  '(?:[123]\\s*)?(?:Genesis|Gen|Exodus|Exod?|Leviticus|Lev|Numbers|Num|Deuteronomy|Deut?' +
  '|Joshua|Josh|Judges|Judg|Ruth|Samuel|Sam|Kings|Kgs|Chronicles|Chron|Chr|Ezra|Nehemiah|Neh' +
  '|Esther|Esth|Job|Psalms|Psalm|Pss|Ps|Proverbs|Prov|Ecclesiastes|Eccl|Ecc' +
  '|Song of Solomon|Song of Songs|Isaiah|Isa|Jeremiah|Jer|Lamentations|Lam|Ezekiel|Ezek' +
  '|Daniel|Dan|Hosea|Hos|Joel|Amos|Obadiah|Obad|Jonah|Micah|Mic|Nahum|Nah|Habakkuk|Hab' +
  '|Zephaniah|Zeph|Haggai|Hag|Zechariah|Zech|Malachi|Mal|Matthew|Matt|Mark|Luke|John|Acts' +
  '|Romans|Rom|Corinthians|Cor|Galatians|Gal|Ephesians|Eph|Philippians|Phil|Philemon|Phlm' +
  '|Colossians|Col|Thessalonians|Thess|Timothy|Tim|Titus|Hebrews|Heb|James|Jas|Peter|Pet' +
  '|Jude|Revelation|Rev)';
const REF_RE = new RegExp('\\b' + BOOK_WORD + '\\.?\\s+\\d+\\s*:\\s*\\d+(?:\\s*[-–]\\s*\\d+)?', 'gi');

// Anything *shaped* like a citation — a capitalised word followed by
// chapter:verse — whether or not the word is a real book.
//
// Matching only real book names was not enough. A model that invents
// "Hezekiah 3:16" produces something no book-name pattern recognises, so it
// would pass through unexamined and be printed to a member as though it were
// a citation they could look up. Everything citation-shaped is extracted, and
// an unrecognised book is treated as a reference that failed to resolve.
const LOOSE_REF_RE =
  /\b(?:[123]\s*)?[A-Z][A-Za-z]+(?:\s+of\s+[A-Z][A-Za-z]+)*\.?\s+\d+\s*:\s*\d+(?:\s*[-–]\s*\d+)?/g;

function tidyRef(raw) {
  return String(raw).replace(/\s*\.\s*/g, ' ').replace(/\s+/g, ' ')
    .replace(/\s*:\s*/, ':').trim();
}

/**
 * Every scripture reference that appears in a block of model output.
 *
 * Deliberately over-inclusive: a false positive costs one resolver lookup that
 * comes back empty, while a false negative puts an unverified citation in front
 * of a member.
 */
function extractRefs(text) {
  const s = String(text || '');
  const seen = new Set();
  const out = [];
  for (const raw of [...(s.match(REF_RE) || []), ...(s.match(LOOSE_REF_RE) || [])]) {
    const ref = tidyRef(raw);
    const k = ref.toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(ref); }
  }
  return out;
}

/**
 * Resolve every reference cited in model output against real scripture.
 *
 * `resolve` is injected (async, reference -> text or null) so this stays
 * testable and so the caller decides whether the local library, the YouVersion
 * Platform, or both are consulted.
 *
 * Returns { verified, rejected, ok } where `verified` carries the real text.
 * `ok` is false when the model cited references and none of them resolved —
 * the signal for a caller to discard the response and fall back.
 */
async function verifyRefs(text, resolve, meta) {
  const refs = extractRefs(text);
  const verified = [];
  const rejected = [];
  for (const ref of refs) {
    let hit = null;
    try { hit = await resolve(ref); } catch { hit = null; }
    if (hit && hit.text) verified.push({ reference: hit.reference || ref, text: hit.text });
    else rejected.push(ref);
  }
  // Recorded so /api/ai/status can report how many citations were checked and
  // how many survived — the audit trail behind the claim, not just the claim.
  if (refs.length) {
    logCall({
      kind: (meta && meta.kind) || 'verify',
      userId: meta && meta.userId,
      tradition: meta && meta.tradition,
      refsCited: refs.length,
      refsVerified: verified.length,
      ok: verified.length > 0,
      error: rejected.length ? 'unresolved: ' + rejected.join(', ').slice(0, 200) : null,
    });
  }
  return { verified, rejected, ok: refs.length === 0 || verified.length > 0 };
}

function start() {
  init();
  if (!isConfigured()) {
    console.log('[gloo] no GLOO_CLIENT_ID/GLOO_CLIENT_SECRET — ' +
                'authored scripture only, no companion, no generated reflection');
    return;
  }
  // Prove the credentials at boot rather than at a member's first question.
  accessToken().then((t) => {
    console.log(t ? '[gloo] authenticated, values-aligned inference available'
                  : '[gloo] credentials present but rejected — falling back to authored scripture');
  }).catch(() => {});
}

module.exports = {
  start, init, isConfigured, chat, chatJson, stats,
  extractRefs, verifyRefs, normaliseTradition, TRADITIONS,
  _cache: { cacheKey, cacheGet, cachePut },
};
