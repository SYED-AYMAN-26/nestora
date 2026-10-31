#!/usr/bin/env node
/**
 * Boots a DEDICATED production server for the payment integration tests.
 *
 *   node scripts/payment-server.mjs
 *
 * Differences from `npm start`:
 *   - port 3100 (the normal dev/prod server on 3000 is left alone)
 *   - its own database (.paytest/integration.db) so production data is untouched
 *   - Razorpay TEST-mode credentials and a webhook secret, so the real signature
 *     and webhook code paths run instead of the demo branch
 *   - an optional outbound HTTP proxy (PAYMENT_PROXY_PORT=3101) that stands in
 *     for api.razorpay.com, so capture verification can be exercised for real
 *     without live gateway credentials
 *
 * Do not deploy with these values — the secrets below are obviously fake.
 */
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";

export const SERVER_PORT = 3100;
export const PROXY_PORT = 3101;
export const KEY_ID = "rzp_test_RentLinkPaymentTests";
export const KEY_SECRET = "paytest_secret_0123456789abcdef";
export const WEBHOOK_SECRET = "whsec_paytest_0123456789abcdef";

/**
 * Fake Razorpay API. Only /v1/payments/:id is used by the app's capture check.
 * Behaviour is steered per-test through the payment id, which is passed through
 * as `state:<id>` in the gateway state file — no hidden back door in the app.
 */
export function startProxy(stateFile) {
  const server = http.createServer((req, res) => {
    const m = /^\/v1\/payments\/(.+)$/.exec(req.url ?? "");
    res.setHeader("content-type", "application/json");
    if (!m) {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: "not found in test proxy" }));
      return;
    }
    const paymentId = decodeURIComponent(m[1]);
    let state = {};
    try { state = JSON.parse(fs.readFileSync(stateFile, "utf8")); } catch { state = {}; }
    const entry = state[paymentId] ?? { status: "captured" };
    if (entry.httpError) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: "upstream failure (simulated)" }));
      return;
    }
    res.statusCode = 200;
    res.end(JSON.stringify({
      id: paymentId,
      entity: "payment",
      order_id: entry.order_id ?? null,
      amount: entry.amount ?? 0,
      currency: entry.currency ?? "INR",
      status: entry.status ?? "captured",
      captured: entry.status === "captured",
    }));
  });
  return new Promise((resolve) => server.listen(PROXY_PORT, "127.0.0.1", () => resolve(server)));
}

/**
 * BACKEND=postgres runs the same integration suite against the PostgreSQL
 * adapter. It needs an empty database (the suite assumes a clean slate); the
 * default remains an isolated SQLite file so both engines can be compared.
 */
const PG_URL = process.env.INTEGRATION_DATABASE_URL || "";
const USE_PG = Boolean(PG_URL);

export async function startServer({ proxy = true } = {}) {
  const stateFile = ".paytest/gateway-state.json";
  fs.mkdirSync(".paytest", { recursive: true });
  if (!USE_PG) {
    fs.rmSync(".paytest/integration.db", { force: true });
    fs.rmSync(".paytest/integration.db-wal", { force: true });
    fs.rmSync(".paytest/integration.db-shm", { force: true });
  }
  if (proxy) {
    fs.writeFileSync(stateFile, "{}");
    await startProxy(stateFile);
  }

  // Seed the isolated database with demo accounts (in place, never deleted).
  //
  // scripts/seed.mjs is the SQLite demo seeder. On PostgreSQL the schema is
  // created by scripts/migrate.mjs and the demo data is loaded with
  // scripts/migrate-to-postgres.mjs from the local SQLite demo database — the
  // same code path a real SQLite→PostgreSQL cutover uses. That is why the
  // PostgreSQL integration run is a genuine end-to-end test of the migration
  // tooling as well as of the payment routes.
  if (USE_PG) {
    await run("node", ["scripts/migrate.mjs"], {
      DATABASE_URL: PG_URL,
      PG_SSL_MODE: process.env.PG_SSL_MODE || "disable",
    });
    await run("node", ["scripts/migrate-to-postgres.mjs", "--apply", "--replace"], {
      DATABASE_URL: PG_URL,
      PG_SSL_MODE: process.env.PG_SSL_MODE || "disable",
      ...(process.env.SOURCE_DATABASE_PATH ? { DATABASE_PATH: process.env.SOURCE_DATABASE_PATH } : {}),
    });
  } else {
    await run("node", ["scripts/seed.mjs", "--reset"], {
      DATABASE_PATH: ".paytest/integration.db",
      ALLOW_DEMO_SEED: "1",
    });
  }

  const child = spawn("node_modules/.bin/next", ["start", "-p", String(SERVER_PORT), "-H", "127.0.0.1"], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      // A production build now REQUIRES a session secret (the old write-to-disk
      // fallback was a serverless hazard). Tests supply a fixed throwaway one.
      SESSION_SECRET: process.env.SESSION_SECRET || "integration-test-session-secret-0123456789",
      ...(USE_PG
        ? { DATABASE_URL: PG_URL, PG_SKIP_SCHEMA: "1", PG_SSL_MODE: process.env.PG_SSL_MODE || "disable" }
        : { DATABASE_PATH: ".paytest/integration.db" }),
      ALLOW_TEST_FIXTURES: "1",
      // This is a deliberately insecure, local-only test process (SQLite + no
      // Blob store). A production build refuses to start without that, which is
      // the correct behaviour; the test harness acknowledges it explicitly.
      RENTLINK_ALLOW_INSECURE_PROD: "1",
      RAZORPAY_KEY_ID: KEY_ID,
      RAZORPAY_KEY_SECRET: KEY_SECRET,
      RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
      // Point the capture check at the local stand-in for api.razorpay.com.
      RAZORPAY_API_BASE: proxy ? `http://127.0.0.1:${PROXY_PORT}` : undefined,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const log = [];
  child.stdout.on("data", (d) => log.push(String(d)));
  child.stderr.on("data", (d) => log.push(String(d)));
  // Never leave a stray server (and its DB handle) behind if a test throws.
  const kill = () => { try { child.kill("SIGTERM"); } catch { /* already gone */ } };
  process.on("exit", kill);
  process.on("SIGINT", () => { kill(); process.exit(130); });
  process.on("uncaughtException", (e) => { kill(); console.error(e); process.exit(1); });

  // wait for the port
  const deadline = Date.now() + 90000;
  for (;;) {
    try {
      const r = await fetch(`http://127.0.0.1:${SERVER_PORT}/api/payments`);
      if (r.status < 500) break;
    } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error("payment test server did not start:\n" + log.join(""));
    await new Promise((r) => setTimeout(r, 500));
  }
  return { child, log, stateFile };
}

function run(cmd, args, env) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: "ignore" });
    p.on("exit", (c) => (c === 0 ? resolve() : reject(new Error(`${cmd} exited ${c}`))));
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { child } = await startServer();
  console.log(`payment test server on http://127.0.0.1:${SERVER_PORT} (proxy ${PROXY_PORT})`);
  child.on("exit", (c) => process.exit(c ?? 0));
}
