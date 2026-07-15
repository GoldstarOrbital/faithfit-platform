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
 * @returns {object} { verse, context, themes, payload }
 */
function runPipeline(input) {
  const snapshot = normalizeSnapshot(input.rawSnapshot);
  const context = classifyContext(snapshot);
  const themes = candidateThemesForContext(context);
  const candidates = (input.candidateVerses || []).filter(v => v.themes.some(t => themes.includes(t)));
  const verse = selectVerse(candidates, {
    themes,
    userHistory: input.userHistory,
    userPreferences: input.userPreferences,
    personalizationEnabled: !!input.personalizationEnabled,
  });
  const payload = composePayload(verse, input.verseTextLookup);
  return { verse, context, themes, snapshot, payload };
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
};
