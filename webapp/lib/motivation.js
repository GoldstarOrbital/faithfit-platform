'use strict';

const db = require('./db');

// Stable ids make this catalog safe to add to an existing Railway database.
// Scripture text is never placed here unless it is a short, explicitly cited
// reference; the verse pool below is resolved from the verified Bible stores.
const CURATED = [
  { id: 'curated:tolkien-wander', text: 'Not all those who wander are lost.', attribution: 'J.R.R. Tolkien, The Fellowship of the Ring', theme: 'journey' },
  { id: 'curated:tolkien-road', text: 'The Road goes ever on and on.', attribution: 'J.R.R. Tolkien, The Fellowship of the Ring', theme: 'journey' },
  { id: 'curated:lewis-courage', text: 'Courage, dear heart.', attribution: 'C.S. Lewis, The Voyage of the Dawn Treader', theme: 'courage' },
  { id: 'curated:lewis-hardship', text: 'Hardships often prepare ordinary people for an extraordinary destiny.', attribution: 'C.S. Lewis, attributed', theme: 'perseverance' },
  { id: 'curated:roosevelt', text: 'Do what you can, with what you have, where you are.', attribution: 'Theodore Roosevelt', theme: 'motivation' },
  { id: 'curated:mandela', text: 'It always seems impossible until it’s done.', attribution: 'Nelson Mandela', theme: 'perseverance' },
  { id: 'curated:king', text: 'Faith is taking the first step even when you don’t see the whole staircase.', attribution: 'Martin Luther King Jr.', theme: 'faith' },
  { id: 'curated:parks', text: 'I have learned over the years that when one’s mind is made up, this diminishes fear.', attribution: 'Rosa Parks', theme: 'courage' },
  { id: 'curated:frankl', text: 'When we are no longer able to change a situation, we are challenged to change ourselves.', attribution: 'Viktor Frankl, Man’s Search for Meaning', theme: 'perseverance' },
  { id: 'curated:angelou', text: 'You may not control all the events that happen to you, but you can decide not to be reduced by them.', attribution: 'Maya Angelou', theme: 'resilience' },
  { id: 'curated:keller', text: 'Although the world is full of suffering, it is also full of the overcoming of it.', attribution: 'Helen Keller, The Open Door', theme: 'perseverance' },
  { id: 'curated:aurelius', text: 'The impediment to action advances action. What stands in the way becomes the way.', attribution: 'Marcus Aurelius, Meditations', theme: 'discipline' },
  { id: 'curated:robinson', text: 'A life is not important except in the impact it has on other lives.', attribution: 'Jackie Robinson', theme: 'purpose' },
  { id: 'curated:gretzky', text: 'You miss 100% of the shots you don’t take.', attribution: 'Wayne Gretzky', theme: 'courage' },
  { id: 'curated:jordan', text: 'I’ve failed over and over and over again in my life. And that is why I succeed.', attribution: 'Michael Jordan', theme: 'resilience' },
  { id: 'curated:ali', text: 'Don’t count the days; make the days count.', attribution: 'Muhammad Ali', theme: 'discipline' },
  { id: 'curated:king-billie-jean', text: 'Champions keep playing until they get it right.', attribution: 'Billie Jean King', theme: 'perseverance' },
  { id: 'curated:serena', text: 'A champion is defined not by their wins but by how they can recover when they fall.', attribution: 'Serena Williams', theme: 'resilience' },
  { id: 'curated:kobe', text: 'The moment you give up is the moment you let someone else win.', attribution: 'Kobe Bryant', theme: 'discipline' },
];

// A random pick across the whole ~31,000-verse canon (the previous approach)
// was surfacing genealogies, property disputes, and tragic narratives as
// "motivation" -- technically fast and technically scripture, but not what
// anyone means by encouragement. This is what later reports meant by
// motivation "still not working well": the timeout was fixed, but the verse
// it handed back often had nothing to do with encouragement. This list is
// the same kind of hand-vetted, genuinely encouraging references
// scriptureMission.js already curates for its own verse pool -- every entry
// confirmed present in this app's own bible_verses table.
const MOTIVATIONAL_REFS = [
  ['Psalms', 18, 32], ['Psalms', 46, 1], ['Psalms', 27, 14], ['Psalms', 121, 1],
  ['Isaiah', 40, 31], ['Isaiah', 41, 10], ['Isaiah', 43, 19],
  ['Philippians', 4, 13], ['Philippians', 1, 6],
  ['1 Corinthians', 9, 24],
  ['Joshua', 1, 9], ['Deuteronomy', 31, 6], ['Deuteronomy', 31, 8],
  ['2 Timothy', 1, 7],
  ['Hebrews', 12, 1],
  ['James', 1, 12],
  ['Romans', 5, 3], ['Romans', 8, 28],
  ['Matthew', 11, 28],
  ['Proverbs', 3, 5],
  ['Ephesians', 6, 10],
];

function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS motivation_seen (
      user_id TEXT NOT NULL,
      quote_id TEXT NOT NULL,
      seen_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, quote_id)
    );
  `);
  const insert = db.prepare(`INSERT OR IGNORE INTO motivation_quotes (id, text, attribution, theme)
                             VALUES (?, ?, ?, ?)`);
  for (const quote of CURATED) insert.run(quote.id, quote.text, quote.attribution, quote.theme);
}

function curatedQuote(userId) {
  return db.prepare(`
    SELECT q.id AS quote_id, q.text, q.attribution, q.theme
    FROM motivation_quotes q
    LEFT JOIN motivation_seen s ON s.user_id = ? AND s.quote_id = q.id
    WHERE s.quote_id IS NULL ORDER BY RANDOM() LIMIT 1
  `).get(userId);
}

function curatedScripture(userId) {
  const placeholders = MOTIVATIONAL_REFS.map(() => '(?, ?, ?)').join(', ');
  return db.prepare(`
    SELECT 'bible:' || b.id AS quote_id, b.text,
           b.book || ' ' || b.chapter || ':' || b.verse AS attribution,
           'scripture' AS theme
    FROM bible_verses b
    LEFT JOIN motivation_seen s ON s.user_id = ? AND s.quote_id = 'bible:' || b.id
    WHERE s.quote_id IS NULL
      AND (b.book, b.chapter, b.verse) IN (${placeholders})
    ORDER BY RANDOM() LIMIT 1
  `).get(userId, ...MOTIVATIONAL_REFS.flat());
}

function localCandidate(userId) {
  // Keep the human voices visible alongside the curated scripture pool.
  // Once either source is exhausted for this member, the other naturally
  // carries the queue.
  return Math.random() < 0.45
    ? (curatedQuote(userId) || curatedScripture(userId))
    : (curatedScripture(userId) || curatedQuote(userId));
}

async function next(userId) {
  init();

  let candidate = localCandidate(userId);
  let poolReset = false;
  if (!candidate) {
    // Every curated quote and every curated verse has already been shown to
    // this member -- start the rotation over rather than reaching for a
    // random verse from the full canon (see MOTIVATIONAL_REFS above for why
    // that was the actual bug).
    db.prepare('DELETE FROM motivation_seen WHERE user_id = ?').run(userId);
    poolReset = true;
    candidate = localCandidate(userId);
  }
  if (!candidate) return { text: 'Keep showing up. Your next step matters.', attribution: 'Functioning Faith', theme: 'motivation', pool_reset: poolReset };

  db.prepare('INSERT OR IGNORE INTO motivation_seen (user_id, quote_id) VALUES (?, ?)').run(userId, candidate.quote_id);
  return { ...candidate, pool_reset: poolReset };
}

module.exports = { init, next, CURATED };
