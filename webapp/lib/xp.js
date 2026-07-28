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

/** XP needed to reach a level. Inverse of levelForXp. */
function xpForLevel(level) {
  const l = Math.max(1, Math.floor(level));
  return 50 * (l - 1) * (l - 1);
}

/**
 * Where someone is inside their current level, for the ring drawn around an
 * avatar: how far through, and how much is left.
 */
function levelProgress(xp) {
  const total = Math.max(0, Number(xp) || 0);
  const level = levelForXp(total);
  const floorXp = xpForLevel(level);
  const nextXp = xpForLevel(level + 1);
  const span = Math.max(1, nextXp - floorXp);
  const into = Math.max(0, total - floorXp);
  return {
    xp: total,
    level,
    into,
    span,
    to_next: Math.max(0, nextXp - total),
    percent: Math.max(0, Math.min(100, Math.round((into / span) * 100))),
  };
}

module.exports = { xpForEvent, levelForXp, xpForLevel, levelProgress, XP_TABLE };
