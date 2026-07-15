const test = require('node:test');
const assert = require('node:assert');
const {
  normalizeSnapshot, classifyContext, candidateThemesForContext,
  scoreVerse, selectVerse, runPipeline, FALLBACK_VERSES,
} = require('../pipeline');

test('normalizeSnapshot fills defaults', () => {
  const s = normalizeSnapshot({ heart_rate: 150 });
  assert.strictEqual(s.heart_rate, 150);
  assert.strictEqual(s.stress_level, 0);
  assert.ok(['morning', 'afternoon', 'evening', 'night'].includes(s.time_of_day));
});

test('classifyContext: high intensity + workout type -> workout', () => {
  const ctx = classifyContext({ workout_type: 'run', movement_intensity: 0.9, stress_level: 2 });
  assert.strictEqual(ctx, 'workout');
});

test('classifyContext: workout type + low intensity -> cooldown', () => {
  const ctx = classifyContext({ workout_type: 'run', movement_intensity: 0.2, stress_level: 2 });
  assert.strictEqual(ctx, 'cooldown');
});

test('classifyContext: no workout, high stress -> stress', () => {
  const ctx = classifyContext({ workout_type: null, movement_intensity: 0, stress_level: 8 });
  assert.strictEqual(ctx, 'stress');
});

test('classifyContext: nothing notable -> idle', () => {
  const ctx = classifyContext({ workout_type: null, movement_intensity: 0, stress_level: 1 });
  assert.strictEqual(ctx, 'idle');
});

test('candidateThemesForContext returns theme list for known context', () => {
  assert.deepStrictEqual(candidateThemesForContext('workout'), ['strength', 'perseverance', 'endurance']);
});

test('scoreVerse: theme match increases score, personalization off ignores prefs', () => {
  const verse = { id: 'v1', themes: ['strength', 'peace'] };
  const score = scoreVerse(verse, { themes: ['strength'], personalizationEnabled: false });
  assert.strictEqual(score, 10);
});

test('scoreVerse: personalization boosts preferred themes and penalizes recency', () => {
  const verse = { id: 'v1', themes: ['strength'] };
  const withPref = scoreVerse(verse, {
    themes: ['strength'], personalizationEnabled: true,
    userPreferences: { preferred_themes: ['strength'] }, userHistory: [],
  });
  const withRecency = scoreVerse(verse, {
    themes: ['strength'], personalizationEnabled: true,
    userPreferences: { preferred_themes: ['strength'] },
    userHistory: [{ verse_id: 'v1', engaged: false }],
  });
  assert.ok(withPref > 10);
  assert.ok(withRecency < withPref);
});

test('selectVerse falls back to FALLBACK_VERSES when no candidates match', () => {
  const chosen = selectVerse([], { themes: ['strength'], personalizationEnabled: false });
  assert.ok(FALLBACK_VERSES.some(v => v.id === chosen.id));
});

test('runPipeline end to end produces verse + payload with deep link', () => {
  const result = runPipeline({
    rawSnapshot: { workout_type: 'run', movement: { intensity: 0.9 }, stress_level: 1 },
    candidateVerses: [{ id: 'v1', reference: 'Phil 4:13', youversion_id: 'phl.4.13', themes: ['strength'] }],
    personalizationEnabled: false,
    verseTextLookup: () => ({ text: 'I can do all this through him who gives me strength.' }),
  });
  assert.strictEqual(result.context, 'workout');
  assert.strictEqual(result.verse.id, 'v1');
  assert.ok(result.payload.deep_link.includes('phl.4.13'));
  assert.ok(result.payload.snippet.length > 0);
});
