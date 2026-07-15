const test = require('node:test');
const assert = require('node:assert');
const { composeForEvent } = require('../src/composer');

test('composeForEvent builds verse notification from payload snippet', () => {
  const msg = composeForEvent('verse.triggered', { payload: { snippet: 'Be strong.', reference: 'Phil 4:13' } });
  assert.strictEqual(msg.type, 'verse');
  assert.strictEqual(msg.body, 'Be strong.');
});

test('composeForEvent builds badge notification', () => {
  const msg = composeForEvent('badge.awarded', { badge_id: 'b-first-workout' });
  assert.strictEqual(msg.type, 'badge');
});
