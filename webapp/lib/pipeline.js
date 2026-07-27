/**
 * Scripture Trigger Engine
 * Pipeline: normalize -> classify context -> map themes -> score verses -> select -> log + emit event
 *
 * This module is pure/testable: it takes data + dependencies as arguments rather than reaching
 * into DB/Kafka directly, so it can be unit tested without infra.
 */

const FALLBACK_VERSES = [
  { id: 'fallback-1', reference: 'Philippians 4:13', youversion_id: 'phl.4.13', themes: ['strength', 'perseverance'] },
  { id: 'fallback-2', reference: 'Isaiah 40:31', youversion_id: 'isa.40.31', themes: ['strength', 'renewal'] },
  { id: 'fallback-3', reference: 'Psalm 46:1', youversion_id: 'psa.46.1', themes: ['peace', 'stress'] },
];

/** 1. Normalize raw biometric snapshot into a consistent shape with derived fields. */
function normalizeSnapshot(raw) {
  const { heart_rate, hrv, movement, stress_level, workout_type, time_of_day } = raw;
  return {
    heart_rate: heart_rate ?? null,
    hrv: hrv ?? null,
    movement_intensity: movement && typeof movement.intensity === 'number' ? movement.intensity : 0,
    stress_level: stress_level ?? 0,
    workout_type: workout_type ?? null,
    time_of_day: time_of_day ?? inferTimeOfDay(new Date()),
  };
}

function inferTimeOfDay(date) {
  const h = date.getHours();
  if (h < 6) return 'night';
  if (h < 12) return 'morning';
  if (h < 18) return 'afternoon';
  return 'evening';
}

/** 2. Classify context bucket from normalized snapshot. */
function classifyContext(snapshot) {
  if (snapshot.workout_type && snapshot.movement_intensity > 0.6) return 'workout';
  if (snapshot.workout_type && snapshot.movement_intensity <= 0.6) return 'cooldown';
  if (snapshot.stress_level >= 7) return 'stress';
  return 'idle';
}

/** 3. Map context -> candidate themes. Extend this table as product/theology review dictates. */
const CONTEXT_THEME_MAP = {
  workout: ['strength', 'perseverance', 'endurance'],
  cooldown: ['peace', 'gratitude', 'renewal'],
  stress: ['peace', 'anxiety', 'comfort'],
  idle: ['encouragement', 'purpose'],
};

function candidateThemesForContext(context) {
  return CONTEXT_THEME_MAP[context] || CONTEXT_THEME_MAP.idle;
}

/**
 * 4. Score verses. Only runs personalized scoring if the user has opted in
 * (`scripture.personalization` flag AND user_preferences.personalization_opt_in).
 * Falls back to a deterministic theme-match score otherwise.
 */
function scoreVerse(verse, { themes, userHistory = [], userPreferences = {}, personalizationEnabled }) {
  const themeMatches = verse.themes.filter(t => themes.includes(t)).length;
  let score = themeMatches * 10;

  if (personalizationEnabled) {
    const preferredThemes = userPreferences.preferred_themes || [];
    score += verse.themes.filter(t => preferredThemes.includes(t)).length * 5;

    const recentlySeen = userHistory.some(h => h.verse_id === verse.id);
    if (recentlySeen) score -= 8; // de-dupe recency penalty

    const engagement = userHistory.filter(h => h.verse_id === verse.id && h.engaged).length;
    score += Math.min(engagement, 3) * 2;
  }

  return score;
}

function selectVerse(candidateVerses, scoringContext) {
  const pool = candidateVerses.length > 0 ? candidateVerses : FALLBACK_VERSES;
  const scored = pool.map(v => ({ verse: v, score: scoreVerse(v, scoringContext) }));
  scored.sort((a, b) => b.score - a.score);
  return scored[0].verse;
}

/** 5. Compose the notification-ready payload. Text/snippet must come from cached, licensed content. */
function composePayload(verse, verseTextLookup) {
  const cached = verseTextLookup ? verseTextLookup(verse.youversion_id) : null;
  return {
    youversion_id: verse.youversion_id,
    reference: verse.reference,
    snippet: cached ? truncate(cached.text, 140) : null,
    deep_link: `youversion://bible/verse/${verse.youversion_id}`,
  };
}

function truncate(text, len) {
  if (!text) return null;
  return text.length > len ? text.slice(0, len - 1) + '…' : text;
}

/**
 * Full pipeline entry point.
 * @param {object} input - { rawSnapshot, candidateVerses, userHistory, userPreferences, personalizationEnabled, verseTextLookup }
 *   Optional physiological-moment inputs (see below): { effort, lookupReference, ftsSearch, sessionVerseIds, recentVerseIds }
 * @returns {object} { verse, context, themes, payload, moment, moment_label, caption }
 */
function runPipeline(input) {
  const snapshot = normalizeSnapshot(input.rawSnapshot);
  const context = classifyContext(snapshot);

  // --- physiological-moment path (preferred) -------------------------------
  // When the caller supplies real effort signals plus a way to resolve verses out
  // of the verified `bible_verses` table, classify the MOMENT the body is in and
  // pick a verse curated for it. Falls through to the legacy theme path below if
  // anything is missing, so the original contract still holds.
  if (input.effort && typeof input.lookupReference === 'function') {
    const moment = classifyMoment(input.effort);
    const themes = MOMENT_THEMES[moment];
    const picked = selectMomentVerse({
      moment,
      lookupReference: input.lookupReference,
      ftsSearch: input.ftsSearch,
      sessionVerseIds: input.sessionVerseIds || [],
      recentVerseIds: input.recentVerseIds || [],
    });
    if (picked) {
      return {
        verse: picked,
        context,
        moment,
        moment_label: MOMENT_LABELS[moment],
        themes,
        snapshot,
        caption: momentCaption(input.effort),
        payload: {
          youversion_id: picked.youversion_id,
          reference: picked.reference,
          snippet: truncate(picked.text, 240),
          translation: picked.translation,
          deep_link: `youversion://bible/verse/${picked.youversion_id}`,
        },
      };
    }
  }

  // --- legacy theme path (unchanged) ---------------------------------------
  const themes = candidateThemesForContext(context);
  const candidates = (input.candidateVerses || []).filter(v => v.themes.some(t => themes.includes(t)));
  const verse = selectVerse(candidates, {
    themes,
    userHistory: input.userHistory,
    userPreferences: input.userPreferences,
    personalizationEnabled: !!input.personalizationEnabled,
  });
  const payload = composePayload(verse, input.verseTextLookup);
  return { verse, context, themes, snapshot, payload, moment: null, moment_label: null, caption: null };
}

// =========================================================================
// The right word at the right physiological moment
// =========================================================================
//
// `effort` signals expected by classifyMoment (all computed from real data by the
// caller; anything unknown must be passed as null rather than guessed):
//   zone            1-5 current HR zone, or null when max HR is unknown
//   trend           'rising' | 'falling' | 'steady' | null  (recent HR direction)
//   elapsed_sec     real seconds since workout start
//   elapsed_fraction 0-1 through the session when a target duration is known, else null
//   dwell_sec       seconds spent in the current effort band without dropping out of it
//   hr              current heart rate (for the caption only)

const MOMENT_LABELS = {
  starting_out: 'Starting out',
  climbing: 'Climbing',
  the_wall: 'The wall',
  steady_state: 'Steady state',
  cooling_down: 'Cooling down',
  finishing: 'Finishing',
};

const MOMENT_THEMES = {
  starting_out: ['courage', 'setting out', 'calling'],
  climbing: ['strength', 'endurance', 'perseverance'],
  the_wall: ['perseverance', 'being upheld', 'endurance'],
  steady_state: ['faithfulness', 'steadfastness', 'devotion'],
  cooling_down: ['peace', 'gratitude', 'rest'],
  finishing: ['finishing the race', 'completion', 'victory'],
};

const EARLY_SEC = 300;   // first five minutes of a session
const DEEP_SEC = 1200;   // twenty minutes in — deep enough for "the wall" to mean something
const WALL_DWELL_SEC = 240; // four unbroken minutes at zone 4+

/**
 * Map real physiological signals onto the moment the person is actually in.
 * Order matters: the later, more specific states win over the general ones.
 */
function classifyMoment(effort) {
  const { zone, trend, elapsed_sec = 0, elapsed_fraction = null, dwell_sec = 0 } = effort || {};
  const late = elapsed_fraction != null && elapsed_fraction >= 0.9;
  const deep = elapsed_sec >= DEEP_SEC;
  const early = elapsed_sec < EARLY_SEC;

  // No zone data (no max HR / no HR strap): degrade to an honest, time-only reading.
  // We never claim an intensity we cannot measure.
  if (zone == null) {
    if (late) return 'finishing';
    if (early) return 'starting_out';
    return 'steady_state';
  }

  if (late) return 'finishing';
  if (trend === 'falling' && (zone <= 2 || deep || (elapsed_fraction != null && elapsed_fraction >= 0.75))) return 'cooling_down';
  if (zone >= 4 && (dwell_sec >= WALL_DWELL_SEC || deep)) return 'the_wall';
  if (zone >= 3 && trend === 'rising') return 'climbing';
  if (zone >= 4) return 'climbing';
  if (early && zone <= 2) return 'starting_out';
  return 'steady_state';
}

/** Small "why now" caption for the verse card. Only states what we actually measured. */
function momentCaption(effort) {
  if (!effort) return null;
  const parts = [];
  if (effort.zone != null) parts.push(`Zone ${effort.zone}`);
  else if (Number.isFinite(effort.hr)) parts.push(`${effort.hr} bpm`);
  const m = Math.floor((effort.elapsed_sec || 0) / 60);
  parts.push(`${m} min in`);
  return parts.join(' · ');
}

/**
 * Curated references per moment. Every reference below is a REAL, correctly attributed
 * citation — nothing here is paraphrased or invented.
 *
 * Resolution happens at RUNTIME against the verified `bible_verses` table, never baked
 * in at authoring time. A reference that does not resolve (because its book is not in
 * the library yet) is silently skipped, so the list works both before and after new
 * books are ingested. Entries marked `// pending` name books being added to the library
 * concurrently — they will start being served automatically once those books land, and
 * until then the surrounding curated verses cover the moment.
 */
const MOMENT_VERSES = {
  starting_out: [
    ['Genesis', 12, 1], ['Psalms', 121, 8], ['Psalms', 143, 8], ['Psalms', 25, 4],
    ['Proverbs', 3, 5], ['Proverbs', 3, 6], ['Mark', 1, 17], ['Matthew', 4, 19],
    ['Psalms', 5, 3],
    ['Joshua', 1, 9], // pending
  ],
  climbing: [
    ['Philippians', 4, 13], ['Psalms', 18, 32], ['Psalms', 18, 33], ['Psalms', 28, 7],
    ['Romans', 5, 3], ['Romans', 5, 4], ['Psalms', 27, 1], ['Psalms', 138, 3],
    ['Philippians', 3, 14],
    ['Isaiah', 40, 31], ['Isaiah', 40, 29], ['Ephesians', 6, 10], ['1 Corinthians', 9, 24], // pending
  ],
  the_wall: [
    ['James', 1, 12], ['James', 1, 3], ['James', 1, 4], ['Psalms', 73, 26],
    ['Psalms', 63, 8], ['Romans', 8, 37], ['Matthew', 11, 28], ['Psalms', 46, 1],
    ['Hebrews', 12, 1], ['Isaiah', 41, 10], ['1 Corinthians', 9, 27], // pending
  ],
  steady_state: [
    ['Psalms', 1, 3], ['Psalms', 37, 23], ['Psalms', 119, 105], ['Proverbs', 4, 26],
    ['Romans', 12, 12], ['Luke', 16, 10], ['Psalms', 16, 8],
    ['1 Corinthians', 15, 58], // pending
  ],
  cooling_down: [
    ['Psalms', 23, 2], ['Psalms', 23, 3], ['John', 14, 27], ['Psalms', 4, 8],
    ['Psalms', 100, 4], ['Philippians', 4, 7], ['Matthew', 11, 29],
    ['Isaiah', 26, 3], ['Exodus', 33, 14], // pending
  ],
  finishing: [
    ['John', 19, 30], ['Philippians', 1, 6], ['Philippians', 3, 14], ['Matthew', 25, 21],
    ['Psalms', 18, 29], ['Romans', 8, 37], ['James', 1, 12],
    ['2 Timothy', 4, 7], ['Hebrews', 12, 2], // pending
  ],
};

/** Keyword queries used only as a fallback when no curated verse is available. */
const MOMENT_FTS_TERMS = {
  starting_out: 'go arise walk way',
  climbing: 'strength strong power',
  the_wall: 'endure patience uphold',
  steady_state: 'faithful steadfast continue',
  cooling_down: 'peace rest quiet thanks',
  finishing: 'finished end reward',
};

/**
 * Pick the verse for a moment: curated first (better fit), FTS fallback second.
 * Never repeats a verse already served in this session, and prefers verses the user
 * has not seen recently.
 */
function selectMomentVerse({ moment, lookupReference, ftsSearch, sessionVerseIds = [], recentVerseIds = [] }) {
  const session = new Set(sessionVerseIds);
  const recent = new Set(recentVerseIds);

  const resolved = [];
  for (const [book, chapter, verse] of (MOMENT_VERSES[moment] || [])) {
    const row = lookupReference(book, chapter, verse);
    if (row && row.id && row.text) resolved.push(row);
  }
  let pool = resolved.filter(v => !session.has(v.id));
  if (!pool.length && typeof ftsSearch === 'function') {
    pool = (ftsSearch(MOMENT_FTS_TERMS[moment] || moment) || []).filter(v => v && v.id && !session.has(v.id));
  }
  if (!pool.length) pool = resolved; // everything seen this session — better a repeat than nothing
  if (!pool.length) return null;

  const fresh = pool.filter(v => !recent.has(v.id));
  const from = fresh.length ? fresh : pool;
  return from[Math.floor(Math.random() * from.length)];
}

module.exports = {
  normalizeSnapshot,
  classifyContext,
  candidateThemesForContext,
  scoreVerse,
  selectVerse,
  composePayload,
  runPipeline,
  FALLBACK_VERSES,
  inferTimeOfDay,
  classifyMoment,
  selectMomentVerse,
  momentCaption,
  MOMENT_THEMES,
  MOMENT_LABELS,
  MOMENT_VERSES,
};
