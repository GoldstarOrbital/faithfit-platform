'use strict';
// Restrict is a write-side control: if the post author has restricted you,
// you should not be able to leave a comment on their post. Feed ranking and
// profile already expose is_restricted; the comments route never consulted it.
// Expected to FAIL on current main until the check lands before the INSERT.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../routes/api.js'), 'utf8');
const comments = source.split("router.post('/posts/:id/comments'")[1];
assert.ok(comments, "could not find POST /posts/:id/comments");
const body = comments.split('router.')[0];

assert.match(
  body,
  /hasRelationship\(\s*post\.user_id\s*,\s*(?:me|req\.session\.userId)\s*,\s*'restrict'\s*\)/,
  "POST /posts/:id/comments must check hasRelationship(post.user_id, me, 'restrict') (or equivalent) before writing — current main only enforces comment_permission / visibility"
);

// The restrict check must come before the comment row is written.
const restrictAt = body.search(/hasRelationship\(\s*post\.user_id[^)]*'restrict'\s*\)/);
const insertAt = body.indexOf('INSERT INTO post_comments');
assert.ok(restrictAt >= 0, 'restrict hasRelationship not found');
assert.ok(insertAt >= 0, 'INSERT INTO post_comments not found');
assert.ok(
  restrictAt < insertAt,
  'restrict check must run before INSERT INTO post_comments'
);

console.log('Restrict-on-comments: PASS');
