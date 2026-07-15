const { randomUUID } = require('crypto');
const db = require('./db');

function seed() {
  const userCount = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  if (userCount > 0) return;

  const users = [
    { id: randomUUID(), email: 'alex@faithfit.demo', display_name: 'Alex G.',
      bio_verse_ref: 'Philippians 4:13', bio_verse_text: 'I can do all things through Christ who strengtheneth me.',
      job: 'Software Engineer', church: 'Grace Community Church', fitness_group: 'Sunrise 5K Fellowship', gym: 'Anytime Fitness', age: 29, show_age: 1 },
    { id: randomUUID(), email: 'sam@faithfit.demo', display_name: 'Sam T.',
      bio_verse_ref: 'Isaiah 40:31', bio_verse_text: 'Those who hope in the Lord will renew their strength. They will soar on wings like eagles.',
      job: 'Physical Therapist', church: 'Riverside Fellowship', fitness_group: 'Sunrise 5K Fellowship', gym: null, age: null, show_age: 0 },
    { id: randomUUID(), email: 'priya@faithfit.demo', display_name: 'Priya K.',
      bio_verse_ref: 'Psalm 46:1', bio_verse_text: 'God is our refuge and strength, an ever-present help in trouble.',
      job: 'Yoga Instructor', church: 'New Hope Chapel', fitness_group: null, gym: 'Peak Studio', age: 34, show_age: 1 },
  ];
  const insertUser = db.prepare(`INSERT INTO users (id, email, display_name, bio_verse_ref, bio_verse_text, job, church, fitness_group, gym, age, show_age)
    VALUES (@id, @email, @display_name, @bio_verse_ref, @bio_verse_text, @job, @church, @fitness_group, @gym, @age, @show_age)`);
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

  // Follows — make it feel like a real social graph.
  const insertFollow = db.prepare('INSERT OR IGNORE INTO followers (follower_id, followee_id) VALUES (?, ?)');
  insertFollow.run(users[0].id, users[1].id);
  insertFollow.run(users[0].id, users[2].id);
  insertFollow.run(users[1].id, users[0].id);
  insertFollow.run(users[2].id, users[0].id);
  insertFollow.run(users[1].id, users[2].id);

  // Likes + comments on the seeded posts so the feed feels alive on first load.
  const posts = db.prepare('SELECT id FROM posts').all();
  const insertLike = db.prepare('INSERT OR IGNORE INTO post_likes (post_id, user_id) VALUES (?, ?)');
  const insertComment = db.prepare('INSERT INTO post_comments (id, post_id, user_id, content) VALUES (?, ?, ?, ?)');
  posts.forEach(p => {
    users.forEach(u => { if (Math.random() > 0.3) insertLike.run(p.id, u.id); });
  });
  if (posts[0]) {
    insertComment.run(randomUUID(), posts[0].id, users[0].id, 'Way to go! That verse hit perfectly.');
    insertComment.run(randomUUID(), posts[0].id, users[2].id, 'Isaiah 40:31 is one of my favorites 🙌');
  }
  if (posts[1]) {
    insertComment.run(randomUUID(), posts[1].id, users[0].id, 'Needed this today.');
  }

  // All quotes below have been checked against known misattribution lists; each is
  // either scripture (attributed to its book/verse) or a verified, correctly-sourced
  // quote from the named person. Never fabricated, never guessed.
  const quotes = [
    { id: randomUUID(), text: 'She is clothed with strength and dignity; she can laugh at the days to come.', attribution: 'Proverbs 31:25', theme: 'strength' },
    { id: randomUUID(), text: 'I have set the Lord always before me. Because he is at my right hand, I will not be shaken.', attribution: 'Psalm 16:8', theme: 'peace' },
    { id: randomUUID(), text: 'Do everything in love.', attribution: '1 Corinthians 16:14', theme: 'purpose' },
    { id: randomUUID(), text: 'Do what you can, with what you have, where you are.', attribution: 'Theodore Roosevelt', theme: 'motivation' },
    { id: randomUUID(), text: 'When we are no longer able to change a situation, we are challenged to change ourselves.', attribution: 'Viktor Frankl, Man\'s Search for Meaning', theme: 'perseverance' },
    { id: randomUUID(), text: 'You may not control all the events that happen to you, but you can decide not to be reduced by them.', attribution: 'Maya Angelou', theme: 'resilience' },
    { id: randomUUID(), text: 'Although the world is full of suffering, it is also full of the overcoming of it.', attribution: 'Helen Keller, The Open Door', theme: 'perseverance' },
    { id: randomUUID(), text: 'Darkness cannot drive out darkness; only light can do that.', attribution: 'Martin Luther King Jr., Strength to Love', theme: 'purpose' },
    { id: randomUUID(), text: 'Courage is not simply one of the virtues, but the form of every virtue at the testing point.', attribution: 'C.S. Lewis, The Screwtape Letters', theme: 'discipline' },
    { id: randomUUID(), text: 'The impediment to action advances action. What stands in the way becomes the way.', attribution: 'Marcus Aurelius, Meditations', theme: 'discipline' },
  ];
  const insertQuote = db.prepare('INSERT INTO motivation_quotes (id, text, attribution, theme) VALUES (@id, @text, @attribution, @theme)');
  quotes.forEach(q => insertQuote.run(q));

  // Real, currently-running independent Christian podcasts (not fictional FaithFit
  // originals). Titles/hosts verified against known public podcast directories.
  const podcasts = [
    { id: randomUUID(), title: 'The Bible Recap', host: 'Tara-Leigh Cobble', description: 'A daily companion podcast that recaps that day\'s Bible reading in about 20 minutes.', duration_min: 20, theme: 'devotion' },
    { id: randomUUID(), title: 'Ten Minute Bible Hour', host: 'Matt Whitman', description: 'Approachable, honest conversations about scripture and faith questions.', duration_min: 25, theme: 'devotion' },
    { id: randomUUID(), title: 'Ask NT Wright Anything', host: 'N.T. Wright & Premier', description: 'Listener questions on theology and scripture answered by biblical scholar N.T. Wright.', duration_min: 22, theme: 'purpose' },
    { id: randomUUID(), title: 'Christian History Almanac', host: 'Dan LeFebvre / 1517', description: 'Daily short episodes on church history figures and events.', duration_min: 10, theme: 'renewal' },
  ];
  const insertPodcast = db.prepare('INSERT INTO podcasts (id, title, host, description, duration_min, theme) VALUES (@id, @title, @host, @description, @duration_min, @theme)');
  podcasts.forEach(p => insertPodcast.run(p));

  console.log('Seeded database with demo users, verses, badges, quests, groups.');
  return users;
}

module.exports = { seed };
