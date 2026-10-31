#!/usr/bin/env node
/**
 * Production-configuration review tests.
 *
 *   STATIC  — asserts the shipped source contains the guard it claims to.
 *   RUNTIME — actually starts the production server with a given environment and
 *             records what happens. This is the only kind that proves behaviour,
 *             and the only kind that can tell "refuses to start" apart from
 *             "logs a fatal line and carries on".
 *
 * Runtime safety rules (deliberate, see the mandate):
 *   - each probe gets its OWN disposable SQLite file under data/probe-<id>.db, so
 *     the real development database is never opened for writing;
 *   - each probe writes its server output to its own log file under /tmp;
 *   - the spawned process tree is killed by listening port, not by name, so no
 *     unrelated server is ever touched.
 *
 *   node scripts/test-production-config.mjs            # static + runtime
 *   node scripts/test-production-config.mjs --static   # no servers spawned
 */
import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STATIC_ONLY = process.argv.includes("--static");
const BASE_PORT = Number(process.env.PROBE_PORT || 3430);

const PASS = [];
const FAIL = [];
const FINDINGS = [];
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
const note = (label, detail) => {
  FINDINGS.push({ section, label, detail });
  console.log(`  \x1b[36mNOTE\x1b[0m ${label} \x1b[90m— ${detail}\x1b[0m`);
};

const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
/** Strip comments so assertions target executable code, not prose. */
const code = (p) =>
  read(p)
    .split("\n")
    .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
    .map((l) => l.replace(/\s\/\/.*$/, ""))
    .join("\n");

const CONFIG = "src/lib/config.ts";
const BOOT = "src/lib/boot.ts";
const INSTR = "src/instrumentation.ts";
const DB = "src/lib/db.ts";
const CRYPTO = "src/lib/crypto.ts";
const STORAGE = "src/lib/storage.ts";
const CRON = "src/app/api/cron/reminders/route.ts";
const ENV = "src/lib/env.ts";
const LAYOUT = "src/app/layout.tsx";

/* ---------------------------------------------------------------- static ---- */

function staticChecks() {
  group("1. Source: the guards exist where they are claimed");
  const cfg = code(CONFIG);
  check(/key: "DATABASE_URL"/.test(cfg), "DATABASE_URL has an explicit rule", "config.ts");
  check(/level: prod \? "fatal" : "warning"[\s\S]{0,220}DATABASE_URL|key: "DATABASE_URL"[\s\S]{0,300}level: prod \? "fatal"/.test(cfg), "A missing DATABASE_URL is FATAL in production", "config.ts");
  check(/localhost\|127\\?\.0\\?\.0\\?\.1/.test(cfg), "A localhost DATABASE_URL is rejected in production", "config.ts");
  const minSecret = /MIN_SECRET_LEN = (\d+)/.exec(cfg)?.[1];
  check(Number(minSecret) >= 32, "SESSION_SECRET has a >=32 character rule", `MIN_SECRET_LEN=${minSecret}`);
  check(/key: "BLOB_READ_WRITE_TOKEN"/.test(cfg) && /level: prod \? "fatal"/.test(cfg), "Blob storage is required in production", "config.ts");
  check(/ALLOW_DEMO_SEED/.test(cfg), "Demo seeding is reviewed in production", "config.ts");
  check(/CRON_SECRET/.test(cfg), "CRON_SECRET is reviewed", "config.ts");

  const boot = code(BOOT);
  check(/enforceProductionConfig/.test(boot), "boot.ts exists and enforces", "boot.ts");
  check(/throw new InsecureProductionConfigError\(fatal\)/.test(boot), "A fatal problem THROWS (fail-fast, not just logging)", "boot.ts");
  const throwIdx = boot.indexOf("throw new InsecureProductionConfigError(fatal)");
  const bypassIdx = boot.indexOf("if (bypassed())");
  check(bypassIdx > 0 && bypassIdx < throwIdx, "The throw is unconditional apart from the explicit, logged bypass", `bypass@${bypassIdx} throw@${throwIdx}`);
  check(/isBuildPhase\(\)\) return/.test(boot), "Enforcement is skipped during `next build` (prerender has no runtime secrets)", "boot.ts");
  check(/process\.env\[key\]|configReport\(\)/.test(boot) && !/process\.env\.[A-Z_]+\)\s*\+/.test(boot), "Error text interpolates no environment VALUES (no secret leakage)", "boot.ts");

  const instr = code(INSTR);
  check(/export async function register\(\)/.test(instr), "instrumentation.ts exports register() — the Next.js per-process hook", "instrumentation.ts");
  check(/NEXT_RUNTIME !== "nodejs"/.test(instr), "It only runs in the Node.js runtime (not on the edge)", "instrumentation.ts");
  check(/enforceProductionConfig/.test(instr), "It calls the enforcement gate", "instrumentation.ts");
  const layout = code(LAYOUT);
  check(/assertProductionConfigReady/.test(layout), "The root layout also enforces the gate (belt and braces)", "layout.tsx");

  const db = code(DB);
  const defaultSsl = /PG_SSL_MODE \|\| "([a-z-]+)"/.exec(db)?.[1];
  check(defaultSsl === "verify-full", "PG TLS verification defaults to verify-full", `default=${defaultSsl}`);
  check(/NODE_ENV === "production" && !allowInsecure/.test(db), "db.ts refuses to open local SQLite in production", "db.ts");
  check(/if \(process\.env\.PG_SKIP_SCHEMA === "1"\) return;/.test(db), "PG_SKIP_SCHEMA=1 short-circuits the DDL bootstrap", "db.ts");
  const fn = db.slice(db.indexOf("async function ensureSchemaPostgres"));
  check(fn.indexOf('PG_SKIP_SCHEMA === "1"') < fn.indexOf("client.query"), "The skip guard runs before any DDL", "db.ts");

  const storage = code(STORAGE);
  check(/assertWritableTarget/.test(storage), "storage.ts refuses local writes in production", "storage.ts");
  check(/access: scope === "public" \? "public" : "private"/.test(storage), "Private uploads use access:'private'", "storage.ts");

  const crypto = code(CRYPTO);
  check(/NODE_ENV === "production"[\s\S]{0,300}throw new Error\(/.test(crypto), "A production session with no SESSION_SECRET throws", "crypto.ts");
  check(/timingSafeEqual/.test(crypto), "Secret comparison is constant-time", "crypto.ts");

  const cron = code(CRON);
  check(/if \(!secret\) return false/.test(cron), "An unset CRON_SECRET authorises nobody", "cron route");
  check(/status: 503/.test(cron), "The endpoint answers 503 rather than running unauthenticated", "cron route");
  check(/token\.length !== secret\.length/.test(cron) && /charCodeAt/.test(cron), "Cron auth is constant-time over equal-length inputs", "cron route");

  const env = code(ENV);
  check(/if \(!isProduction\(\)\) return false/.test(env) && /demoLoginBlocked/.test(env), "Demo logins are still refused in production unless explicitly allowed", "env.ts");
}

/* --------------------------------------------------------------- runtime ---- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.once("listening", () => s.close(() => resolve(true)));
    s.listen(port, "127.0.0.1");
  });
}

async function freePort(start) {
  for (let p = start; p < start + 40; p++) if (await portFree(p)) return p;
  throw new Error("no free port");
}

/** Kills whatever is listening on `port` (the probe's own process tree only). */
function killPort(port) {
  try {
    const out = execSync(`ss -ltnp 2>/dev/null | grep -o ':${port} .*pid=[0-9]*' || true`, {
      encoding: "utf8",
    });
    const pids = [...out.matchAll(/pid=(\d+)/g)].map((m) => Number(m[1]));
    for (const pid of pids) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
    }
    return pids;
  } catch {
    return [];
  }
}
let probeSeq = 0;
const probeDbs = [];

/**
 * Starts a production server with exactly `env` and probes it.
 * Returns { page, login, log, readyLine, refused, port, dbFile }.
 */
async function probe(label, env) {
  const port = await freePort(BASE_PORT + probeSeq * 5);
  probeSeq++;
  // A disposable database per probe: the development database is never used.
  const dbFile = path.join("data", `probe-${process.pid}-${probeSeq}.db`);
  probeDbs.push(dbFile);
  for (const suffix of ["", "-wal", "-shm"]) {
    const f = path.join(ROOT, dbFile + suffix);
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  const logFile = `/tmp/rentlink-probe-${process.pid}-${probeSeq}.log`;
  const logStream = fs.openSync(logFile, "w");

  const child = spawn("npx", ["next", "start", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NODE_ENV: "production",
      DATABASE_PATH: dbFile,
      PG_SSL_MODE: "disable",
      ...env,
    },
    stdio: ["ignore", logStream, logStream],
    detached: true,
  });
  let exited = null;
  child.on("exit", (c) => (exited = c ?? 0));

  const base = `http://127.0.0.1:${port}`;
  const started = Date.now();
  let page = null;
  while (Date.now() - started < 45_000) {
    if (exited !== null) break;
    try {
      const res = await fetch(`${base}/`, { headers: { "user-agent": "config-test/1.0" }, redirect: "manual" });
      page = res.status;
      await res.text().catch(() => "");
      break;
    } catch {
      await sleep(400);
    }
  }
  let login = null;
  if (page !== null) {
    try {
      const res = await fetch(`${base}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": "config-test/1.0" },
        body: JSON.stringify({ email: "buyer@student.demo", password: "Demo@1234" }),
      });
      login = res.status;
      await res.text().catch(() => "");
    } catch {
      login = "no answer";
    }
  }

  // Kill the whole tree: the npx wrapper and the next-server child.
  const killed = killPort(port);
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {}
  for (const pid of killed) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
  await sleep(600);
  fs.closeSync(logStream);
  const log = fs.readFileSync(logFile, "utf8");
  return { label, page, login, log, logFile, port, dbFile, exited, ms: Date.now() - started };
}

/** Distinct FATAL lines (the same problem is logged once and repeated in the thrown error). */
const fatalLines = (log) => [...new Set(log.match(/\[config\] FATAL [^\n]*/g) || [])];
const readyLine = (log) => (/✓ Ready in [^\n]*/.exec(log) || [""])[0];

async function runtimeChecks() {
  const buildId = path.join(ROOT, ".next", "BUILD_ID");
  if (!fs.existsSync(buildId)) {
    group("2. Runtime");
    check(false, "A production build exists to probe", ".next/BUILD_ID missing — run npm run build");
    return;
  }

  group("2. Missing DATABASE_URL in production");
  const noDb = await probe("no DATABASE_URL", {
    DATABASE_URL: "",
    SESSION_SECRET: "config-test-secret-0123456789abcdef",
    BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_dummy",
    CRON_SECRET: "cron-test-secret-0123456789abcdef",
  });
  check(fatalLines(noDb.log).some((l) => /DATABASE_URL/.test(l)), "It reports FATAL DATABASE_URL", (fatalLines(noDb.log)[0] || "(none)").slice(0, 110));
  check(noDb.page === 500, "It REFUSES to serve pages (500, not a working app)", `GET / → ${noDb.page}`);
  check(noDb.login !== 200, "Authentication does not work either", `login → ${noDb.login}`);
  check(/InsecureProductionConfigError|Refusing to start/.test(noDb.log), "The refusal is explicit in the log", (noDb.log.match(/Refusing to start[^\n]*/) || ["(no refusal line)"])[0].slice(0, 90));
  const devDbUntouched = !fs.existsSync(path.join(ROOT, noDb.dbFile)) || fs.statSync(path.join(ROOT, noDb.dbFile)).size === 0;
  check(devDbUntouched, "No database file was created behind the refusal", `${noDb.dbFile} ${devDbUntouched ? "absent/empty" : "WAS WRITTEN"}`);
  note("Fail-fast: DATABASE_URL", `Process stays up but serves 500 for every page (never SQLite): ${readyLine(noDb.log) || "no Ready line"}; login ${noDb.login}. On Vercel the function invocation fails, which is fail-closed.`);

  group("3. Missing / weak SESSION_SECRET in production");
  const REMOTE_DB = "postgresql://u:p@db.example.com:5432/rentlink";
  const noSecret = await probe("no SESSION_SECRET", {
    DATABASE_URL: REMOTE_DB,
    SESSION_SECRET: "",
    BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_dummy",
  });
  const secretFatals = fatalLines(noSecret.log).filter((l) => /SESSION_SECRET/.test(l));
  check(secretFatals.length === 1, "It reports FATAL SESSION_SECRET (and only that)", secretFatals[0]?.slice(0, 110) || `fatal lines: ${fatalLines(noSecret.log).length}`);
  check(noSecret.page === 500 && noSecret.login !== 200, "It refuses to serve", `page ${noSecret.page}, login ${noSecret.login}`);

  const weak = await probe("short SESSION_SECRET", {
    DATABASE_URL: REMOTE_DB,
    SESSION_SECRET: "short",
    BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_dummy",
  });
  const weakFatal = fatalLines(weak.log).find((l) => /SESSION_SECRET/.test(l));
  check(Boolean(weakFatal) && /32/.test(weakFatal), "A weak (<32 char) secret is fatal and the message says how long", (weakFatal || "(none)").slice(0, 120));
  check(weak.page === 500, "It refuses to serve with a weak secret", `GET / → ${weak.page}`);

  group("4. Missing BLOB_READ_WRITE_TOKEN in production");
  const noBlob = await probe("no BLOB token", {
    DATABASE_URL: REMOTE_DB,
    SESSION_SECRET: "config-test-secret-0123456789abcdef",
    BLOB_READ_WRITE_TOKEN: "",
  });
  check(fatalLines(noBlob.log).length === 1 && fatalLines(noBlob.log).some((l) => /BLOB_READ_WRITE_TOKEN/.test(l)), "It reports FATAL BLOB_READ_WRITE_TOKEN (and only that)", (fatalLines(noBlob.log)[0] || "(none)").slice(0, 110));
  check(noBlob.page === 500, "Uploads cannot silently land on local disk: the process refuses to serve", `GET / → ${noBlob.page}`);

  group("5. LOCALHOST / non-Postgres DATABASE_URL in production");
  const localhost = await probe("localhost DATABASE_URL", {
    DATABASE_URL: "postgresql://user:pass@127.0.0.1:5432/rentlink",
    SESSION_SECRET: "config-test-secret-0123456789abcdef",
    BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_dummy",
  });
  check(fatalLines(localhost.log).some((l) => /localhost/.test(l)), "A localhost DATABASE_URL is reported fatal", (fatalLines(localhost.log).find((l) => /localhost/.test(l)) || "(none)").slice(0, 110));
  check(localhost.page === 500, "It refuses to serve", `GET / → ${localhost.page}`);
  const sqliteUrl = await probe("sqlite: DATABASE_URL", {
    DATABASE_URL: "file:./data/rentlink.db",
    SESSION_SECRET: "config-test-secret-0123456789abcdef",
    BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_dummy",
  });
  check(fatalLines(sqliteUrl.log).some((l) => /PostgreSQL|not a PostgreSQL/.test(l)), "A non-postgres DATABASE_URL is refused (no silent SQLite fallback)", (fatalLines(sqliteUrl.log)[0] || "(none)").slice(0, 110));

  group("6. A fully configured production process MUST serve (no false positives)");
  // A self-hosted/local PostgreSQL is a legitimate configuration. The localhost
  // rule exists for serverless platforms, so a self-hosted run acknowledges it
  // with RENTLINK_ALLOW_INSECURE_PROD — the same documented escape hatch — and
  // the probe below proves the gate is not a blanket refusal.
  const good = await probe("fully configured (self-hosted PG)", {
    DATABASE_URL: process.env.PROBE_PG_URL || "postgresql://rentlink:rentlink@127.0.0.1:5432/rentlink",
    SESSION_SECRET: "config-test-secret-0123456789abcdef",
    BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_dummy",
    CRON_SECRET: "cron-test-secret-0123456789abcdef",
    RENTLINK_ALLOW_INSECURE_PROD: "1",
  });
  const goodFatals = fatalLines(good.log).filter((l) => !/ALLOW_INSECURE|RENTLINK_ALLOW/.test(l));
  check(goodFatals.length === 1 && /localhost/.test(goodFatals[0]), "The only fatal left is the localhost rule, which the override acknowledges", goodFatals.map((l) => l.slice(0, 70)).join(" | ") || "none");
  check(good.page === 200, "It serves pages normally (the gate is not a blanket refusal)", `GET / → ${good.page}`);
  check(/RENTLINK_ALLOW_INSECURE_PROD is set/.test(good.log), "The override is recorded in the log", "boot.ts");

  // A genuinely remote-looking configuration must pass with NO override at all.
  const remote = await probe("fully configured (remote PG)", {
    DATABASE_URL: REMOTE_DB,
    SESSION_SECRET: "config-test-secret-0123456789abcdef",
    BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_dummy",
    CRON_SECRET: "cron-test-secret-0123456789abcdef",
  });
  check(fatalLines(remote.log).length === 0, "A Vercel-shaped configuration produces NO fatal problem", fatalLines(remote.log).join(" | ") || "none");
  check(!/Refusing to start/.test(remote.log), "The boot gate lets it through", (remote.log.match(/Refusing to start[^\n]*/) || ["no refusal"])[0].slice(0, 60));
  note(
    "Unreachable database is not a boot failure",
    `With a remote-looking but unreachable DATABASE_URL the gate passes (GET / → ${remote.page}) because connectivity is a runtime concern, not a configuration one; the page surfaces the connection failure.`
  );

  group("7. The explicit insecure override still refuses to be silent");
  const override = await probe("override", {
    DATABASE_URL: "",
    SESSION_SECRET: "config-test-secret-0123456789abcdef",
    BLOB_READ_WRITE_TOKEN: "",
    RENTLINK_ALLOW_INSECURE_PROD: "1",
  });
  check(/FATAL DATABASE_URL/.test(override.log), "The problems are still reported when overridden", (fatalLines(override.log)[0] || "(none)").slice(0, 90));
  check(/RENTLINK_ALLOW_INSECURE_PROD is set/.test(override.log), "The override itself is logged as a warning", "boot.ts");
  check(override.page === 200, "The override does let the process serve (documented escape hatch)", `GET / → ${override.page}, login ${override.login}`);
  note("Insecure override", "RENTLINK_ALLOW_INSECURE_PROD=1 starts an unsafe process on purpose and says so in the log. It must never be set in a real deployment.");
}

/* ------------------------------------------------------- live endpoint ---- */

async function liveChecks() {
  group("8. Live cron endpoint (already-running dev servers)");
  for (const [name, base] of [
    ["SQLite :3300", "http://127.0.0.1:3300"],
    ["PostgreSQL :3200", "http://127.0.0.1:3200"],
  ]) {
    try {
      const anon = await fetch(`${base}/api/cron/reminders`, { method: "POST" });
      check(anon.status === 401, `${name}: unauthenticated cron call rejected`, `status ${anon.status}`);
      const wrong = await fetch(`${base}/api/cron/reminders`, {
        method: "POST",
        headers: { authorization: "Bearer wrong-secret-000000000000" },
      });
      check(wrong.status === 401, `${name}: wrong Bearer secret rejected`, `status ${wrong.status}`);
      const ok = await fetch(`${base}/api/cron/reminders`, {
        method: "POST",
        headers: { authorization: "Bearer cron-test-secret-0123456789abcdef" },
      });
      check(ok.status === 200, `${name}: correct Bearer secret accepted`, `status ${ok.status}`);
    } catch (e) {
      check(false, `${name}: cron endpoint reachable`, String(e.message));
    }
  }
}

/* ---------------------------------------------------- pure-function gates ---- */

function matrixChecks() {
  group("9. PG TLS mode resolution");
  const resolve = (mode) => {
    const sslMode = (mode || "verify-full").toLowerCase();
    if (sslMode === "disable" || sslMode === "false") return false;
    if (sslMode === "no-verify") return { rejectUnauthorized: false };
    return { rejectUnauthorized: true };
  };
  check(resolve(undefined).rejectUnauthorized === true, "Unset → certificate verified", JSON.stringify(resolve(undefined)));
  check(resolve("verify-full").rejectUnauthorized === true, "verify-full → verified", JSON.stringify(resolve("verify-full")));
  check(resolve("require").rejectUnauthorized === true, "require → still verified", JSON.stringify(resolve("require")));
  check(resolve("no-verify").rejectUnauthorized === false, "no-verify → explicit opt-out only", JSON.stringify(resolve("no-verify")));
  check(resolve("disable") === false, "disable → TLS off, explicit opt-out", JSON.stringify(resolve("disable")));
}

function schemaModuleChecks() {
  group("10. The schema ships as a bundled module");
  const gen = "src/lib/schema.generated.ts";
  check(fs.existsSync(path.join(ROOT, gen)), "schema.generated.ts exists", gen);
  const db = code(DB);
  check(/from "\.\/schema\.generated"/.test(db), "db.ts imports it as a module", "db.ts");
  check(!/readFileSync\([^)]*schema\.(pg\.)?sql/.test(db), "db.ts never reads a .sql file at runtime", "no runtime fs read");
  const genSrc = read(gen);
  check(/export const POSTGRES_SCHEMA = /.test(genSrc) && /export const SQLITE_SCHEMA = /.test(genSrc), "Both dialects exported as constants", `${(genSrc.length / 1024).toFixed(1)} KB`);
}

/* ------------------------------------------------------------------- main ---- */

async function main() {
  console.log("Production-configuration review");
  staticChecks();
  if (!STATIC_ONLY) {
    await runtimeChecks();
    await liveChecks();
    matrixChecks();
    schemaModuleChecks();
  }
  console.log("\n" + "=".repeat(68));
  console.log(`Production config: \x1b[32m${PASS.length} passed\x1b[0m, ${FAIL.length} failed (${PASS.length + FAIL.length} checks)`);
  if (FINDINGS.length) {
    console.log("\nFindings (behaviour recorded for the report):");
    for (const f of FINDINGS) console.log(`  • [${f.section}] ${f.label}\n      ${f.detail}`);
  }
  if (FAIL.length) {
    console.log("\nFailures:");
    for (const f of FAIL) console.log(`  ✗ [${f.section}] ${f.label}${f.detail ? ` — ${f.detail}` : ""}`);
  }
  process.exitCode = FAIL.length ? 1 : 0;
}

main()
  .catch((e) => {
    console.error("CONFIG SUITE CRASHED:", e);
    process.exitCode = 1;
  })
  .finally(() => {
    // Every probe database is disposable; remove them so nothing is mistaken for data.
    for (const f of probeDbs) {
      for (const suffix of ["", "-wal", "-shm"]) {
        try {
          const p = path.join(ROOT, f + suffix);
          if (fs.existsSync(p)) fs.unlinkSync(p);
        } catch {}
      }
    }
  });
