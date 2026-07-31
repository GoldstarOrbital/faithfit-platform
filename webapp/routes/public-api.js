/**
 * The public developer API.
 *
 * Functioning Faith already sends events out (lib/webhooks.js). This lets other
 * software ask it things — so the scripture engine built here can run inside a
 * game, a wearable companion, a church's own app, or a creator's stream overlay
 * without any of them re-solving the hard part.
 *
 * The hard part is not "return a verse". It is returning one that is real, that
 * fits the moment, and that never invents anything. Every response from this
 * router goes through the same resolver the app itself uses, so an integrator
 * gets the guarantee, not just the text:
 *
 *   - `text` is always real scripture, from YouVersion or the verified local
 *     library. `source` says which.
 *   - `note`, when present, is the only model-written field, and it is labelled.
 *   - a reference that cannot be resolved returns 404, never a guess.
 *
 * Auth is a bearer API key (lib/apikeys.js). CORS is open for reads because
 * that is the point of a public read API, and the key is what gates it.
 */
'use strict';

const express = require('express');
const router = express.Router();

const apikeys = require('../lib/apikeys');
const youversion = require('../lib/youversion');
const companion = require('../lib/companion');
const moments = require('../lib/moments');
const contexts = require('../lib/contexts');
const breathwork = require('../lib/breathwork');
const gloo = require('../lib/gloo');
const { lookupScriptureText } = require('../lib/journeys');

// Browser-based integrations are a first-class case, so preflight is answered
// for every route here rather than only where a body is posted.
router.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

/** Bearer-key auth plus hourly budget. `bucket` separates metered endpoints. */
function requireKey(scope, bucket) {
  return (req, res, next) => {
    const header = String(req.get('authorization') || '');
    const presented = /^Bearer\s+(.+)$/i.exec(header);
    const key = presented ? apikeys.verify(presented[1]) : null;
    if (!key) {
      return res.status(401).json({
        error: 'unauthorized',
        hint: 'Send your key as "Authorization: Bearer ff_live_…". Create one in the app under Developer.',
      });
    }
    if (!apikeys.hasScope(key, scope)) {
      return res.status(403).json({ error: 'missing_scope', required: scope, granted: key.scopes });
    }
    const quota = apikeys.consume(key.id, bucket || 'default');
    res.set('X-RateLimit-Limit', String(quota.limit));
    res.set('X-RateLimit-Remaining', String(quota.remaining));
    res.set('X-RateLimit-Reset', quota.reset);
    if (!quota.ok) {
      return res.status(429).json({ error: 'rate_limited', limit: quota.limit, reset: quota.reset });
    }
    req.apiKey = key;
    next();
  };
}

// --- Discovery --------------------------------------------------------------
// Unauthenticated on purpose: a developer should be able to see what exists
// before deciding whether to sign up for a key.
router.get('/', (req, res) => {
  res.json({
    name: 'Functioning Faith API',
    version: '1',
    description: 'Verified scripture, chosen for the moment someone is actually in.',
    auth: 'Authorization: Bearer ff_live_…',
    scopes: apikeys.SCOPES,
    rate_limits: {
      default: apikeys.RATE_LIMIT_PER_HOUR + '/hour',
      moment: apikeys.MOMENT_LIMIT_PER_HOUR + '/hour (reaches values-aligned inference)',
    },
    guarantees: [
      'Verse text is always real, from YouVersion or a word-for-word verified public-domain library.',
      'A reference that cannot be resolved returns 404 rather than invented text.',
      'The only model-written field is "note", and it is always labelled as such.',
    ],
    endpoints: {
      'GET  /v1/versions': 'Available Bible translations.',
      'GET  /v1/books': 'The canon index — every book and its chapter count.',
      'GET  /v1/books/:book/chapters': 'Chapters in a book, with verse counts.',
      'GET  /v1/scripture/:reference': 'Verified text for a reference. ?version= to choose a translation.',
      'GET  /v1/moments': 'The moment types the engine recognises.',
      'POST /v1/moment': 'Telemetry in, a fitting verse out.',
      'POST /v1/rest': 'A heart-rate reading taken at rest, in; a fitting verse out.',
      'GET  /v1/breathwork': 'Guided breathing patterns with their scripture.',
    },
    docs: '/developers',
  });
});

// --- Scripture --------------------------------------------------------------
router.get('/versions', requireKey('scripture:read'), (req, res) => {
  res.json({ default: youversion.DEFAULT_VERSION, versions: youversion.versions() });
});

router.get('/books', requireKey('scripture:read'), (req, res) => {
  const books = youversion.books();
  if (!books.length) {
    return res.status(503).json({ error: 'canon_unavailable',
      hint: 'The canon index has not been loaded — the YouVersion Platform is not configured on this instance.' });
  }
  res.json({ books });
});

router.get('/books/:book/chapters', requireKey('scripture:read'), (req, res) => {
  const chapters = youversion.chapters(req.params.book);
  if (!chapters.length) return res.status(404).json({ error: 'unknown_book' });
  res.json({ book: String(req.params.book).toUpperCase(), chapters });
});

router.get('/scripture/:reference', requireKey('scripture:read'), async (req, res) => {
  const reference = String(req.params.reference || '').trim();
  const versionId = req.query.version ? Number(req.query.version) : null;

  const hit = await companion.resolveRef(reference, versionId);
  if (!hit) {
    // Distinguish "not a real address" from "we cannot fetch it", because the
    // fix is different for each and an integrator deserves to know which.
    const exists = youversion.canonHas(reference);
    return res.status(404).json({
      error: exists === false ? 'not_in_canon' : 'unresolved',
      reference,
      hint: exists === false
        ? 'That chapter or verse does not exist in the canon.'
        : 'No verified text is available for that reference. Nothing is ever invented to fill the gap.',
    });
  }
  res.json({
    reference: hit.reference,
    text: hit.text,
    source: hit.source,                       // 'youversion' | 'local'
    version_id: hit.version_id || null,
    deep_link: youversion.deepLink(hit.reference, versionId),
  });
});

// --- Moments ----------------------------------------------------------------
router.get('/moments', requireKey('moment:read'), (req, res) => {
  const shape = (obj) => Object.entries(obj).map(([key, m]) => ({
    key, label: m.label, blurb: m.blurb, candidates: m.refs.length,
  }));
  res.json({ workout: shape(moments.MOMENTS), rest: shape(contexts.CONTEXTS) });
});

/**
 * The app's signature capability, offered as a service.
 *
 * Send what a session actually measured; get back the moment it classifies to
 * and a verse chosen for it. The honesty rules travel with it: heart-rate
 * derived moments require `hr_measured: true`, and `measured` in the response
 * says which kind of read this was.
 */
router.post('/moment', requireKey('moment:read', 'moment'), async (req, res) => {
  const b = req.body || {};
  const state = moments.classify({
    elapsed_sec: b.elapsed_sec,
    distance_km: b.distance_km,
    total_km: b.total_km,
    speed_kmh: b.speed_kmh,
    recent_speeds: b.recent_speeds,
    hr: b.hr_measured ? b.hr : null,
    recent_hr: b.hr_measured ? b.recent_hr : null,
    max_hr: b.max_hr,
    terrain: b.terrain,
    trigger: b.trigger,
    grade_ahead: b.grade_ahead,
  });

  const seen = Array.isArray(b.seen_refs) ? b.seen_refs.map(String) : [];
  const tradition = gloo.normaliseTradition(b.tradition);
  let verse = null;

  try {
    const picked = await companion.momentVerse({
      moment: state.moment, seenRefs: seen, tradition,
      versionId: b.version_id, measured: state.measured, zone: state.zone,
      hr: b.hr_measured ? b.hr : null,
      distanceKm: Number(b.distance_km), totalKm: Number(b.total_km),
      elapsedSec: Number(b.elapsed_sec), gradeAhead: Number(b.grade_ahead),
      reason: state.reason,
    });
    if (picked) verse = { ...picked, chosen_by: 'values-aligned-ai' };
  } catch { /* authored fallback below */ }

  if (!verse) {
    const tried = seen.slice();
    for (let i = 0; i < 6 && !verse; i++) {
      const ref = moments.pickRef(state.moment, tried);
      if (!ref) break;
      const text = lookupScriptureText(ref);
      if (text) verse = { reference: ref, text, source: 'local', chosen_by: 'authored' };
      else tried.push(ref);
    }
  }

  res.json({ ...state, verse, tradition: tradition || null });
});

/**
 * A heart rate taken while still.
 *
 * `resting_hr` is required and never estimated: "elevated" is a comparison, and
 * a comparison against a number we invented would mean nothing. Integrators get
 * the same refusal the app gives its own members.
 */
router.post('/rest', requireKey('moment:read', 'moment'), async (req, res) => {
  const b = req.body || {};
  const state = contexts.classifyRest({
    hr: b.hr_measured ? b.hr : null,
    recent_hr: b.hr_measured ? b.recent_hr : null,
    resting_hr: b.resting_hr,
    max_hr: b.max_hr,
    moving: !!b.moving,
  });
  if (!state.context) return res.json({ ...state, verse: null, suggested_pattern: null });

  const seen = Array.isArray(b.seen_refs) ? b.seen_refs.map(String) : [];
  const tradition = gloo.normaliseTradition(b.tradition);
  let verse = null;
  try {
    const picked = await companion.restVerse({ state, seenRefs: seen, tradition, versionId: b.version_id });
    if (picked) verse = { ...picked, chosen_by: 'values-aligned-ai' };
  } catch { /* fallback below */ }
  if (!verse) {
    const tried = seen.slice();
    for (let i = 0; i < 6 && !verse; i++) {
      const ref = contexts.pickRef(state.context, tried);
      if (!ref) break;
      const text = lookupScriptureText(ref);
      if (text) verse = { reference: ref, text, source: 'local', chosen_by: 'authored' };
      else tried.push(ref);
    }
  }
  const key = contexts.suggestPattern(state.context);
  const pattern = key ? breathwork.byKey(key) : null;
  res.json({
    ...state, verse,
    suggested_pattern: pattern ? { key: pattern.key, name: pattern.name } : null,
    tradition: tradition || null,
  });
});

// --- Breathwork -------------------------------------------------------------
router.get('/breathwork', requireKey('breathwork:read'), (req, res) => {
  res.json({ patterns: breathwork.list(lookupScriptureText) });
});

module.exports = router;
