#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

const api = read('routes', 'api.js');
const push = read('lib', 'push.js');
const daily = read('lib', 'daily.js');
const notificationCoordinator = read('..', 'ios', 'FunctioningFaith', 'FunctioningFaith', 'Networking', 'NotificationCoordinator.swift');
const shared = read('..', 'ios', 'FunctioningFaith', 'FunctioningFaith', 'Views', 'SharedComponents.swift');
const stories = read('..', 'ios', 'FunctioningFaith', 'FunctioningFaith', 'Views', 'StoriesRail.swift');
const storiesCache = read('..', 'ios', 'FunctioningFaith', 'FunctioningFaith', 'Networking', 'StoriesCache.swift');
const bibleAnswers = read('..', 'ios', 'FunctioningFaith', 'FunctioningFaith', 'Views', 'BibleAnswersView.swift');

assert.doesNotMatch(shared, /FFKeyboardDismissBridge|endEditing\(true\)/,
  'window-level recognizers must not cancel SwiftUI field focus');
assert.match(shared, /struct FFKeyboardEscapeModifier/, 'the keyboard must have a non-intercepting global escape control');
assert.doesNotMatch(bibleAnswers, /safeAreaInset\(edge: \.bottom[^}]*composeBar/,
  'Bible Answers composer must participate directly in keyboard-resized layout');
assert.match(bibleAnswers, /if !suggestions\.isEmpty && !inputFocused \{ suggestionsRow \}\s*composeBar/,
  'Bible Answers must keep its editor visible and release suggestion space while typing');
assert.match(stories, /StoriesCache\.load\(userID:/, 'Moments must paint a disk snapshot before live refresh');
assert.match(stories, /StoriesCache\.save\(fresh, userID:/, 'fresh Moments must replace the disk snapshot');
assert.match(storiesCache, /appendingPathComponent\("stories-cache"/, 'Moment snapshots must use their own member-scoped cache');

assert.match(push, /workout_scripture:/, 'workout scripture must not share the daily-verse delivery category');
assert.match(notificationCoordinator, /\["daily_verse", "workout_scripture"\]/,
  'the native Scripture preference must subscribe to daily and workout scripture');
assert.match(api, /push\.send\(uid, 'workout_scripture'/, 'workout starts must use the workout category');
assert.match(api, /push\.send\(req\.session\.userId, 'workout_scripture'/, 'workout finishes must use the workout category');
assert.doesNotMatch(api, /push\.send\((?:uid|req\.session\.userId), 'daily_verse',[\s\S]{0,180}workout-/,
  'workout notifications must never suppress the daily verse log');
assert.match(api, /if \(topic !== 'verse\.triggered'\)/,
  'the generic event subscriber must not duplicate route-owned workout pushes');
assert.match(api, /\['climbing', 'the_wall'\]\.includes\(result\.moment\)/,
  'the live sample path must leave the single finishing alert to the stop route');
assert.match(api, /function workoutFinishVerse\(userId, workoutId\)/,
  'workout completion must rotate verified verses against session and recent history');
assert.match(api, /finish_verse: finishVerse/, 'the completion response must return the selected finishing verse');
assert.match(daily, /runOnce\(\)\.catch\(\(\) => \{\}\);\s*timer = setInterval/,
  'the daily scheduler must check for due verses immediately after a deploy');
assert.match(daily, /category = 'daily_verse' AND ok = 1/,
  'failed APNs attempts must remain eligible for a later daily scheduler retry');
assert.match(daily, /if \(!res \|\| res\.sent < 1\) return null/,
  'daily delivery must only count a successful device send');

console.log('Launch readiness: keyboard focus, Moments cache, push cadence, and workout verse rotation verified.');
