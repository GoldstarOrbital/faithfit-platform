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

// Word-for-word verification against the live bible-api.com source (see
// scripts/verify-bible.js) found that the ORIGINAL seed data for James and
// Romans (committed before the ingest-bible.js pipeline existed) used an older
// WEB revision that has since drifted from the current source in ~40 verses
// (e.g. "patience" -> "perseverance", quote style, minor phrasing). Not
// fabricated — just stale. Both books were re-ingested fresh and verified
// byte-for-byte against the source (see git history). Because bible_verses
// uses INSERT OR IGNORE for idempotency, a plain reload would never touch the
// already-inserted stale rows on an existing (e.g. production) database — so
// this one-time, version-gated correction deletes those specific rows before
// the normal load runs, letting the corrected JSON re-populate them. Content-
// only migration: no schema change, no effect on user data.
const CONTENT_VERSION = '2';
const CORRECTED_BOOKS = [
  { book: 'James', translation: 'WEB' },
  { book: 'Romans', translation: 'WEB' },
];

function applyContentCorrections() {
  const stamp = db.prepare('SELECT value FROM bible_meta WHERE key = ?').get('bible_content_version');
  if (stamp && stamp.value === CONTENT_VERSION) return;
  const del = db.prepare('DELETE FROM bible_verses WHERE book = ? AND translation = ?');
  let removed = 0;
  for (const { book, translation } of CORRECTED_BOOKS) {
    const info = del.run(book, translation);
    removed += info.changes;
  }
  if (removed > 0) {
    // Full-content FTS5 tables need re-syncing after bulk deletes from the base
    // table (the AFTER INSERT trigger alone can't clean up rows whose base row
    // is gone). Neither FTS5's 'rebuild' command nor a plain DELETE works here:
    // both validate against a same-named column in the content table, and
    // `reference` is computed (book || chapter || verse), not a real column —
    // so any DELETE against this external-content table throws "no such column:
    // T.reference". Sidestep it entirely: drop and recreate the virtual table
    // (no DELETE involved), then bulk-populate via INSERT — which already works
    // fine everywhere else in this file — using the same formula the trigger uses.
    db.exec('DROP TABLE IF EXISTS bible_verses_fts');
    db.exec(`CREATE VIRTUAL TABLE bible_verses_fts USING fts5(
      text, book, reference UNINDEXED, content='bible_verses', content_rowid='rowid'
    )`);
    db.exec(`INSERT INTO bible_verses_fts(rowid, text, book, reference)
             SELECT rowid, text, book, book || ' ' || chapter || ':' || verse FROM bible_verses`);
    console.log(`[bible-load] content correction: removed ${removed} stale verse(s) for re-ingestion (James/Romans WEB drift fix)`);
  }
  db.prepare('INSERT INTO bible_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run('bible_content_version', CONTENT_VERSION);
}

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
  applyContentCorrections();

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
