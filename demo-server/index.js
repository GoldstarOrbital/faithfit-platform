/**
 * FaithFit live demo server.
 * Deployed standalone (no Postgres/Kafka dependency) so the Scripture Trigger Engine
 * and gamification/notification logic can be exercised over HTTP as a free-tier demo
 * of the full platform in /faithfit-platform. See that repo's README for the real
 * microservice architecture this demo is a thin illustrative slice of.
 */
const express = require('express');
const path = require('path');
const { runPipeline, FALLBACK_VERSES } = require('../scripture-engine/pipeline');
const { xpForEvent, levelForXp } = require('../services/gamification/src/logic/xp');
const { badgeEligibility } = require('../services/gamification/src/logic/badges');
const { composeForEvent } = require('../services/notification/src/composer');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const VERSE_LIBRARY = [
  ...FALLBACK_VERSES,
  { id: 'jhn.3.16', reference: 'John 3:16', youversion_id: 'jhn.3.16', themes: ['encouragement', 'purpose'] },
  { id: 'rom.8.28', reference: 'Romans 8:28', youversion_id: 'rom.8.28', themes: ['purpose', 'renewal'] },
];
const VERSE_TEXT = {
  'phl.4.13': 'I can do all this through him who gives me strength.',
  'isa.40.31': 'Those who hope in the Lord will renew their strength.',
  'psa.46.1': 'God is our refuge and strength, an ever-present help in trouble.',
  'jhn.3.16': 'For God so loved the world that he gave his one and only Son.',
  'rom.8.28': 'In all things God works for the good of those who love him.',
};

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'faithfit-demo' }));

app.post('/api/demo/scripture-trigger', (req, res) => {
  const { workout_type, movement_intensity = 0, stress_level = 0, personalization_opt_in = false } = req.body || {};
  const result = runPipeline({
    rawSnapshot: { workout_type, movement: { intensity: movement_intensity }, stress_level },
    candidateVerses: VERSE_LIBRARY,
    personalizationEnabled: personalization_opt_in,
    verseTextLookup: (id) => (VERSE_TEXT[id] ? { text: VERSE_TEXT[id] } : null),
  });
  res.json(result);
});

app.post('/api/demo/gamification', (req, res) => {
  const { event_type = 'workout.completed', workouts_completed = 1, verses_engaged = 0, groups_joined = 0 } = req.body || {};
  const xp = xpForEvent(event_type);
  const level = levelForXp(xp * Math.max(workouts_completed, 1));
  const badges = badgeEligibility({ workoutsCompleted: workouts_completed, versesEngaged: verses_engaged, groupsJoined: groups_joined });
  res.json({ xp_gained: xp, level, badges_earned: badges });
});

app.post('/api/demo/notification-preview', (req, res) => {
  const { topic = 'verse.triggered', event = {} } = req.body || {};
  res.json(composeForEvent(topic, event));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`FaithFit demo server listening on ${PORT}`));
