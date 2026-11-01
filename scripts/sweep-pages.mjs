#!/usr/bin/env node
/**
 * Authenticated page/route sweep for a running server.
 *
 * Signs in as a buyer, a provider and an admin in turn, then requests every page
 * and API route that role can reach and records the HTTP status. It exists to
 * answer one question honestly: "does the whole application actually work on
 * this database backend?", including the pages nobody clicks during a demo.
 *
 *   node scripts/sweep-pages.mjs                      # http://127.0.0.1:3000
 *   BASE=http://127.0.0.1:3200 node scripts/sweep-pages.mjs
 *
 * Exit code 0 = every page returned a success/redirect status.
 */
const BASE = process.env.BASE || "http://127.0.0.1:3000";
const PW = process.env.SWEEP_PASSWORD || "Demo@1234";

const results = [];
let failures = 0;

function cookieJar() {
  const jar = new Map();
  return {
    header: () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; "),
    absorb(res) {
      for (const c of res.headers.getSetCookie?.() ?? []) {
        const [kv] = c.split(";");
        const i = kv.indexOf("=");
        if (i < 0) continue;
        const name = kv.slice(0, i);
        const value = kv.slice(i + 1);
        if (!value) jar.delete(name);
        else jar.set(name, value);
      }
    },
    has: () => jar.size > 0,
  };
}

async function login(email) {
  const jar = cookieJar();
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "sweep/1.0" },
    body: JSON.stringify({ email, password: PW }),
    redirect: "manual",
  });
  jar.absorb(res);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`login ${email} failed: ${res.status} ${body.slice(0, 200)}`);
  }
  return jar;
}

async function get(path, jar, { expect = "ok" } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { cookie: jar.header(), "user-agent": "sweep/1.0" },
    redirect: "manual",
  });
  const text = await res.text().catch(() => "");
  const ok =
    expect === "ok"
      ? res.status >= 200 && res.status < 400
      : res.status === Number(expect);
  const record = { path, status: res.status, ok, note: "" };
  // A 200 that renders Next's error overlay still counts as broken.
  if (res.status >= 200 && res.status < 300 && /Application error|Internal Server Error/i.test(text)) {
    record.ok = false;
    record.note = "error boundary content";
  }
  if (!ok) {
    failures++;
    record.note = record.note || text.replace(/\s+/g, " ").slice(0, 140);
  }
  results.push(record);
  const tag = record.ok ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";
  console.log(`  ${tag} ${String(res.status).padEnd(3)} ${path}${record.note && !record.ok ? `  \x1b[90m${record.note}\x1b[0m` : ""}`);
  return { status: res.status, text, record };
}

async function section(name, fn) {
  console.log(`\n\x1b[1m${name}\x1b[0m`);
  try {
    await fn();
  } catch (e) {
    failures++;
    console.log(`  \x1b[31mFAIL\x1b[0m ${name}: ${e.message}`);
    results.push({ path: name, status: 0, ok: false, note: e.message });
  }
}

async function main() {
  console.log(`\x1b[1mPage sweep\x1b[0m  ${BASE}`);
  const anon = cookieJar();

  await section("Public pages (anonymous)", async () => {
    for (const p of [
      "/",
      "/marketplace",
      "/login",
      "/register",
      "/help",
      "/compare",
      "/recommend",
      "/viewer",
      "/resources/1",
      "/resources/1/passport",
      "/storefront/anna-institute-of-technology",
    ]) {
      await get(p, anon);
    }
  });

  // Protected pages must redirect anonymous visitors to /login — that is a
  // security assertion, not a convenience.
  await section("Protected pages redirect anonymous visitors", async () => {
    for (const p of ["/dashboard", "/admin", "/provider", "/bookings", "/settings", "/favourites"]) {
      const res = await fetch(`${BASE}${p}`, { redirect: "manual" });
      const loc = res.headers.get("location") || "";
      const ok = res.status >= 300 && res.status < 400 && /login|marketplace|onboard/i.test(loc);
      const tag = ok ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";
      if (!ok) failures++;
      results.push({ path: p, status: res.status, ok, note: loc });
      console.log(`  ${tag} ${res.status} ${p} → ${loc || "(no redirect)"}`);
    }
  });

  const buyer = await login("buyer@student.demo");
  await section("Buyer pages", async () => {
    for (const p of [
      "/dashboard",
      "/marketplace",
      "/bookings",
      "/favourites",
      "/notifications",
      "/settings",
      "/disputes",
      "/recommend",
      "/impact",
      "/compare?ids=1,2",
    ]) await get(p, buyer);
  });

  const provider = await login("provider@anna.demo");
  await section("Provider pages", async () => {
    for (const p of [
      "/provider",
      "/provider/bookings",
      "/provider/resources",
      "/provider/resources/1",
      "/provider/utilisation",
      "/provider/verification",
      "/provider/new",
    ]) await get(p, provider);
  });

  const admin = await login("admin@rentlink.demo");
  await section("Admin pages", async () => {
    for (const p of [
      "/admin",
      "/admin/users",
      "/admin/resources",
      "/admin/verifications",
      "/admin/disputes",
      "/admin/audit",
      "/verification-report",
    ]) await get(p, admin);
  });

  await section("Admin APIs", async () => {
    for (const p of [
      "/api/admin/overview",
      "/api/admin/users",
      "/api/admin/resources",
      "/api/admin/disputes",
      "/api/analytics/utilisation?providerId=1",
      "/api/analytics/impact",
      "/api/notifications",
      "/api/disputes?scope=all",
      "/api/providers/anna-institute-of-technology",
    ]) await get(p, admin);
  });

  await section("Buyer APIs", async () => {
    for (const p of [
      "/api/bookings",
      "/api/favourites",
      "/api/notifications",
      "/api/disputes",
      "/api/me",
    ]) await get(p, buyer);
  });

  await section("POST-only endpoints", async () => {
    const res = await fetch(`${BASE}/api/recommend`, {
      method: "POST",
      headers: { cookie: buyer.header(), "content-type": "application/json" },
      body: JSON.stringify({ query: "camera for a student film project" }),
    });
    const ok = res.ok;
    if (!ok) failures++;
    results.push({ path: "/api/recommend (POST)", status: res.status, ok, note: ok ? "" : (await res.text()).slice(0, 120) });
    console.log(`  ${ok ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"} ${res.status} /api/recommend (POST)`);
  });

  await section("Ajax endpoints used by the listing page / booking panel", async () => {
    for (const p of [
      "/api/resources/1/availability?start=2030-01-01&end=2030-01-05&units=1&basis=daily&months=2",
      "/api/providers/anna-institute-of-technology",
    ]) await get(p, buyer);
  });

  console.log(`\n${results.length} requests, ${results.length - failures} ok, ${failures} failed`);
  if (failures) {
    console.log("\nFailures:");
    for (const r of results.filter((x) => !x.ok)) console.log(`  ${r.status} ${r.path} — ${r.note}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("\nSWEEP CRASHED:", e.message);
  process.exit(1);
});
