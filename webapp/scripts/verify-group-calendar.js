'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const sw = fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8');
const index = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

assert.match(app, /function downloadGroupEventIcs\(event, groupName\)/, 'group meetups need a local calendar exporter');
assert.match(app, /type: 'text\/calendar;charset=utf-8'/, 'calendar exports must use the ICS MIME type');
assert.match(app, /data-event-calendar/, 'each meetup needs an Add to calendar control');
assert.match(app, /lines\.join\('\\r\\n'\)/, 'ICS events must use CRLF line endings');
assert.match(app, /URL\.createObjectURL\(blob\)/, 'calendar export must remain a local download');
assert.doesNotMatch(app, /calendar\.google\.com/, 'meetup export must not send member event data to Google Calendar');
assert.match(index, /app\.js\?v=ff-group-calendar-1/, 'the new app bundle must be requested');
assert.match(sw, /functioning-faith-shell-v32/, 'the service worker cache must rotate for the calendar control');

console.log('group calendar export checks passed');
