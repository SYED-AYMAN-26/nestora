import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";

/**
 * Database access layer — one async API, two backends.
 *
 *   DATABASE_URL set  → PostgreSQL (Vercel/Neon/Supabase/RDS). Required for
 *                       serverless: a local SQLite file is not writable or
 *                       shared across lambda instances.
 *   DATABASE_URL unset→ SQLite via better-sqlite3 (local dev and the existing
 *                       data/rentlink.db). Nothing about local behaviour changes.
 *
 * Everything here is AWAITED. A serverless function is a different process per
 * request, so every statement has to be independent of anything held in memory.
 *
 * Dialect: SQLite timestamps are TEXT (ISO / "YYYY-MM-DD HH:MM:SS") and the
 * Postgres schema deliberately keeps the same column types, so almost every
 * query works unchanged. The few genuine differences are translated per backend
 * in `toDialect()` — see the comments there.
 */

// Raw SQL rows are untyped by nature. Every query is narrowed at its call site
// through the generics on one<>/all<>; this is the single scoped use of `any` in
// the codebase and it is what lets 14k lines of existing query code stay intact.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;
export type Bind = string | number | bigint | boolean | null | Uint8Array | Date;
export type RunResult = { changes: number; lastInsertRowid: number };

export type Backend = "postgres" | "sqlite";

export const backend: Backend = process.env.DATABASE_URL ? "postgres" : "sqlite";
export const isPostgres = backend === "postgres";

/* ------------------------------------------------------------------ dialect */

/**
 * Rewrites the handful of SQLite-only constructs the application uses.
 * Anything more complex than this list is deliberately NOT supported — the
 * schema was written to be portable instead.
 */
export function toDialect(sql: string): string {
  if (backend !== "postgres") return sql;
  let out = sql;

  // positional params: ?  →  $1, $2, …
  let n = 0;
  out = out.replace(/\?/g, () => `$${++n}`);

  // SQLite date helpers → Postgres equivalents
  out = out.replace(/datetime\('now'\s*,\s*'([+-]?\d+)\s+(seconds?|minutes?|hours?|days?|months?|years?)'\)/gi,
    (_m, amt, unit) => `(now() + interval '${amt} ${unit}')`);
  out = out.replace(/datetime\('now'\)/gi, "now()");
  out = out.replace(/date\('now'\s*,\s*'([+-]?\d+)\s+(days?|months?)'\)/gi,
    (_m, amt, unit) => `((now() + interval '${amt} ${unit}')::date)`);
  out = out.replace(/date\('now'\)/gi, "CURRENT_DATE");

  // instr(haystack, needle) → position(needle in haystack)
  out = out.replace(/instr\(\s*([^,()]+?)\s*,\s*([^()]+?)\s*\)/gi, "position($2 in $1)");

  // SQLite "INSERT OR IGNORE INTO" → "INSERT INTO … ON CONFLICT DO NOTHING"
  if (/^\s*INSERT\s+OR\s+IGNORE\s+INTO/i.test(out)) {
    out = out.replace(/^\s*INSERT\s+OR\s+IGNORE\s+INTO/i, "INSERT INTO");
    if (!/ON\s+CONFLICT/i.test(out)) out = out.trimEnd() + " ON CONFLICT DO NOTHING";
  }

  // datetime('now') comparisons against TEXT columns still work as timestamps
  return out;
}

/* ------------------------------------------------------------------ sqlite */
type SqliteDb = {
  prepare(sql: string): { get(...a: unknown[]): unknown; all(...a: unknown[]): unknown[]; run(...a: unknown[]): { changes: number; lastInsertRowid: number | bigint } };
  exec(sql: string): void;
  pragma(s: string): unknown;
  close(): void;
};

type PgPool = {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
  connect(): Promise<PgClient>;
  end(): Promise<void>;
};
type PgClient = {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
  release(): void;
};

const DB_PATH = process.env.DATABASE_PATH
  ? path.resolve(process.cwd(), process.env.DATABASE_PATH)
  : path.join(process.cwd(), "data", "rentlink.db");

function schemaFor(b: Backend) {
  const file = b === "postgres" ? "src/lib/schema.pg.sql" : "src/lib/schema.sql";
  const abs = path.join(process.cwd(), file);
  if (!fs.existsSync(abs)) {
    throw new Error(
      `Database schema file missing: ${file}. For Postgres run "npm run db:pg:schema" to generate it.`
    );
  }
  return fs.readFileSync(abs, "utf8");
}

/* ------------------------------------------------------------------ state */
type DbState = {
  pool?: PgPool;
  sqlite?: SqliteDb;
  /** Transaction client / connection pinned to the current async context. */
  ctx: AsyncLocalStorage<unknown>;
  sqliteTxQueue: Promise<unknown>;
};

const globalForDb = globalThis as unknown as { __rentlinkDb?: DbState };

async function init(): Promise<DbState> {
  if (globalForDb.__rentlinkDb) return globalForDb.__rentlinkDb;

  const ctx = new AsyncLocalStorage<unknown>();
  const state: DbState = { ctx, sqliteTxQueue: Promise.resolve() };

  if (backend === "postgres") {
    const { default: pg } = await import("pg");
    // COUNT()/SUM() come back as strings unless we tell pg otherwise. The rest of
    // the app does arithmetic on them, so parse once here.
    pg.types.setTypeParser(20, (v: string) => Number(v));   // int8
    pg.types.setTypeParser(1700, (v: string) => Number(v)); // numeric
    const pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.PGPOOL_MAX || 5),
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
      ssl: process.env.PGSSL === "disable" ? false : { rejectUnauthorized: false },
    });
    state.pool = pool as unknown as PgPool;
    await ensureSchemaPostgres(state.pool!);
  } else {
    const { default: Database } = await import("better-sqlite3");
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    const db = new Database(DB_PATH) as unknown as SqliteDb;
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec(schemaFor("sqlite"));
    state.sqlite = db;
    migrateSqlite(db);
    // Keep the id-returning convention working after the async switch.
    globalForDb.__rentlinkDb = state;
    return state;
  }

  globalForDb.__rentlinkDb = state;
  return state;
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
 * Postgres schema bootstrap. Idempotent (CREATE TABLE IF NOT EXISTS), so it is
 * safe on every cold start; on Vercel prefer running `npm run db:pg:migrate`
 * once during deployment instead of relying on this.
 */
async function ensureSchemaPostgres(pool: PgPool) {
  if (process.env.PG_SKIP_SCHEMA === "1") return;
  const sql = schemaFor("postgres");
  const client = await pool.connect();
  try {
    await client.query(sql);
  } finally {
    client.release();
  }
}

/* ------------------------------------------------------------------ query */
async function client() {
  const s = await init();
  return s;
}

export async function one<T = Row>(sql: string, ...params: Bind[]): Promise<T | undefined> {
  const s = await client();
  const text = toDialect(sql);
  if (s.pool) {
    const pinned = s.ctx.getStore() as PgClient | undefined;
    const q = pinned ?? s.pool;
    const res = await q.query(text, params as unknown[]);
    return res.rows[0] as T | undefined;
  }
  const stmt = s.sqlite!.prepare(sql);
  return stmt.get(...(params as unknown[])) as T | undefined;
}

export async function all<T = Row>(sql: string, ...params: Bind[]): Promise<T[]> {
  const s = await client();
  const text = toDialect(sql);
  if (s.pool) {
    const pinned = s.ctx.getStore() as PgClient | undefined;
    const q = pinned ?? s.pool;
    const res = await q.query(text, params as unknown[]);
    return res.rows as T[];
  }
  return s.sqlite!.prepare(sql).all(...(params as unknown[])) as T[];
}

export async function run(sql: string, ...params: Bind[]): Promise<RunResult> {
  const s = await client();
  const text = toDialect(sql);
  if (s.pool) {
    const pinned = s.ctx.getStore() as PgClient | undefined;
    const q = pinned ?? s.pool;
    let finalText = text;
    // Mirror better-sqlite3's lastInsertRowid so calling code stays unchanged.
    const needsId = /^\s*insert\s+into/i.test(sql) && !/\breturning\b/i.test(sql);
    if (needsId) finalText = `${text.trimEnd()} RETURNING id`;
    const res = await q.query(finalText, params as unknown[]);
    const lastInsertRowid = needsId ? Number((res.rows[0] as { id?: number } | undefined)?.id ?? 0) : 0;
    return { changes: res.rowCount ?? 0, lastInsertRowid };
  }
  const r = s.sqlite!.prepare(sql).run(...(params as unknown[]));
  return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
}

/**
 * Transaction wrapper. Everything inside the callback runs on a single pinned
 * connection, so `one`/`all`/`run` calls made from anywhere inside it are part
 * of the same atomic unit.
 *
 * Postgres: dedicated client checked out of the pool (safe with concurrency).
 * SQLite: the one synchronous connection, serialised through a queue so two
 * concurrent transactions can never interleave BEGIN/COMMIT.
 */
export async function tx<T>(fn: () => Promise<T>): Promise<T> {
  const s = await client();

  if (s.pool) {
    const c = await s.pool.connect();
    try {
      await c.query("BEGIN");
      const out = await s.ctx.run(c, fn);
      await c.query("COMMIT");
      return out;
    } catch (e) {
      try { await c.query("ROLLBACK"); } catch { /* connection already gone */ }
      throw e;
    } finally {
      c.release();
    }
  }

  // SQLite: serialise transactions.
  const previous = s.sqliteTxQueue;
  let release!: () => void;
  s.sqliteTxQueue = new Promise<void>((r) => (release = r));
  await previous.catch(() => undefined);
  try {
    s.sqlite!.exec("BEGIN IMMEDIATE");
    try {
      const out = await fn();
      s.sqlite!.exec("COMMIT");
      return out;
    } catch (e) {
      try { s.sqlite!.exec("ROLLBACK"); } catch { /* already rolled back */ }
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
  const s = globalForDb.__rentlinkDb;
  if (!s) return;
  if (s.pool) await s.pool.end();
  if (s.sqlite) s.sqlite.close();
  globalForDb.__rentlinkDb = undefined;
}
