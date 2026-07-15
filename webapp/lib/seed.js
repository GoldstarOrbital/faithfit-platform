const { randomUUID } = require('crypto');
const db = require('./db');

function seed() {
  const userCount = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  if (userCount > 0) return;

  const users = [
    { id: randomUUID(), email: 'alex@faithfit.demo', display_name: 'Alex G.', bio: 'Training body and spirit.' },
    { id: randomUUID(), email: 'sam@faithfit.demo', display_name: 'Sam T.', bio: 'Marathoner. Psalms reader.' },
    { id: randomUUID(), email: 'priya@faithfit.demo', display_name: 'Priya K.', bio: 'Yoga + scripture reflection.' },
  ];
  const insertUser = db.prepare('INSERT INTO users (id, email, display_name, bio) VALUES (@id, @email, @display_name, @bio)');
  users.forEach(u => insertUser.run(u));

  const insertConsent = db.prepare("INSERT INTO user_consents (id, user_id, scope) VALUES (?, ?, ?)");
  users.forEach(u => {
    insertConsent.run(randomUUID(), u.id, 'biometric_ingest');
    insertConsent.run(randomUUID(), u.id, 'scripture_personalization');
  });

  const insertXp = db.prepare('INSERT INTO user_xp (user_id, xp, level) VALUES (?, 0, 1)');
  users.forEach(u => insertXp.run(u.id));

  const verses = [
    { id: 'phl.4.13', reference: 'Philippians 4:13', text: 'I can do all this through him who gives me strength.', translation: 'NIV', themes: 'strength,perseverance' },
    { id: 'isa.40.31', reference: 'Isaiah 40:31', text: 'Those who hope in the Lord will renew their strength. They will soar on wings like eagles.', translation: 'NIV', themes: 'strength,renewal' },
    { id: 'psa.46.1', reference: 'Psalm 46:1', text: 'God is our refuge and strength, an ever-present help in trouble.', translation: 'NIV', themes: 'peace,stress,comfort' },
    { id: 'jhn.3.16', reference: 'John 3:16', text: 'For God so loved the world that he gave his one and only Son.', translation: 'NIV', themes: 'encouragement,purpose' },
    { id: 'rom.8.28', reference: 'Romans 8:28', text: 'In all things God works for the good of those who love him.', translation: 'NIV', themes: 'purpose,renewal' },
    { id: 'phl.4.6', reference: 'Philippians 4:6', text: 'Do not be anxious about anything, but in every situation, by prayer and petition, present your requests to God.', translation: 'NIV', themes: 'peace,anxiety,comfort' },
    { id: 'jos.1.9', reference: 'Joshua 1:9', text: 'Be strong and courageous. Do not be afraid; the Lord your God is with you wherever you go.', translation: 'NIV', themes: 'strength,perseverance,endurance' },
  ];
  const insertVerse = db.prepare('INSERT INTO scripture_verses (id, reference, text, translation, youversion_id, themes) VALUES (@id, @reference, @text, @translation, @id, @themes)');
  verses.forEach(v => insertVerse.run(v));

  const badges = [
    { id: 'b-first-workout', name: 'First Steps', description: 'Completed your first workout', icon: '🏁' },
    { id: 'b-verse-seeker', name: 'Verse Seeker', description: 'Engaged with 5 scripture triggers', icon: '📖' },
    { id: 'b-five-workouts', name: 'Faithful Five', description: 'Completed 5 workouts', icon: '🔥' },
  ];
  const insertBadge = db.prepare('INSERT INTO badges (id, name, description, icon) VALUES (@id, @name, @description, @icon)');
  badges.forEach(b => insertBadge.run(b));

  const quests = [
    { id: 'q-faithful-five', name: 'Faithful Five', description: 'Complete 5 workouts this week', theme: 'perseverance', target: 5 },
    { id: 'q-scripture-streak', name: 'Scripture Streak', description: 'Engage with a verse 7 times', theme: 'devotion', target: 7 },
  ];
  const insertQuest = db.prepare('INSERT INTO quests (id, name, description, theme, target) VALUES (@id, @name, @description, @theme, @target)');
  quests.forEach(q => insertQuest.run(q));

  const insertUserQuest = db.prepare("INSERT INTO user_quests (user_id, quest_id, progress, completed) VALUES (?, ?, '{\"count\":0}', 0)");
  users.forEach(u => quests.forEach(q => insertUserQuest.run(u.id, q.id)));

  const groupId = randomUUID();
  db.prepare('INSERT INTO groups (id, name, description) VALUES (?, ?, ?)').run(groupId, 'Sunrise 5K Fellowship', 'Early morning runs + reflection, synced via Gloo (mocked)');
  const insertMember = db.prepare('INSERT INTO group_members (group_id, user_id) VALUES (?, ?)');
  users.forEach(u => insertMember.run(groupId, u.id));

  // Seed a couple of demo workouts + posts so the feed isn't empty on first load.
  const now = Date.now();
  const w1 = randomUUID();
  db.prepare('INSERT INTO workouts (id, user_id, type, start_time, end_time, calories, avg_hr, max_hr) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(w1, users[1].id, 'Run', new Date(now - 3600000).toISOString(), new Date(now - 1800000).toISOString(), 420, 152, 171);
  db.prepare('INSERT INTO posts (id, user_id, content, workout_id, verse_id) VALUES (?, ?, ?, ?, ?)')
    .run(randomUUID(), users[1].id, 'Morning 5K done! Legs are tired but spirit is strong.', w1, 'isa.40.31');

  db.prepare('INSERT INTO posts (id, user_id, content, verse_id) VALUES (?, ?, ?, ?)')
    .run(randomUUID(), users[2].id, 'Rest day reflection before tomorrow’s yoga session.', 'psa.46.1');

  console.log('Seeded database with demo users, verses, badges, quests, groups.');
  return users;
}

module.exports = { seed };
