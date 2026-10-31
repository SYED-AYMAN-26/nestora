#!/usr/bin/env node
/**
 * Versioned, repeatable schema migrations.
 *
 *   node scripts/migrate.mjs            apply everything outstanding
 *   node scripts/migrate.mjs --status   show what has been applied
 *   node scripts/migrate.mjs --dry-run  list what WOULD be applied
 *
 * Backend is chosen by DATABASE_URL (PostgreSQL) or its absence (SQLite), i.e.
 * exactly the same rule src/lib/db.ts uses.
 *
 * How it works
 * ------------
 * `migrations/0001_baseline.sql` is generated from `src/lib/schema.sql` (SQLite)
 * or `src/lib/schema.pg.sql` (PostgreSQL), so the baseline is always the schema
 * the application actually ships with. Each file is applied once, inside a
 * transaction, and recorded in `schema_migrations`. Re-running is a no-op.
 *
 * `0001_baseline.sql` is written with IF NOT EXISTS, so pointing this at a
 * database that already has tables (created by the old cold-start bootstrap)
 * simply records the baseline without touching data. Anything after 0001 is a
 * normal forward migration.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BACKEND = process.env.DATABASE_URL ? "postgres" : "sqlite";
// One directory per engine: the same migration number means the same logical
// change, but the SQL differs (AUTOINCREMENT vs identity, default expressions…).
const DIR = path.join(ROOT, "migrations", BACKEND);
const DRY = process.argv.includes("--dry-run");
const STATUS = process.argv.includes("--status");

const require = createRequire(import.meta.url);

function ensureBaseline() {
  fs.mkdirSync(DIR, { recursive: true });
  const file = path.join(DIR, "0001_baseline.sql");
  const src = BACKEND === "postgres" ? "src/lib/schema.pg.sql" : "src/lib/schema.sql";
  const banner =
    `-- GENERATED baseline (${BACKEND}). Source: ${src}\n` +
    `-- Regenerate with: node scripts/migrate.mjs --regen-baseline\n`;
  if (!fs.existsSync(file) || process.argv.includes("--regen-baseline")) {
    if (BACKEND === "postgres" && !fs.existsSync(path.join(ROOT, src))) {
      console.error(`✗ ${src} is missing — run "npm run db:pg:schema" first.`);
      process.exit(1);
    }
    fs.writeFileSync(file, banner + fs.readFileSync(path.join(ROOT, src), "utf8"));
    console.log(`  wrote ${path.relative(ROOT, file)} from ${src}`);
  }
}

function files() {
  return fs
    .readdirSync(DIR)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort();
}

async function sqlite() {
  const Database = require("better-sqlite3");
  const dbPath = process.env.DATABASE_PATH
    ? path.resolve(ROOT, process.env.DATABASE_PATH)
    : path.join(ROOT, "data", "rentlink.db");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  const applied = new Set(db.prepare(`SELECT version FROM schema_migrations`).all().map((r) => r.version));
  const all = files();

  if (STATUS) {
    for (const f of all) console.log(`  ${applied.has(f) ? "✓" : "·"} ${f}`);
    db.close();
    return;
  }

  let n = 0;
  for (const f of all) {
    if (applied.has(f)) continue;
    const sql = fs.readFileSync(path.join(DIR, f), "utf8");
    if (DRY) {
      console.log(`  would apply ${f}`);
      continue;
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(sql);
      db.prepare(`INSERT INTO schema_migrations (version) VALUES (?)`).run(f);
      db.exec("COMMIT");
      console.log(`  ✓ ${f}`);
      n++;
    } catch (e) {
      db.exec("ROLLBACK");
      console.error(`  ✗ ${f}: ${e.message}`);
      db.close();
      process.exit(1);
    }
  }
  const rows = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`).all();
  console.log(`\n${BACKEND}: ${n} migration(s) applied, ${rows.length} tables present.`);
  if (!n) console.log("  (already up to date)");
  db.close();
}

async function postgres() {
  const pg = require("pg");
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl:
      (process.env.PG_SSL_MODE || "verify-full").toLowerCase() === "disable"
        ? false
        : (process.env.PG_SSL_MODE || "").toLowerCase() === "no-verify"
          ? { rejectUnauthorized: false }
          : { rejectUnauthorized: true },
  });
  await client.connect();
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS'))
  )`);

  const applied = new Set((await client.query(`SELECT version FROM schema_migrations`)).rows.map((r) => r.version));
  const all = files();

  if (STATUS) {
    for (const f of all) console.log(`  ${applied.has(f) ? "✓" : "·"} ${f}`);
    await client.end();
    return;
  }

  let n = 0;
  for (const f of all) {
    if (applied.has(f)) continue;
    const sql = fs.readFileSync(path.join(DIR, f), "utf8");
    if (DRY) {
      console.log(`  would apply ${f}`);
      continue;
    }
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query(`INSERT INTO schema_migrations (version) VALUES ($1)`, [f]);
      await client.query("COMMIT");
      console.log(`  ✓ ${f}`);
      n++;
    } catch (e) {
      await client.query("ROLLBACK");
      console.error(`  ✗ ${f}: ${e.message}`);
      await client.end();
      process.exit(1);
    }
  }
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS c FROM information_schema.tables WHERE table_schema='public'`
  );
  console.log(`\n${BACKEND}: ${n} migration(s) applied, ${rows[0].c} tables present.`);
  if (!n) console.log("  (already up to date)");
  await client.end();
}

ensureBaseline();
console.log(`\nMigrations — backend: ${BACKEND}${DRY ? " (dry run)" : ""}\n`);
if (BACKEND === "postgres") await postgres();
else await sqlite();
