'use strict';

// A daily practice is intentionally not a streak, ranking, or social score.
// It offers one short, verified passage, an optional private note, and a
// gentle next-day rhythm. Public verse conversations remain a separate choice.
const db = require('./db');

const PLAN = {
  key: 'steady-week',
  title: 'A steady week',
  subtitle: 'Seven quiet moments of Scripture, movement, and reflection.',
  days: [
    { reference: 'Psalms 23:1', focus: 'Receive', prompt: 'What would it look like to receive enough for today?' },
    { reference: 'Matthew 11:28', focus: 'Rest', prompt: 'Where could you bring your weariness honestly?' },
    { reference: 'Proverbs 3:5', focus: 'Trust', prompt: 'What is one next step you can take without having every answer?' },
    { reference: 'Isaiah 40:31', focus: 'Renew', prompt: 'What kind of strength are you asking for today?' },
    { reference: 'Romans 12:12', focus: 'Persevere', prompt: 'What helps you stay present through a hard season?' },
    { reference: 'James 1:5', focus: 'Ask', prompt: 'What wisdom would be useful for today, specifically?' },
    { reference: 'Philippians 4:6', focus: 'Bring it', prompt: 'What can you name in prayer rather than carrying alone?' },
  ],
};

function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS scripture_practice_enrollments (
      user_id TEXT NOT NULL,
      plan_key TEXT NOT NULL,
      started_on TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, plan_key)
    );
    CREATE TABLE IF NOT EXISTS scripture_practice_days (
      user_id TEXT NOT NULL,
      plan_key TEXT NOT NULL,
      day_number INTEGER NOT NULL,
      completed_at TEXT NOT NULL DEFAULT (datetime('now')),
      note TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, plan_key, day_number)
    );
  `);
}

function isoDay(date = new Date()) { return date.toISOString().slice(0, 10); }
function dayOffset(start, today = isoDay()) {
  return Math.max(0, Math.floor((Date.parse(today + 'T00:00:00Z') - Date.parse(start + 'T00:00:00Z')) / 86400000));
}

function verse(reference) {
  const match = /^(.+?)\s+(\d+):(\d+)$/.exec(reference);
  if (!match) return null;
  const row = db.prepare('SELECT text, translation FROM bible_verses WHERE book=? AND chapter=? AND verse=?')
    .get(match[1], Number(match[2]), Number(match[3]));
  return row ? { reference, text: row.text, translation: row.translation } : null;
}

function get(userId) {
  const enrollment = db.prepare('SELECT started_on FROM scripture_practice_enrollments WHERE user_id=? AND plan_key=?')
    .get(userId, PLAN.key);
  const completed = new Map(db.prepare('SELECT day_number, completed_at, note FROM scripture_practice_days WHERE user_id=? AND plan_key=?')
    .all(userId, PLAN.key).map(row => [row.day_number, row]));
  const elapsed = enrollment ? dayOffset(enrollment.started_on) : -1;
  const firstOpen = PLAN.days.findIndex((_, index) => !completed.has(index + 1));
  const activeNumber = firstOpen < 0 ? null : firstOpen + 1;
  const availableNumber = enrollment && activeNumber && firstOpen <= elapsed ? activeNumber : null;
  const days = PLAN.days.map((day, index) => {
    const number = index + 1;
    const record = completed.get(number);
    return {
      number, focus: day.focus, prompt: day.prompt,
      verse: verse(day.reference),
      completed: !!record,
      completed_at: record ? record.completed_at : null,
      note: record && record.note ? record.note : '',
      available: number === availableNumber,
      next: number === activeNumber,
    };
  });
  return {
    plan: { key: PLAN.key, title: PLAN.title, subtitle: PLAN.subtitle, total_days: PLAN.days.length },
    started: !!enrollment,
    started_on: enrollment ? enrollment.started_on : null,
    complete: activeNumber === null,
    current_day: availableNumber,
    next_day: activeNumber,
    days,
  };
}

function start(userId) {
  db.prepare('INSERT OR IGNORE INTO scripture_practice_enrollments(user_id, plan_key, started_on) VALUES(?,?,?)')
    .run(userId, PLAN.key, isoDay());
  return get(userId);
}

function complete(userId, dayNumber, note) {
  const day = Number(dayNumber);
  if (!Number.isInteger(day) || day < 1 || day > PLAN.days.length) return { error: 'invalid_day' };
  const enrollment = db.prepare('SELECT started_on FROM scripture_practice_enrollments WHERE user_id=? AND plan_key=?')
    .get(userId, PLAN.key);
  if (!enrollment) return { error: 'practice_not_started' };
  const current = get(userId);
  if (current.complete) return { error: 'practice_complete' };
  if (current.current_day !== day) return { error: 'day_not_available', hint: current.next_day ? 'Return when the next practice day is ready.' : 'This practice is already complete.' };
  const cleanNote = String(note || '').trim().slice(0, 1000) || null;
  db.prepare('INSERT INTO scripture_practice_days(user_id,plan_key,day_number,note) VALUES(?,?,?,?)')
    .run(userId, PLAN.key, day, cleanNote);
  return { practice: get(userId) };
}

function updateNote(userId, dayNumber, note) {
  const cleanNote = String(note || '').trim().slice(0, 1000) || null;
  const result = db.prepare(`UPDATE scripture_practice_days SET note=?, updated_at=datetime('now')
                             WHERE user_id=? AND plan_key=? AND day_number=?`)
    .run(cleanNote, userId, PLAN.key, Number(dayNumber));
  return result.changes ? { practice: get(userId) } : { error: 'day_not_complete' };
}

module.exports = { PLAN, init, get, start, complete, updateNote };
