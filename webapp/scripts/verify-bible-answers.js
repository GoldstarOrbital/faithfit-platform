'use strict';
/*
 * Bible Answers product surface verification (static source asserts).
 * Proves the floating launcher + history sidebar wiring exist on web, and that
 * the answer path still depends on companion/Gloo verified-library guardrails
 * (never an invented-verse client path).
 */
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const app = read('public/app.js');
const css = read('public/styles.css');
const api = read('routes/api.js');
const companion = read('lib/companion.js');
const gloo = read('lib/gloo.js');
const db = read('lib/db.js');

function need(source, token, label) {
  assert.ok(source.includes(token), `Missing ${label}: ${token}`);
}

// Floating launcher + panel shell
need(app, 'id = \'ba-launcher\'', 'floating Bible Answers launcher');
need(app, 'ba-launcher', 'launcher class/id wiring');
need(app, 'function openBibleAnswers', 'openBibleAnswers API');
need(app, 'function closeBibleAnswers', 'closeBibleAnswers API');
need(app, 'function ensureBibleAnswersUI', 'launcher mount that survives tab changes');
need(css, '.ba-launcher', 'launcher styles');
need(css, 'z-index: 46', 'launcher above tab bar chrome');
need(css, 'z-index: 100', 'panel above sticky chrome');

// History / sidebar / home-reset
need(app, 'ba-sidebar', 'history sidebar markup');
need(app, '/bible/ask/history', 'history API wiring');
need(app, 'baStartNewChat', 'new-chat / home reset');
need(app, 'ba-memory-item', 'memory list items');
need(app, 'ba-home', 'welcoming empty/home state');
need(css, '.ba-sidebar', 'sidebar styles');
need(css, '.ba-home', 'home/empty styles');
need(css, 'ba-sidebar-open', 'collapsible sidebar on narrow');

// Explore catalogue entry
need(app, "key: 'bibleAnswers'", 'Explore section for Bible Answers');

// Answer path: verified library guardrails (server + client refusal)
need(api, "router.post('/bible/ask'", 'POST /bible/ask route');
need(api, "router.get('/bible/ask/history'", 'GET /bible/ask/history route');
need(api, 'no_verified_answer', 'refusal when answer cannot be verified');
need(api, 'askBibleQuestion', 'companion askBibleQuestion call');
need(companion, 'async function askBibleQuestion', 'askBibleQuestion implementation');
need(companion, 'gloo.verifyRefs', 'citation verification before return');
need(companion, 'do NOT write out their words', 'model must not invent verse text');
need(companion, 'resolveRef', 'verse text from resolver/library');
need(gloo, 'Gloo never produces scripture', 'sacred invariant in gloo.js');
need(gloo, 'async function verifyRefs', 'verifyRefs enforcement');
need(gloo, 'hand-authored scripture', 'fallback when refs fail');
need(db, 'bible_answers_history', 'history table');

// Client must surface unverified refusal, never synthesize verse text
need(app, 'no_verified_answer', 'client handles unverified refusal');
need(app, 'Verified Scripture · text from the library, not the model', 'UI discloses library source');
need(app, 'Verse text always comes from the verified library', 'guardrail copy in panel');
assert.ok(!/inventVerseText|fakeVerse|makeUpVerse/.test(app), 'no invented-verse helper in client');

// Brand tokens present in BA CSS
need(css, 'var(--parch-2)', 'parchment brand token');
need(css, 'var(--walnut-1)', 'walnut brand token');
need(css, 'var(--meadow', 'meadow brand token');
need(css, 'var(--hearth', 'hearth brand token');

console.log(JSON.stringify({
  ok: true,
  floating_launcher: true,
  history_sidebar: true,
  new_chat_home_reset: true,
  verified_library_guardrails: true,
  explore_entry: true,
}, null, 2));
