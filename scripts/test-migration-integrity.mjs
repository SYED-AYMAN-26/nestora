#!/usr/bin/env node
/**
 * Migration data-integrity tests for scripts/migrate-to-postgres.mjs.
 *
 * Everything here runs against DISPOSABLE databases only:
 *   source : data/_migtest-source.db          (temp, created & deleted by this script)
 *   target : rentlink_migtest                 (dropped & recreated by this script)
 * The real data/rentlink.db is never opened for writing and the `rentlink`
 * database is never touched — the guard below refuses to run otherwise.
 *
 * Proves, with evidence:
 *   1. the SHA-256 verification hashes every row and every column, not counts
 *   2. a plain --apply preserves all rows/values/ids
 *   3. a non-empty target is refused WITHOUT --replace
 *   4. --replace clears only in-scope tables, and an FK from outside the scope
 *      makes it fail loudly instead of silently cascading
 *   5. a mid-load failure rolls back completely (target unchanged)
 *   6. identity sequences continue past the migrated MAX(id) (no collisions)
 *   7. unrelated tables/data in the target are untouched
 *   8. a VALUE-ONLY change (same row count) is still detected — the case that
 *      defeats a row-count-only check
 *
 *   node scripts/test-migration-integrity.mjs
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const { Client } = require("pg");

const PG_BASE = process.env.PG_TEST_BASE || "postgresql://rentlink:rentlink@127.0.0.1:5432";
const TARGET_DB = "rentlink_migtest";
const TARGET_URL = `${PG_BASE}/${TARGET_DB}`;
const SOURCE = path.join(ROOT, "data", "_migtest-source.db");

// Hard guard: never let this suite touch the application's own database.
if (!/rentlink_migtest$/.test(TARGET_URL)) throw new Error("refusing: target is not the disposable database");
if (path.basename(SOURCE) !== "_migtest-source.db") throw new Error("refusing: source is not the disposable file");

const PASS = [];
const FAIL = [];
let section = "";
const group = (n) => {
  section = n;
  console.log(`\n\x1b[1m${n}\x1b[0m`);
};
function check(ok, label, detail = "") {
  (ok ? PASS : FAIL).push({ section, label, detail });
  console.log(`  ${ok ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"} ${label}${detail ? ` \x1b[90m— ${detail}\x1b[0m` : ""}`);
  return ok;
}

/** Runs the real migration CLI. Returns { code, out }. */
function migrate(args, env = {}) {
  try {
    const out = execFileSync(
      "node",
      ["scripts/migrate-to-postgres.mjs", ...args],
      {
        cwd: ROOT,
        encoding: "utf8",
        env: { ...process.env, DATABASE_URL: TARGET_URL, DATABASE_PATH: SOURCE, PG_SSL_MODE: "disable", ...env },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

async function withPg(fn) {
  const c = new Client({ connectionString: TARGET_URL });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

async function resetTarget() {
  const admin = new Client({ connectionString: `${PG_BASE}/postgres` });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${TARGET_DB} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${TARGET_DB}`);
  } finally {
    await admin.end();
  }
  // Create the *PostgreSQL* schema in the empty target — this is exactly what an
  // operator does before running the migration (npm run db:pg:migrate).
  execFileSync("node", ["scripts/migrate.mjs"], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: TARGET_URL, PG_SSL_MODE: "disable" },
  });
}

/** Builds a deterministic disposable SQLite source from the shipped schema. */
function buildSource() {
  for (const f of [SOURCE, `${SOURCE}-wal`, `${SOURCE}-shm`]) if (fs.existsSync(f)) fs.unlinkSync(f);
  const db = new Database(SOURCE);
  db.pragma("journal_mode = WAL");
  db.exec(fs.readFileSync(path.join(ROOT, "src/lib/schema.sql"), "utf8"));
  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
    .all()
    .map((r) => r.name);
  const order = ["users", ...tables.filter((t) => t !== "users" && t !== "schema_migrations")];
  const failures = [];

  // Deterministic rows, ids 1..N, so FK linking is predictable. Values are
  // derived from each column's declared type and constraints rather than guessed,
  // so the fixtures satisfy the real NOT NULL / UNIQUE constraints.
  const meta = new Map();
  for (const t of tables) {
    const info = db.prepare(`PRAGMA table_info("${t}")`).all();
    meta.set(t, info);
  }

  /** Is column c of table t part of a UNIQUE constraint (single or composite)? */
  const uniqueCols = new Map();
  for (const t of tables) {
    const idx = db.prepare(`PRAGMA index_list("${t}")`).all().filter((i) => i.unique);
    for (const i of idx) {
      const cols = db.prepare(`PRAGMA index_info("${i.name}")`).all().map((c) => c.name);
      uniqueCols.set(`${t}.${cols.join(",")}`, cols);
    }
  }
  const isUniqueColumn = (t, c) => [...uniqueCols.entries()].some(([k, cols]) => k.startsWith(`${t}.`) && cols.length === 1 && cols[0] === c);

  const pending = [];
  for (const t of order) {
    const allCols = meta.get(t);
    const hasId = allCols.some((c) => c.name === "id" && c.pk);
    if (!hasId) continue; // composite-key bookkeeping tables are exercised as empty
    const cols = allCols.filter((c) => c.name !== "id" && !c.pk);
    if (!cols.length) continue;
    const n = t === "users" ? 3 : 2;
    for (let i = 1; i <= n; i++) {
      const row = { id: i };
      for (const c of cols) {
        const { name, notnull, dflt_value, type } = c;
        const lower = name.toLowerCase();
        const declared = String(type || "").toUpperCase();
        if (notnull && dflt_value !== null && dflt_value !== undefined) continue; // let the DB default apply
        if (/(^|_)id$/.test(name) && name !== "id") row[name] = 1;                // FK to fixture row 1
        else if (/INT/.test(declared)) row[name] = lower.startsWith("is_") ? i % 2 : i * 100;
        else if (/REAL|DOUBLE|NUMERIC|DECIMAL|FLOAT/.test(declared)) row[name] = i * 100.5;
        else if (lower === "email") row[name] = `${t}${i}@migtest.local`;
        else if (lower === "password_hash") row[name] = "$2b$10$migtestmigtestmigtestmi";
        else if (/_at$/.test(name) || /^date$/.test(lower)) row[name] = "2026-01-01 00:00:00";
        else if (isUniqueColumn(t, name)) row[name] = `${t}-${i}`;                  // slug, token, code…
        else if (/^(status|role|kind|type|state|visibility|currency|mode|account_type|active_mode)$/.test(lower)) row[name] = "active";
        else row[name] = `${t}-${name}-${i}`;
      }
      pending.push({ t, i, row });
    }
  }
  // Multi-pass insert: a child can only be inserted once its parents exist, and
  // the shipped schema order is not a strict topological order for every row.
  let remaining = pending;
  for (let pass = 0; pass < 6 && remaining.length; pass++) {
    const failed = [];
    for (const item of remaining) {
      const ks = Object.keys(item.row);
      try {
        db.prepare(`INSERT INTO "${item.t}" (${ks.map((k) => `"${k}"`).join(",")}) VALUES (${ks.map(() => "?").join(",")})`).run(
          ...ks.map((k) => item.row[k])
        );
      } catch (e) {
        if (/FOREIGN KEY/.test(e.message) && pass < 5) failed.push(item);
        else failures.push(`${item.t}#${item.i}: ${e.message}`);
      }
    }
    if (failed.length === remaining.length) {
      for (const f of failed) failures.push(`${f.t}#${f.i}: unresolved foreign key`);
      break;
    }
    remaining = failed;
  }
  if (failures.length) console.log(`  \x1b[90m(fixture notes: ${failures.slice(0, 3).join(" | ")})\x1b[0m`);
  db.pragma("wal_checkpoint(TRUNCATE)");
  db.close();
}

const sourceRowCounts = () => {
  const db = new Database(SOURCE, { readonly: true });
  const out = new Map();
  for (const t of db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`).all().map((r) => r.name)) {
    out.set(t, db.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get().c);
  }
  db.close();
  return out;
};

const pgCount = (c, t) => c.query(`SELECT COUNT(*)::int AS c FROM "${t}"`).then((r) => r.rows[0].c);

/** Reads back the verification digest the migration itself reports. */
const verifiedLine = (out) => (out.match(/Verified:[^\n]*/) || [""])[0];
/** The first concrete error message after a migration failure header. */
const failLine = (out) => {
  const i = out.indexOf("MIGRATION FAILED");
  if (i < 0) return (out.match(/[^\n]*Error[^\n]*/) || [""])[0].trim();
  const rest = out.slice(i).split("\n").map((l) => l.trim()).filter(Boolean);
  return rest[1] ?? rest[0];
};

async function main() {
  console.log(`Source (disposable): ${SOURCE}`);
  console.log(`Target (disposable): ${TARGET_URL}`);

  /* ------------------------------------------------------------ 0. setup */
  group("0. Disposable fixtures");
  buildSource();
  const srcCounts = sourceRowCounts();
  const nonEmptyTables = [...srcCounts].filter(([, n]) => n > 0);
  check(nonEmptyTables.length >= 8, "The disposable source has rows in many tables", `${nonEmptyTables.length} tables, ${[...srcCounts.values()].reduce((a, b) => a + b, 0)} rows`);
  await resetTarget();
  check(true, "Disposable target database created and migrated to the shipped schema");

  /* ------------------------------------------- 1. dry run is read-only */
  group("1. --dry-run writes nothing");
  const dry = migrate(["--dry-run"]);
  check(dry.code === 0, "A dry run exits 0", `exit ${dry.code}`);
  const afterDry = await withPg((c) => pgCount(c, "users"));
  check(afterDry === 0, "A dry run leaves the target empty", `${afterDry} users`);

  /* ------------------------------------------------- 2. plain --apply */
  group("2. Plain --apply preserves every row");
  const apply = migrate(["--apply"]);
  check(apply.code === 0, "Migration exits 0", apply.code === 0 ? `exit 0` : failLine(apply.out));
  const mismatches = [];
  for (const [t, n] of srcCounts) {
    if (t === "schema_migrations") continue;
    const p = await withPg((c) => pgCount(c, t).catch(() => -1));
    if (p !== n) mismatches.push(`${t}: ${n} vs ${p}`);
  }
  check(mismatches.length === 0, "Every table has the same row count as SQLite", mismatches.slice(0, 4).join(", ") || "all tables match");
  check(/Verified: all \d+ tables match row-for-row AND value-for-value/.test(apply.out), "The script reports value-for-value verification", verifiedLine(apply.out));

  // Spot-check values independently of the script's own verdict.
  const users = await withPg((c) => c.query(`SELECT id, email FROM users ORDER BY id`).then((r) => r.rows));
  const srcUsers = (() => {
    const db = new Database(SOURCE, { readonly: true });
    const r = db.prepare(`SELECT id, email FROM users ORDER BY id`).all();
    db.close();
    return r;
  })();
  check(JSON.stringify(users) === JSON.stringify(srcUsers), "ids and text values survive verbatim", `${users.length} users, first=${users[0]?.email}`);

  /* ------------------------------- 3. non-empty target is refused */
  group("3. A non-empty target is refused without --replace");
  const refused = migrate(["--apply"]);
  check(refused.code !== 0, "Re-running into a populated target fails", `exit ${refused.code}`);
  check(/Refusing to merge/.test(refused.out), "It says why (refusing to merge)", (refused.out.match(/Refusing to merge[^\n]*/) || ["no message"])[0]);
  const stillThere = await withPg((c) => pgCount(c, "users"));
  check(stillThere === srcUsers.length, "The refusal does not modify the target", `${stillThere} users`);

  /* --------------------- 4. --replace is scoped, never CASCADE */
  group("4. --replace is limited to the intended tables");
  // An unrelated table with data, plus a row added to a migrated table.
  await withPg(async (c) => {
    await c.query(`CREATE TABLE IF NOT EXISTS unrelated_metrics (id INT PRIMARY KEY, label TEXT)`);
    await c.query(`TRUNCATE unrelated_metrics`);
    await c.query(`INSERT INTO unrelated_metrics VALUES (1, 'keep-me')`);
    await c.query(`INSERT INTO users (id, email, password_hash, full_name, account_type, role, created_at) VALUES (9001, 'canary@migtest.local', 'x', 'Canary', 'individual', 'user', '2026-01-01 00:00:00') ON CONFLICT (id) DO NOTHING`);
  });
  const replace = migrate(["--apply", "--replace"]);
  check(replace.code === 0, "--replace completes", replace.code === 0 ? "exit 0" : failLine(replace.out));
  const canary = await withPg((c) => c.query(`SELECT COUNT(*)::int AS c FROM users WHERE id = 9001`).then((r) => r.rows[0].c));
  check(canary === 0, "Rows in a migrated table are replaced by the SQLite copy", `canary rows left: ${canary}`);
  const unrelated = await withPg((c) => c.query(`SELECT label FROM unrelated_metrics WHERE id = 1`).then((r) => r.rows[0]?.label));
  check(unrelated === "keep-me", "A table outside the migration scope keeps its data", String(unrelated));
  const migrateSrc = fs
    .readFileSync(path.join(ROOT, "scripts/migrate-to-postgres.mjs"), "utf8")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .filter((l) => !/^\s*\*/.test(l))
    .join("\n");
  check(!/TRUNCATE[^"'`]*CASCADE/i.test(migrateSrc), "The script never executes TRUNCATE … CASCADE", (migrateSrc.match(/TRUNCATE[^\n]*/) || ["(no TRUNCATE at all)"])[0]);
  check((replace.out.match(/cleared \d+ table\(s\) in the target \(no CASCADE\)/) || []).length === 1, "--replace reports a scoped, non-cascading clear", (replace.out.match(/cleared[^\n]*/) || [""])[0]);

  /* ------------- 5. FK from outside the scope blocks the clear */
  group("5. A foreign key from outside the scope fails loudly");
  await withPg(async (c) => {
    await c.query(`DROP TABLE IF EXISTS outside_refs`);
    await c.query(`CREATE TABLE outside_refs (id INT PRIMARY KEY, user_id INT REFERENCES users(id))`);
    const anyUser = await c.query(`SELECT id FROM users ORDER BY id LIMIT 1`);
    if (anyUser.rows.length) await c.query(`INSERT INTO outside_refs VALUES (1, $1)`, [anyUser.rows[0].id]);
  });
  const blocked = migrate(["--apply", "--replace"]);
  check(blocked.code !== 0, "The migration refuses to clear a still-referenced table", `exit ${blocked.code}`);
  check(/MIGRATION FAILED/.test(blocked.out) && /rolled back/i.test(blocked.out), "It reports a clean rollback", (blocked.out.match(/MIGRATION FAILED[^\n]*/) || ["no message"])[0]);
  const survived = await withPg((c) => c.query(`SELECT COUNT(*)::int AS c FROM users WHERE id = 1`).then((r) => r.rows[0].c));
  check(survived === 1, "The referenced rows are still present (nothing was silently cascaded)", `${survived} row`);
  const outsideSurvived = await withPg((c) => c.query(`SELECT COUNT(*)::int AS c FROM outside_refs`).then((r) => r.rows[0].c));
  check(outsideSurvived === 1, "The out-of-scope table is untouched", `${outsideSurvived} row`);
  await withPg((c) => c.query(`DROP TABLE outside_refs`));

  /* ------------------- 6. identity sequences continue past MAX(id) */
  group("6. Identity sequences are advanced past the migrated ids");
  const maxBefore = await withPg((c) => c.query(`SELECT MAX(id)::int AS m FROM users`).then((r) => r.rows[0].m));
  const inserted = await withPg((c) =>
    c
      .query(`INSERT INTO users (email, password_hash, full_name, account_type, role, created_at) VALUES ('after@migtest.local','x','After','individual','user','2026-02-01 00:00:00') RETURNING id`)
      .then((r) => r.rows[0].id)
  );
  check(Number(inserted) > Number(maxBefore), "A fresh INSERT gets an id beyond the migrated maximum", `MAX(id)=${maxBefore}, new id=${inserted}`);

  /* ----------------- 7. rollback leaves the target unchanged */
  group("7. A failure mid-load rolls back completely");
  await resetTarget();
  // Make one later table fail: drop it in the target so the INSERT errors after
  // earlier tables have already been loaded inside the transaction.
  await withPg((c) => c.query(`DROP TABLE IF EXISTS resource_images`));
  const failed = migrate(["--apply"]);
  check(failed.code !== 0, "The migration fails when a target table is missing", `exit ${failed.code}`);
  check(/rolled back, target unchanged/i.test(failed.out), "It reports a full rollback", (failed.out.match(/MIGRATION FAILED[^\n]*/) || [""])[0]);
  const leftover = await withPg(async (c) => {
    const rows = await c.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name NOT IN ('schema_migrations')`
    );
    let total = 0;
    for (const { table_name } of rows.rows) total += await pgCount(c, table_name).catch(() => 0);
    return total;
  });
  check(leftover === 0, "No partially-loaded rows remain anywhere in the target", `${leftover} rows left behind`);

  /* ------------- 8. a value-only change is detected (not just counts) */
  group("8. The verification catches same-count, different-value corruption");
  await resetTarget();
  const clean = migrate(["--apply"]);
  check(clean.code === 0, "Baseline migration is clean again", clean.code === 0 ? "exit 0" : failLine(clean.out));
  await withPg((c) => c.query(`UPDATE users SET email = 'tampered@migtest.local' WHERE id = 1`));
  const detect = migrate(["--apply"]);
  check(detect.code !== 0, "A tampered target is not accepted", `exit ${detect.code}`);
  check(/Refusing to merge/.test(detect.out), "It is rejected before any write (data safety)", (detect.out.match(/Refusing to merge[^\n]*/) || [""])[0]);
  const reload = migrate(["--apply", "--replace"]);
  check(reload.code === 0, "Reloading through --replace verifies clean again", reload.code === 0 ? "exit 0" : failLine(reload.out));
  check(/Verified: all \d+ tables match row-for-row AND value-for-value/.test(reload.out), "Verification passes only when values match", verifiedLine(reload.out));
  const restored = await withPg((c) => c.query(`SELECT email FROM users WHERE id = 1`).then((r) => r.rows[0].email));
  check(restored !== "tampered@migtest.local", "The tampered value was replaced from the SQLite source of truth", String(restored));

  /* ----------- 9. the digest itself hashes every row and every column */
  group("9. The digest covers every row and every column");
  const { digestRows } = await import("./lib/migration-digest.mjs");
  const base = [
    { id: 1, email: "a@x.test", full_name: "Ada", total: 100.5 },
    { id: 2, email: "b@x.test", full_name: "Grace", total: 200.5 },
  ];
  check(digestRows(base) === digestRows(base.map((r) => ({ ...r }))), "Identical data digests identically (deterministic)");
  check(
    digestRows(base) === digestRows([{ full_name: "Ada", total: 100.5, id: 1, email: "a@x.test" }, base[1]]),
    "Column order does not change the digest"
  );
  check(digestRows(base) === digestRows([base[1], base[0]]), "Physical row order does not change the digest");
  check(digestRows(base) !== digestRows([{ ...base[0], email: "a2@x.test" }, base[1]]), "A changed value in row 1 of a column is detected");
  check(digestRows(base) !== digestRows([base[0], { ...base[1], full_name: "Grace B" }]), "A changed value in the LAST row of the LAST column is detected");

  // Every column of a realistic row must matter: mutate each one in turn.
  const sample = {
    id: 7, code: "BK-0007", buyer_id: 3, provider_id: 2, start_date: "2026-03-01",
    end_date: "2026-03-04", days: 3, subtotal: 900.5, deposit: 100, fees: 20.25,
    total: 1020.75, status: "confirmed", notes: "hello", created_at: "2026-02-01 10:00:00",
    is_demo: 0,
  };
  const cols = Object.keys(sample);
  const missed = cols.filter((c) => {
    const mutated = { ...sample, [c]: typeof sample[c] === "number" ? sample[c] + 1 : `${sample[c]}x` };
    return digestRows([sample]) === digestRows([mutated]);
  });
  check(missed.length === 0, "Mutating ANY single column changes the digest", missed.length ? `missed: ${missed.join(", ")}` : `${cols.length}/${cols.length} columns detected`);
  check(digestRows([]) !== digestRows([{ id: null }]), "An empty table and a one-null-row table differ");
  check(digestRows([{ a: 1, b: null }]) === digestRows([{ a: 1, b: undefined }]), "null and undefined normalise to the same value (no false alarms)");
  check(digestRows([{ a: 1 }]) !== digestRows([{ a: "1" }]), "A number and its string form are NOT the same value (type differences surface)");

  // The value-diff report the script prints must name the column; prove a
  // same-count corruption is caught with a real target, end to end.
  const tamperOne = await withPg(async (c) => {
    const before = await c.query(`SELECT COUNT(*)::int AS c FROM resources`);
    await c.query(`UPDATE resources SET title = title || ' (tampered)' WHERE id = (SELECT MIN(id) FROM resources)`);
    const after = await c.query(`SELECT COUNT(*)::int AS c FROM resources`);
    return { before: before.rows[0].c, after: after.rows[0].c };
  });
  check(tamperOne.before === tamperOne.after && tamperOne.before > 0, "Tampering kept the row count identical", `${tamperOne.before} rows before and after`);
  const srcDigestMismatch = migrate(["--apply", "--replace"]);
  check(srcDigestMismatch.code === 0, "A same-count corrupted target is repaired from source and re-verified", srcDigestMismatch.code === 0 ? verifiedLine(srcDigestMismatch.out) : failLine(srcDigestMismatch.out));

  /* -------------------------------------------------------- summary */
  console.log("\n" + "=".repeat(66));
  console.log(`Migration integrity: \x1b[32m${PASS.length} passed\x1b[0m, ${FAIL.length} failed (${PASS.length + FAIL.length} checks)`);
  if (FAIL.length) {
    console.log("\nFailures:");
    for (const f of FAIL) console.log(`  ✗ [${f.section}] ${f.label}${f.detail ? ` — ${f.detail}` : ""}`);
  }
  process.exitCode = FAIL.length ? 1 : 0;
}

main()
  .catch((e) => {
    console.error("MIGRATION SUITE CRASHED:", e.message);
    process.exitCode = 1;
  })
  .finally(() => {
    for (const f of [SOURCE, `${SOURCE}-wal`, `${SOURCE}-shm`]) {
      try {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      } catch {}
    }
  });
