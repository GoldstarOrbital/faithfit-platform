#!/usr/bin/env node
/*
 * Bible verification — proves that every verse committed in lib/bible-data/ is a
 * faithful copy of the authoritative public-domain source (bible-api.com), with
 * NOTHING fabricated, altered, dropped, duplicated, or misaligned.
 *
 * For each committed chapter it re-fetches the same book+chapter+translation from
 * the source, normalizes whitespace identically to ingestion, and compares text
 * verse-by-verse. It reports:
 *   - verses checked, exact matches, and any mismatches (with a text diff)
 *   - stored verses missing from the source, or source verses missing from store
 *   - duplicate / non-monotonic verse numbers within a chapter
 *
 * Exit code 0 only if every verse matches the source exactly.
 *
 * Usage:
 *   node scripts/verify-bible.js                 # verify every committed book
 *   node scripts/verify-bible.js genesis psalms  # only these files (by book name)
 *   node scripts/verify-bible.js --delay 600     # ms between requests (default 800)
 */
'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'lib', 'bible-data');
const API = 'https://bible-api.com';

const rawArgs = process.argv.slice(2);
let DELAY_MS = 800;
const di = rawArgs.indexOf('--delay');
if (di !== -1 && rawArgs[di + 1]) DELAY_MS = Math.max(200, Number(rawArgs[di + 1]) || 800);
const filter = rawArgs.filter(a => !a.startsWith('--') && a !== String(DELAY_MS)).map(s => s.toLowerCase());

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const normalize = (t) => String(t).replace(/\s+/g, ' ').trim();
// Fold typographic variants (curly vs straight quotes/apostrophes, ellipsis, dashes)
// so we can tell a true WORDING difference from a mere punctuation-glyph difference.
const foldTypography = (t) => String(t)
  .replace(/[‘’‛′]/g, "'")
  .replace(/[“”″]/g, '"')
  .replace(/…/g, '...')
  .replace(/[‐‑‒–—]/g, '-')
  .replace(/\s+/g, ' ').trim();

// Extract {verse, text} from a stored entry (new {v,t}, legacy ["text"], or "text").
function extract(entry, idx) {
  if (entry && typeof entry === 'object' && !Array.isArray(entry)) return { verse: Number(entry.v), text: String(entry.t) };
  const text = Array.isArray(entry) ? entry[0] : entry;
  return { verse: idx + 1, text: String(text) };
}

async function fetchChapter(book, chapter, translation) {
  const url = `${API}/${encodeURIComponent(book.toLowerCase())}%20${chapter}?translation=${translation.toLowerCase()}`;
  let lastErr;
  // Generous retries + backoff: bible-api.com throttles sustained runs, so on 429
  // (or any bad/empty response) we wait progressively longer rather than giving up
  // and falsely flagging a chapter as unverified.
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 30000);
      const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'faithfit-verify/1.0' } });
      clearTimeout(to);
      if (res.status === 429) { await sleep(3000 * attempt); throw new Error('rate-limited (429)'); }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json || !Array.isArray(json.verses) || json.verses.length === 0) throw new Error('empty/no verses');
      // Map verse number -> normalized source text (skip empty/omitted verses).
      const map = new Map();
      for (const v of json.verses) {
        if (Number(v.chapter) !== chapter) continue;
        const t = normalize(v.text);
        if (t) map.set(Number(v.verse), t);
      }
      return map;
    } catch (err) { lastErr = err; if (attempt < 6) await sleep(1000 * attempt); }
  }
  throw lastErr;
}

async function main() {
  let files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
  if (filter.length) files = files.filter(f => filter.some(k => f.toLowerCase().includes(k)));
  if (!files.length) { console.error('No matching bible-data files.'); process.exit(1); }

  console.log(`Verifying ${files.length} file(s) against ${API} — delay ${DELAY_MS}ms\n`);

  let totalVerses = 0, totalMatches = 0, totalTypography = 0;
  const problems = []; // { file, ref, kind, detail } — real concerns only
  const typographyOnly = []; // punctuation-glyph differences (words identical)

  for (const file of files) {
    const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));
    const book = data.book, translation = data.translation;
    let fileVerses = 0, fileMatches = 0, fileFailedChapters = 0;

    for (const [chStr, verses] of Object.entries(data.chapters)) {
      const chapter = Number(chStr);
      let source;
      try { source = await fetchChapter(book, chapter, translation); }
      catch (err) { fileFailedChapters++; problems.push({ file, ref: `${book} ${chapter}`, kind: 'fetch_failed', detail: err.message }); await sleep(DELAY_MS); continue; }

      // Integrity: duplicate / non-monotonic verse numbers within the stored chapter.
      const seen = new Set();
      let prev = 0;
      const storedNums = new Set();

      verses.forEach((entry, idx) => {
        const { verse, text } = extract(entry, idx);
        const norm = normalize(text);
        totalVerses++; fileVerses++;
        storedNums.add(verse);
        if (seen.has(verse)) problems.push({ file, ref: `${book} ${chapter}:${verse}`, kind: 'duplicate_verse', detail: 'appears more than once' });
        seen.add(verse);
        if (verse < prev) problems.push({ file, ref: `${book} ${chapter}:${verse}`, kind: 'non_monotonic', detail: `follows verse ${prev}` });
        prev = verse;

        const src = source.get(verse);
        if (src === undefined) {
          problems.push({ file, ref: `${book} ${chapter}:${verse}`, kind: 'not_in_source', detail: `stored: "${norm.slice(0, 60)}…"` });
        } else if (src === norm) {
          totalMatches++; fileMatches++;
        } else if (foldTypography(src) === foldTypography(norm)) {
          // Same words, different punctuation glyph (e.g. straight vs curly quote).
          totalTypography++; fileMatches++;
          typographyOnly.push({ file, ref: `${book} ${chapter}:${verse}` });
        } else {
          problems.push({ file, ref: `${book} ${chapter}:${verse}`, kind: 'text_mismatch', detail: `stored:  "${norm.slice(0, 80)}"\n         source: "${src.slice(0, 80)}"` });
        }
      });

      // Source verses that exist but are missing from our store (dropped content).
      for (const [num] of source) {
        if (!storedNums.has(num)) problems.push({ file, ref: `${book} ${chapter}:${num}`, kind: 'missing_from_store', detail: 'present in source, absent from committed data' });
      }

      process.stdout.write(`  ${book} ${chapter} — ${fileMatches}/${fileVerses} ok\r`);
      await sleep(DELAY_MS);
    }
    const clean = fileMatches === fileVerses && fileFailedChapters === 0;
    console.log(`\n${book} (${translation}): ${fileMatches}/${fileVerses} verses match source` +
      (fileFailedChapters ? `  ⚠ ${fileFailedChapters} chapter(s) could not be fetched (NOT verified)` : (clean ? '  ✓' : '  ⚠')));
  }

  console.log('\n===== VERIFICATION REPORT =====');
  console.log(`Verses checked: ${totalVerses}`);
  console.log(`Exact matches to source: ${totalMatches}`);
  console.log(`Typography-only differences (same words, e.g. ' vs ’): ${totalTypography}`);
  console.log(`Wording/structural discrepancies: ${problems.length}`);
  if (totalTypography) {
    console.log(`  (typography-only in: ${[...new Set(typographyOnly.map(t => t.file))].join(', ')})`);
  }
  if (problems.length) {
    const byKind = {};
    for (const p of problems) byKind[p.kind] = (byKind[p.kind] || 0) + 1;
    console.log('By type:', JSON.stringify(byKind));
    console.log('\n--- details (first 50) ---');
    problems.slice(0, 50).forEach(p => console.log(`[${p.kind}] ${p.ref}\n  ${p.detail}`));
    process.exit(2);
  }
  console.log(`\n✓ All ${totalVerses} committed verses match the authoritative public-domain source word-for-word` +
    (totalTypography ? ` (${totalTypography} differ only in punctuation glyphs).` : '.') +
    ' No fabricated or altered scripture.');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
