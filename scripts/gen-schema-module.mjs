#!/usr/bin/env node
/**
 * Generates `src/lib/schema.generated.ts`.
 *
 * Why this exists: `db.ts` used to `fs.readFileSync("src/lib/schema.sql")` at
 * runtime. That works locally but FAILS on Vercel — the serverless bundle only
 * contains files Next traced through imports, and `find .next -name '*.sql'`
 * returns nothing. A cold start would throw ENOENT while trying to bootstrap the
 * database.
 *
 * Importing the DDL as a TypeScript module makes it part of the bundle, so it is
 * available in every lambda with no file-tracing configuration and no runtime
 * filesystem access at all.
 *
 * Runs automatically via `prebuild`/`predev`/`prestart`; also usable directly:
 *   node scripts/gen-schema-module.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "src/lib/schema.generated.ts");

const sqlite = fs.readFileSync(path.join(ROOT, "src/lib/schema.sql"), "utf8");
const pgPath = path.join(ROOT, "src/lib/schema.pg.sql");
if (!fs.existsSync(pgPath)) {
  console.error("src/lib/schema.pg.sql is missing — run: node scripts/gen-pg-schema.mjs");
  process.exit(1);
}
const postgres = fs.readFileSync(pgPath, "utf8");

const hash = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);

const body = `/**
 * GENERATED FILE — do not edit.
 * Produced by scripts/gen-schema-module.mjs from:
 *   src/lib/schema.sql      (SQLite,      ${hash(sqlite)})
 *   src/lib/schema.pg.sql   (PostgreSQL,  ${hash(postgres)})
 *
 * Bundled into the server output so the schema is available on serverless
 * deployments without any runtime filesystem access.
 */

export const SQLITE_SCHEMA = ${JSON.stringify(sqlite)};

export const POSTGRES_SCHEMA = ${JSON.stringify(postgres)};

export const SQLITE_SCHEMA_HASH = ${JSON.stringify(hash(sqlite))};
export const POSTGRES_SCHEMA_HASH = ${JSON.stringify(hash(postgres))};
`;

const previous = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
fs.writeFileSync(OUT, body);
console.log(
  `schema.generated.ts ${previous === body ? "unchanged" : "written"} ` +
    `(sqlite ${hash(sqlite)}, postgres ${hash(postgres)}, ${(body.length / 1024).toFixed(1)} kB)`
);
