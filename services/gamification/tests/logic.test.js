const test = require('node:test');
const assert = require('node:assert');
const { xpForEvent, levelForXp } = require('../src/logic/xp');
const { advanceQuestProgress, SAMPLE_QUESTS } = require('../src/logic/quests');
const { badgeEligibility } = require('../src/logic/badges');

test('xpForEvent returns configured value', () => {
  assert.strictEqual(xpForEvent('workout.completed'), 25);
  assert.strictEqual(xpForEvent('unknown'), 0);
});

test('levelForXp grows with xp', () => {
  assert.strictEqual(levelForXp(0), 1);
  assert.ok(levelForXp(500) > levelForXp(0));
});

test('advanceQuestProgress marks completed at target', () => {
  const quest = SAMPLE_QUESTS.find(q => q.id === 'q-community-lift'); // target 1
  const { completed } = advanceQuestProgress(quest, {}, {});
  assert.strictEqual(completed, true);
});

test('badgeEligibility awards first-workout badge after 1 workout', () => {
  const earned = badgeEligibility({ workoutsCompleted: 1, versesEngaged: 0, groupsJoined: 0 });
  assert.ok(earned.includes('b-first-workout'));
});
