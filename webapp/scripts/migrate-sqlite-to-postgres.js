'use strict';

// One-way, operator-invoked cutover tool. This is intentionally not required
// by server startup: production stays on the known-good SQLite volume until a
// snapshot has been imported and every application table count agrees.
//
// Usage:
//   DATABASE_URL='postgresql://…' node scripts/migrate-sqlite-to-postgres.js \
//     --source /path/to/faithfit.db --truncate
//   DATABASE_URL='postgresql://…' node scripts/migrate-sqlite-to-postgres.js \
//     --source /path/to/faithfit.db --verify-only
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const { Client } = require('pg');

const args = process.argv.slice(2);
const sourceIndex = args.indexOf('--source');
const sourcePath = sourceIndex >= 0 ? args[sourceIndex + 1] : null;
const truncate = args.includes('--truncate');
const verifyOnly = args.includes('--verify-only');
if (!sourcePath || !fs.existsSync(sourcePath)) throw new Error('Pass an existing SQLite file with --source <path>.');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required; never place it in source control.');
if (truncate && verifyOnly) throw new Error('--truncate and --verify-only cannot be combined.');

const quote = (identifier) => `"${String(identifier).replaceAll('"', '""')}"`;
const source = new DatabaseSync(sourcePath, { readOnly: true });
const tables = source.prepare(`SELECT name FROM sqlite_master
  WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'bible_verses_fts%'
  ORDER BY name`).all().map((row) => row.name);

function columns(table) {
  return source.prepare(`PRAGMA table_info(${quote(table)})`).all().map((row) => row.name);
}

function sourceCount(table) {
  return source.prepare(`SELECT count(*) AS count FROM ${quote(table)}`).get().count;
}

async function destinationCount(client, table) {
  const result = await client.query(`SELECT count(*)::bigint AS count FROM ${quote(table)}`);
  return Number(result.rows[0].count);
}

// pgloader maps SQLite TEXT columns faithfully, including timestamp fields and
// unique declarations that SQLite permits as table constraints. The semantic
// cache is the first runtime workload routed to Postgres, so normalize its
// expiry/telemetry types and conflict target explicitly after every import.
async function normalizeSemanticCacheSchema(client) {
  await client.query(`ALTER TABLE semantic_answer_cache
    ALTER COLUMN created_at DROP DEFAULT,
    ALTER COLUMN expires_at DROP DEFAULT`);
  // Cast through text so this remains idempotent after a prior successful
  // normalization (where these columns are already timestamptz).
  await client.query(`ALTER TABLE semantic_answer_cache
    ALTER COLUMN created_at TYPE timestamptz USING NULLIF(NULLIF(created_at::text, ''), 'datetime(''now'')')::timestamptz,
    ALTER COLUMN expires_at TYPE timestamptz USING NULLIF(expires_at::text, '')::timestamptz,
    ALTER COLUMN last_hit_at TYPE timestamptz USING NULLIF(last_hit_at::text, '')::timestamptz,
    ALTER COLUMN created_at SET DEFAULT NOW()`);
  // The invalid string only occurs if an old SQLite default was used by an
  // earlier importer before this normalizer ran; preserve the event rather
  // than making a later migration fail on historical telemetry.
  await client.query(`UPDATE semantic_cache_events
    SET created_at = NOW() WHERE created_at::text = 'datetime(''now'')'`);
  await client.query(`ALTER TABLE semantic_cache_events
    ALTER COLUMN created_at DROP DEFAULT,
    ALTER COLUMN created_at TYPE timestamptz USING NULLIF(created_at::text, '')::timestamptz,
    ALTER COLUMN created_at SET DEFAULT NOW()`);
  await client.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'semantic_answer_cache_scope_signature_unique') THEN
      ALTER TABLE semantic_answer_cache ADD CONSTRAINT semantic_answer_cache_scope_signature_unique
        UNIQUE (kind, reference, tradition, version_id, intent, terms);
    END IF;
  END $$`);
}

async function verify(client) {
  const mismatches = [];
  for (const table of tables) {
    const expected = sourceCount(table);
    const actual = await destinationCount(client, table);
    if (expected !== actual) mismatches.push({ table, expected, actual });
  }
  if (mismatches.length) {
    console.error(JSON.stringify({ verified: false, mismatches }, null, 2));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({ verified: true, tables: tables.length }, null, 2));
  }
}

async function importTable(client, table) {
  const names = columns(table);
  if (!names.length) return;
  const rows = source.prepare(`SELECT * FROM ${quote(table)}`).all();
  const columnSql = names.map(quote).join(', ');
  const batchSize = 200;
  await client.query('BEGIN');
  try {
    for (let start = 0; start < rows.length; start += batchSize) {
      const batch = rows.slice(start, start + batchSize);
      const values = [];
      const placeholders = batch.map((row, rowIndex) => {
        const offset = rowIndex * names.length;
        for (const name of names) values.push(row[name]);
        return `(${names.map((_, columnIndex) => `$${offset + columnIndex + 1}`).join(', ')})`;
      });
      await client.query(`INSERT INTO ${quote(table)} (${columnSql}) VALUES ${placeholders.join(', ')}`, values);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw new Error(`Import failed for ${table}: ${error.message}`);
  }
  console.log(`${table}: ${rows.length}`);
}

(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    if (verifyOnly) return await verify(client);
    if (!truncate) throw new Error('Refusing to import into a non-empty destination without --truncate.');
    // The destination was created specifically for this migration. Disabling
    // FK trigger enforcement during import preserves the source snapshot even
    // where SQLite accepted rows in an order PostgreSQL would otherwise reject.
    await client.query('SET session_replication_role = replica');
    await client.query(`TRUNCATE TABLE ${tables.map(quote).join(', ')} RESTART IDENTITY CASCADE`);
    for (const table of tables) await importTable(client, table);
    await client.query('SET session_replication_role = origin');
    await normalizeSemanticCacheSchema(client);
    await verify(client);
  } finally {
    await client.end();
    source.close();
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
