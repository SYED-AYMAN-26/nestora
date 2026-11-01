#!/usr/bin/env node
/**
 * Nestora — the ONE command that verifies everything.
 *
 *   npm run verify:full            # full run (starts/stops its own servers)
 *   npm run verify:full -- --fast  # skip the browser suites
 *
 * Gates, in order, each of which must pass:
 *   1. TypeScript            tsc --noEmit
 *   2. ESLint                eslint .            (errors fail; not skipped by the build)
 *   3. Production build      next build
 *   4. Payment unit tests    scripts/test-payments.mjs            (isolated DB)
 *   5. Payment integration   scripts/test-payments-integration.mjs (own server :3100)
 *   6. End-to-end tests      scripts/test-e2e.mjs                (server :3000)
 *   7. 2D browser tests      scripts/check-2d.mjs                (puppeteer + DOM)
 *
 *   BASE=http://127.0.0.1:3300 npm run verify:full   # target an app you started
 *   8. Link / button checks  scripts/check-links.mjs
 *
 * Nothing here is mocked away and no assertion is relaxed to make a gate pass.
 * The two suites that need a running app start their own servers against
 * disposable databases; your dev data is never deleted.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";

const FAST = process.argv.includes("--fast");
const CHROME_LIBS = "/home/user/.local/chromedeps/usr/lib/x86_64-linux-gnu";
// Where the browser suites and the "already running server" probes point.
// Set BASE to target a server you started yourself (e.g. BASE=http://127.0.0.1:3300).
const BASE = process.env.BASE || "http://127.0.0.1:3000";
const BASE_PORT = new URL(BASE).port || "80";

/**
 * Environment for a `next start` this harness boots itself.
 *
 * A production build now refuses to start without a session secret, and refuses
 * the documented demo password when demo seeding is on (both are deliberate
 * safety rules). The harness is a local, disposable, obviously-insecure run, so
 * it supplies a throwaway secret, its own demo password and explicitly
 * acknowledges the insecure configuration.
 */
const LOCAL_SERVER_ENV = {
  NODE_ENV: "production",
  RENTLINK_ALLOW_INSECURE_PROD: "1",
  ALLOW_TEST_FIXTURES: "1",
  ALLOW_DEMO_SEED: "1",
  DEMO_PASSWORD: "Verifier@1234",
  SESSION_SECRET: "verify-all-harness-session-secret-0123456789",
  CRON_SECRET: "cron-test-secret-0123456789abcdef",
};
const results = [];

function banner(n, total, name) {
  console.log(`\n\x1b[1m\x1b[36m[${n}/${total}] ${name}\x1b[0m`);
  console.log("─".repeat(70));
}

function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  const tag = ok ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";
  console.log(`${tag} ${name}${detail ? ` \x1b[90m— ${detail}\x1b[0m` : ""}`);
}

function run(cmd, args, { env = {}, capture = true } = {}) {
  const r = spawnSync(cmd, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    shell: false,
  });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  if (!capture) process.stdout.write(out);
  return { code: r.status ?? 1, out };
}

/**
 * Extracts the LAST "N/M passed" summary line from a suite's output.
 * Anchored + global so a stray matching phrase inside an explanation can't be
 * mistaken for the summary (that produced garbled details in an earlier run).
 */
function summarise(out, pattern) {
  const clean = out.replace(/\x1b\[[0-9;]*m/g, "");
  const flags = pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g";
  const re = new RegExp(pattern.source, flags);
  const all = [...clean.matchAll(re)];
  return all.length ? all[all.length - 1][0].trim() : "";
}

async function waitForPort(url, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return true;
    } catch { /* not up */ }
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 400));
  }
}

async function withServer(name, port, env, fn) {
  console.log(`\x1b[90m(starting ${name} on :${port})\x1b[0m`);
  const child = spawn("node_modules/.bin/next", ["start", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const log = [];
  child.stdout.on("data", (d) => log.push(String(d)));
  child.stderr.on("data", (d) => log.push(String(d)));
  const kill = () => { try { child.kill("SIGTERM"); } catch { /* gone */ } };
  process.on("exit", kill);
  try {
    const up = await waitForPort(`http://127.0.0.1:${port}/api/payments`);
    if (!up) throw new Error(`${name} did not start:\n${log.join("").slice(-2000)}`);
    return await fn();
  } finally {
    kill();
    // also reap anything still holding the port
    spawnSync("bash", ["-c", `fuser -k ${port}/tcp 2>/dev/null || true`]);
    await new Promise((r) => setTimeout(r, 600));
  }
}

const TOTAL = FAST ? 5 : 8;
let n = 0;

/* ------------------------------------------------------------ 1. TypeScript */
banner(++n, TOTAL, "TypeScript");
{
  const r = run("node_modules/.bin/tsc", ["--noEmit"]);
  record("TypeScript typecheck", r.code === 0, r.code === 0 ? "0 errors" : r.out.slice(0, 800));
}

/* ------------------------------------------------------------------ 2. Lint */
banner(++n, TOTAL, "ESLint");
{
  const r = run("node_modules/.bin/eslint", ["."]);
  const warn = /(\d+) warnings?/.exec(r.out);
  record("ESLint", r.code === 0, r.code === 0 ? `clean${warn ? ` (${warn[1]} warnings)` : ""}` : r.out.slice(0, 800));
}

/* ----------------------------------------------------------------- 3. Build */
banner(++n, TOTAL, "Production build");
{
  const r = run("npm", ["run", "build"]);
  const ok = r.code === 0 && /Compiled successfully/.test(r.out);
  const pages = /Generating static pages \((\d+)\/(\d+)\)/.exec(r.out);
  record("next build", ok, ok ? `compiled${pages ? `, ${pages[2]} static pages` : ""}` : r.out.slice(-1500));
  if (!ok) {
    console.error("\x1b[31mBuild failed — remaining gates need a working build, stopping.\x1b[0m");
    finish();
  }
}

/* ------------------------------------------------------ 4. Payment unit tests */
banner(++n, TOTAL, "Payment unit tests (isolated database)");
{
  const r = run("node", ["scripts/test-payments.mjs"]);
  const summary = summarise(r.out, /(?:Payment tests|Payment integration): \d+ passed, \d+ failed \(\d+ checks\)/);
  record("Payment unit tests", r.code === 0, summary || r.out.slice(-800));
  if (r.code !== 0) console.log(r.out.split("\n").filter((l) => /FAIL|✗/.test(l)).join("\n"));
}

/* ----------------------------------------------- 5. Payment integration tests */
banner(++n, TOTAL, "Payment integration tests (own server on :3100)");
{
  // Needs the demo server on :3000 for the "no gateway configured" checks.
  const demoUp = await (async () => {
    try {
      const r = await fetch(`${BASE}/api/payments`);
      return (await r.json()).mode === "demo";
    } catch { return false; }
  })();

  const runIntegration = () => run("node", ["scripts/test-payments-integration.mjs"], { env: { DEMO_BASE: BASE } });

  let r;
  if (demoUp) {
    r = await runIntegration();
  } else {
    // Boot a demo-mode server ourselves, exactly as `npm run start:demo` would.
    fs.rmSync(".paytest/e2e.db", { force: true });
    run("node", ["scripts/seed.mjs", "--reset"], { env: { DATABASE_PATH: ".paytest/e2e.db", ALLOW_DEMO_SEED: "1" } });
    r = await withServer("demo server", Number(BASE_PORT), {
      ...LOCAL_SERVER_ENV, DATABASE_PATH: ".paytest/e2e.db",
    }, runIntegration);
  }
  const summary = summarise(r.out, /(?:Payment tests|Payment integration): \d+ passed, \d+ failed \(\d+ checks\)/);
  record("Payment integration tests", r.code === 0, summary || r.out.slice(-1200));
  if (r.code !== 0) {
    console.log(r.out.split("\n").filter((l) => /FAIL|✗/.test(l)).join("\n"));
  }
}

if (FAST) finish();

/* ------------------------------------------------------- 6. End-to-end tests */
banner(++n, TOTAL, "End-to-end lifecycle tests");
{
  const needsOwnServer = !(await (async () => {
    try { return (await fetch(`${BASE}/`)).status === 200; } catch { return false; }
  })());

  const runE2E = () => run("node", ["scripts/test-e2e.mjs"], { env: { BASE } });
  let r;
  if (needsOwnServer) {
    fs.rmSync(".paytest/e2e.db", { force: true });
    run("node", ["scripts/seed.mjs", "--reset"], { env: { DATABASE_PATH: ".paytest/e2e.db", ALLOW_DEMO_SEED: "1" } });
    console.log(`\x1b[90m(no server on :${BASE_PORT} — starting one on a disposable database)\x1b[0m`);
    r = await withServer("e2e server", Number(BASE_PORT), {
      ...LOCAL_SERVER_ENV, DATABASE_PATH: ".paytest/e2e.db",
    }, runE2E);
  } else {
    // A running server keeps its own rate-limit counters; a fresh seed is required
    // for repeatable login-based checks, and seeding is in-place (never unlinks).
    run("node", ["scripts/seed.mjs", "--reset"], { env: { ALLOW_DEMO_SEED: "1" } });
    r = await runE2E();
  }
  const summary = summarise(r.out, /Summary\s+\d+\/\d+ passed, \d+ failed, \d+ skipped/);
  record("End-to-end tests", r.code === 0, summary || r.out.slice(-1200));
  if (r.code !== 0) console.log(r.out.split("\n").filter((l) => /FAIL/.test(l)).slice(0, 20).join("\n"));
}

/* ------------------------------------------------------------ 7. 2D browser */
banner(++n, TOTAL, "2D browser checks (puppeteer + DOM)");
{
  const env = fs.existsSync(CHROME_LIBS) ? { LD_LIBRARY_PATH: CHROME_LIBS } : {};
  const r = run("node", ["scripts/check-2d.mjs", BASE], { env });
  const summary = summarise(r.out, /2D summary\s+\d+\/\d+ passed, \d+ failed/);
  record("2D checks", r.code === 0, summary || r.out.slice(-1200));
  if (r.code !== 0) console.log(r.out.split("\n").filter((l) => /FAIL/.test(l)).slice(0, 20).join("\n"));
}

/* ------------------------------------------------------ 8. Links & buttons */
banner(++n, TOTAL, "Link and button checks");
{
  const env = fs.existsSync(CHROME_LIBS) ? { LD_LIBRARY_PATH: CHROME_LIBS } : {};
  const r = run("node", ["scripts/check-links.mjs", BASE], { env });
  const summary = summarise(r.out, /Link\/UI summary\s+\d+\/\d+ passed/);
  record("Links & buttons", r.code === 0, summary || r.out.slice(-1200));
  if (r.code !== 0) console.log(r.out.split("\n").filter((l) => /FAIL/.test(l)).slice(0, 20).join("\n"));
}

finish();

function finish() {
  const pass = results.filter((x) => x.ok).length;
  const fail = results.length - pass;
  console.log(`\n${"=".repeat(70)}`);
  console.log(`\x1b[1mVERIFICATION SUMMARY\x1b[0m  ${pass} passed, ${fail} failed`);
  for (const r of results) console.log(`  ${r.ok ? "\x1b[32m✔\x1b[0m" : "\x1b[31m✘\x1b[0m"} ${r.name}${r.detail ? ` \x1b[90m— ${r.detail}\x1b[0m` : ""}`);
  console.log("=".repeat(70));
  fs.mkdirSync(".paytest", { recursive: true });
  fs.writeFileSync(".paytest/verify-results.json", JSON.stringify({ results, pass, fail, at: new Date().toISOString() }, null, 2));
  process.exit(fail ? 1 : 0);
}
