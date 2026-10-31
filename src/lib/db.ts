import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import { POSTGRES_SCHEMA, SQLITE_SCHEMA } from "./schema.generated";

/**
 * Database access layer — one async API, two backends.
 *
 *   DATABASE_URL set   → PostgreSQL (Vercel/Neon/Supabase/RDS). Required for
 *                        serverless: a local SQLite file is not writable or
 *                        shared across lambda instances.
 *   DATABASE_URL unset → SQLite via better-sqlite3 (local dev and the existing
 *                        data/rentlink.db). Behaviour of the local build is
 *                        unchanged apart from the calls now being awaited.
 *
 * Everything here is AWAITED. A serverless function is a different process per
 * request, so no statement may depend on state held in module memory.
 *
 * Dialect: timestamps are stored as TEXT in both engines (ISO or
 * "YYYY-MM-DD HH:MM:SS"), which is why one query set works on both. The genuine
 * differences are translated per backend — see `toDialect()`.
 */

// Raw SQL rows are untyped by nature. Every query is narrowed at its call site
// through the generics on one<>/all<>; this is the single deliberate use of
// `any` in the codebase and it is what lets the existing query code stay intact.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;
export type Bind = string | number | bigint | boolean | null | Uint8Array | Date;
export type RunResult = { changes: number; lastInsertRowid: number };

export type Backend = "postgres" | "sqlite";

export const backend: Backend = process.env.DATABASE_URL ? "postgres" : "sqlite";
export const isPostgres = backend === "postgres";

/* ------------------------------------------------------------------ dialect */

/**
 * Walks SQL and reports, for every character, whether it is inside a quoted
 * literal, a quoted identifier or a comment. This is what makes the parameter
 * rewrite safe: a `?` inside 'a?b', "we?ird", $$ … $$, -- line or /* block *\/
 * must never be turned into a parameter.
 */
function quoteMask(sql: string): boolean[] {
  const mask = new Array<boolean>(sql.length).fill(false);
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    const next = sql[i + 1];

    // line comment
    if (c === "-" && next === "-") {
      const end = sql.indexOf("\n", i);
      const stop = end === -1 ? sql.length : end;
      for (let k = i; k < stop; k++) mask[k] = true;
      i = stop;
      continue;
    }
    // block comment
    if (c === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      const stop = end === -1 ? sql.length : end + 2;
      for (let k = i; k < stop; k++) mask[k] = true;
      i = stop;
      continue;
    }
    // quoted string / identifier  '…'  "…"  `…`  ('' and "" are escapes)
    if (c === "'" || c === '"' || c === "`") {
      const quote = c;
      let k = i + 1;
      mask[i] = true;
      while (k < sql.length) {
        if (sql[k] === quote) {
          if (sql[k + 1] === quote) { mask[k] = mask[k + 1] = true; k += 2; continue; }
          mask[k] = true;
          k++;
          break;
        }
        mask[k] = true;
        k++;
      }
      i = k;
      continue;
    }
    // dollar-quoted string  $$ … $$  /  $tag$ … $tag$
    if (c === "$") {
      const m = /^\$[A-Za-z_]\w*\$|^\$\$/.exec(sql.slice(i));
      if (m) {
        const tag = m[0];
        const end = sql.indexOf(tag, i + tag.length);
        const stop = end === -1 ? sql.length : end + tag.length;
        for (let k = i; k < stop; k++) mask[k] = true;
        i = stop;
        continue;
      }
    }
    i++;
  }
  return mask;
}

/**
 * Replaces a bare SQL keyword (e.g. LIKE → ILIKE) outside strings, identifiers
 * and comments. Operates on whole words only, so LIKE_ESCAPE or a column called
 * "likely" is untouched.
 */
function rewriteKeyword(sql: string, from: string, to: string): string {
  const mask = quoteMask(sql);
  const re = new RegExp(`\\b${from}\\b`, "gi");
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) {
    if (mask[m.index]) continue; // inside a literal/identifier/comment
    out += sql.slice(last, m.index) + to;
    last = m.index + m[0].length;
  }
  return out + sql.slice(last);
}

/** Replaces `?` placeholders that are real placeholders, in order, with $1…$n. */
function rewritePlaceholders(sql: string): string {
  const mask = quoteMask(sql);
  let n = 0;
  let out = "";
  for (let i = 0; i < sql.length; i++) {
    out += sql[i] === "?" && !mask[i] ? `$${++n}` : sql[i];
  }
  return out;
}

/**
 * Rewrites the handful of SQLite-only constructs this application uses.
 * Anything more elaborate is deliberately NOT supported — the schema is written
 * to be portable so the translation surface stays small and auditable.
 */
export function toDialect(sql: string): string {
  if (backend !== "postgres") return sql;
  let out = rewritePlaceholders(sql);

  // SQLite date helpers → Postgres equivalents. Both sides produce TEXT in the
  // same "YYYY-MM-DD HH:MM:SS" shape as the schema default, so comparisons
  // against TEXT columns keep working.
  out = out.replace(
    /datetime\('now'\s*,\s*'([+-]?\d+)\s+(seconds?|minutes?|hours?|days?|months?|years?)'\s*\)/gi,
    (_m, amt, unit) => `to_char((now() + interval '${amt} ${unit}') AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS')`
  );
  out = out.replace(/datetime\('now'\)/gi, "to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS')");
  out = out.replace(
    /date\('now'\s*,\s*'([+-]?\d+)\s+(days?|months?)'\s*\)/gi,
    (_m, amt, unit) => `to_char((now() + interval '${amt} ${unit}') AT TIME ZONE 'utc', 'YYYY-MM-DD')`
  );
  out = out.replace(/date\('now'\)/gi, "to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD')");

  // LIKE is case-insensitive on SQLite (ASCII) but case-sensitive on PostgreSQL.
  // Marketplace search relies on that — "canon" must find "Canon EOS 90D" on both.
  // Rewrite the operator, never the operands, and only outside quotes/comments.
  out = rewriteKeyword(out, "LIKE", "ILIKE");

  // instr(haystack, needle) → position(needle in haystack)
  out = out.replace(/instr\(\s*([^,()]+?)\s*,\s*([^()]+?)\s*\)/gi, "position($2 in $1)");

  // SQLite "INSERT OR IGNORE INTO" → "INSERT INTO … ON CONFLICT DO NOTHING"
  if (/^\s*INSERT\s+OR\s+IGNORE\s+INTO/i.test(out)) {
    out = out.replace(/^\s*INSERT\s+OR\s+IGNORE\s+INTO/i, "INSERT INTO");
    if (!/ON\s+CONFLICT/i.test(out)) out = `${out.trimEnd()} ON CONFLICT DO NOTHING`;
  }
  // "INSERT OR REPLACE" has no exact Postgres equivalent; refuse rather than
  // silently inserting a duplicate row.
  if (/^\s*INSERT\s+OR\s+REPLACE\s+INTO/i.test(out)) {
    throw new Error("INSERT OR REPLACE is not supported on PostgreSQL — rewrite the query as an upsert.");
  }
  return out;
}

/* ------------------------------------------------------------------ sqlite */
type SqliteStatement = {
  get(...a: unknown[]): unknown;
  all(...a: unknown[]): unknown[];
  run(...a: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
};
type SqliteDb = {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
  pragma(s: string): unknown;
  close(): void;
};

type PgResult = { rows: Record<string, unknown>[]; rowCount: number | null };
type PgPool = {
  query(text: string, values?: unknown[]): Promise<PgResult>;
  connect(): Promise<PgClient>;
  end(): Promise<void>;
};
type PgClient = {
  query(text: string, values?: unknown[]): Promise<PgResult>;
  release(): void;
};

const DB_PATH = process.env.DATABASE_PATH
  ? path.resolve(process.cwd(), process.env.DATABASE_PATH)
  : path.join(process.cwd(), "data", "rentlink.db");

/**
 * The DDL comes from a generated TypeScript module, NOT from disk.
 *
 * A serverless bundle only contains files Next traced through imports, so a
 * runtime `fs.readFileSync("src/lib/schema.sql")` throws ENOENT on Vercel. The
 * generated module is part of the build, which makes schema availability a
 * compile-time guarantee instead of a deployment-time gamble.
 */
function readSchema(b: Backend) {
  return b === "postgres" ? POSTGRES_SCHEMA : SQLITE_SCHEMA;
}

/**
 * Table → does it have an `id` column? Used to mirror better-sqlite3's
 * lastInsertRowid. Seeded from the schema file, then corrected at runtime for
 * tables the adapter has never seen (a RETURNING id on a table without an id
 * column is a SQL error, so this is learned once and cached, never guessed).
 */
function tablesWithIdColumn(schemaSql: string): Map<string, boolean> {
  const withId = new Map<string, boolean>();
  const re = /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+"?(\w+)"?\s*\(([\s\S]*?)\n\);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(schemaSql))) {
    const [, table, body] = m;
    withId.set(table.toLowerCase(), /^\s*"?id"?\s+/im.test(body));
  }
  return withId;
}

function insertTargetTable(sql: string): string | null {
  const m = /^\s*INSERT\s+(?:OR\s+\w+\s+)?INTO\s+"?(\w+)"?/i.exec(sql);
  return m ? m[1].toLowerCase() : null;
}

/* ------------------------------------------------------------------ state */
type CtxStore = { client: PgClient } | { sqliteTx: true };

type DbState = {
  pool?: PgPool;
  sqlite?: SqliteDb;
  tablesWithId: Map<string, boolean>;
  ctx: AsyncLocalStorage<CtxStore>;
  /** Serialises SQLite work: a transaction holds it for its whole duration. */
  lock: { promise: Promise<void> };
  ready: Promise<DbState>;
};

const globalForDb = globalThis as unknown as { __rentlinkDb?: DbState };

/** Minimal promise-chain mutex. */
function acquire(holder: { promise: Promise<void> }): Promise<() => void> {
  let release!: () => void;
  const next = new Promise<void>((r) => (release = r));
  const prior = holder.promise;
  holder.promise = prior.then(() => next);
  return prior.then(() => {
    let done = false;
    return () => {
      if (done) return;
      done = true;
      release();
    };
  });
}

async function init(): Promise<DbState> {
  // A concurrent caller must WAIT for the in-flight initialisation, not receive
  // the half-built state object. `ready` is the single shared promise.
  const existing = globalForDb.__rentlinkDb;
  if (existing) return existing.ready;

  const ctx = new AsyncLocalStorage<CtxStore>();
  const state = {
    ctx,
    lock: { promise: Promise.resolve() },
    tablesWithId: new Map<string, boolean>(),
  } as unknown as DbState;

  // Publish the state (and its `ready` promise) synchronously, before the first
  // await, so simultaneous cold-start requests share one pool / file handle.
  state.ready = (async () => {
    if (backend === "postgres") {
      const { default: pg } = await import("pg");
      // COUNT()/SUM() arrive as strings unless we say otherwise; the whole app
      // does arithmetic on them, so parse once, here.
      pg.types.setTypeParser(20, (v: string) => Number(v)); // int8
      pg.types.setTypeParser(1700, (v: string) => Number(v)); // numeric
      state.tablesWithId = tablesWithIdColumn(readSchema("postgres"));
      const sslMode = (process.env.PG_SSL_MODE || "verify-full").toLowerCase();
      const pool = new pg.Pool({
        connectionString: process.env.DATABASE_URL,
        // Serverless: every lambda is its own process, so a small pool is right.
        // A hosted pooler (Neon/Supavisor, Supabase pgBouncer) is the real fix
        // for connection exhaustion — see docs/DEPLOYMENT.md.
        max: Number(process.env.PGPOOL_MAX || 3),
        min: 0,
        idleTimeoutMillis: 10_000,
        connectionTimeoutMillis: 10_000,
        allowExitOnIdle: true,
        ssl:
          sslMode === "disable" || sslMode === "false"
            ? false
            : sslMode === "no-verify"
              ? { rejectUnauthorized: false }
              : sslMode === "require"
                ? { rejectUnauthorized: true, ca: undefined, servername: undefined }
                : { rejectUnauthorized: true },
      });
      state.pool = pool as unknown as PgPool;
      await ensureSchemaPostgres(state.pool);
    } else {
      /**
       * Defence in depth behind src/lib/boot.ts (which is what actually stops a
       * misconfigured process at boot). A production process must never OPEN the
       * local SQLite file: on a serverless platform it is read-only outside /tmp
       * and not shared between instances, so serving from it means silent write
       * failures and lost data. The only bypass is the explicit, loudly-reported
       * RENTLINK_ALLOW_INSECURE_PROD acknowledgement.
       */
      const allowInsecure = ["1", "true", "yes"].includes(
        String(process.env.RENTLINK_ALLOW_INSECURE_PROD ?? "").toLowerCase()
      );
      if (process.env.NODE_ENV === "production" && !allowInsecure) {
        throw new Error(
          "Refusing to open the local SQLite database in production: DATABASE_URL is not set. " +
            "Point DATABASE_URL at PostgreSQL (see docs/DEPLOYMENT.md)."
        );
      }
      const { default: Database } = await import("better-sqlite3");
      fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
      const schemaSql = readSchema("sqlite");
      state.tablesWithId = tablesWithIdColumn(schemaSql);
      const db = new Database(DB_PATH) as unknown as SqliteDb;
      db.pragma("journal_mode = WAL");
      db.pragma("foreign_keys = ON");
      db.exec(schemaSql);
      state.sqlite = db;
      migrateSqlite(db);
    }
    return state;
  })();

  globalForDb.__rentlinkDb = state;
  return state.ready;
}

/** Additive migrations for SQLite databases created by an older schema. */
function migrateSqlite(d: SqliteDb) {
  const cols = (table: string) =>
    (d.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
  const bookings = cols("bookings");
  if (!bookings.includes("price_snapshot")) d.exec(`ALTER TABLE bookings ADD COLUMN price_snapshot TEXT`);
  if (!bookings.includes("price_pinned_at")) d.exec(`ALTER TABLE bookings ADD COLUMN price_pinned_at TEXT`);
  const payments = cols("payments");
  if (!payments.includes("captured_at")) d.exec(`ALTER TABLE payments ADD COLUMN captured_at TEXT`);
}

/**
 * Postgres schema bootstrap.
 *
 * Safe on cold start (every statement is CREATE … IF NOT EXISTS) but it is NOT a
 * migration system: run `npm run db:pg:migrate` as a deploy step so schema
 * changes are versioned and applied once, and set PG_SKIP_SCHEMA=1 in production
 * so a cold start never tries to DDL a database it does not own.
 */
async function ensureSchemaPostgres(pool: PgPool) {
  if (process.env.PG_SKIP_SCHEMA === "1") return;
  const sql = readSchema("postgres");
  const client = await pool.connect();
  try {
    await client.query(sql);
  } finally {
    client.release();
  }
}

/* ------------------------------------------------------------------ query */
async function client(): Promise<DbState> {
  return init();
}

function pgExecutor(s: DbState): PgPool | PgClient {
  const store = s.ctx.getStore();
  if (store && "client" in store) return store.client;
  return s.pool!;
}

/** Runs a SQLite statement under the lock unless we are already inside a tx. */
async function withSqlite<T>(s: DbState, fn: (db: SqliteDb) => T): Promise<T> {
  if (s.ctx.getStore()) return fn(s.sqlite!); // inside the transaction: it owns the lock
  const release = await acquire(s.lock);
  try {
    return fn(s.sqlite!);
  } finally {
    release();
  }
}

export async function one<T = Row>(sql: string, ...params: Bind[]): Promise<T | undefined> {
  const s = await client();
  if (s.pool) {
    const res = await pgExecutor(s).query(toDialect(sql), params as unknown[]);
    return res.rows[0] as T | undefined;
  }
  return withSqlite(s, (db) => db.prepare(sql).get(...(params as unknown[])) as T | undefined);
}

export async function all<T = Row>(sql: string, ...params: Bind[]): Promise<T[]> {
  const s = await client();
  if (s.pool) {
    const res = await pgExecutor(s).query(toDialect(sql), params as unknown[]);
    return res.rows as T[];
  }
  return withSqlite(s, (db) => db.prepare(sql).all(...(params as unknown[])) as T[]);
}

export async function run(sql: string, ...params: Bind[]): Promise<RunResult> {
  const s = await client();
  if (s.pool) {
    const text = toDialect(sql);
    const table = insertTargetTable(sql);
    const alreadyReturning = /\breturning\b/i.test(text);
    let wantsId = table !== null && !alreadyReturning && s.tablesWithId.get(table) !== false;

    let res: PgResult;
    if (wantsId) {
      try {
        res = await pgExecutor(s).query(`${text.trimEnd()} RETURNING id`, params as unknown[]);
      } catch (e) {
        // 42703 = undefined_column: this table has no id. Remember it and retry.
        if ((e as { code?: string }).code !== "42703") throw e;
        s.tablesWithId.set(table!, false);
        wantsId = false;
        res = await pgExecutor(s).query(text, params as unknown[]);
      }
    } else {
      res = await pgExecutor(s).query(text, params as unknown[]);
    }

    const raw = wantsId ? (res.rows[0] as { id?: unknown } | undefined)?.id : undefined;
    const n = Number(raw);
    return { changes: res.rowCount ?? 0, lastInsertRowid: Number.isFinite(n) && wantsId ? n : 0 };
  }
  return withSqlite(s, (db) => {
    const r = db.prepare(sql).run(...(params as unknown[]));
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
  });
}

/**
 * Transaction wrapper. Every one/all/run issued from inside the callback joins
 * the same atomic unit.
 *
 * Postgres: a dedicated client is checked out of the pool and pinned to the
 * current async context, so concurrency is real and isolation is per-connection.
 * SQLite: one synchronous connection, so the transaction takes the global lock
 * for its whole duration and unrelated queries queue behind it instead of
 * silently joining (and being rolled back with) someone else's transaction.
 *
 * Nested transactions are rejected rather than emulated with savepoints: the
 * application never needs them today, and a silent promotion to a savepoint is
 * exactly the kind of behaviour that hides a bug.
 */
export async function tx<T>(fn: () => Promise<T>): Promise<T> {
  const s = await client();

  if (s.ctx.getStore()) {
    throw new Error(
      "Nested database transactions are not supported. Pass the transaction context down instead of opening a second tx()."
    );
  }

  if (s.pool) {
    const c = await s.pool.connect();
    try {
      await c.query("BEGIN");
      const out = await s.ctx.run({ client: c }, fn);
      await c.query("COMMIT");
      return out;
    } catch (e) {
      try {
        await c.query("ROLLBACK");
      } catch {
        /* connection already gone — the pool will discard it */
      }
      throw e;
    } finally {
      c.release();
    }
  }

  const release = await acquire(s.lock);
  try {
    s.sqlite!.exec("BEGIN IMMEDIATE");
    try {
      const out = await s.ctx.run({ sqliteTx: true }, fn);
      s.sqlite!.exec("COMMIT");
      return out;
    } catch (e) {
      try {
        s.sqlite!.exec("ROLLBACK");
      } catch {
        /* already rolled back */
      }
      throw e;
    }
  } finally {
    release();
  }
}

/** Pure parsing — deliberately synchronous so it can be used inside .map(). */
export function jsonParse<T>(v: unknown, fallback: T): T {
  if (typeof v !== "string" || !v) return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}

export const nowIso = () => new Date().toISOString();
export const today = () => new Date().toISOString().slice(0, 10);

/** Closes the pool / file handle. Used by scripts and tests. */
export async function closeDb() {
  const st = globalForDb.__rentlinkDb;
  if (!st) return;
  if (st.pool) await st.pool.end();
  if (st.sqlite) st.sqlite.close();
  globalForDb.__rentlinkDb = undefined;
}
