#!/usr/bin/env node
/**
 * RentLink 3D — end-to-end lifecycle test harness.
 *
 * Runs against a LIVE server (default http://127.0.0.1:3000) using real HTTP
 * requests, real cookies and the real SQLite database. Nothing is mocked, so a
 * pass here means the workflow genuinely works.
 *
 *   npm test                 # run everything
 *   npm test -- --reset      # reset + reseed the database first (needs no server restart)
 *   BASE=http://host:3000 npm test
 *
 * Exit code 0 = every check passed.
 */
import { execFileSync } from "node:child_process";

const BASE = process.env.BASE || "http://127.0.0.1:3000";
const PASS = [], FAIL = [], SKIP = [];
let currentSection = "general";

function section(name) { currentSection = name; console.log(`\n\x1b[1m${name}\x1b[0m`); }
function record(ok, label, detail = "") {
  const entry = { section: currentSection, label, detail };
  if (ok) { PASS.push(entry); console.log(`  \x1b[32mPASS\x1b[0m ${label}${detail ? ` \x1b[90m— ${detail}\x1b[0m` : ""}`); }
  else { FAIL.push(entry); console.log(`  \x1b[31mFAIL\x1b[0m ${label}${detail ? ` \x1b[90m— ${detail}\x1b[0m` : ""}`); }
  return ok;
}
function skip(label, why) { SKIP.push({ section: currentSection, label, detail: why }); console.log(`  \x1b[33mSKIP\x1b[0m ${label} \x1b[90m— ${why}\x1b[0m`); }

/* ------------------------------------------------------------------ helpers */
function jar() {
  const m = new Map();
  return {
    header: () => [...m.entries()].map(([k, v]) => `${k}=${v}`).join("; "),
    absorb(res) {
      for (const c of res.headers.getSetCookie?.() ?? []) {
        const [kv, ...attrs] = c.split(";");
        const i = kv.indexOf("=");
        const name = kv.slice(0, i);
        const value = kv.slice(i + 1);
        const expiresPast = attrs.some((a) => /expires=thu, 01 jan 1970/i.test(a)) || /max-age=0/i.test(c);
        if (!value || expiresPast) m.delete(name);
        else m.set(name, value);
      }
    },
  };
}

async function req(path, { method = "GET", body, cookie, redirect = "manual", raw } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (body !== undefined && !raw) headers["content-type"] = "application/json";
  const res = await fetch(BASE + path, { method, headers, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined), redirect });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* html */ }
  return { status: res.status, json, text, res };
}

/**
 * Sessions are single-active-per-user on purpose (logging in elsewhere signs the
 * old session out), so the harness keeps a shared per-user cookie ledger instead
 * of holding several jars for the same account.
 */
const LEDGER = new Map();
function cookieFor(email) {
  const c = LEDGER.get(email);
  if (!c) throw new Error(`No session for ${email} — call login() first`);
  return c;
}
async function login(email, password = "Demo@1234") {
  const j = jar();
  const r = await req("/api/auth/login", { method: "POST", body: { email, password } });
  j.absorb(r.res);
  if (r.status === 200) LEDGER.set(email, j.header());
  return { ok: r.status === 200 && r.json?.ok !== false, jar: { header: () => LEDGER.get(email) ?? "" }, body: r.json, status: r.status };
}

function dbQuery(sql) {
  // Read-only helper for assertions that need ground truth from SQLite.
  const out = execFileSync("node", ["-e", `
    const D=require('better-sqlite3');const db=new D('data/rentlink.db',{readonly:true});
    const r=db.prepare(${JSON.stringify(sql)}).all();console.log(JSON.stringify(r));
  `], { cwd: process.cwd(), encoding: "utf8" });
  return JSON.parse(out);
}

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (base, n) => {
  const d = new Date(base + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/* ------------------------------------------------- fresh throwaway accounts */
const RUN_TAG = Date.now().toString(36).slice(-5);   // keeps re-runs independent
const ACCOUNTS = {};

/**
 * Registers a brand-new throwaway account through the real public API, so the
 * suite is repeatable without resetting and never depends on a shared demo
 * account's accumulated history. Optionally creates a provider profile.
 */
async function freshAccount(key, { accountType = "individual", wantsProvider = false, orgName } = {}) {
  if (ACCOUNTS[key]) return ACCOUNTS[key];
  const email = `e2e-${key}-${RUN_TAG}@example.test`;
  // Uses the test-only fixture endpoint: the public /api/auth/register route is
  // rate-limited on purpose (10/IP/hour) and creating accounts through it would
  // make this suite fail on its second run.
  const r = await req("/api/dev/fixture-account", {
    method: "POST",
    body: {
      full_name: `E2E ${key} ${RUN_TAG}`, email, password: "TestPass@2026",
      account_type: accountType, org_name: orgName ?? null, city: "Chennai", state: "Tamil Nadu",
      wants_provider: wantsProvider,
    },
  });
  if (r.status !== 200) throw new Error(`fixture ${key} failed: ${r.status} ${r.text.slice(0, 160)}`);
  await login(email, "TestPass@2026");
  ACCOUNTS[key] = { email, cookie: () => cookieFor(email), body: r.json };
  return ACCOUNTS[key];
}

/* ------------------------------------------------------------- 1. boot & data */
async function checkServer() {
  section("1. Server & database");
  let r;
  try { r = await req("/"); } catch (e) { record(false, "Server reachable", String(e.cause?.code ?? e.message)); return false; }
  record(r.status === 200, "Landing page responds 200", `${r.text.length} bytes`);
  record(/Canon EOS 90D|RentLink/.test(r.text), "Landing page renders seeded content");

  // Tables + row counts straight from the database file.
  const tables = dbQuery(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`);
  record(tables.length >= 25, "Schema has the expected tables", `${tables.length} tables`);
  const users = dbQuery(`SELECT COUNT(*) AS c FROM users`)[0].c;
  const resources = dbQuery(`SELECT COUNT(*) AS c FROM resources`)[0].c;
  const bookings = dbQuery(`SELECT COUNT(*) AS c FROM bookings`)[0].c;
  record(users >= 8 && resources >= 8 && bookings >= 5, "Seed data present", `${users} users / ${resources} resources / ${bookings} bookings`);
  // Real invariant: anything owned by a seeded (fictional) demo account must itself be
  // flagged is_demo, so demo content can never be mistaken for a real listing. Rows the
  // suite creates through fixture accounts are legitimately is_demo = 0.
  const leaked = dbQuery(`SELECT COUNT(*) AS c FROM resources r JOIN provider_profiles p ON p.id=r.provider_id
      JOIN users u ON u.id=p.user_id WHERE u.is_demo = 1 AND r.is_demo = 0`)[0].c;
  record(leaked === 0, "No demo-owned resource is unlabelled (is_demo invariant)", `${leaked} leaked`);
  const demoUsers = dbQuery(`SELECT COUNT(*) AS c FROM users WHERE is_demo = 1`)[0].c;
  record(demoUsers >= 11, "Seeded demo accounts are all flagged is_demo", `${demoUsers} demo accounts`);
  return true;
}

/* ------------------------------------------------------- 2. auth & security */
async function checkAuth() {
  section("2. Authentication, sessions & roles");
  const buyer = await login("buyer@student.demo");
  record(buyer.ok, "Buyer login succeeds", `status ${buyer.status}`);

  const wrong = await req("/api/auth/login", { method: "POST", body: { email: "buyer@individual.demo", password: "wrong-password-123" } });
  record(wrong.status === 401, "Wrong password rejected", `status ${wrong.status}`);

  const me = await req("/api/me", { cookie: cookieFor("buyer@student.demo") });
  record(me.status === 200 && me.json?.user?.email === "buyer@student.demo", "Session identifies the user", me.json?.user?.email);
  const hash = dbQuery(`SELECT password_hash FROM users WHERE email='buyer@student.demo'`)[0].password_hash;
  record(!hash.includes("Demo@1234") && /scrypt/.test(hash) && hash.split("$").length >= 4, "Passwords are hashed (scrypt + per-user salt)", hash.slice(0, 22) + "…");

  const anon = await req("/api/me");
  record(anon.status === 401, "Anonymous /api/me is 401", `status ${anon.status}`);

  // RBAC: a buyer must not reach the admin console or admin APIs.
  const adminPage = await req("/admin", { cookie: cookieFor("buyer@student.demo") });
  record([307, 302].includes(adminPage.status), "Buyer redirected away from /admin", `status ${adminPage.status}`);
  const adminApi = await req("/api/admin/verifications", { method: "POST", cookie: cookieFor("buyer@student.demo"), body: { requestId: 1, decision: "approved", note: "hack attempt" } });
  record(adminApi.status === 401 || adminApi.status === 403, "Buyer blocked from admin API", `status ${adminApi.status}`);

  // Ownership: a buyer cannot read someone else's booking.
  const foreign = dbQuery(`SELECT b.id FROM bookings b JOIN users u ON u.id=b.buyer_id WHERE u.email != 'buyer@student.demo' LIMIT 1`)[0];
  if (foreign) {
    const r = await req(`/bookings/${foreign.id}`, { cookie: cookieFor("buyer@student.demo") });
    record(r.status === 404, "Foreign booking returns 404 (not 403 leak)", `booking ${foreign.id}, status ${r.status}`);
  } else skip("Foreign booking 404", "no other booking in the dataset");

  // Provider isolation: cannot edit another provider's listing.
  await login("provider@anna.demo");
  const otherListing = dbQuery(`SELECT r.id FROM resources r JOIN provider_profiles p ON p.id=r.provider_id WHERE p.storefront_slug != 'anna-institute-of-technology' LIMIT 1`)[0];
  if (otherListing) {
    const r = await req(`/api/resources/${otherListing.id}`, { method: "PATCH", cookie: cookieFor("provider@anna.demo"), body: { title: "Hijacked listing title" } });
    record(r.status === 403 || r.status === 404, "Provider cannot edit a foreign listing", `status ${r.status}`);
  }

  // Dedicated account so this cannot invalidate the sessions other sections use.
  const j2 = await login("buyer@community.demo");
  const lo = await req("/api/auth/logout", { method: "POST", cookie: j2.jar.header() });
  record(lo.status === 200, "Logout succeeds", `status ${lo.status}`);
  const after = await req("/api/me", { cookie: j2.jar.header() });
  record(after.status === 401, "Session invalid after logout", `status ${after.status}`);

  return buyer;
}

/* -------------------------------------------------------- 3. provider checks */
async function checkVerification() {
  section("3. Provider verification workflow");
  const admin = await login("admin@rentlink.demo");
  record(admin.ok, "Admin login succeeds", `status ${admin.status}`);

  const pending = dbQuery(`SELECT v.id, v.provider_id, p.display_name, p.user_id FROM verification_requests v JOIN provider_profiles p ON p.id=v.provider_id WHERE v.status='pending' LIMIT 1`)[0];
  record(Boolean(pending), "A pending verification request exists in the queue", pending?.display_name);
  if (!pending) return admin;

  // The unverified provider must not carry a verified badge.
  const ownerEmail = dbQuery(`SELECT email FROM users WHERE id=${pending.user_id}`)[0].email;
  await login(ownerEmail);
  const meP = await req("/api/me", { cookie: cookieFor(ownerEmail) });
  record(meP.json?.provider?.verification_status === "pending", "Unapproved provider has no verified badge", `status=${meP.json?.provider?.verification_status}`);

  // Rejecting without a note is refused (a provider must be told why).
  const noNote = await req("/api/admin/verifications", { method: "POST", cookie: cookieFor("admin@rentlink.demo"), body: { requestId: pending.id, decision: "rejected" } });
  record(noNote.status === 422, "Rejection without a reviewer note is refused", `status ${noNote.status}`);

  const moreInfo = await req("/api/admin/verifications", { method: "POST", cookie: cookieFor("admin@rentlink.demo"), body: { requestId: pending.id, decision: "more_info", note: "Please supply the ownership invoice for the listed inventory." } });
  record(moreInfo.status === 200, "Admin can request more information", moreInfo.json?.message ?? `status ${moreInfo.status}`);
  let vs = dbQuery(`SELECT verification_status FROM provider_profiles WHERE id=${pending.provider_id}`)[0].verification_status;
  record(vs === "more_info", "Status became more_info (still not verified)", vs);

  restorePendingVerification(pending.id, pending.provider_id, pending.user_id);
  const reLogin = await login(ownerEmail);
  record(reLogin.ok, "Provider can sign in while verification is pending", `status ${reLogin.status}`);

  const approve = await req("/api/admin/verifications", { method: "POST", cookie: cookieFor("admin@rentlink.demo"), body: { requestId: pending.id, decision: "approved", note: "Documents verified during the automated test run." } });
  record(approve.status === 200, "Admin can approve a request", approve.json?.message ?? `status ${approve.status}`);
  vs = dbQuery(`SELECT verification_status FROM provider_profiles WHERE id=${pending.provider_id}`)[0].verification_status;
  record(vs === "verified", "Approval sets verification_status = verified", vs);
  const auditRow = dbQuery(`SELECT COUNT(*) AS c FROM audit_logs WHERE action LIKE 'admin.verification%'`)[0].c;
  record(auditRow > 0, "Verification decisions are written to the audit log", `${auditRow} entries`);

  restorePendingVerification(pending.id, pending.provider_id, pending.user_id);

  // A provider can only submit verification for their own storefront.
  await login("provider@anna.demo");
  const foreignVerify = await req("/api/providers/bharat-media-university/verify", { method: "POST", cookie: cookieFor("provider@anna.demo"), body: { legal_name: "Hijack Institute" } });
  record([403, 404].includes(foreignVerify.status), "Cannot submit verification for another provider", `status ${foreignVerify.status}`);
  return admin;
}

/** Put the pending verification request back exactly as seeded. */
function restorePendingVerification(requestId, providerId) {
  execFileSync("node", ["-e", `
    const D=require('better-sqlite3');const db=new D('data/rentlink.db');
    db.prepare("UPDATE verification_requests SET status='pending', reviewer_id=NULL, reviewer_note=NULL, reviewed_at=NULL WHERE id=?").run(${requestId});
    db.prepare("UPDATE provider_profiles SET verification_status='pending', verification_note=NULL, verified_at=NULL WHERE id=?").run(${providerId});
    db.prepare("DELETE FROM sessions WHERE user_id = (SELECT user_id FROM provider_profiles WHERE id=?)").run(${providerId});
  `], { cwd: process.cwd() });
}

/* --------------------------------------------------------- 4. listing mgmt */
async function checkListings() {
  section("4. Resource listing & management");
  await login("provider@anna.demo");
  const stamp = Date.now().toString().slice(-6);
  const create = await req("/api/resources/create", {
    method: "POST", cookie: cookieFor("provider@anna.demo"),
    body: {
      title: `E2E Test Oscilloscope ${stamp}`, category: "lab-equipment", description: "Automated end-to-end test listing created by the verification harness to prove listing creation and management work.",
      condition: "good", quantity_total: 4, quantity_active: 1, internal_usage_hours_month: 10,
      location_city: "Chennai", location_state: "Tamil Nadu", price_hourly: 150, price_daily: 900, price_weekly: 4500,
      deposit: 2000, eligibility: "Open to institutional accounts", training_required: true, supervision_required: false,
      usage_rules: "Handle with care.", cancellation_policy: "48 hours notice.", min_hours: 2, max_days: 14,
      status: "active", capabilities: ["diagnostics", "measurement"], images: ["/img/lab.svg"], blocked_dates: [],
      approval_mode: "manual", booking_limit_days: 14,
    },
  });
  record(create.status === 200, "Provider creates a listing", create.json?.message ?? JSON.stringify(create.json).slice(0, 120));
  const newId = create.json?.resourceId ?? create.json?.id;
  record(Boolean(newId), "Create returns the new listing id", String(newId));

  if (newId) {
    const mine = dbQuery(`SELECT id, provider_id FROM resources WHERE id=${newId}`)[0];
    const provRow = dbQuery(`SELECT id FROM provider_profiles WHERE storefront_slug='anna-institute-of-technology'`)[0];
    record(Number(mine?.provider_id) === Number(provRow?.id), "Listing is owned by the calling provider", `provider_id=${mine?.provider_id} (expected ${provRow?.id})`);

    const upd = await req(`/api/resources/${newId}`, { method: "PATCH", cookie: cookieFor("provider@anna.demo"), body: { price_daily: 950, status: "paused" } });
    record(upd.status === 200, "Provider edits their own listing", `status ${upd.status}`);
    const row = dbQuery(`SELECT price_daily, status FROM resources WHERE id=${newId}`)[0] ?? {};
    record(Number(row.price_daily) === 950 && row.status === "paused", "Edits persisted", `₹${row.price_daily} / ${row.status}`);

    const del = await req(`/api/resources/${newId}`, { method: "DELETE", cookie: cookieFor("provider@anna.demo") });
    record(del.status === 200, "Listing without bookings can be deleted", del.json?.message ?? `status ${del.status}`);
    const gone = dbQuery(`SELECT COUNT(*) AS c FROM resources WHERE id=${newId}`)[0].c;
    record(gone === 0, "Deleted listing is gone", `${gone} rows`);
  }

  await login("provider@bharat.demo");
  const annaListing = dbQuery(`SELECT r.id FROM resources r JOIN provider_profiles p ON p.id=r.provider_id WHERE p.storefront_slug='anna-institute-of-technology' LIMIT 1`)[0];
  if (annaListing) {
    const r = await req(`/api/resources/${annaListing.id}`, { method: "DELETE", cookie: cookieFor("provider@bharat.demo") });
    record([403, 404].includes(r.status), "Other provider cannot delete the listing", `status ${r.status}`);
  }
}

/* --------------------------------------------- 5. discovery, search, compare */
async function checkDiscovery() {
  await login("buyer@student.demo");
  section("5. Discovery: search, filters, favourites, recommendations");
  const mkt = await req("/marketplace?q=camera");
  record(mkt.status === 200 && /result|listing|resource/i.test(mkt.text), "Marketplace search renders", `${mkt.text.length} bytes`);

  const api = await req("/api/resources?q=camera&limit=5");
  record(api.status === 200 && Array.isArray(api.json?.items), "Resource search API returns items", `${api.json?.items?.length ?? 0} items`);

  const first = dbQuery(`SELECT id FROM resources WHERE status='active' ORDER BY id LIMIT 1`)[0];
  const fav1 = await req("/api/favourites", { method: "POST", cookie: cookieFor("buyer@student.demo"), body: { resourceId: first.id } });
  record(fav1.status === 200, "Favourite toggles on", JSON.stringify(fav1.json));
  const list = await req("/api/favourites", { cookie: cookieFor("buyer@student.demo") });
  record((list.json?.items ?? []).some((i) => i.id === first.id), "Favourite appears in the list", `${list.json?.items?.length} saved`);
  await req("/api/favourites", { method: "POST", cookie: cookieFor("buyer@student.demo"), body: { resourceId: first.id } });
  const list2 = await req("/api/favourites", { cookie: cookieFor("buyer@student.demo") });
  record(!(list2.json?.items ?? []).some((i) => i.id === first.id), "Favourite toggles back off");

  await req("/api/track", { method: "POST", cookie: cookieFor("buyer@student.demo"), body: { resourceId: first.id } });
  const seen = await req("/api/track", { cookie: cookieFor("buyer@student.demo") });
  record((seen.json?.items ?? []).length > 0, "Recently viewed tracked", `${seen.json?.items?.length} entries`);

  const rec = await req("/api/recommend", { method: "POST", cookie: cookieFor("buyer@student.demo"), body: { query: "camera for recording interviews and video" } });
  record(rec.status === 200 && Array.isArray(rec.json?.results), "Recommendation endpoint responds", `${rec.json?.results?.length ?? 0} matches`);
  record(rec.json?.engine === "rules" || rec.json?.engine === "ai", "Recommendations disclose which engine ran", `engine=${rec.json?.engine}`);
  const hasWhy = (rec.json?.results ?? []).every((r) => Array.isArray(r.reasons) && r.reasons.length > 0);
  record((rec.json?.results ?? []).length === 0 || hasWhy, "\"Why this matches\" explanations present", hasWhy ? "all results explained" : "missing");

  const cmp = await req(`/compare?ids=${first.id}`);
  record(cmp.status === 200, "Compare page renders", `${cmp.text.length} bytes`);

  const detail = await req(`/resources/${first.id}`);
  record(detail.status === 200, "Resource detail page renders", `${detail.text.length} bytes`);
  const passport = await req(`/resources/${first.id}/passport`);
  record(passport.status === 200, "Digital equipment passport renders", `${passport.text.length} bytes`);
}

/* --------------------------------------------------- 6. booking lifecycle */
/** Creates a fresh provider + listing owned by a throwaway account. */
async function freshProviderListing(key, overrides = {}) {
  const acct = await freshAccount(key, { accountType: "college_university", wantsProvider: true, orgName: `E2E Institute ${RUN_TAG}` });
  const body = {
    title: `E2E Test Camera Kit ${RUN_TAG}-${key}`, category: "cameras-photography",
    description: "Throwaway listing created by the automated verification harness so the full rental lifecycle can be exercised end to end.",
    condition: "excellent", quantity_total: 1, quantity_active: 0, internal_usage_hours_month: 0,
    location_city: "Chennai", location_state: "Tamil Nadu", price_hourly: 200, price_daily: 1200, price_weekly: 6000,
    deposit: 3000, eligibility: "Open to all verified account types", training_required: false, supervision_required: false,
    usage_rules: "Return in the supplied case.", cancellation_policy: "48 hours notice for a full refund of the rental fee.",
    min_hours: 1, max_days: 14, status: "active", capabilities: ["photography", "recording"], images: ["/img/camera.svg"],
    blocked_dates: [], approval_mode: "manual", booking_limit_days: 20, ...overrides,
  };
  const created = await req("/api/resources/create", { method: "POST", cookie: acct.cookie(), body });
  if (created.status !== 200) throw new Error(`listing create failed: ${created.status} ${created.text.slice(0, 200)}`);
  const id = created.json?.resourceId ?? created.json?.id;
  if (!id) throw new Error(`listing create returned no id: ${created.text.slice(0, 200)}`);
  return { acct, resourceId: id, ...dbQuery(`SELECT * FROM resources WHERE id=${id}`)[0] };
}

async function checkBookingLifecycle() {
  section("6. Booking lifecycle (request → approve → pay → handover → return → completed)");
  const target = await freshProviderListing("lifecycle-provider");
  const provEmail = target.acct.email;                 // owns the listing & provider row
  const buyerAcct = await freshAccount("lifecycle-buyer", { accountType: "college_university", orgName: "E2E College" });
  const buyerEmail = buyerAcct.email;
  const resource = target;
  record(Boolean(resource?.id), "Fresh provider listing created for the lifecycle run", `resource ${resource?.id} owned by ${provEmail}`);

  const book = (email, body) => req("/api/bookings", { method: "POST", cookie: cookieFor(email), body });
  const act = (email, id, body) => req(`/api/bookings/${id}/actions`, { method: "POST", cookie: cookieFor(email), body });

  const start = addDays(today(), 21);
  const end = addDays(today(), 24);

  const create = await book(buyerEmail, { resourceId: resource.id, start, end, units: 1, basis: "daily", purpose: "E2E automated lifecycle verification" });
  record(create.status === 200, "Buyer can request a booking", create.json?.message ?? JSON.stringify(create.json).slice(0, 140));
  const bookingId = create.json?.bookingId ?? create.json?.id;
  record(Boolean(bookingId), "Booking id returned", String(bookingId));
  if (!bookingId) return;

  const priority = dbQuery(`SELECT priority_score, priority_reason, status, total, deposit, fees FROM bookings WHERE id=${bookingId}`)[0] ?? {};
  record(priority.status === "pending", "New booking starts pending", priority.status);
  record(Number(priority.priority_score) > 0 && Boolean(priority.priority_reason), "Priority score + human-readable reason stored", `${priority.priority_score} — ${String(priority.priority_reason).slice(0, 60)}…`);

  // Double booking: the listing has exactly one unit, so a second claim must fail.
  const other = await freshAccount("clash-buyer", { accountType: "company", orgName: "E2E Clash Co" });
  const clash = await book(other.email, { resourceId: resource.id, start, end, units: 1, basis: "daily" });
  record([403, 409].includes(clash.status), "Overlapping request beyond capacity refused", `status ${clash.status}: ${clash.json?.error ?? ""}`);

  const provider = await login(provEmail, "TestPass@2026");
  record(provider.ok, "Provider logs in", provEmail);

  // Rejection path on a throwaway request first.
  const throwaway = await book(buyerEmail, { resourceId: resource.id, start: addDays(today(), 40), end: addDays(today(), 42), units: 1, basis: "daily" });
  const tId = throwaway.json?.bookingId;
  if (tId) {
    const noReason = await act(provEmail, tId, { action: "reject", reason: "x" });
    record(noReason.status === 422, "Rejection without a real reason is refused", `status ${noReason.status}`);
    const rej = await act(provEmail, tId, { action: "reject", reason: "Equipment reserved for internal maintenance that week." });
    record(rej.status === 200, "Provider rejects with a reason", rej.json?.message ?? `status ${rej.status}`);
    const rb = dbQuery(`SELECT status, provider_note FROM bookings WHERE id=${tId}`)[0] ?? {};
    record(rb.status === "rejected" && Boolean(rb.provider_note), "Rejection stored with reason", String(rb.provider_note ?? "").slice(0, 50));
  }

  // Main path.
  const approve = await act(provEmail, bookingId, { action: "approve" });
  record(approve.status === 200, "Provider approves the booking", approve.json?.message ?? `status ${approve.status}`);

  const payMode = await req("/api/payments", { cookie: cookieFor(buyerEmail) });
  record(payMode.status === 200, "Payment mode disclosed to the client", `mode=${payMode.json?.mode} (${payMode.json?.label})`);
  record(payMode.json?.mode === "demo" || payMode.json?.mode === "razorpay_test", "Payment mode is explicitly labelled", String(payMode.json?.label).slice(0, 70));
  const pay = await req("/api/payments", { method: "POST", cookie: cookieFor(buyerEmail), body: { action: "confirm", bookingId } });
  record(pay.status === 200, "Buyer completes payment", `${pay.json?.message ?? pay.json?.error}`);
  const paidRow = (dbQuery(`SELECT status FROM bookings WHERE id=${bookingId}`)[0] ?? {}).status;
  record(["paid", "ready_for_handover"].includes(paidRow), "Booking moves to paid", paidRow);
  const payRows = dbQuery(`SELECT kind, status, mode FROM payments WHERE booking_id=${bookingId}`);
  record(payRows.length > 0, "Payment record persisted (with its mode)", payRows.map((p) => `${p.kind}/${p.status}/${p.mode}`).join(", "));

  const ready = await act(provEmail, bookingId, { action: "provider_ready", initial_condition: "good", checklist: ["All accessories present", "Powered on and tested", "No visible damage"], photos: ["/img/lab.svg"], note: "Collected at the front desk." });
  record(ready.status === 200, "Provider records handover condition + photos", ready.json?.message ?? `status ${ready.status}`);
  const confirm = await act(buyerEmail, bookingId, { action: "buyer_confirm", accepted: true, note: "Received in good condition." });
  record(confirm.status === 200, "Buyer confirms collection", confirm.json?.message ?? `status ${confirm.status}`);
  const activeRow = (dbQuery(`SELECT status FROM bookings WHERE id=${bookingId}`)[0] ?? {}).status;
  record(activeRow === "active", "Booking is now active", activeRow);

  const tooShort = await act(buyerEmail, bookingId, { action: "request_extension", end, note: "same day" });
  record(tooShort.status === 422, "Extension to the same end date is refused", `status ${tooShort.status}`);
  const ext = await act(buyerEmail, bookingId, { action: "request_extension", end: addDays(end, 2), note: "Shoot runs a day longer than planned." });
  record(ext.status === 200, "Buyer requests an extension", ext.json?.message ?? `status ${ext.status}`);
  const extId = dbQuery(`SELECT id FROM extensions WHERE booking_id=${bookingId} ORDER BY id DESC LIMIT 1`)[0]?.id;
  if (extId) {
    const dec = await act(provEmail, bookingId, { action: "decide_extension", extensionId: extId, approve: true, note: "Approved, next slot is free." });
    record(dec.status === 200, "Provider approves the extension", dec.json?.message ?? `status ${dec.status}`);
    const extRow = dbQuery(`SELECT status, extra_cost, extra_days FROM extensions WHERE id=${extId}`)[0] ?? {};
    record(extRow.status === "approved", "Extension approved & extra cost recorded", `${extRow.extra_days} extra day(s), ₹${extRow.extra_cost}`);
    record(Number(extRow.extra_days) === 2 && Number(extRow.extra_cost) === 2400, "Extension charge = daily rate × extra days", `${extRow.extra_days} × ₹1200 = ₹${extRow.extra_cost}`);
    const extended = dbQuery(`SELECT end_date, days FROM bookings WHERE id=${bookingId}`)[0] ?? {};
    record(extended.end_date === addDays(end, 2), "Booking end date extended", `${extended.end_date} (${extended.days} days)`);
  }

  const ret = await act(buyerEmail, bookingId, { action: "request_return", photos: ["/img/lab.svg"], note: "Returned to reception.", condition: "good" });
  record(ret.status === 200, "Buyer requests return with photos", ret.json?.message ?? `status ${ret.status}`);
  const inspect = await act(provEmail, bookingId, { action: "confirm_return", accept: true, condition: "good", checklist: ["All accessories present", "No new damage"], photos: ["/img/lab.svg"], note: "Inspected, fine." });
  record(inspect.status === 200, "Provider inspects and confirms return", inspect.json?.message ?? `status ${inspect.status}`);
  const doneRow = (dbQuery(`SELECT status FROM bookings WHERE id=${bookingId}`)[0] ?? {}).status;
  record(doneRow === "completed", "Booking completed", doneRow);
  const dep = dbQuery(`SELECT status, released_amount FROM deposits WHERE booking_id=${bookingId}`)[0] ?? {};
  record(dep.status === "released", "Deposit released on successful return", `${dep.status} / ₹${dep.released_amount}`);

  const review = await req("/api/reviews", { method: "POST", cookie: cookieFor(buyerEmail), body: { bookingId, rating: 5, body: "Automated test review — equipment was exactly as described.", condition_accuracy: 5 } });
  record(review.status === 200, "Buyer can review a completed booking", review.json?.message ?? `status ${review.status}`);
  const dup = await req("/api/reviews", { method: "POST", cookie: cookieFor(buyerEmail), body: { bookingId, rating: 4 } });
  record(dup.status === 409, "Duplicate review is refused", `status ${dup.status}`);

  return { bookingId, provEmail, buyerEmail, resourceId: resource.id };
}

/* ----------------------------------------------- 7. counteroffer + waiting */
async function checkAlternatePaths() {
  section("7. Counteroffer, waiting list, fair-use");
  const target = await freshProviderListing("counter-provider", { quantity_total: 1, booking_limit_days: 10 });
  const provEmail = target.acct.email;
  const buyerAcct = await freshAccount("counter-buyer", { accountType: "company", orgName: "E2E Company" });
  const buyerEmail = buyerAcct.email;
  const book = (email, body) => req("/api/bookings", { method: "POST", cookie: cookieFor(email), body });
  const act = (email, id, body) => req(`/api/bookings/${id}/actions`, { method: "POST", cookie: cookieFor(email), body });

  const start = addDays(today(), 60);
  const end = addDays(today(), 62);
  const created = await book(buyerEmail, { resourceId: target.id, start, end, units: 1, basis: "daily", purpose: "Counteroffer verification" });
  record(created.status === 200, "Booking request created for the counteroffer test", created.json?.message ?? JSON.stringify(created.json).slice(0, 120));
  const bid = created.json?.bookingId;
  if (!bid) return;

  await login(provEmail, "TestPass@2026");
  const newStart = addDays(today(), 65);
  const newEnd = addDays(today(), 67);
  const counter = await act(provEmail, bid, { action: "counter", start: newStart, end: newEnd, note: "Those dates clash with a scheduled workshop." });
  record(counter.status === 200, "Provider proposes a counteroffer", counter.json?.message ?? `status ${counter.status}`);
  const co = dbQuery(`SELECT status, counter_start, counter_end FROM bookings WHERE id=${bid}`)[0] ?? {};
  record(co.status === "counteroffered" && co.counter_start === newStart, "Counteroffer dates stored", `${co.counter_start} → ${co.counter_end}`);

  const accept = await act(buyerEmail, bid, { action: "counter_accept" });
  record(accept.status === 200, "Buyer accepts the counteroffer", accept.json?.message ?? `status ${accept.status}`);
  const acc = dbQuery(`SELECT status, start_date, end_date FROM bookings WHERE id=${bid}`)[0] ?? {};
  record(acc.status === "approved" && acc.start_date === newStart, "Accepted counteroffer re-dates and approves the booking", `${acc.start_date} → ${acc.end_date} (${acc.status})`);

  // Fair-use cap: ask for far more days than the provider allows per buyer.
  const tooLong = await book(buyerEmail, { resourceId: target.id, start: addDays(today(), 90), end: addDays(today(), 90 + Number(target.booking_limit_days) + 5), units: 1, basis: "daily" });
  record([409, 422].includes(tooLong.status), "Request beyond the max duration is refused", `status ${tooLong.status}: ${tooLong.json?.error ?? ""}`);

  // Waiting list: a fresh listing whose only unit is already approved.
  const wl = await freshProviderListing("waiting-provider", { quantity_total: 1 });
  const wlProviderEmail = wl.acct.email;
  const wlStart = addDays(today(), 30);
  const holder = await freshAccount("waiting-holder", { accountType: "individual" });
  const held = await book(holder.email, { resourceId: wl.id, start: wlStart, end: wlStart, units: 1, basis: "daily" });
  record(held.status === 200, "First buyer books the single unit", held.json?.message ?? `status ${held.status}`);
  if (held.json?.bookingId) {
    await login(wlProviderEmail, "TestPass@2026");
    await act(wlProviderEmail, held.json.bookingId, { action: "approve" });
  }
  const late = await freshAccount("waiting-late", { accountType: "individual" });
  const blocked = await book(late.email, { resourceId: wl.id, start: wlStart, end: wlStart, units: 1, basis: "daily", joinWaitingList: true });
  record(blocked.status === 200 && blocked.json?.waitingListed, "Second buyer is offered the waiting list", JSON.stringify(blocked.json).slice(0, 120));
  const wlRows = dbQuery(`SELECT COUNT(*) AS c FROM waiting_list WHERE resource_id=${wl.id}`);
  record(wlRows[0].c > 0, "Waiting-list entry persisted", `${wlRows[0].c} entries`);
  const seen = await req("/api/waiting-list", { cookie: cookieFor(late.email) });
  record(seen.status === 200 && (seen.json?.items ?? []).length > 0, "Buyer can see their waiting-list position", `${seen.json?.items?.length ?? 0} entries`);
}

/* --------------------------------------------------- 8. disputes & admins */
async function checkDisputes() {
  section("8. Damage reports, disputes & admin decisions");
  await login("admin@rentlink.demo");

  const seed = dbQuery(`SELECT d.id, d.booking_id, d.status, d.claim_amount FROM disputes d
     WHERE d.status IN ('open','under_review','evidence_requested') ORDER BY d.id LIMIT 1`)[0];
  record(Boolean(seed), "An open dispute is waiting in the admin queue", seed ? `dispute #${seed.id} (${seed.status})` : "none");

  // ---- End-to-end damage flow on fresh, disposable data -------------------
  // 1. a provider rents out a listing, 2. the rental completes, 3. the provider
  // reports damage, 4. an admin decides with an explicit deduction.
  const target = await freshProviderListing("dispute-provider", { deposit: 4000 });
  const provEmail = target.acct.email;
  const buyerAcct = await freshAccount("dispute-buyer", { accountType: "individual" });
  const buyerEmail = buyerAcct.email;
  const book = (email, body) => req("/api/bookings", { method: "POST", cookie: cookieFor(email), body });
  const act = (email, id, body) => req(`/api/bookings/${id}/actions`, { method: "POST", cookie: cookieFor(email), body });

  async function completeARental(startOffset) {
    const s0 = addDays(today(), startOffset);
    const s1 = addDays(today(), startOffset + 2);
    const created = await book(buyerEmail, { resourceId: target.id, start: s0, end: s1, units: 1, basis: "daily", purpose: "Dispute flow test" });
    if (created.status !== 200) return null;
    const id = created.json.bookingId;
    await act(provEmail, id, { action: "approve" });
    await req("/api/payments", { method: "POST", cookie: cookieFor(buyerEmail), body: { action: "confirm", bookingId: id } });
    await act(provEmail, id, { action: "provider_ready", initial_condition: "excellent", checklist: ["All accessories present"], photos: ["/img/camera.svg"] });
    await act(buyerEmail, id, { action: "buyer_confirm", accepted: true });
    await act(buyerEmail, id, { action: "request_return", photos: ["/img/camera.svg"], condition: "good", note: "Returned." });
    await act(provEmail, id, { action: "confirm_return", accept: true, condition: "fair", checklist: ["Scratch noted"], photos: ["/img/camera.svg"], note: "Scratch found on the body." });
    return id;
  }

  const bookingId = await completeARental(50);
  record(Boolean(bookingId), "Rental completed so a damage report can be raised", `booking ${bookingId}`);
  if (bookingId) {
    const noEvidence = await req("/api/disputes", { method: "POST", cookie: cookieFor(provEmail), body: { bookingId, kind: "damage", claim_amount: 500, description: "Attempt with no evidence attached at all.", evidence: [] } });
    record([400, 422].includes(noEvidence.status), "Dispute without evidence is refused", `status ${noEvidence.status}`);

    const raised = await req("/api/disputes", { method: "POST", cookie: cookieFor(provEmail), body: {
      bookingId, kind: "damage", claim_amount: 1000,
      description: "Automated test: the camera body has a visible scratch that was not present at handover. Photo attached.",
      evidence: ["/img/camera.svg"],
    } });
    record(raised.status === 200, "Provider raises a damage report with evidence", raised.json?.message ?? JSON.stringify(raised.json).slice(0, 120));
    const disputeId = raised.json?.disputeId;

    const dep0 = dbQuery(`SELECT status, released_amount, deducted_amount FROM deposits WHERE booking_id=${bookingId}`)[0] ?? {};
    record(dep0.status === "disputed" && Number(dep0.deducted_amount ?? 0) === 0, "Deposit is frozen but NOT deducted when the dispute opens", JSON.stringify(dep0));

    const thread = await req(`/api/disputes/${disputeId}`, { method: "POST", cookie: cookieFor("admin@rentlink.demo"), body: { body: "Admin note: reviewing the evidence now.", attachments: [] } });
    record(thread.status === 200, "Admin can post into the dispute thread", thread.json?.message ?? `status ${thread.status}`);

    const noNote = await req("/api/admin/disputes", { method: "POST", cookie: cookieFor("admin@rentlink.demo"), body: { disputeId, decision: "resolved", decision_note: "", deduction_amount: 100 } });
    record([400, 422].includes(noNote.status), "A dispute decision without a note is refused", `status ${noNote.status}`);

    const tooMuch = await req("/api/admin/disputes", { method: "POST", cookie: cookieFor("admin@rentlink.demo"), body: { disputeId, decision: "resolved", decision_note: "Attempt to over-deduct beyond the claimed amount.", deduction_amount: 999999 } });
    record([400, 409, 422].includes(tooMuch.status), "Deduction above the claim is refused", `status ${tooMuch.status}`);

    const dec = await req("/api/admin/disputes", { method: "POST", cookie: cookieFor("admin@rentlink.demo"), body: { disputeId, decision: "resolved", decision_note: "Evidence supports a partial deduction for the scratch and servicing.", deduction_amount: 250 } });
    record(dec.status === 200, "Admin records a dispute decision", dec.json?.message ?? JSON.stringify(dec.json).slice(0, 120));

    const row = dbQuery(`SELECT status, deduction_amount, decided_by FROM disputes WHERE id=${disputeId}`)[0] ?? {};
    record(row.status === "resolved" && Number(row.deduction_amount) === 250, "Decision + deduction persisted on the dispute", `${row.status} / ₹${row.deduction_amount}`);

    const dep1 = dbQuery(`SELECT status, amount, released_amount, deducted_amount FROM deposits WHERE booking_id=${bookingId}`)[0] ?? {};
    record(
      dep1.status === "partially_released" && Number(dep1.deducted_amount) === 250 && Number(dep1.released_amount) === Number(dep1.amount) - 250,
      "Deposit reflects only the explicitly ordered deduction",
      `₹${dep1.amount} → released ₹${dep1.released_amount}, deducted ₹${dep1.deducted_amount} (${dep1.status})`
    );
    const depAudit = dbQuery(`SELECT COUNT(*) AS c FROM audit_logs WHERE action LIKE 'admin.dispute_%'`)[0].c;
    record(depAudit > 0, "The admin decision is in the audit log", `${depAudit} entries`);
  }

  // ---- A second dispute that the admin rejects: full release, no deduction ----
  const bookingId2 = await completeARental(60);
  if (bookingId2) {
    const raised2 = await req("/api/disputes", { method: "POST", cookie: cookieFor(provEmail), body: {
      bookingId: bookingId2, kind: "late_return", claim_amount: 600,
      description: "Automated test: equipment came back a day late; claiming a late-return charge.", evidence: ["/img/camera.svg"],
    } });
    const d2 = raised2.json?.disputeId;
    record(raised2.status === 200 && Boolean(d2), "A second dispute can be raised", `dispute ${d2}`);
    if (d2) {
      const rej = await req("/api/admin/disputes", { method: "POST", cookie: cookieFor("admin@rentlink.demo"), body: { disputeId: d2, decision: "rejected", decision_note: "Handover log shows the return was within the agreed window.", deduction_amount: 0 } });
      record(rej.status === 200, "Admin can reject a claim", rej.json?.message ?? `status ${rej.status}`);
      const dep2 = dbQuery(`SELECT status, released_amount, deducted_amount FROM deposits WHERE booking_id=${bookingId2}`)[0] ?? {};
      record(dep2.status === "released" && Number(dep2.deducted_amount) === 0, "A rejected claim releases the deposit in full", JSON.stringify(dep2));
    }
  }

  // ---- Reports queue + moderation -----------------------------------------
  await login("buyer@student.demo");
  const anyRes = dbQuery(`SELECT id FROM resources WHERE status='active' LIMIT 1`)[0];
  const rep = await req("/api/reports", { method: "POST", cookie: cookieFor("buyer@student.demo"), body: { resourceId: anyRes.id, reason: "misleading", detail: "Automated test: photos look out of date." } });
  record(rep.status === 200, "Buyer can report a listing", rep.json?.message ?? `status ${rep.status}`);
  const openReports = dbQuery(`SELECT COUNT(*) AS c FROM reports WHERE status='open'`)[0].c;
  record(openReports > 0, "The report lands in the admin queue", `${openReports} open`);

  const mod = await req("/api/admin/resources", { method: "POST", cookie: cookieFor("admin@rentlink.demo"), body: { resourceId: anyRes.id, action: "pause", note: "Automated moderation test" } });
  record(mod.status === 200, "Admin can pause a listing", mod.json?.message ?? `status ${mod.status}`);
  await req("/api/admin/resources", { method: "POST", cookie: cookieFor("admin@rentlink.demo"), body: { resourceId: anyRes.id, action: "activate", note: "restore after test" } });

  const auditCount = dbQuery(`SELECT COUNT(*) AS c FROM audit_logs`)[0].c;
  record(auditCount > 20, "Audit log populated by the run", `${auditCount} entries`);
}

/* ----------------------------------------- 9. analytics / utilisation / impact */
async function checkAnalytics() {
  section("9. Utilisation, underused detection & impact");
  await login("provider@anna.demo");
  const util = await req("/api/analytics/utilisation", { cookie: cookieFor("provider@anna.demo") });
  record(util.status === 200, "Utilisation endpoint responds", `status ${util.status}`);
  const items = util.json?.items ?? [];
  record(items.length > 0, "Utilisation computed per listing", `${items.length} listings`);
  const labelled = items.every((i) => typeof i.classification === "string" && typeof i.utilisation_pct === "number");
  record(labelled, "Each listing classified (frequently_used / underused / no_recent_bookings)", items.map((i) => i.classification).slice(0, 4).join(", "));

  const utilPage = await req("/provider/utilisation", { cookie: cookieFor("provider@anna.demo") });
  record(utilPage.status === 200 && /estimate/i.test(utilPage.text), "Utilisation page labels estimates rather than promising availability", `${utilPage.text.length} bytes`);

  const imp = await req("/api/analytics/impact", { cookie: cookieFor("provider@anna.demo") });
  record(imp.status === 200, "Impact endpoint responds", `status ${imp.status}`);
  record(Boolean(imp.json?.verified) && Boolean(imp.json?.estimated), "Impact splits verified vs estimated metrics", Object.keys(imp.json?.verified ?? {}).join(", "));
  record(Boolean(imp.json?.dataProvenance?.statement), "Impact discloses data provenance", String(imp.json?.dataProvenance?.statement).slice(0, 80));
  record(Boolean(imp.json?.estimated?.formula), "Impact publishes the formula behind its estimates", Object.keys(imp.json?.estimated?.formula ?? {}).join(", "));

  const filtered = await req(`/api/analytics/impact?from=${addDays(today(), -365)}&to=${today()}`, { cookie: cookieFor("provider@anna.demo") });
  record(filtered.status === 200, "Impact accepts date filters", `status ${filtered.status}`);
  const impactPage = await req("/impact?from=2024-01-01&to=2030-01-01");
  record(impactPage.status === 200, "Impact dashboard page renders with filters", `${impactPage.text.length} bytes`);
}

/* ------------------------------------------------------------- 10. pages */
async function checkAllPages() {
  section("10. Every page in the spec is reachable");
  const admin = await login("admin@rentlink.demo");
  const prov = await login("provider@anna.demo");
  const buyer = await login("buyer@student.demo");
  const booking = dbQuery(`SELECT id FROM bookings WHERE buyer_id=(SELECT id FROM users WHERE email='buyer@student.demo') ORDER BY id LIMIT 1`)[0];
  const dispute = dbQuery(`SELECT id FROM disputes ORDER BY id LIMIT 1`)[0];
  const resource = dbQuery(`SELECT id FROM resources ORDER BY id LIMIT 1`)[0];

  const pages = [
    ["/", null], ["/login", null], ["/register", null], ["/marketplace", null], ["/marketplace?category=cameras", null],
    [`/resources/${resource.id}`, null], [`/resources/${resource.id}/passport`, null], ["/compare?ids=1,2", null],
    ["/storefront/anna-institute-of-technology", null], ["/storefront/bharat-media-university", null],
    ["/impact", null], ["/recommend", null], ["/viewer", null], ["/help", null], ["/verification-report", null],
    ["/dashboard", buyer.jar], ["/bookings", buyer.jar], [`/bookings/${booking?.id}`, buyer.jar],
    ["/favourites", buyer.jar], ["/notifications", buyer.jar], ["/disputes", buyer.jar],
    [`/disputes/${dispute?.id}`, buyer.jar], ["/settings", buyer.jar], ["/onboarding", buyer.jar],
    ["/provider", prov.jar], ["/provider/bookings", prov.jar], ["/provider/resources", prov.jar],
    [`/provider/resources/${resource.id}`, prov.jar], ["/provider/new", prov.jar],
    ["/provider/utilisation", prov.jar], ["/provider/verification", prov.jar],
    ["/admin", admin.jar], ["/admin/verifications", admin.jar], ["/admin/disputes", admin.jar],
    ["/admin/resources", admin.jar], ["/admin/users", admin.jar], ["/admin/audit", admin.jar],
  ];

  for (const [path, j] of pages) {
    let r;
    try { r = await req(path, { cookie: j?.header() }); } catch (e) { record(false, `GET ${path}`, String(e.cause?.code ?? e.message)); continue; }
    const okStatus = r.status === 200 || (j === null && [307, 302].includes(r.status));
    const looksBroken = /Application error: a server-side exception|Internal Server Error/.test(r.text);
    record(okStatus && !looksBroken, `GET ${path}`, `${r.status} · ${r.text.length}b`);
  }

  const missing = await req("/definitely-not-a-page");
  record(missing.status === 404, "Unknown routes return 404", `status ${missing.status}`);
}

/* -------------------------------------------------------- 11. anti-abuse */
async function checkSecurityExtras() {
  section("11. Validation, rate limiting & safe errors");
  await login("buyer@student.demo");

  const fixtureDenied = await req("/api/dev/fixture-account", { method: "POST", body: { full_name: "x", email: "nope@example.test", password: "short" } });
  record([404, 422].includes(fixtureDenied.status), "Fixture endpoint validates input (never creates a junk account)", `status ${fixtureDenied.status}`);

  const badBody = await req("/api/bookings", { method: "POST", cookie: cookieFor("buyer@student.demo"), body: { resourceId: "not-a-number", start: "yesterday" } });
  record([400, 422].includes(badBody.status), "Invalid input rejected by zod validation", `status ${badBody.status}`);
  record(!/at Object\.|node_modules|\/home\/user/.test(badBody.text), "Errors don't leak stack traces", badBody.json?.error?.slice(0, 80));

  await login("provider@anna.demo");
  const own = dbQuery(`SELECT r.id FROM resources r JOIN provider_profiles p ON p.id=r.provider_id WHERE p.storefront_slug='anna-institute-of-technology' LIMIT 1`)[0];
  if (own) {
    const r = await req("/api/bookings", { method: "POST", cookie: cookieFor("provider@anna.demo"), body: { resourceId: own.id, start: addDays(today(), 200), end: addDays(today(), 201), units: 1, basis: "daily" } });
    record([403, 409].includes(r.status), "Cannot book your own listing", `status ${r.status}`);
  }

  const upload = await req("/api/uploads", { method: "POST", cookie: cookieFor("buyer@student.demo"), body: {}, raw: (() => { const fd = new FormData(); fd.set("kind", "image"); fd.set("file", new Blob(["#!/bin/sh\necho hi"], { type: "application/x-sh" }), "evil.sh"); return fd; })() });
  record([400, 415, 422].includes(upload.status), "Upload with a bad file type is rejected", `status ${upload.status}`);

  let limited = false, codes = [];
  for (let i = 0; i < 8; i++) {
    const r = await req("/api/auth/login", { method: "POST", body: { email: `nobody-${Date.now()}-${i}@example.com`, password: "guess-guess" } });
    codes.push(r.status);
    if (r.status === 429) { limited = true; break; }
  }
  record(limited || codes.every((c) => c === 401), "Login attempts are rate-limited or uniformly rejected", codes.join(","));
}

/* --------------------------------------------------------------- 12. 3D */
async function check3D() {
  section("12. 3D & responsive surface");
  const viewer = await req("/viewer");
  record(viewer.status === 200, "Dedicated 3D viewer page renders", `${viewer.text.length} bytes`);
  const detail = await req(`/resources/${dbQuery(`SELECT id FROM resources WHERE model_3d IS NOT NULL LIMIT 1`)[0].id}`);
  record(detail.status === 200, "Listing page with a 3D model renders", `${detail.text.length} bytes`);
  const noModel = dbQuery(`SELECT id FROM resources WHERE model_3d IS NULL LIMIT 1`)[0];
  if (noModel) {
    const r = await req(`/resources/${noModel.id}`);
    record(r.status === 200, "Listing without a model still renders (photo fallback)", `${r.text.length} bytes`);
  }
  record(/three|webgl/i.test(viewer.text), "Viewer page discloses the rendering technology / fallback");
}

/* ------------------------------------------------------------------- run */
async function main() {
  console.log(`\x1b[1mRentLink 3D — end-to-end verification\x1b[0m  ${BASE}\n`);
  if (process.argv.includes("--reset")) {
    // In-place reseed: `--reset` unlinks the database file, which a running server
    // keeps holding via an open handle (WAL), so the server and the harness would
    // end up looking at different files. Seeding truncates every table instead.
    console.log("Reseeding the database in place…");
    execFileSync("node", ["scripts/seed.mjs"], { stdio: "inherit", cwd: process.cwd() });
    execFileSync("node", ["-e", "const D=require('better-sqlite3');const db=new D('data/rentlink.db');db.prepare('DELETE FROM rate_limits').run();"], { cwd: process.cwd() });
  }

  const up = await checkServer();
  if (!up) {
    console.log("\n\x1b[31mServer not reachable — start it with `npm run dev` and retry.\x1b[0m");
    process.exit(1);
  }
  const steps = [
    ["Authentication", () => checkAuth()],
    ["Verification", () => checkVerification()],
    ["Listings", () => checkListings()],
    ["Discovery", () => checkDiscovery()],
    ["Booking lifecycle", () => checkBookingLifecycle()],
    ["Alternate paths", () => checkAlternatePaths()],
    ["Disputes", () => checkDisputes()],
    ["Analytics", () => checkAnalytics()],
    ["Pages", () => checkAllPages()],
    ["Security extras", () => checkSecurityExtras()],
    ["3D", () => check3D()],
  ];
  for (const [label, fn] of steps) {
    try { await fn(); }
    catch (e) { record(false, `Section "${label}" completed without crashing`, String(e.cause?.code ?? e.message).slice(0, 120)); }
  }

  const total = PASS.length + FAIL.length;
  console.log(`\n\x1b[1mSummary\x1b[0m  ${PASS.length}/${total} passed, ${FAIL.length} failed, ${SKIP.length} skipped`);
  if (FAIL.length) {
    console.log("\n\x1b[31mFailures:\x1b[0m");
    for (const f of FAIL) console.log(`  • [${f.section}] ${f.label}${f.detail ? ` — ${f.detail}` : ""}`);
  }
  if (SKIP.length) {
    console.log("\n\x1b[33mSkipped:\x1b[0m");
    for (const s of SKIP) console.log(`  • [${s.section}] ${s.label} — ${s.detail}`);
  }
  process.exit(FAIL.length ? 1 : 0);
}

main().catch((e) => {
  console.error("\nHarness crashed:", e);
  process.exit(2);
});
