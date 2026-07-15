const SAMPLE_QUESTS = [
  { id: 'q-faithful-five', name: 'Faithful Five', description: 'Complete 5 workouts this week', theme: 'perseverance', difficulty: 1, target: 5 },
  { id: 'q-scripture-streak', name: 'Scripture Streak', description: 'Engage with a verse 7 days in a row', theme: 'devotion', difficulty: 2, target: 7 },
  { id: 'q-community-lift', name: 'Community Lift', description: 'Join a group workout challenge', theme: 'fellowship', difficulty: 1, target: 1 },
];

/** Given current progress JSON + a workout.completed event, returns updated progress + completed flag. */
function advanceQuestProgress(quest, progress, event) {
  const count = (progress?.count || 0) + 1;
  const completed = count >= quest.target;
  return { progress: { count }, completed };
}

module.exports = { SAMPLE_QUESTS, advanceQuestProgress };
