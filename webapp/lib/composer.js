/** Composes a human-readable notification payload from a domain event. */
function composeForEvent(topic, event) {
  switch (topic) {
    case 'verse.triggered':
      return { type: 'verse', title: 'A verse for this moment', body: event.payload?.snippet || event.payload?.reference, data: event.payload };
    case 'badge.awarded':
      return { type: 'badge', title: 'Badge earned!', body: `You earned a new badge`, data: { badge_id: event.badge_id } };
    case 'quest.progress':
      return { type: 'quest', title: event.completed ? 'Quest complete!' : 'Quest progress', body: JSON.stringify(event.progress), data: event };
    default:
      return { type: 'generic', title: 'FaithFit update', body: topic, data: event };
  }
}

module.exports = { composeForEvent };
