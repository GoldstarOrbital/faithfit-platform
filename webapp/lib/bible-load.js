// Loads real, public-domain Bible text (KJV / WEB, both public domain) fetched
// from bible-api.com into the bible_verses table. This is a real, verified
// SUBSET of scripture (not the full 31,102-verse canon) — see README note.
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const db = require('./db');

const DATA_FILES = [
  'philippians-kjv.json',
  'james-web.json',
  'psalm23-web.json',
  'romans8-web.json',
];

function loadBibleData() {
  const already = db.prepare('SELECT COUNT(*) c FROM bible_verses').get().c;
  if (already > 0) return { inserted: 0, already };

  const insert = db.prepare(`
    INSERT OR IGNORE INTO bible_verses (id, book, book_id, chapter, verse, text, translation)
    VALUES (@id, @book, @book_id, @chapter, @verse, @text, @translation)
  `);

  let inserted = 0;
  for (const file of DATA_FILES) {
    const full = path.join(__dirname, 'bible-data', file);
    if (!fs.existsSync(full)) continue;
    const data = JSON.parse(fs.readFileSync(full, 'utf8'));
    for (const [chapterNum, verses] of Object.entries(data.chapters)) {
      verses.forEach((v, idx) => {
        const text = Array.isArray(v) ? v[0] : v;
        insert.run({
          id: randomUUID(),
          book: data.book,
          book_id: data.book_id,
          chapter: Number(chapterNum),
          verse: idx + 1,
          text,
          translation: data.translation,
        });
        inserted++;
      });
    }
  }
  return { inserted, already };
}

module.exports = { loadBibleData };
