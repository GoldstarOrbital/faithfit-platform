const SAMPLE_BADGES = [
  { id: 'b-first-workout', name: 'First Steps', description: 'Completed your first workout', icon_url: '/icons/first-steps.png' },
  { id: 'b-verse-seeker', name: 'Verse Seeker', description: 'Engaged with 10 scripture triggers', icon_url: '/icons/verse-seeker.png' },
  { id: 'b-community-builder', name: 'Community Builder', description: 'Joined 3 groups', icon_url: '/icons/community-builder.png' },
];

function badgeEligibility(stats) {
  const earned = [];
  if (stats.workoutsCompleted >= 1) earned.push('b-first-workout');
  if (stats.versesEngaged >= 10) earned.push('b-verse-seeker');
  if (stats.groupsJoined >= 3) earned.push('b-community-builder');
  return earned;
}

module.exports = { SAMPLE_BADGES, badgeEligibility };
