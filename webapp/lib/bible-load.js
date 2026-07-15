// Loads real, public-domain Bible text (KJV / WEB, both public domain) into the
// bible_verses table from the JSON files in ./bible-data/. Those files are
// produced by scripts/ingest-bible.js (fetched + verified from bible-api.com) and
// committed to the repo, so production never fetches over the network.
//
// This is idempotent and additive: it loads EVERY *.json file in bible-data and
// uses INSERT OR IGNORE, so new books added to the repo are picked up on the next
// deploy without touching existing rows (safe against the persistent Railway
// volume). The FTS index stays in sync via the AFTER INSERT trigger, which only
// fires for rows that are actually inserted.
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const db = require('./db');

const DATA_DIR = path.join(__dirname, 'bible-data');

// A chapter entry may be: {v, t} (new, explicit verse number), ["text"] / [n]
// (legacy nested array => verse from position), or "text" (verse from position).
function extractVerse(entry, index) {
  if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
    return { verse: Number(entry.v), text: String(entry.t) };
  }
  const text = Array.isArray(entry) ? entry[0] : entry;
  return { verse: index + 1, text: String(text) };
}

function loadBibleData() {
  if (!fs.existsSync(DATA_DIR)) return { inserted: 0, files: 0, total: 0 };

  const insert = db.prepare(`
    INSERT OR IGNORE INTO bible_verses (id, book, book_id, chapter, verse, text, translation)
    VALUES (@id, @book, @book_id, @chapter, @verse, @text, @translation)
  `);

  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
  let inserted = 0;

  // node:sqlite's DatabaseSync has no .transaction() helper — wrap the bulk load
  // in an explicit transaction so the whole load commits atomically and fast.
  db.exec('BEGIN');
  try {
    for (const file of files) {
      let data;
      try {
        data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));
      } catch {
        console.error(`[bible-load] skipping unreadable file ${file}`);
        continue;
      }
      if (!data || !data.chapters) continue;
      for (const [chapterNum, verses] of Object.entries(data.chapters)) {
        verses.forEach((entry, idx) => {
          const { verse, text } = extractVerse(entry, idx);
          if (!text || !Number.isFinite(verse)) return;
          const info = insert.run({
            id: randomUUID(),
            book: data.book,
            book_id: data.book_id,
            chapter: Number(chapterNum),
            verse,
            text,
            translation: data.translation,
          });
          inserted += info.changes;
        });
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  const total = db.prepare('SELECT COUNT(*) c FROM bible_verses').get().c;
  if (inserted > 0) console.log(`[bible-load] inserted ${inserted} new verse(s) from ${files.length} file(s); ${total} total`);
  return { inserted, files: files.length, total };
}

module.exports = { loadBibleData };
