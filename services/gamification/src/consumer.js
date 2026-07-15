/**
 * Kafka consumer: listens for workout.completed / verse.triggered, updates XP/quests,
 * and emits quest.progress / badge.awarded events for the notification service.
 */
const { EventConsumer } = require('../../../eventbus/consumer');
const { EventProducer } = require('../../../eventbus/producer');
const { xpForEvent, levelForXp } = require('./logic/xp');
const { SAMPLE_QUESTS, advanceQuestProgress } = require('./logic/quests');
const { badgeEligibility } = require('./logic/badges');

async function start({ db } = {}) {
  const consumer = new EventConsumer({ groupId: 'gamification-service' });
  const producer = new EventProducer({ clientId: 'gamification-service' });

  await consumer.subscribeAndRun(['workout.completed', 'verse.triggered'], async (topic, event) => {
    const xpGain = xpForEvent(topic === 'workout.completed' ? 'workout.completed' : 'verse.engaged');
    // TODO: persist xp/level to user_xp table via db
    const newLevel = levelForXp(xpGain); // placeholder - should add to running total from DB

    for (const quest of SAMPLE_QUESTS) {
      const { progress, completed } = advanceQuestProgress(quest, {}, event);
      await producer.publish('quest.progress', { user_id: event.user_id, quest_id: quest.id, progress, completed });
    }

    const eligible = badgeEligibility({ workoutsCompleted: 1, versesEngaged: 1, groupsJoined: 0 });
    for (const badgeId of eligible) {
      await producer.publish('badge.awarded', { user_id: event.user_id, badge_id: badgeId, earned_at: new Date().toISOString() });
    }
  });
}

module.exports = { start };
if (require.main === module) start().catch(err => { console.error(err); process.exit(1); });
