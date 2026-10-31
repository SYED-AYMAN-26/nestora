#!/usr/bin/env node
/**
 * Rebuild the DISPOSABLE PostgreSQL regression database from a disposable
 * SQLite seed file, so stateful suites (E2E, storage security) always start from
 * the same demo dataset.
 *
 *   node scripts/pg-regress-reset.mjs
 *
 * Deliberately restricted to a database whose name ends in `_regress` and to a
 * SQLite file named `e2e-seed.db`: it drops and recreates the target, so it must
 * never be pointed at real data.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { Client } = require("pg");

const BASE = process.env.PG_TEST_BASE || "postgresql://rentlink:rentlink@127.0.0.1:5432";
const DB = "rentlink_regress";
const SEED = path.join(ROOT, "data", "e2e-seed.db");

if (!DB.endsWith("_regress")) throw new Error("refusing: target is not a disposable regression database");
if (!fs.existsSync(SEED)) throw new Error(`seed file missing: ${SEED} (run DATABASE_PATH=data/e2e-seed.db node scripts/seed.mjs)`);

const admin = new Client({ connectionString: `${BASE}/postgres` });
await admin.connect();
await admin.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
await admin.query(`CREATE DATABASE ${DB}`);
await admin.end();

const url = `${BASE}/${DB}`;
execFileSync("node", ["scripts/migrate.mjs"], { cwd: ROOT, stdio: "inherit", env: { ...process.env, DATABASE_URL: url, PG_SSL_MODE: "disable" } });
execFileSync("node", ["scripts/migrate-to-postgres.mjs", "--apply"], {
  cwd: ROOT,
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: url, DATABASE_PATH: path.relative(ROOT, SEED), PG_SSL_MODE: "disable" },
});
console.log(`\n${DB} rebuilt from ${path.relative(ROOT, SEED)}.`);
