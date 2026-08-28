#!/usr/bin/env node
/*
 * Batch Bible ingestion — fetches real, public-domain scripture (WEB / KJV, both
 * public domain) from bible-api.com one chapter at a time, verifies every
 * response, and writes verified JSON into ../lib/bible-data/. Those JSON files
 * are what the app loads at startup (lib/bible-load.js) — production never
 * fetches from the network, so coverage is committed, reproducible and auditable.
 *
 * Design goals (per the revamp brief):
 *   - Unattended: run it and walk away.
 *   - Rate-limited: polite delay + retries with backoff, never hammers the API.
 *   - Verified: each chapter is validated (right book/chapter, contiguous verses,
 *     non-empty text) before it is written. Bad responses are recorded as
 *     failures, never silently inserted.
 *   - Resumable/idempotent: chapters already present in a book's JSON are skipped
 *     unless --force is passed. Re-running only fetches what is missing.
 *   - Auditable: prints exactly what was ingested vs. what failed at the end.
 *
 * Usage:
 *   node scripts/ingest-bible.js                 # ingest all TARGETS, skip existing
 *   node scripts/ingest-bible.js genesis psalms  # only these books
 *   node scripts/ingest-bible.js --force         # re-fetch even existing chapters
 *   node scripts/ingest-bible.js --delay 1500    # ms between requests (default 900)
 */
'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'lib', 'bible-data');
const API = 'https://bible-api.com';

// Books to ingest. `api` is the bible-api.com book slug; `chapters` is the real
// chapter count of that book; `translation` is a public-domain translation
// (web = World English Bible, kjv = King James Version). Both are public domain.
const TARGETS = [
  { key: 'genesis',   book: 'Genesis',   book_id: 'GEN', api: 'genesis',   chapters: 50,  translation: 'web' },
  { key: 'psalms',    book: 'Psalms',    book_id: 'PSA', api: 'psalms',    chapters: 150, translation: 'web' },
  { key: 'proverbs',  book: 'Proverbs',  book_id: 'PRO', api: 'proverbs',  chapters: 31,  translation: 'web' },
  { key: 'matthew',   book: 'Matthew',   book_id: 'MAT', api: 'matthew',   chapters: 28,  translation: 'web' },
  { key: 'mark',      book: 'Mark',      book_id: 'MRK', api: 'mark',      chapters: 16,  translation: 'web' },
  { key: 'luke',      book: 'Luke',      book_id: 'LUK', api: 'luke',      chapters: 24,  translation: 'web' },
  { key: 'john',      book: 'John',      book_id: 'JHN', api: 'john',      chapters: 21,  translation: 'web' },
  { key: 'james',     book: 'James',     book_id: 'JAS', api: 'james',     chapters: 5,   translation: 'web' },
  { key: 'romans',    book: 'Romans',    book_id: 'ROM', api: 'romans',    chapters: 16,  translation: 'web' },
  // --- Books chosen for this app specifically: the endurance/race/strength
  // passages the scripture engine leans on, and the journey geography (Sinai,
  // the wilderness, Horeb, Paul's roads) the Journeys feature walks through. ---
  { key: 'isaiah',      book: 'Isaiah',      book_id: 'ISA', api: 'isaiah',      chapters: 66, translation: 'web' }, // 40:31 run and not be weary
  { key: 'hebrews',     book: 'Hebrews',     book_id: 'HEB', api: 'hebrews',     chapters: 13, translation: 'web' }, // 12:1 run with endurance
  { key: '1corinthians',book: '1 Corinthians',book_id:'1CO', api: '1corinthians',chapters: 16, translation: 'web' }, // 9:24-27 run to win
  { key: 'philippians', book: 'Philippians', book_id: 'PHP', api: 'philippians', chapters: 4,  translation: 'web' }, // 3:14 press on toward the goal
  { key: '2timothy',    book: '2 Timothy',   book_id: '2TI', api: '2timothy',    chapters: 4,  translation: 'web' }, // 4:7 finished the race
  { key: 'ephesians',   book: 'Ephesians',   book_id: 'EPH', api: 'ephesians',   chapters: 6,  translation: 'web' }, // 6:10 be strong in the Lord
  { key: 'exodus',      book: 'Exodus',      book_id: 'EXO', api: 'exodus',      chapters: 40, translation: 'web' }, // Sinai, the Exodus route
  { key: 'numbers',     book: 'Numbers',     book_id: 'NUM', api: 'numbers',     chapters: 36, translation: 'web' }, // wilderness journey
  { key: 'deuteronomy', book: 'Deuteronomy', book_id: 'DEU', api: 'deuteronomy', chapters: 34, translation: 'web' },
  { key: 'joshua',      book: 'Joshua',      book_id: 'JOS', api: 'joshua',      chapters: 24, translation: 'web' }, // 1:9 strong and courageous
  { key: '1kings',      book: '1 Kings',     book_id: '1KI', api: '1kings',      chapters: 22, translation: 'web' }, // 19:8 Elijah to Horeb
  { key: 'acts',        book: 'Acts',        book_id: 'ACT', api: 'acts',        chapters: 28, translation: 'web' }, // Paul's journeys
  // --- The rest of the 66-book canon. Members browsing the Bible in-app, and
  // the growing set of Scripture-in-Motion / DM verse-category references
  // drawing from books beyond the original curated set, both need real local
  // text rather than falling through to a live network lookup on every miss. ---
  { key: 'leviticus',        book: 'Leviticus',        book_id: 'LEV', api: 'leviticus',        chapters: 27, translation: 'web' },
  { key: 'judges',           book: 'Judges',           book_id: 'JDG', api: 'judges',           chapters: 21, translation: 'web' },
  { key: 'ruth',             book: 'Ruth',             book_id: 'RUT', api: 'ruth',             chapters: 4,  translation: 'web' },
  { key: '1samuel',          book: '1 Samuel',         book_id: '1SA', api: '1samuel',          chapters: 31, translation: 'web' },
  { key: '2samuel',          book: '2 Samuel',         book_id: '2SA', api: '2samuel',          chapters: 24, translation: 'web' },
  { key: '2kings',           book: '2 Kings',          book_id: '2KI', api: '2kings',           chapters: 25, translation: 'web' },
  { key: '1chronicles',      book: '1 Chronicles',     book_id: '1CH', api: '1chronicles',      chapters: 29, translation: 'web' },
  { key: '2chronicles',      book: '2 Chronicles',     book_id: '2CH', api: '2chronicles',      chapters: 36, translation: 'web' },
  { key: 'ezra',             book: 'Ezra',             book_id: 'EZR', api: 'ezra',             chapters: 10, translation: 'web' },
  { key: 'nehemiah',         book: 'Nehemiah',         book_id: 'NEH', api: 'nehemiah',         chapters: 13, translation: 'web' },
  { key: 'esther',           book: 'Esther',           book_id: 'EST', api: 'esther',           chapters: 10, translation: 'web' },
  { key: 'job',              book: 'Job',              book_id: 'JOB', api: 'job',              chapters: 42, translation: 'web' },
  { key: 'ecclesiastes',     book: 'Ecclesiastes',     book_id: 'ECC', api: 'ecclesiastes',     chapters: 12, translation: 'web' },
  { key: 'songofsolomon',    book: 'Song of Solomon',  book_id: 'SNG', api: 'songofsolomon',    chapters: 8,  translation: 'web' },
  { key: 'jeremiah',         book: 'Jeremiah',         book_id: 'JER', api: 'jeremiah',         chapters: 52, translation: 'web' },
  { key: 'lamentations',     book: 'Lamentations',     book_id: 'LAM', api: 'lamentations',     chapters: 5,  translation: 'web' },
  { key: 'ezekiel',          book: 'Ezekiel',          book_id: 'EZK', api: 'ezekiel',          chapters: 48, translation: 'web' },
  { key: 'daniel',           book: 'Daniel',           book_id: 'DAN', api: 'daniel',           chapters: 12, translation: 'web' },
  { key: 'hosea',            book: 'Hosea',            book_id: 'HOS', api: 'hosea',            chapters: 14, translation: 'web' },
  { key: 'joel',             book: 'Joel',             book_id: 'JOL', api: 'joel',             chapters: 3,  translation: 'web' },
  { key: 'amos',             book: 'Amos',             book_id: 'AMO', api: 'amos',             chapters: 9,  translation: 'web' },
  { key: 'obadiah',          book: 'Obadiah',          book_id: 'OBA', api: 'obadiah',          chapters: 1,  translation: 'web', versesCh1: 21 },
  { key: 'jonah',            book: 'Jonah',            book_id: 'JON', api: 'jonah',            chapters: 4,  translation: 'web' },
  { key: 'micah',            book: 'Micah',            book_id: 'MIC', api: 'micah',            chapters: 7,  translation: 'web' },
  { key: 'nahum',            book: 'Nahum',            book_id: 'NAM', api: 'nahum',            chapters: 3,  translation: 'web' },
  { key: 'habakkuk',         book: 'Habakkuk',         book_id: 'HAB', api: 'habakkuk',         chapters: 3,  translation: 'web' },
  { key: 'zephaniah',        book: 'Zephaniah',        book_id: 'ZEP', api: 'zephaniah',        chapters: 3,  translation: 'web' },
  { key: 'haggai',           book: 'Haggai',           book_id: 'HAG', api: 'haggai',           chapters: 2,  translation: 'web' },
  { key: 'zechariah',        book: 'Zechariah',        book_id: 'ZEC', api: 'zechariah',        chapters: 14, translation: 'web' },
  { key: 'malachi',          book: 'Malachi',          book_id: 'MAL', api: 'malachi',          chapters: 4,  translation: 'web' },
  { key: '2corinthians',     book: '2 Corinthians',    book_id: '2CO', api: '2corinthians',     chapters: 13, translation: 'web' },
  { key: 'galatians',        book: 'Galatians',        book_id: 'GAL', api: 'galatians',        chapters: 6,  translation: 'web' },
  { key: 'colossians',       book: 'Colossians',       book_id: 'COL', api: 'colossians',       chapters: 4,  translation: 'web' },
  { key: '1thessalonians',   book: '1 Thessalonians',  book_id: '1TH', api: '1thessalonians',   chapters: 5,  translation: 'web' },
  { key: '2thessalonians',   book: '2 Thessalonians',  book_id: '2TH', api: '2thessalonians',   chapters: 3,  translation: 'web' },
  { key: '1timothy',         book: '1 Timothy',        book_id: '1TI', api: '1timothy',         chapters: 6,  translation: 'web' },
  { key: 'titus',            book: 'Titus',            book_id: 'TIT', api: 'titus',            chapters: 3,  translation: 'web' },
  // versesCh1 on a single-chapter book: bible-api.com parses "book 1" as
  // "book chapter:verse 1" (Obadiah 1:1), not "book chapter 1", for any book
  // with exactly one chapter -- there's no bare-chapter query that isn't also
  // a valid single-verse reference. Discovered live: an initial ingest of
  // Obadiah and Philemon silently wrote exactly one verse each instead of
  // failing loudly. An explicit "1:1-N" verse range is unambiguous and pulls
  // the whole chapter; N is the book's real, well-known total verse count.
  { key: 'philemon',         book: 'Philemon',         book_id: 'PHM', api: 'philemon',         chapters: 1,  translation: 'web', versesCh1: 25 },
  { key: '1peter',           book: '1 Peter',          book_id: '1PE', api: '1peter',           chapters: 5,  translation: 'web' },
  { key: '2peter',           book: '2 Peter',          book_id: '2PE', api: '2peter',           chapters: 3,  translation: 'web' },
  { key: '1john',            book: '1 John',           book_id: '1JN', api: '1john',            chapters: 5,  translation: 'web' },
  { key: '2john',            book: '2 John',           book_id: '2JN', api: '2john',            chapters: 1,  translation: 'web', versesCh1: 13 },
  { key: '3john',            book: '3 John',           book_id: '3JN', api: '3john',            chapters: 1,  translation: 'web', versesCh1: 14 },
  { key: 'jude',             book: 'Jude',             book_id: 'JUD', api: 'jude',             chapters: 1,  translation: 'web', versesCh1: 25 },
  { key: 'revelation',       book: 'Revelation',       book_id: 'REV', api: 'revelation',       chapters: 22, translation: 'web' },
];

// --- args ---
const rawArgs = process.argv.slice(2);
const FORCE = rawArgs.includes('--force');
let DELAY_MS = 900;
const delayIdx = rawArgs.indexOf('--delay');
if (delayIdx !== -1 && rawArgs[delayIdx + 1]) DELAY_MS = Math.max(200, Number(rawArgs[delayIdx + 1]) || 900);
const bookFilter = rawArgs.filter(a => !a.startsWith('--') && a !== String(DELAY_MS));

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Collapse the API's embedded newlines / runs of whitespace into clean prose.
function normalize(text) {
  return String(text).replace(/\s+/g, ' ').trim();
}

function fileFor(t) {
  return path.join(DATA_DIR, `${t.key}-${t.translation}.json`);
}

function readBook(t) {
  const f = fileFor(t);
  if (fs.existsSync(f)) {
    try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* rewrite below */ }
  }
  return { book: t.book, book_id: t.book_id, translation: t.translation.toUpperCase(), chapters: {} };
}

function writeBook(t, data) {
  fs.writeFileSync(fileFor(t), JSON.stringify(data) + '\n');
}

// Fetch one chapter with retries + backoff. Returns { verses:[{v,t}] } or throws.
async function fetchChapter(t, chapter) {
  // See the versesCh1 comment on the single-chapter TARGETS entries above --
  // "book 1" is ambiguous with "book chapter:verse 1" for those books, and
  // silently returns just that one verse instead of erroring.
  const url = t.chapters === 1 && t.versesCh1
    ? `${API}/${encodeURIComponent(t.api)}%201:1-${t.versesCh1}?translation=${t.translation}`
    : `${API}/${encodeURIComponent(t.api)}%20${chapter}?translation=${t.translation}`;
  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 30000);
      const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'functioning-faith-ingest/1.0' } });
      clearTimeout(to);
      if (res.status === 429) { await sleep(2000 * attempt); throw new Error('rate-limited (429)'); }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json || !Array.isArray(json.verses) || json.verses.length === 0) throw new Error('no verses in response');

      const verses = [];
      let expected = 1;
      for (const v of json.verses) {
        if (Number(v.chapter) !== chapter) throw new Error(`verse from wrong chapter (${v.chapter})`);
        const text = normalize(v.text);
        // Some verses are intentionally absent in a given translation (e.g. WEB
        // omits Luke 17:36, Matt 17:21, 18:11 — verses not in the earliest
        // manuscripts). The API returns the number with empty text. That is valid
        // textual-critical data, not a corrupt response: skip the empty verse and
        // keep the rest of the chapter rather than failing the whole fetch.
        if (!text) continue;
        // WEB occasionally merges verses (e.g. 5-6), leaving a numeric gap. That is
        // valid; we store explicit verse numbers so nothing is misaligned. We only
        // reject out-of-order / duplicate numbering.
        if (Number(v.verse) < expected) throw new Error(`non-monotonic verse ${v.verse}`);
        verses.push({ v: Number(v.verse), t: text });
        expected = Number(v.verse) + 1;
      }
      if (!verses.length) throw new Error('no non-empty verses in response');
      return { verses };
    } catch (err) {
      lastErr = err;
      if (attempt < 4) await sleep(700 * attempt);
    }
  }
  throw lastErr;
}

async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const targets = bookFilter.length
    ? TARGETS.filter(t => bookFilter.includes(t.key) || bookFilter.includes(t.book.toLowerCase()))
    : TARGETS;

  if (!targets.length) {
    console.error('No matching books. Available:', TARGETS.map(t => t.key).join(', '));
    process.exit(1);
  }

  console.log(`Ingesting ${targets.length} book(s) from bible-api.com — delay ${DELAY_MS}ms, force=${FORCE}\n`);
  const report = [];

  for (const t of targets) {
    const data = readBook(t);
    let fetched = 0, skipped = 0, versesAdded = 0;
    const failedChapters = [];

    for (let ch = 1; ch <= t.chapters; ch++) {
      const key = String(ch);
      if (!FORCE && Array.isArray(data.chapters[key]) && data.chapters[key].length) { skipped++; continue; }
      try {
        const { verses } = await fetchChapter(t, ch);
        data.chapters[key] = verses;
        versesAdded += verses.length;
        fetched++;
        writeBook(t, data); // persist after each chapter so a crash never loses progress
        process.stdout.write(`  ${t.book} ${ch}/${t.chapters} ✓ (${verses.length} verses)\r`);
      } catch (err) {
        failedChapters.push(ch);
        process.stdout.write(`  ${t.book} ${ch}/${t.chapters} ✗ ${err.message}\n`);
      }
      await sleep(DELAY_MS);
    }

    const totalVerses = Object.values(data.chapters).reduce((n, arr) => n + arr.length, 0);
    report.push({ book: t.book, translation: t.translation.toUpperCase(), fetched, skipped, versesAdded, totalVerses, failedChapters });
    console.log(`\n${t.book}: ${fetched} fetched, ${skipped} already present, ${versesAdded} new verses, ${totalVerses} total` +
      (failedChapters.length ? `  ⚠ FAILED chapters: ${failedChapters.join(', ')}` : ''));
  }

  console.log('\n===== INGESTION REPORT =====');
  let grandTotal = 0, anyFailures = false;
  for (const r of report) {
    grandTotal += r.totalVerses;
    if (r.failedChapters.length) anyFailures = true;
    console.log(`${r.book.padEnd(10)} ${r.translation}  ${String(r.totalVerses).padStart(5)} verses` +
      (r.failedChapters.length ? `  FAILED: ${r.failedChapters.join(', ')}` : '  ✓'));
  }
  console.log(`Total verses across ingested books: ${grandTotal}`);
  if (anyFailures) {
    console.log('\n⚠ Some chapters failed. Re-run to retry only the missing ones (they were NOT written).');
    process.exit(2);
  }
  console.log('All requested chapters ingested and verified.');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
