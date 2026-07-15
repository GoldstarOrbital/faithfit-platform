const express = require('express');
const { randomUUID } = require('crypto');
const db = require('../lib/db');
const { publish, subscribe } = require('../lib/events');
const { runPipeline } = require('../lib/pipeline');
const { xpForEvent, levelForXp } = require('../lib/xp');
const { advanceQuestProgress } = require('../lib/quests');
const { badgeEligibility } = require('../lib/badges');
const { composeForEvent } = require('../lib/composer');

const router = express.Router();

// ---- auth (demo: pick a user, no password — this is a local demo, not production auth) ----
router.get('/users', (req, res) => {
  res.json(db.prepare('SELECT id, display_name, bio FROM users').all());
});

router.post('/session', (req, res) => {
  const { user_id } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(user_id);
  if (!user) return res.status(404).json({ error: 'user_not_found' });
  req.session.userId = user.id;
  res.json({ ok: true, user });
});

router.get('/me', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'not_signed_in' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  const xp = db.prepare('SELECT * FROM user_xp WHERE user_id = ?').get(req.session.userId);
  const badges = db.prepare(`SELECT b.* FROM user_badges ub JOIN badges b ON b.id = ub.badge_id WHERE ub.user_id = ?`).all(req.session.userId);
  const consents = db.prepare('SELECT scope FROM user_consents WHERE user_id = ? AND revoked_at IS NULL').all(req.session.userId).map(r => r.scope);
  res.json({ user, xp, badges, consents });
});

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'not_signed_in' });
  next();
}

// ---- consent (privacy opt-in, per spec section 3) ----
router.post('/consent', requireAuth, (req, res) => {
  const { scope, granted } = req.body || {};
  if (!['biometric_ingest', 'scripture_personalization'].includes(scope)) {
    return res.status(400).json({ error: 'invalid_scope' });
  }
  if (granted) {
    const existing = db.prepare('SELECT * FROM user_consents WHERE user_id = ? AND scope = ? AND revoked_at IS NULL').get(req.session.userId, scope);
    if (!existing) db.prepare('INSERT INTO user_consents (id, user_id, scope) VALUES (?, ?, ?)').run(randomUUID(), req.session.userId, scope);
  } else {
    db.prepare("UPDATE user_consents SET revoked_at = datetime('now') WHERE user_id = ? AND scope = ? AND revoked_at IS NULL").run(req.session.userId, scope);
  }
  res.json({ ok: true });
});

// ---- feed ----
router.get('/feed', (req, res) => {
  const posts = db.prepare(`
    SELECT p.id, p.content, p.created_at, u.display_name author,
           w.type workout_type, w.calories, w.avg_hr,
           v.reference verse_reference, v.text verse_text, v.youversion_id
    FROM posts p
    JOIN users u ON u.id = p.user_id
    LEFT JOIN workouts w ON w.id = p.workout_id
    LEFT JOIN scripture_verses v ON v.id = p.verse_id
    ORDER BY p.created_at DESC LIMIT 50
  `).all();
  res.json(posts);
});

// ---- workouts ----
router.post('/workouts/start', requireAuth, (req, res) => {
  const { type = 'Run' } = req.body || {};
  const id = randomUUID();
  db.prepare('INSERT INTO workouts (id, user_id, type, start_time) VALUES (?, ?, ?, ?)')
    .run(id, req.session.userId, type, new Date().toISOString());
  publish('workout.started', { user_id: req.session.userId, workout_id: id, type });
  res.json({ id, type, start_time: new Date().toISOString() });
});

router.post('/workouts/:id/sample', requireAuth, (req, res) => {
  const { heart_rate, stress_level } = req.body || {};
  const workout = db.prepare('SELECT * FROM workouts WHERE id = ? AND user_id = ?').get(req.params.id, req.session.userId);
  if (!workout) return res.status(404).json({ error: 'not_found' });
  db.prepare('INSERT INTO biometric_samples (id, user_id, workout_id, time, heart_rate, stress_level) VALUES (?, ?, ?, ?, ?, ?)')
    .run(randomUUID(), req.session.userId, workout.id, new Date().toISOString(), heart_rate, stress_level ?? 0);

  // Run the real scripture trigger pipeline on this live biometric sample.
  const consents = db.prepare('SELECT scope FROM user_consents WHERE user_id = ? AND revoked_at IS NULL').all(req.session.userId).map(r => r.scope);
  const personalizationEnabled = consents.includes('scripture_personalization');
  const candidateVerses = db.prepare('SELECT id, reference, youversion_id, themes FROM scripture_verses').all()
    .map(v => ({ ...v, themes: v.themes.split(',') }));
  const history = db.prepare('SELECT verse_id FROM scripture_triggers WHERE user_id = ? ORDER BY timestamp DESC LIMIT 20').all(req.session.userId);

  const result = runPipeline({
    rawSnapshot: { heart_rate, workout_type: workout.type, movement: { intensity: 0.8 }, stress_level: stress_level ?? 0 },
    candidateVerses,
    userHistory: history.map(h => ({ verse_id: h.verse_id, engaged: false })),
    userPreferences: {},
    personalizationEnabled,
    verseTextLookup: (yid) => db.prepare('SELECT text FROM scripture_verses WHERE youversion_id = ?').get(yid),
  });

  db.prepare('INSERT INTO scripture_triggers (id, user_id, verse_id, trigger_type, biometric_snapshot) VALUES (?, ?, ?, ?, ?)')
    .run(randomUUID(), req.session.userId, result.verse.id, result.context, JSON.stringify(result.snapshot));

  publish('verse.triggered', { user_id: req.session.userId, verse_id: result.verse.id, youversion_id: result.verse.youversion_id, trigger_type: result.context, payload: result.payload });

  res.json({ context: result.context, verse: result.payload });
});

router.post('/workouts/:id/stop', requireAuth, (req, res) => {
  const workout = db.prepare('SELECT * FROM workouts WHERE id = ? AND user_id = ?').get(req.params.id, req.session.userId);
  if (!workout) return res.status(404).json({ error: 'not_found' });
  const samples = db.prepare('SELECT * FROM biometric_samples WHERE workout_id = ?').all(workout.id);
  const hrs = samples.map(s => s.heart_rate).filter(Boolean);
  const avgHr = hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null;
  const maxHr = hrs.length ? Math.max(...hrs) : null;
  const calories = Math.round((Date.now() - new Date(workout.start_time).getTime()) / 60000 * 8); // rough estimate

  db.prepare("UPDATE workouts SET end_time = datetime('now'), avg_hr = ?, max_hr = ?, calories = ? WHERE id = ?")
    .run(avgHr, maxHr, calories, workout.id);

  publish('workout.completed', { user_id: req.session.userId, workout_id: workout.id, calories, avg_hr: avgHr, max_hr: maxHr });

  res.json({ id: workout.id, calories, avg_hr: avgHr, max_hr: maxHr });
});

router.post('/posts', requireAuth, (req, res) => {
  const { content, workout_id, verse_id } = req.body || {};
  const id = randomUUID();
  db.prepare('INSERT INTO posts (id, user_id, content, workout_id, verse_id) VALUES (?, ?, ?, ?, ?)')
    .run(id, req.session.userId, content, workout_id || null, verse_id || null);
  res.json({ id });
});

// ---- explore ----
router.get('/explore', (req, res) => {
  const groups = db.prepare('SELECT * FROM groups').all();
  const quests = db.prepare('SELECT * FROM quests').all();
  res.json({ groups, quests });
});

// ---- notifications ----
router.get('/notifications', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY delivered_at DESC LIMIT 20').all(req.session.userId));
});

// ---- gamification + notification event handlers (in-process, mirrors the Kafka consumers) ----
subscribe('workout.completed', (event) => {
  const xp = xpForEvent('workout.completed');
  const current = db.prepare('SELECT * FROM user_xp WHERE user_id = ?').get(event.user_id) || { xp: 0 };
  const newXp = current.xp + xp;
  const newLevel = levelForXp(newXp);
  db.prepare("INSERT INTO user_xp (user_id, xp, level, updated_at) VALUES (?, ?, ?, datetime('now')) ON CONFLICT(user_id) DO UPDATE SET xp=excluded.xp, level=excluded.level, updated_at=excluded.updated_at")
    .run(event.user_id, newXp, newLevel);

  const workoutCount = db.prepare("SELECT COUNT(*) c FROM workouts WHERE user_id = ? AND end_time IS NOT NULL").get(event.user_id).c;
  const verseCount = db.prepare('SELECT COUNT(*) c FROM scripture_triggers WHERE user_id = ?').get(event.user_id).c;
  const groupCount = db.prepare('SELECT COUNT(*) c FROM group_members WHERE user_id = ?').get(event.user_id).c;
  const earned = badgeEligibility({ workoutsCompleted: workoutCount, versesEngaged: verseCount, groupsJoined: groupCount });
  earned.forEach(badgeId => {
    const already = db.prepare('SELECT 1 FROM user_badges WHERE user_id = ? AND badge_id = ?').get(event.user_id, badgeId);
    if (!already) {
      db.prepare('INSERT INTO user_badges (user_id, badge_id) VALUES (?, ?)').run(event.user_id, badgeId);
      publish('badge.awarded', { user_id: event.user_id, badge_id: badgeId });
    }
  });

  // quest progress
  const quests = db.prepare('SELECT * FROM quests').all();
  quests.forEach(q => {
    const uq = db.prepare('SELECT * FROM user_quests WHERE user_id = ? AND quest_id = ?').get(event.user_id, q.id);
    if (!uq || uq.completed) return;
    const { progress, completed } = advanceQuestProgress(q, JSON.parse(uq.progress || '{}'), event);
    db.prepare('UPDATE user_quests SET progress = ?, completed = ? WHERE user_id = ? AND quest_id = ?')
      .run(JSON.stringify(progress), completed ? 1 : 0, event.user_id, q.id);
    if (completed) publish('quest.progress', { user_id: event.user_id, quest_id: q.id, progress, completed: true });
  });
});

['verse.triggered', 'badge.awarded', 'quest.progress'].forEach(topic => {
  subscribe(topic, (event) => {
    const message = composeForEvent(topic, event);
    db.prepare('INSERT INTO notifications (id, user_id, type, payload) VALUES (?, ?, ?, ?)')
      .run(randomUUID(), event.user_id, message.type, JSON.stringify(message));
  });
});

module.exports = router;
