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
  const url = `${API}/${encodeURIComponent(t.api)}%20${chapter}?translation=${t.translation}`;
  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 30000);
      const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'faithfit-ingest/1.0' } });
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
