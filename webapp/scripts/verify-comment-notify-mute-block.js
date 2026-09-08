'use strict';
// Comment / kudos / story-reply notifications must respect mute and block the
// same way DM send already does. Today they notify unconditionally once the
// write is allowed, so a muted or blocked member still gets a push carrying
// the other person's name. These asserts pin the gates; they are expected to
// FAIL on current main until the notify sites are wrapped.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../routes/api.js'), 'utf8');

function handler(routeLiteral) {
  const rest = source.split(routeLiteral)[1];
  assert.ok(rest, `could not find ${routeLiteral}`);
  return rest.split('router.')[0];
}

const comments = handler("router.post('/posts/:id/comments'");
const like = handler("router.post('/posts/:id/like'");
const storyReply = handler("router.post('/stories/:id/reply'");
const dmSend = handler("router.post('/dms/:threadId'");

// DM send is the gold standard: mute-gated notify (recipient muted sender).
assert.match(
  dmSend,
  /hasRelationship\(\s*r\.recipient_id\s*,\s*req\.session\.userId\s*,\s*'mute'\s*\)/,
  'DM send notify must stay mute-gated (template for story reply / comments)'
);

function assertNotifyGated(body, label) {
  // Every notify(...) in this handler must be preceded, in the same local
  // decision, by both a mute hasRelationship(..., 'mute') check and an
  // isBlockedEitherWay check. Unconditional notify( is the bug.
  const notifySites = [...body.matchAll(/\bnotify\s*\(/g)];
  assert.ok(notifySites.length >= 1, `${label}: expected at least one notify(`);

  // Author / recipient mute gate — same shape as DM send.
  assert.match(
    body,
    /hasRelationship\([^)]*'mute'\s*\)/,
    `${label}: notify must be gated with hasRelationship(..., 'mute') (missing today — mute still delivers the push)`
  );
  assert.match(
    body,
    /isBlockedEitherWay\s*\(/,
    `${label}: notify must also guard dms.isBlockedEitherWay (missing today — block pair can still be notified)`
  );

  // Structural: every notify call site should sit behind those guards rather
  // than running bare after the INSERT. Count of unguarded "notify(" after a
  // simple "if (post" without mute/block is what currently fails.
  for (const m of notifySites) {
    const before = body.slice(Math.max(0, m.index - 280), m.index);
    const hasMute = /hasRelationship\([^)]*'mute'/.test(before) || /!.*mute/.test(before);
    const hasBlock = /isBlockedEitherWay/.test(before) || /!.*blocked/.test(before);
    assert.ok(
      hasMute && hasBlock,
      `${label}: notify( at offset ${m.index} is not preceded by mute + block guards in the preceding ~280 chars — current main notifies unconditionally`
    );
  }
}

// POST /posts/:id/comments — author notify AND the co-commenter / others loop.
assert.match(comments, /notify\(\s*post\.user_id/, 'comments route notifies the post author');
assert.match(comments, /for \(const o of others\)/, 'comments route loops co-commenters');
assert.match(comments, /notify\(\s*o\.user_id/, 'comments route notifies co-commenters');
assertNotifyGated(comments, 'POST /posts/:id/comments');

// POST /posts/:id/like — kudos notify.
assert.match(like, /notify\(\s*post\.user_id\s*,\s*'kudos'/, 'like route notifies author with kudos');
assertNotifyGated(like, 'POST /posts/:id/like');

// POST /stories/:id/reply — mute-gated like DM send (block already on the read path).
assert.match(storyReply, /\bnotify\s*\(\s*story\.user_id/, 'story reply notifies the story author');
assert.match(
  storyReply,
  /hasRelationship\(\s*story\.user_id\s*,\s*me\s*,\s*'mute'\s*\)|hasRelationship\([^)]*story\.user_id[^)]*'mute'\s*\)/,
  "POST /stories/:id/reply notify must be mute-gated like DM send (hasRelationship(story.user_id, me, 'mute')) — currently notifies unconditionally after dms.send"
);

console.log('Comment / kudos / story-reply notify mute+block gates: PASS');
