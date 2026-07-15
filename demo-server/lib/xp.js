const XP_TABLE = {
  'workout.completed': 25,
  'quest.progress_step': 10,
  'verse.engaged': 5,
};

function xpForEvent(eventType) {
  return XP_TABLE[eventType] || 0;
}

/** Simple level curve: level = floor(sqrt(xp / 50)) + 1 */
function levelForXp(xp) {
  return Math.floor(Math.sqrt(xp / 50)) + 1;
}

module.exports = { xpForEvent, levelForXp, XP_TABLE };
