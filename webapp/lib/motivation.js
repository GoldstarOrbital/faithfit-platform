'use strict';

const db = require('./db');
const youversion = require('./youversion');

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

function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS motivation_seen (
      user_id TEXT NOT NULL,
      quote_id TEXT NOT NULL,
      seen_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, quote_id)
    );
    CREATE TABLE IF NOT EXISTS motivation_bible_refs (
      quote_id TEXT PRIMARY KEY,
      version_id INTEGER NOT NULL,
      reference TEXT NOT NULL,
      book TEXT NOT NULL,
      chapter INTEGER NOT NULL,
      verse INTEGER NOT NULL
    );
  `);
  const insert = db.prepare(`INSERT OR IGNORE INTO motivation_quotes (id, text, attribution, theme)
                             VALUES (?, ?, ?, ?)`);
  for (const quote of CURATED) insert.run(quote.id, quote.text, quote.attribution, quote.theme);
}

// syncCanon() was being called from next() on every single /api/motivation
// request -- re-inserting one row per verse in the entire Bible (~31,000
// INSERT OR IGNORE calls) synchronously, every time. INSERT OR IGNORE makes
// that idempotent but not cheap: it was blocking the event loop long enough
// to make the endpoint time out. The canon itself never changes once loaded,
// so this only ever needs to run once per process.
let canonSynced = false;

function syncCanon() {
  if (canonSynced) return 0;
  if (!youversion.isConfigured() || !youversion.canonLoaded()) return 0;
  const insert = db.prepare(`INSERT OR IGNORE INTO motivation_bible_refs
    (quote_id, version_id, reference, book, chapter, verse) VALUES (?, ?, ?, ?, ?, ?)`);
  let added = 0;
  for (const book of youversion.books()) {
    for (const chapter of youversion.chapters(book.book)) {
      for (let verse = 1; verse <= Number(chapter.verses || 0); verse++) {
        const reference = `${book.title || book.book} ${chapter.chapter}:${verse}`;
        const id = `bible:${youversion.DEFAULT_VERSION}:${book.book}:${chapter.chapter}:${verse}`;
        added += insert.run(id, youversion.DEFAULT_VERSION, reference, book.book, chapter.chapter, verse).changes;
      }
    }
  }
  canonSynced = true;
  return added;
}

function localCandidate(userId) {
  const curated = () => db.prepare(`
    SELECT q.id AS quote_id, q.text, q.attribution, q.theme
    FROM motivation_quotes q
    LEFT JOIN motivation_seen s ON s.user_id = ? AND s.quote_id = q.id
    WHERE s.quote_id IS NULL ORDER BY RANDOM() LIMIT 1
  `).get(userId);
  const scripture = () => db.prepare(`
    SELECT 'bible:' || b.id AS quote_id, b.text,
           b.book || ' ' || b.chapter || ':' || b.verse AS attribution,
           'scripture' AS theme
    FROM bible_verses b
    LEFT JOIN motivation_seen s ON s.user_id = ? AND s.quote_id = 'bible:' || b.id
    WHERE s.quote_id IS NULL ORDER BY RANDOM() LIMIT 1
  `).get(userId);
  // Keep the human voices visible alongside the large scripture pool. Once
  // either source is exhausted, the other source naturally carries the queue.
  return Math.random() < 0.45 ? (curated() || scripture()) : (scripture() || curated());
}

async function next(userId) {
  init();
  syncCanon();

  let candidate = localCandidate(userId);
  if (!candidate) {
    const ref = db.prepare(`
      SELECT r.* FROM motivation_bible_refs r
      LEFT JOIN motivation_seen s ON s.user_id = ? AND s.quote_id = r.quote_id
      WHERE s.quote_id IS NULL ORDER BY RANDOM() LIMIT 1
    `).get(userId);
    if (ref) {
      const passage = await youversion.passage(ref.reference, ref.version_id);
      if (passage && passage.text) candidate = {
        quote_id: ref.quote_id,
        text: passage.text,
        attribution: passage.reference || ref.reference,
        theme: 'scripture',
      };
    }
  }

  let poolReset = false;
  if (!candidate) {
    db.prepare('DELETE FROM motivation_seen WHERE user_id = ?').run(userId);
    poolReset = true;
    candidate = localCandidate(userId);
  }
  if (!candidate) return { text: 'Keep showing up. Your next step matters.', attribution: 'Functioning Faith', theme: 'motivation', pool_reset: poolReset };

  db.prepare('INSERT OR IGNORE INTO motivation_seen (user_id, quote_id) VALUES (?, ?)').run(userId, candidate.quote_id);
  return { ...candidate, pool_reset: poolReset };
}

module.exports = { init, syncCanon, next, CURATED };
