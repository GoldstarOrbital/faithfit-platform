'use strict';
// GET /groups/:id/messages is membership-only today. Post comments already
// drop authors on either side of a dm_blocks row; group chat must do the same
// so a blocked member's messages are not still readable inside a shared group.
// Expected to FAIL on current main.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../routes/api.js'), 'utf8');
const route = source.split("router.get('/groups/:id/messages'")[1];
assert.ok(route, "could not find GET /groups/:id/messages");
const body = route.split('router.')[0];

// Gold standard: GET /posts/:id/comments either-way dm_blocks filter.
const commentsGet = source.split("router.get('/posts/:id/comments'")[1].split('router.')[0];
assert.match(
  commentsGet,
  /dm_blocks/,
  'comments GET must keep its either-way dm_blocks filter (template)'
);

assert.match(
  body,
  /dm_blocks/,
  "GET /groups/:id/messages must filter dm_blocks either-way like comments — current SQL is membership-only (no dm_blocks)"
);

// Either-way shape: (blocker=me AND blocked=author) OR (blocker=author AND blocked=me)
assert.match(
  body,
  /blocker_id[\s\S]{0,80}blocked_id[\s\S]{0,120}blocker_id[\s\S]{0,80}blocked_id|\(b\.blocker_id\s*=\s*.*AND\s*b\.blocked_id\s*=\s*.*\)[\s\S]{0,40}OR[\s\S]{0,40}\(b\.blocker_id\s*=\s*.*AND\s*b\.blocked_id\s*=\s*.*\)/,
  'group messages must exclude authors blocked either way with the viewer (same shape as comments)'
);

console.log('Group messages block filter: PASS');
