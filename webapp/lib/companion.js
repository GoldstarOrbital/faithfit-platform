/**
 * Where Gloo and YouVersion meet.
 *
 * This is the only module that calls both, and it exists to enforce one
 * division of labour that neither API can enforce on its own:
 *
 *     Gloo AI      decides WHICH scripture fits this moment, and writes the
 *                  words around it, shaped to the member's own tradition.
 *
 *     YouVersion   supplies WHAT THE VERSE ACTUALLY SAYS.
 *
 * Neither half is optional and neither half substitutes for the other. A model
 * asked to recall scripture will produce something verse-shaped and be subtly
 * wrong — a word swapped, a clause dropped, a reference off by one. So no text
 * a model emits is ever shown to a member as scripture. The model hands back a
 * reference; the reference is resolved against the YouVersion Platform (or the
 * locally ingested public-domain library, which is verified word-for-word); and
 * if it will not resolve, the whole answer is thrown away and the caller falls
 * back to the hand-authored verse lists the app has always had.
 *
 * Three checks stand between a model and a member, in order:
 *
 *   1. `finish_reason` must be "stop"       (lib/gloo.js — a truncated reply
 *                                            once turned Phil 4:13 into 4:1,
 *                                            which no later check could catch)
 *   2. every cited reference must resolve   (gloo.verifyRefs + resolveRef here)
 *   3. verse text always comes from the resolver, never from the reply
 *
 * With Gloo unconfigured every function here returns null and every caller
 * falls back. The app is fully functional in that state — it is the state it
 * shipped in.
 */
'use strict';

const gloo = require('./gloo');
const youversion = require('./youversion');
const moments = require('./moments');

/**
 * Real text for a reference: the local verified library first, the YouVersion
 * Platform second. Returns null rather than anything invented.
 *
 * The local library is preferred because it is ingested and checked
 * word-for-word against source, and because it costs nothing; YouVersion lifts
 * the ceiling to the whole canon in the member's own translation.
 */
async function resolveRef(reference, versionId) {
  if (!reference) return null;
  let lookupLocal = null;
  try { lookupLocal = require('./journeys').lookupScriptureText; } catch { /* optional */ }

  // A member reading in a specific translation should get that translation,
  // so the local WEB copy is only used when no preference is expressed.
  if (!versionId && typeof lookupLocal === 'function') {
    const local = lookupLocal(reference);
    if (local) return { reference, text: local, source: 'local' };
  }
  const yv = await youversion.passage(reference, versionId);
  if (yv && yv.text) {
    return { reference: yv.reference || reference, text: yv.text,
             source: 'youversion', version_id: yv.version_id };
  }
  if (typeof lookupLocal === 'function') {
    const local = lookupLocal(reference);
    if (local) return { reference, text: local, source: 'local' };
  }
  return null;
}

/** Strip the fenced/quoted forms a model uses when it ignores "don't quote". */
function cleanNote(s, maxWords) {
  let t = String(s || '').replace(/\s+/g, ' ').trim().replace(/^["'“”]|["'“”]$/g, '');
  const words = t.split(' ');
  if (maxWords && words.length > maxWords) t = words.slice(0, maxWords).join(' ');
  return t;
}

// ---------------------------------------------------------------------------
// 1. Scripture chosen for the moment you are actually in
// ---------------------------------------------------------------------------
/**
 * Pick the verse for a live session moment, and write one line about it.
 *
 * The app already classifies the moment from real telemetry (`lib/moments.js`)
 * and already has an authored shortlist per moment. What it could not do was
 * weigh *this* member's actual numbers — eleven minutes in zone 4, a 6% ramp
 * coming, the third session this week — against that shortlist, or say anything
 * about the verse that was not written months ago for everyone.
 *
 * The shortlist is passed in as candidates and the model is asked to choose
 * from it. That keeps selection inside scripture a human already vetted for the
 * moment, while the judgement about which one fits *now* is made with the real
 * numbers in hand. The model may propose something outside the list; if it
 * does, the reference still has to resolve like any other.
 *
 * @returns {Promise<null|{reference,text,note,source,tradition,model,chosen_from}>}
 */
async function momentVerse(opts) {
  const o = opts || {};
  if (!gloo.isConfigured()) return null;

  const moment = o.moment && moments.MOMENTS[o.moment] ? o.moment : null;
  if (!moment) return null;
  const def = moments.MOMENTS[moment];

  const seen = new Set(o.seenRefs || []);
  const candidates = def.refs.filter(r => !seen.has(r));
  if (!candidates.length) return null;          // nothing fresh left to choose

  // Only facts that were actually measured are described as measured. This
  // mirrors the rule in lib/moments.js: pace is never dressed up as physiology.
  const facts = [];
  if (Number.isFinite(o.distanceKm) && o.distanceKm > 0) {
    facts.push(`${o.distanceKm.toFixed(1)} km covered` +
               (o.totalKm ? ` of ${Number(o.totalKm).toFixed(1)} km` : ''));
  }
  if (Number.isFinite(o.elapsedSec) && o.elapsedSec > 0) {
    facts.push(`${Math.round(o.elapsedSec / 60)} minutes in`);
  }
  if (o.measured && Number.isFinite(o.hr) && o.hr > 0) {
    facts.push(`heart rate ${Math.round(o.hr)} bpm` +
               (o.zone ? `, zone ${o.zone} (measured by a chest strap)` : ''));
  }
  if (Number.isFinite(o.gradeAhead) && o.gradeAhead >= 1) {
    facts.push(`a climb of about ${Number(o.gradeAhead).toFixed(1)}% just ahead`);
  }
  if (o.reason) facts.push(o.reason);

  const prompt =
    `You are helping someone mid-workout in a Christian fitness app. They are at this ` +
    `moment: ${def.label} — ${def.blurb}\n\n` +
    `What is actually true right now:\n` +
    (facts.length ? facts.map(f => '- ' + f).join('\n') : '- no sensor data available') +
    `\n\nChoose the ONE scripture from this list that best meets this exact moment:\n` +
    candidates.map(r => '- ' + r).join('\n') +
    `\n\nReply with ONLY compact JSON, no prose and no code fence:\n` +
    `{"reference":"<one reference exactly as written above>","note":"<one sentence, max 22 words>"}\n\n` +
    `Rules for "note": speak to them directly and briefly. Do NOT quote, paraphrase, ` +
    `or restate the verse — they will see its real text beside your sentence. ` +
    `Do NOT claim anything about their body that is not listed above.`;

  const res = await gloo.chatJson({
    kind: 'moment_verse',
    userId: o.userId,
    tradition: o.tradition,
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 800,
    // Same moment + same tradition + same shortlist recurs constantly across a
    // session and across members; caching makes this affordable.
    cacheDays: 30,
  });
  if (!res || !res.json) return null;

  const reference = String(res.json.reference || '').trim();
  if (!reference) return null;

  const resolved = await resolveRef(reference, o.versionId);
  if (!resolved) return null;                   // check 2: unresolvable -> discard

  const note = cleanNote(res.json.note, 30);
  if (!note) return null;

  return {
    reference: resolved.reference,
    text: resolved.text,                        // check 3: text from the resolver
    note,
    source: resolved.source,
    version_id: resolved.version_id || null,
    tradition: res.tradition || null,
    model: res.model || null,
    chosen_from: candidates.length,
    cached: !!res.cached,
  };
}

// ---------------------------------------------------------------------------
// 2. Scripture as conversation
// ---------------------------------------------------------------------------
/**
 * Answer a member's question about a verse, in their own tradition.
 *
 * The app already has verse threads — one canonical thread per reference, where
 * people reply to each other. This adds a companion to that room, not a
 * replacement for it: it answers the question that stalls a thread ("what does
 * 'ruach' mean here?", "who is being addressed?") so the human conversation can
 * keep going.
 *
 * The verse under discussion is fetched first and supplied to the model as
 * context, so it is reasoning about the real text rather than its recollection
 * of it. Any further reference it brings in is resolved and returned alongside,
 * and one that cannot be resolved is dropped from the answer.
 */
async function askAboutVerse(opts) {
  const o = opts || {};
  if (!gloo.isConfigured()) return null;

  const reference = String(o.reference || '').trim();
  const question = String(o.question || '').trim();
  if (!reference || !question) return null;
  if (question.length > 500) return null;

  const base = await resolveRef(reference, o.versionId);
  if (!base) return null;      // we will not discuss a verse we cannot quote

  const prompt =
    `A member of a Christian fitness and community app is reading this passage:\n\n` +
    `${base.reference}\n"${base.text}"\n\n` +
    `Their question: ${question}\n\n` +
    `Answer in 2-4 short sentences, plainly, as if talking to a friend after church. ` +
    `Ground your answer in the passage above. If another passage genuinely helps, ` +
    `cite it by reference (e.g. "Romans 8:28") — but do NOT write out its words, ` +
    `because the app will show the real text for any reference you cite. ` +
    `If the question cannot be answered from scripture, say so honestly.`;

  const res = await gloo.chat({
    kind: 'verse_companion',
    userId: o.userId,
    tradition: o.tradition,
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 900,
    // Grounded in our own ingested library when a publisher is configured;
    // silently a normal completion when it is not.
    grounded: true,
    sourcesLimit: 3,
    cacheDays: 14,
  });
  if (!res) return null;

  // Check 2: every reference the answer cites must be real.
  const check = await gloo.verifyRefs(res.text, (r) => resolveRef(r, o.versionId),
    { kind: 'verse_companion_refs', userId: o.userId, tradition: res.tradition });
  if (!check.ok) return null;   // it cited chapter and verse, and none of it was real

  // A reference that did not resolve is removed from the prose rather than left
  // as a citation the member cannot follow.
  let answer = res.text;
  for (const bad of check.rejected) {
    answer = answer.split(bad).join('that passage');
  }

  return {
    reference: base.reference,
    text: base.text,
    answer: answer.trim(),
    also: check.verified.filter(v => v.reference !== base.reference),
    dropped: check.rejected.length,
    citations: res.citations || [],
    tradition: res.tradition || null,
    model: res.model || null,
    cached: !!res.cached,
  };
}

module.exports = { momentVerse, askAboutVerse, resolveRef, cleanNote };
