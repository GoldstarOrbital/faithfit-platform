/** Composes a human-readable notification payload from a domain event. */
function composeForEvent(topic, event) {
  switch (topic) {
    case 'verse.triggered':
      return { type: 'verse', title: 'A verse for this moment', message: `A verse for this moment — ${event.payload?.reference || ''}`.trim(), body: event.payload?.snippet || event.payload?.reference, data: event.payload };
    case 'badge.awarded':
      return { type: 'badge', title: 'Badge earned!', message: event.badge_name ? `${event.badge_icon || ''} Badge earned: ${event.badge_name}`.trim() : 'You earned a new badge', body: event.badge_name || 'You earned a new badge', data: { badge_id: event.badge_id } };
    case 'quest.progress':
      return { type: 'quest', title: event.completed ? 'Quest complete!' : 'Quest progress', message: event.completed ? 'Quest complete!' : 'You made progress on a quest', body: event.completed ? 'Quest complete!' : 'Quest progress', data: event };
    default:
      return { type: 'generic', title: 'FitFaith update', message: 'FitFaith update', body: topic, data: event };
  }
}

module.exports = { composeForEvent };
