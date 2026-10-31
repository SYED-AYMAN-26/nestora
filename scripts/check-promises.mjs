#!/usr/bin/env node
/**
 * Serialised-Promise detector.
 *
 * The async migration changed `all()`/`one()` from synchronous values to
 * Promises. Any call site that was missed returns a Promise, and a Promise placed
 * straight into a JSON response serialises as `{}` — a page renders perfectly and
 * shows nothing, with no error anywhere. That is the single most dangerous
 * failure mode left by the migration, so it gets its own check.
 *
 *   node scripts/check-promises.mjs                 # http://127.0.0.1:3000
 *   BASE=http://127.0.0.1:3200 node scripts/check-promises.mjs
 *
 * For each JSON endpoint it asserts the shape the application expects: lists are
 * arrays, counts are numbers, and no value is the literal string "[object
 * Promise]" or an empty object where a record is required.
 */
const BASE = process.env.BASE || "http://127.0.0.1:3000";
const PASS = [], FAIL = [];
let section = "";

function group(name) { section = name; console.log(`\n\x1b[1m${name}\x1b[0m`); }
function check(ok, label, detail = "") {
  (ok ? PASS : FAIL).push({ section, label, detail });
  console.log(`  ${ok ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"} ${label}${detail ? ` \x1b[90m— ${detail}\x1b[0m` : ""}`);
  return ok;
}

async function login(email, password = "Demo@1234") {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login ${email}: ${res.status}`);
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}

async function json(path, cookie) {
  const res = await fetch(`${BASE}${path}`, { headers: cookie ? { cookie } : {} });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, body, text };
}

/** Walks a JSON value looking for a serialised Promise or a suspicious {}. */
function findPromiseArtefacts(value, path = "$", out = []) {
  if (value === null || value === undefined) return out;
  if (typeof value === "string") {
    if (value === "[object Promise]" || value === "{}") out.push(`${path} = "${value}"`);
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => findPromiseArtefacts(v, `${path}[${i}]`, out));
    return out;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value)) findPromiseArtefacts(v, `${path}.${k}`, out);
  }
  return out;
}

async function main() {
  console.log(`\x1b[1mSerialised-Promise check\x1b[0m  ${BASE}`);
  const admin = await login("admin@rentlink.demo");
  const buyer = await login("buyer@student.demo");
  const provider = await login("provider@anna.demo");

  group("Admin overview — lists must be present, not empty objects");
  {
    const r = await json("/api/admin/overview", admin);
    check(r.status === 200, "GET /api/admin/overview returns 200", `status ${r.status}`);
    const b = r.body || {};
    check(Array.isArray(b.recentBookings) && b.recentBookings.length > 0, "recentBookings is a non-empty array",
      Array.isArray(b.recentBookings) ? `${b.recentBookings.length} rows` : typeof b.recentBookings);
    check(Array.isArray(b.recentPayments), "recentPayments is an array", typeof b.recentPayments);
    check(Array.isArray(b.categories) && b.categories.length > 0, "categories is a non-empty array",
      Array.isArray(b.categories) ? `${b.categories.length} rows` : typeof b.categories);
    check(Array.isArray(b.settings), "settings is an array", typeof b.settings);
    check(Array.isArray(b.audit), "audit is an array", typeof b.audit);
    check(typeof b.counts?.users === "number" && b.counts.users > 0, "counts.users is a real number", String(b.counts?.users));
    const artefacts = findPromiseArtefacts(b);
    check(artefacts.length === 0, "no serialised Promise artefacts in the payload", artefacts.slice(0, 3).join("; "));
  }

  group("Role dashboards");
  for (const [name, path, cookie, key, kind] of [
    ["admin users", "/api/admin/users", admin, "items", "array"],
    ["admin resources", "/api/admin/resources", admin, "items", "array"],
    ["admin disputes", "/api/admin/disputes", admin, "items", "array"],
    ["admin verifications", "/api/admin/verifications", admin, "items", "array"],
    ["admin categories", "/api/admin/categories", admin, "items", "array"],
    ["buyer bookings", "/api/bookings", buyer, "items", "array"],
    ["buyer favourites", "/api/favourites", buyer, "items", "array"],
    ["buyer notifications", "/api/notifications", buyer, "items", "array"],
    ["buyer disputes", "/api/disputes", buyer, "items", "array"],
    ["impact analytics", "/api/analytics/impact", admin, "verified", "object"],
    ["utilisation analytics", "/api/analytics/utilisation?providerId=1", admin, "items", "array"],
    ["provider storefront", "/api/providers/anna-institute-of-technology", provider, null, null],
    ["current user", "/api/me", buyer, "user", "object"],
  ]) {
    const r = await json(path, cookie);
    if (r.status !== 200) {
      check(false, `${name} (${path})`, `status ${r.status}`);
      continue;
    }
    const artefacts = findPromiseArtefacts(r.body);
    if (kind === "array") {
      const v = r.body?.[key];
      check(Array.isArray(v), `${name}: "${key}" is an array`, Array.isArray(v) ? `${v.length} rows` : typeof v);
      if (Array.isArray(v) && v.length) {
        const empty = Object.keys(v[0] || {}).length === 0;
        check(!empty, `${name}: first row is not an empty object`, empty ? "empty object" : "ok");
      }
    } else if (kind === "object") {
      const v = r.body?.[key];
      check(Boolean(v) && typeof v === "object" && !Array.isArray(v), `${name}: "${key}" is an object`, typeof v);
    }
    check(artefacts.length === 0, `${name}: no Promise artefacts`, artefacts.slice(0, 3).join("; "));
  }

  group("Public pages render data, not empty shells");
  {
    const pages = ["/", "/marketplace", "/impact", "/viewer", "/help"];
    for (const p of pages) {
      const res = await fetch(`${BASE}${p}`);
      const html = await res.text();
      const suspicious = /\[object Promise\]/.test(html);
      check(res.status === 200 && !suspicious, `${p} renders cleanly`, suspicious ? "contains [object Promise]" : `status ${res.status}`);
    }
    // The marketplace must actually show listings.
    const mp = await fetch(`${BASE}/marketplace`);
    const html = await mp.text();
    check(/Canon EOS 90D|Sony|Nikon|rental/i.test(html), "marketplace page contains real listing content");
  }

  const total = PASS.length + FAIL.length;
  console.log(`\n${"=".repeat(66)}`);
  console.log(`Promise check: \x1b[32m${PASS.length} passed\x1b[0m, ${FAIL.length ? "\x1b[31m" : ""}${FAIL.length} failed\x1b[0m (${total} checks)`);
  if (FAIL.length) {
    console.log("\nFailures:");
    for (const f of FAIL) console.log(`  ✗ [${f.section}] ${f.label} — ${f.detail}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("\nCHECK CRASHED:", e.message);
  process.exit(1);
});
