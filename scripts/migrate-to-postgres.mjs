#!/usr/bin/env node
/**
 * SQLite → PostgreSQL data migration.
 *
 * This is the tool for "safe migration of existing records": it copies every row
 * of every table from the SQLite database the app has been using into PostgreSQL,
 * preserving ids, foreign keys and constraints, then verifies the result.
 *
 *   node scripts/migrate-to-postgres.mjs --dry-run
 *   DATABASE_URL=postgres://… node scripts/migrate-to-postgres.mjs --apply
 *
 * What it guarantees
 * ------------------
 *  - Nothing is deleted. The SQLite file is opened READ-ONLY with
 *    `fileMustExist`; the Postgres target is never truncated unless the target
 *    tables are empty or --replace is passed.
 *  - Order: tables are inserted in foreign-key dependency order derived from the
 *    schema itself, so constraints hold at every statement (no need to disable
 *    them, which managed Postgres would not allow anyway).
 *  - One transaction: any failure rolls the whole load back.
 *  - Ids are preserved verbatim, then every identity column's sequence is
 *    advanced past MAX(id) so the app's next INSERT cannot collide.
 *  - Verification: row counts per table, and a checksum of every non-text
 *    column, must match on both sides before it reports success.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { digestRows as digest, normalise } from "./lib/migration-digest.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

const APPLY = process.argv.includes("--apply");
const REPLACE = process.argv.includes("--replace");
const DRY = !APPLY;

const SQLITE_PATH = process.env.DATABASE_PATH
  ? path.resolve(ROOT, process.env.DATABASE_PATH)
  : path.join(ROOT, "data", "rentlink.db");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL must point at the PostgreSQL target.");
  process.exit(2);
}
if (!fs.existsSync(SQLITE_PATH)) {
  console.error(`SQLite source not found: ${SQLITE_PATH}`);
  process.exit(2);
}

/** Reads the FK graph out of the schema and returns a safe insert order. */
function tableOrder(schemaSql) {
  const tables = [];
  const deps = new Map();
  const re = /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+"?(\w+)"?\s*\(([\s\S]*?)\n\);/g;
  let m;
  while ((m = re.exec(schemaSql))) {
    const [, name, body] = m;
    tables.push(name);
    const refs = new Set();
    const refRe = /REFERENCES\s+"?(\w+)"?/g;
    let r;
    while ((r = refRe.exec(body))) if (r[1] !== name) refs.add(r[1]);
    deps.set(name, refs);
  }
  const order = [];
  const seen = new Set();
  const visiting = new Set();
  const visit = (t, chain = []) => {
    if (seen.has(t)) return;
    if (visiting.has(t)) {
      throw new Error(`Circular foreign-key dependency: ${[...chain, t].join(" → ")}`);
    }
    visiting.add(t);
    for (const d of deps.get(t) ?? []) if (deps.has(d)) visit(d, [...chain, t]);
    visiting.delete(t);
    seen.add(t);
    order.push(t);
  };
  for (const t of tables) visit(t);
  return { order, tables };
}

function quoteIdent(name) {
  return `"${name.replace(/"/g, '""')}"`;
}

async function main() {
  const Database = require("better-sqlite3");
  const { Client } = require("pg");

  const src = new Database(SQLITE_PATH, { readonly: true, fileMustExist: true });
  const schemaSql = fs.readFileSync(path.join(ROOT, "src/lib/schema.sql"), "utf8");
  const { order } = tableOrder(schemaSql);

  // Only tables that actually exist in the SQLite file (older DBs may predate some).
  const present = new Set(
    src.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`).all().map((r) => r.name)
  );
  const toCopy = order.filter((t) => present.has(t) && t !== "schema_migrations");

  const counts = new Map();
  for (const t of toCopy) counts.set(t, src.prepare(`SELECT COUNT(*) AS c FROM ${quoteIdent(t)}`).get().c);

  console.log(`Source : ${SQLITE_PATH}`);
  console.log(`Target : ${process.env.DATABASE_URL.replace(/:[^:@/]+@/, ":***@")}`);
  console.log(`Tables : ${toCopy.length}`);
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  console.log(`Rows   : ${total}\n`);

  if (DRY) {
    for (const t of toCopy) console.log(`  ${String(counts.get(t)).padStart(6)}  ${t}`);
    console.log("\n(dry run — nothing written. Pass --apply to load.)");
    src.close();
    return;
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl:
      (process.env.PG_SSL_MODE || "").toLowerCase() === "disable"
        ? false
        : (process.env.PG_SSL_MODE || "").toLowerCase() === "no-verify"
          ? { rejectUnauthorized: false }
          : { rejectUnauthorized: true },
  });
  await client.connect();

  // Refuse to merge into a database that already holds data.
  const existing = (
    await client.query(
      `SELECT table_name, (SELECT 1) AS present FROM information_schema.tables WHERE table_schema='public'`
    )
  ).rows.map((r) => r.table_name);
  const nonEmpty = [];
  for (const t of toCopy) {
    if (!existing.includes(t)) continue;
    const { rows } = await client.query(`SELECT COUNT(*)::int AS c FROM ${quoteIdent(t)}`);
    if (rows[0].c > 0) nonEmpty.push(`${t}(${rows[0].c})`);
  }
  if (nonEmpty.length && !REPLACE) {
    console.error(
      `Target already contains data in: ${nonEmpty.join(", ")}\n` +
        `Refusing to merge. Re-run with --replace to truncate those tables first (their SQLite copy is the source of truth).`
    );
    await client.end();
    src.close();
    process.exit(1);
  }

  await client.query("BEGIN");
  try {
    if (nonEmpty.length && REPLACE) {
      // Deliberately NOT `TRUNCATE … CASCADE`: CASCADE follows every foreign key
      // and can empty tables outside this run's scope. Instead, only the tables
      // this migration owns are cleared, in reverse dependency order, with no
      // CASCADE — so a foreign key from a table outside scope makes the statement
      // fail loudly instead of quietly deleting someone else's rows.
      const scope = new Set(toCopy);
      const outside = [...existing].filter((t) => !scope.has(t));
      if (outside.length) {
        console.log(`  note: ${outside.length} table(s) outside the migration scope are left untouched: ${outside.slice(0, 6).join(", ")}${outside.length > 6 ? "…" : ""}`);
      }
      for (const t of [...toCopy].reverse()) {
        if (!existing.includes(t)) continue;
        await client.query(`DELETE FROM ${quoteIdent(t)}`);
      }
      console.log(`  cleared ${nonEmpty.length} table(s) in the target (no CASCADE)\n`);
    }

    for (const t of toCopy) {
      const rows = src.prepare(`SELECT * FROM ${quoteIdent(t)}`).all();
      if (!rows.length) {
        console.log(`  ✓ ${t}: 0 rows`);
        continue;
      }
      const cols = Object.keys(rows[0]);
      // Batch inserts (500 rows per statement) to keep round-trips sane.
      let done = 0;
      const BATCH = 500;
      for (let i = 0; i < rows.length; i += BATCH) {
        const chunk = rows.slice(i, i + BATCH);
        const values = [];
        const tuples = chunk.map((row) => {
          const ph = cols.map((c) => {
            values.push(row[c] === undefined ? null : row[c]);
            return `$${values.length}`;
          });
          return `(${ph.join(",")})`;
        });
        await client.query(
          `INSERT INTO ${quoteIdent(t)} (${cols.map(quoteIdent).join(",")}) VALUES ${tuples.join(",")}`,
          values
        );
        done += chunk.length;
      }
      console.log(`  ✓ ${t}: ${done} rows`);
    }

    // Advance identity sequences past the ids we just inserted verbatim.
    for (const t of toCopy) {
      const { rows } = await client.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema='public' AND table_name=$1 AND is_identity='YES'`,
        [t]
      );
      if (!rows.length) continue;
      for (const { column_name } of rows) {
        await client.query(
          `SELECT setval(pg_get_serial_sequence($1, $2),
                         COALESCE((SELECT MAX(${quoteIdent(column_name)}) FROM ${quoteIdent(t)}), 0) + 1,
                         false)`,
          [t, column_name]
        );
      }
    }

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(`\nMIGRATION FAILED — rolled back, target unchanged.\n${e.message}`);
    await client.end();
    src.close();
    process.exit(1);
  }

  /* ---------------------------------------------------------- verification */
  // Row counts alone would pass a migration that copied the right NUMBER of
  // wrong rows. For every table we also compare a stable digest of the actual
  // values: rows are read back from both engines, JSON-serialised with sorted
  // keys, and hashed. Any difference in any column of any row shows up.
  let bad = 0;
  const mismatches = [];
  for (const t of toCopy) {
    const sCount = counts.get(t);
    const { rows } = await client.query(`SELECT COUNT(*)::int AS c FROM ${quoteIdent(t)}`);
    const pCount = rows[0].c;
    if (sCount !== pCount) {
      mismatches.push(`${t}: ${sCount} rows in SQLite vs ${pCount} in PostgreSQL`);
      bad++;
      continue;
    }
    if (sCount === 0) continue;
    const srcRows = src.prepare(`SELECT * FROM ${quoteIdent(t)}`).all();
    const dstRows = (await client.query(`SELECT * FROM ${quoteIdent(t)}`)).rows;
    const a = digest(srcRows);
    const b = digest(dstRows);
    if (a !== b) {
      // Narrow it down so the report is actionable.
      const key = Object.keys(srcRows[0]).includes("id") ? "id" : Object.keys(srcRows[0])[0];
      const srcMap = new Map(srcRows.map((r) => [String(r[key]), r]));
      const diffs = [];
      for (const row of dstRows) {
        const s = srcMap.get(String(row[key]));
        if (!s) continue;
        for (const col of Object.keys(s)) {
          if (JSON.stringify(normalise(s[col])) !== JSON.stringify(normalise(row[col]))) {
            diffs.push(`${key}=${row[key]} column "${col}": ${JSON.stringify(s[col])} → ${JSON.stringify(row[col])}`);
          }
        }
        if (diffs.length >= 3) break;
      }
      mismatches.push(`${t}: ${sCount} rows match but values differ — ${diffs.slice(0, 3).join("; ")}`);
      bad++;
    }
  }
  console.log(
    bad
      ? `\n${bad} table(s) do not match:\n` + mismatches.map((m) => `  ✗ ${m}`).join("\n")
      : `\nVerified: all ${toCopy.length} tables match row-for-row AND value-for-value (${total} rows).`
  );

  await client.end();
  src.close();
  if (bad) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
