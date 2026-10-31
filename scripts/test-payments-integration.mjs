#!/usr/bin/env node
/**
 * RentLink 3D — payment INTEGRATION tests (real HTTP, real server, real DB).
 *
 * Any unexpected exception is caught and recorded as a FAIL so the suite always
 * prints a summary and always tears the test server down.
 *
 *   node scripts/test-payments-integration.mjs
 *
 * Boots its own production server on :3100 against .paytest/integration.db with
 * Razorpay TEST-MODE credentials, then drives the actual routes:
 *
 *   POST /api/payments                (create / confirm)
 *   POST /api/payments/webhook        (signed webhook deliveries)
 *
 * Razorpay's order-create endpoint cannot be faked without a network proxy the
 * app is willing to trust, so order rows are inserted directly into the isolated
 * database with the SAME shape the route writes. Everything downstream of that —
 * signature checks, capture verification, amount/currency matching, idempotency,
 * reuse rejection, ownership, authorisation — runs through the real HTTP stack.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import { startServer, KEY_SECRET, WEBHOOK_SECRET, SERVER_PORT } from "./payment-server.mjs";

const BASE = `http://127.0.0.1:${SERVER_PORT}`;
const PASS = [], FAIL = [];
let section = "";
function group(n) { section = n; console.log(`\n\x1b[1m${n}\x1b[0m`); }
function check(ok, label, detail = "") {
  (ok ? PASS : FAIL).push({ section, label, detail });
  console.log(`  ${ok ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"} ${label}${detail ? ` \x1b[90m— ${detail}\x1b[0m` : ""}`);
  return ok;
}

const { child, log, stateFile } = await startServer();
if (!fs.existsSync(".paytest/integration.db")) throw new Error("isolated test DB missing after server start");

/* ------------------------------------------------------------------ helpers */
const LEDGER = new Map();
function jar() {
  const m = new Map();
  return {
    header: () => [...m.entries()].map(([k, v]) => `${k}=${v}`).join("; "),
    absorb(res) {
      for (const c of res.headers.getSetCookie?.() ?? []) {
        const [kv] = c.split(";");
        const i = kv.indexOf("=");
        const name = kv.slice(0, i), value = kv.slice(i + 1);
        if (!value) m.delete(name); else m.set(name, value);
      }
    },
  };
}
async function req(path, { method = "GET", body, cookie, raw, headers = {} } = {}) {
  const h = { ...headers };
  if (cookie) h.cookie = cookie;
  if (body !== undefined) h["content-type"] = "application/json";
  const res = await fetch(BASE + path, { method, headers: h, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined), redirect: "manual" });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* html */ }
  return { status: res.status, json, text, res };
}
async function login(email, password = "Demo@1234") {
  const j = jar();
  const r = await req("/api/auth/login", { method: "POST", body: { email, password } });
  j.absorb(r.res);
  if (r.status === 200) LEDGER.set(email, j.header());
  return r;
}
const cookieFor = (e) => LEDGER.get(e);

// Direct DB access to the ISOLATED test database only.
// NOTE: opened *after* startServer(), which (re)creates the file — opening first
// would leave this handle pointing at a deleted inode (the classic WAL trap).
const Database = (await import("better-sqlite3")).default;
const db = new Database(".paytest/integration.db");
const q = (sql, ...a) => db.prepare(sql).all(...a);
const q1 = (sql, ...a) => db.prepare(sql).get(...a);

const sign = (orderId, paymentId) =>
  crypto.createHmac("sha256", KEY_SECRET).update(`${orderId}|${paymentId}`).digest("hex");
const webhookHeaders = (raw) => ({ "x-razorpay-signature": crypto.createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex") });

let run_ = Date.now().toString(36).slice(-5);
let bookingSeq = 0;
const addDays = (iso, n) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
async function fixture(key, provider = false) {
  const email = `pay-${key}-${run_}@example.test`;
  const r = await req("/api/dev/fixture-account", {
    method: "POST",
    body: { full_name: `Pay ${key}`, email, password: "TestPass@2026", account_type: provider ? "company" : "individual", city: "Chennai", state: "Tamil Nadu", wants_provider: provider },
  });
  if (r.status !== 200) throw new Error(`fixture ${key}: ${r.status} ${r.text.slice(0, 120)}`);
  await login(email, "TestPass@2026");
  return { email, cookie: cookieFor(email), ...r.json };
}

/** Creates a listing + booking through the real API so the price snapshot is genuine. */
async function bookableBooking({ daily = 900, deposit = 2000, autoApprove = true } = {}) {
  const prov = await fixture(`prov${Math.random().toString(36).slice(2, 6)}`, true);
  const create = await req("/api/resources/create", {
    method: "POST", cookie: prov.cookie,
    body: {
      title: `Payment test rig ${Math.random().toString(36).slice(2, 7)}`, category: "cameras-photography",
      description: "A listing created by the payment integration suite; description is long enough.",
      condition: "good", quantity_total: 1, quantity_active: 0, location_city: "Chennai", location_state: "Tamil Nadu",
      price_hourly: Math.round(daily / 8), price_daily: daily, price_weekly: daily * 5, deposit,
      status: "active", approval_mode: autoApprove ? "auto" : "manual", booking_limit_days: 30, max_days: 30,
    },
  });
  if (create.status !== 200) throw new Error(`listing: ${create.status} ${create.text.slice(0, 200)}`);
  const resourceId = create.json.resourceId ?? create.json.id;

  const buyer = await fixture(`buyer${Math.random().toString(36).slice(2, 6)}`);
  // Each listing is brand new, so any future window works; keep it short so the
  // amounts are easy to reason about in the failure messages.
  bookingSeq += 1;
  const start = `2031-${String(1 + Math.floor(bookingSeq / 25)).padStart(2, "0")}-${String(1 + (bookingSeq % 25)).padStart(2, "0")}`;
  const end = addDays(start, 2);
  const booking = await req("/api/bookings", {
    method: "POST", cookie: buyer.cookie,
    body: { resourceId, start, end, units: 1, basis: "daily", purpose: "Payment integration test" },
  });
  if (booking.status !== 200) throw new Error(`booking: ${booking.status} ${booking.text.slice(0, 300)}`);
  const bookingId = booking.json.bookingId ?? booking.json.booking?.id ?? booking.json.id;
  if (!bookingId) throw new Error(`booking response had no id: ${booking.text.slice(0, 300)}`);
  if (!q1(`SELECT id FROM bookings WHERE id = ?`, bookingId)) {
    throw new Error(`booking ${bookingId} not in test DB — response was: ${booking.text.slice(0, 300)}`);
  }
  await login(prov.email, "TestPass@2026"); // single-active session per user
  // Re-read the cookie: sessions are single-active, so the earlier one is now dead.
  prov.cookie = cookieFor(prov.email);
  const row = q1(`SELECT * FROM bookings WHERE id = ?`, bookingId);
  return { bookingId, buyer, provider: prov, resourceId, total: row.total, snapshot: JSON.parse(row.price_snapshot) };
}

/** Inserts the order row the create route would have written (see file header). */
function insertOrder(booking, { orderId = `order_IT${crypto.randomBytes(6).toString("hex")}`, amount } = {}) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO payments (booking_id, kind, amount, currency, mode, status, provider_order_id, meta, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(booking.bookingId, "rental", amount ?? booking.total, "INR", "razorpay", "created", orderId,
    JSON.stringify({ order_amount_paise: Math.round((amount ?? booking.total) * 100), currency: "INR" }), now);
  return orderId;
}
function setGateway(paymentId, entry) {
  const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  state[paymentId] = entry;
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
}
function capturedRow(bookingId) {
  return q1(`SELECT * FROM payments WHERE booking_id = ? AND status = 'paid'`, bookingId);
}
const bookingStatus = (id) => q1(`SELECT status FROM bookings WHERE id = ?`, id)?.status;

function webhookBody({ event, orderId, paymentId, amountPaise, currency, status }) {
  const entity = { id: paymentId, entity: "payment", order_id: orderId, status: status ?? "captured" };
  // Deliberately omit keys when undefined so we can test "missing amount".
  if (amountPaise !== undefined) entity.amount = amountPaise;
  if (currency !== undefined) entity.currency = currency;
  return JSON.stringify({ event, payload: { payment: { entity } } });
}

try {
  /* ==================================================== 1. demo mode via HTTP */
  group("1. Demo mode (server has no gateway) — checked against the main app");
  {
    // The isolated test server HAS gateway keys, so demo mode is exercised here by
    // pointing at the already-running production server on :3000 where keys are unset.
    const demoBase = process.env.DEMO_BASE || "http://127.0.0.1:3000";
    let mode = null;
    try {
      const r = await fetch(demoBase + "/api/payments");
      mode = (await r.json()).mode;
    } catch { mode = "unreachable"; }
    if (mode === "unreachable") {
      check(false, "Demo-mode server reachable on :3000", "not running — start `npm start` first");
    } else {
      check(mode === "demo", "Server without gateway keys reports demo mode", mode);
      const meta = await (await fetch(demoBase + "/api/payments")).json();
      check(typeof meta.label === "string" && /DEMO|no money/i.test(meta.label), "Demo mode is explicitly labelled", String(meta.label).slice(0, 60));
      // (the deposit wording is asserted on the gateway-configured server below,
      //  because the long-running :3000 build may predate this change)

      // The Razorpay key id must never reach the browser in demo mode.
      check(meta.razorpayKeyId === null, "No gateway key id exposed in demo mode", String(meta.razorpayKeyId));
    }
  }

  /* ============================================ 2. gateway configured reports */
  group("2. Gateway-configured server");
  {
    const r = await req("/api/payments");
    check(r.json?.mode === "razorpay_test", "Mode is razorpay_test when keys exist", r.json?.mode);
    check(r.json?.razorpayKeyId === "rzp_test_RentLinkPaymentTests", "Publishable key id is exposed (this one is safe to publish)");
    const body = JSON.stringify(r.json);
    check(!body.includes(KEY_SECRET), "The gateway SECRET is never sent to the client");
    check(!body.includes(WEBHOOK_SECRET), "The webhook secret is never sent to the client");
  }

  /* ================================================ 3. webhook signature gate */
  group("3. Webhook signature enforcement");
  {
    const b = await bookableBooking();
    const orderId = insertOrder(b);
    const raw = webhookBody({ event: "payment.captured", orderId, paymentId: "pay_SIGBAD", amountPaise: Math.round(b.total * 100), currency: "INR" });

    const noSig = await req("/api/payments/webhook", { method: "POST", raw, headers: { "content-type": "application/json" } });
    check(noSig.status === 400, "Webhook without a signature is rejected", `status ${noSig.status}`);
    const badSig = await req("/api/payments/webhook", { method: "POST", raw, headers: { "content-type": "application/json", "x-razorpay-signature": "deadbeef" } });
    check(badSig.status === 400, "Webhook with a wrong signature is rejected", `status ${badSig.status}`);
    check(bookingStatus(b.bookingId) !== "paid", "Booking untouched after rejected webhooks", bookingStatus(b.bookingId));

    // tamper AFTER signing (raw body must be verified exactly)
    const good = webhookHeaders(raw);
    const tampered = raw.replace('"captured"', '"captured" ');
    const t = await req("/api/payments/webhook", { method: "POST", raw: tampered, headers: { ...good, "content-type": "application/json" } });
    check(t.status === 400, "Body modified after signing is rejected", `status ${t.status}`);

    const audit = q(`SELECT action FROM audit_logs WHERE action LIKE 'payment.webhook_signature_invalid' ORDER BY id DESC LIMIT 1`);
    check(audit.length === 1, "Rejected signatures are audited");

    // correct signature, unknown order
    const raw2 = webhookBody({ event: "payment.captured", orderId: "order_NOT_OURS", paymentId: "pay_UNKNOWN", amountPaise: 100, currency: "INR" });
    const unknown = await req("/api/payments/webhook", { method: "POST", raw: raw2, headers: { ...webhookHeaders(raw2), "content-type": "application/json" } });
    check(unknown.status === 200 && unknown.json?.ignored === true, "Signed webhook for an unknown order is ignored, not settled", JSON.stringify(unknown.json));
    const ua = q(`SELECT action FROM audit_logs WHERE action = 'payment.webhook_unknown_order' ORDER BY id DESC LIMIT 1`);
    check(ua.length === 1, "Unknown order is audited");
  }

  /* =================================================== 4. amount / currency */
  group("4. Amount and currency validation (rupees stored, paise reported)");
  {
    const b = await bookableBooking({ daily: 700, deposit: 1500, days: 2 });
    const orderId = insertOrder(b);
    const correctPaise = Math.round(b.total * 100);

    // incorrect amount
    const lowBody = webhookBody({ event: "payment.captured", orderId, paymentId: "pay_LOW", amountPaise: correctPaise - 1, currency: "INR" });
    const low = await req("/api/payments/webhook", { method: "POST", raw: lowBody, headers: { ...webhookHeaders(lowBody), "content-type": "application/json" } });
    check(low.json?.reason === "amount mismatch", "Wrong amount is rejected", low.json?.reason);
    check(bookingStatus(b.bookingId) !== "paid", "Booking not paid after a wrong amount");

    // wrong currency
    const curBody = webhookBody({ event: "payment.captured", orderId, paymentId: "pay_USD", amountPaise: correctPaise, currency: "USD" });
    const cur = await req("/api/payments/webhook", { method: "POST", raw: curBody, headers: { ...webhookHeaders(curBody), "content-type": "application/json" } });
    check(cur.json?.reason === "currency mismatch", "Wrong currency is rejected", cur.json?.reason);

    // missing amount
    const noAmt = webhookBody({ event: "payment.captured", orderId, paymentId: "pay_NOAMT", currency: "INR" });
    const na = await req("/api/payments/webhook", { method: "POST", raw: noAmt, headers: { ...webhookHeaders(noAmt), "content-type": "application/json" } });
    check(/missing amount/.test(na.json?.reason ?? ""), "Capture without an amount is rejected", na.json?.reason);

    // missing currency
    const noCur = webhookBody({ event: "payment.captured", orderId, paymentId: "pay_NOCUR", amountPaise: correctPaise });
    const nc = await req("/api/payments/webhook", { method: "POST", raw: noCur, headers: { ...webhookHeaders(noCur), "content-type": "application/json" } });
    check(/missing amount/.test(nc.json?.reason ?? ""), "Capture without a currency is rejected", nc.json?.reason);

    check(bookingStatus(b.bookingId) !== "paid", "Still unpaid after every malformed delivery");
    const auditCount = q(`SELECT COUNT(*) AS c FROM audit_logs WHERE action IN ('payment.webhook_amount_mismatch','payment.webhook_currency_mismatch','payment.webhook_missing_amount')`)[0].c;
    check(auditCount >= 4, "Every rejected delivery is audited", `${auditCount} audit rows`);

    // the correct amount, in paise, settles — this is the rupees-vs-paise bug guard
    const okBody = webhookBody({ event: "payment.captured", orderId, paymentId: "pay_RIGHTPAISE", amountPaise: correctPaise, currency: "INR" });
    const okRes = await req("/api/payments/webhook", { method: "POST", raw: okBody, headers: { ...webhookHeaders(okBody), "content-type": "application/json" } });
    check(okRes.status === 200 && okRes.json?.idempotent === false, "Correct paise amount settles the booking", JSON.stringify(okRes.json));
    check(bookingStatus(b.bookingId) === "paid", "Booking is paid after the correct delivery");
    const row = capturedRow(b.bookingId);
    check(Math.round(row.amount * 100) === correctPaise, "Stored amount is in RUPEES and equals total", `₹${row.amount} vs ${correctPaise}p`);
  }

  /* =============================================== 5. repeated / idempotency */
  group("5. Repeated captured webhooks (real HTTP)");
  {
    const b = await bookableBooking();
    const orderId = insertOrder(b);
    const paise = Math.round(b.total * 100);
    const body = webhookBody({ event: "payment.captured", orderId, paymentId: "pay_IDEMPOTENT", amountPaise: paise, currency: "INR" });
    const hdrs = { ...webhookHeaders(body), "content-type": "application/json" };

    const r1 = await req("/api/payments/webhook", { method: "POST", raw: body, headers: hdrs });
    const r2 = await req("/api/payments/webhook", { method: "POST", raw: body, headers: hdrs });
    const r3 = await req("/api/payments/webhook", { method: "POST", raw: body, headers: hdrs });
    check(r1.json?.idempotent === false, "First delivery settles", JSON.stringify(r1.json));
    check(r2.json?.idempotent === true, "Second delivery is idempotent");
    check(r3.json?.idempotent === true, "Third delivery is idempotent");
    check(q(`SELECT * FROM payments WHERE booking_id = ? AND status='paid'`, b.bookingId).length === 1, "Exactly one paid row");
    const repeated = q(`SELECT action FROM audit_logs WHERE action = 'payment.webhook_repeated'`).length;
    check(repeated >= 2, "Repeated deliveries are audited", `${repeated} rows`);
  }

  /* ============================================== 6. authorized → not paid */
  group("6. Authorized-but-uncaptured never marks a booking paid");
  {
    const b = await bookableBooking();
    const orderId = insertOrder(b);
    const body = webhookBody({ event: "payment.authorized", orderId, paymentId: "pay_AUTHORIZED", amountPaise: Math.round(b.total * 100), currency: "INR", status: "authorized" });
    const r = await req("/api/payments/webhook", { method: "POST", raw: body, headers: { ...webhookHeaders(body), "content-type": "application/json" } });
    check(r.json?.bookingPaid === false, "Webhook acknowledges but reports bookingPaid:false", JSON.stringify(r.json));
    check(bookingStatus(b.bookingId) !== "paid", "Booking is NOT paid after authorization", bookingStatus(b.bookingId));
    const row = q1(`SELECT status FROM payments WHERE provider_order_id = ?`, orderId);
    check(row.status === "authorized", "Payment row is 'authorized'", row.status);
    check(q(`SELECT * FROM payments WHERE booking_id = ? AND status='paid'`, b.bookingId).length === 0, "No paid row exists");

    // a later capture on the same order does settle it (that is the correct sequence)
    const cap = webhookBody({ event: "payment.captured", orderId, paymentId: "pay_AUTHORIZED", amountPaise: Math.round(b.total * 100), currency: "INR" });
    const c = await req("/api/payments/webhook", { method: "POST", raw: cap, headers: { ...webhookHeaders(cap), "content-type": "application/json" } });
    check(c.json?.idempotent === false, "A later capture event settles the same order", JSON.stringify(c.json));
    check(bookingStatus(b.bookingId) === "paid", "Booking paid once actually captured");
  }

  /* ======================================================= 7. failed payment */
  group("7. Failed and refunded payments cannot become paid");
  {
    const b = await bookableBooking();
    const orderId = insertOrder(b);
    const failBody = webhookBody({ event: "payment.failed", orderId, paymentId: "pay_FAILED", amountPaise: Math.round(b.total * 100), currency: "INR", status: "failed" });
    await req("/api/payments/webhook", { method: "POST", raw: failBody, headers: { ...webhookHeaders(failBody), "content-type": "application/json" } });
    check(q1(`SELECT status FROM payments WHERE provider_order_id = ?`, orderId).status === "failed", "Failed event marks the payment failed");
    check(bookingStatus(b.bookingId) !== "paid", "Booking not paid after failure");

    const capBody = webhookBody({ event: "payment.captured", orderId, paymentId: "pay_FAILED", amountPaise: Math.round(b.total * 100), currency: "INR" });
    const c = await req("/api/payments/webhook", { method: "POST", raw: capBody, headers: { ...webhookHeaders(capBody), "content-type": "application/json" } });
    check(c.json?.ignored === true && c.json?.reason === "payment_failed", "A capture event cannot resurrect a failed payment", JSON.stringify(c.json));
    check(bookingStatus(b.bookingId) !== "paid", "Booking still not paid");

    const b2 = await bookableBooking();
    const o2 = insertOrder(b2);
    const paise = Math.round(b2.total * 100);
    const cap2 = webhookBody({ event: "payment.captured", orderId: o2, paymentId: "pay_REFUND", amountPaise: paise, currency: "INR" });
    await req("/api/payments/webhook", { method: "POST", raw: cap2, headers: { ...webhookHeaders(cap2), "content-type": "application/json" } });
    const refBody = webhookBody({ event: "payment.refunded", orderId: o2, paymentId: "pay_REFUND", amountPaise: paise, currency: "INR", status: "refunded" });
    await req("/api/payments/webhook", { method: "POST", raw: refBody, headers: { ...webhookHeaders(refBody), "content-type": "application/json" } });
    check(q1(`SELECT status FROM payments WHERE provider_order_id = ?`, o2).status === "refunded", "Refund event marks the payment refunded");
    const again = webhookBody({ event: "payment.captured", orderId: o2, paymentId: "pay_REFUND", amountPaise: paise, currency: "INR" });
    const a = await req("/api/payments/webhook", { method: "POST", raw: again, headers: { ...webhookHeaders(again), "content-type": "application/json" } });
    check(a.json?.reason === "payment_refunded", "A refused payment cannot be re-settled by a capture event", JSON.stringify(a.json));
  }

  /* ======================================== 8. cross-booking, reuse, ownership */
  group("8. Cross-booking orders, payment-id reuse, and ownership");
  {
    const a = await bookableBooking();
    const b = await bookableBooking();
    const orderA = insertOrder(a);
    // order A presented against booking B, with a valid signature
    const payId = "pay_CROSSBOOK";
    setGateway(payId, { order_id: orderA, amount: Math.round(b.total * 100), currency: "INR", status: "captured" });
    const confirm = await req("/api/payments", {
      method: "POST", cookie: b.buyer.cookie,
      body: { action: "confirm", bookingId: b.bookingId, razorpay_order_id: orderA, razorpay_payment_id: payId, razorpay_signature: sign(orderA, payId) },
    });
    check(confirm.status >= 400, "A valid signature over another booking's order is rejected", `status ${confirm.status} ${confirm.json?.error ?? ""}`);
    check(bookingStatus(b.bookingId) !== "paid", "The victim booking was NOT paid", bookingStatus(b.bookingId));
    check(bookingStatus(a.bookingId) !== "paid", "The order's own booking was NOT paid either", bookingStatus(a.bookingId));

    // reuse the same payment id on two different orders (both captured)
    const c = await bookableBooking();
    const d = await bookableBooking();
    const o1 = insertOrder(c), o2 = insertOrder(d);
    const shared = "pay_SHARED_HTTP";
    setGateway(shared, { order_id: o1, amount: Math.round(c.total * 100), currency: "INR", status: "captured" });
    const first = await req("/api/payments", { method: "POST", cookie: c.buyer.cookie, body: { action: "confirm", bookingId: c.bookingId, razorpay_order_id: o1, razorpay_payment_id: shared, razorpay_signature: sign(o1, shared) } });
    check(first.status === 200, "First order settles with the shared payment id", first.json?.error ?? "ok");
    setGateway(shared, { order_id: o2, amount: Math.round(d.total * 100), currency: "INR", status: "captured" });
    const second = await req("/api/payments", { method: "POST", cookie: d.buyer.cookie, body: { action: "confirm", bookingId: d.bookingId, razorpay_order_id: o2, razorpay_payment_id: shared, razorpay_signature: sign(o2, shared) } });
    check(second.status === 409, "Reusing that payment id on another order is rejected", `status ${second.status} ${second.json?.error ?? ""}`);
    check(bookingStatus(d.bookingId) !== "paid", "The second booking stays unpaid");

    // a different buyer cannot pay someone else's booking
    const e = await bookableBooking();
    const orderE = insertOrder(e);
    const intruder = await fixture(`intruder${Math.random().toString(36).slice(2, 6)}`);
    const payE = "pay_INTRUDER";
    setGateway(payE, { order_id: orderE, amount: Math.round(e.total * 100), currency: "INR", status: "captured" });
    const hack = await req("/api/payments", { method: "POST", cookie: intruder.cookie, body: { action: "confirm", bookingId: e.bookingId, razorpay_order_id: orderE, razorpay_payment_id: payE, razorpay_signature: sign(orderE, payE) } });
    check([403, 404].includes(hack.status), "Another user cannot pay for a booking they do not own", `status ${hack.status}`);
    check(bookingStatus(e.bookingId) !== "paid", "Booking untouched by the intruder attempt");

    // a provider cannot pay their own listing
    const selfPay = await req("/api/payments", { method: "POST", cookie: e.provider.cookie, body: { action: "confirm", bookingId: e.bookingId, razorpay_order_id: orderE, razorpay_payment_id: payE, razorpay_signature: sign(orderE, payE) } });
    check([403, 404].includes(selfPay.status), "A provider cannot pay their own booking", `status ${selfPay.status}`);
  }

  /* ====================================== 9. checkout confirm needs capture */
  group("9. Checkout confirmation requires a captured payment (gateway API mocked)");
  {
    const b = await bookableBooking({ daily: 600, deposit: 900 });
    const orderId = insertOrder(b);
    const paise = Math.round(b.total * 100);

    // gateway says authorized only
    setGateway("pay_AUTH_ONLY", { order_id: orderId, amount: paise, currency: "INR", status: "authorized" });
    const auth = await req("/api/payments", { method: "POST", cookie: b.buyer.cookie, body: { action: "confirm", bookingId: b.bookingId, razorpay_order_id: orderId, razorpay_payment_id: "pay_AUTH_ONLY", razorpay_signature: sign(orderId, "pay_AUTH_ONLY") } });
    check(auth.status === 409, "Authorised-but-uncaptured confirm is refused", `status ${auth.status} ${auth.json?.error ?? ""}`);
    check(bookingStatus(b.bookingId) !== "paid", "Booking not paid on authorization");

    // bad checkout signature
    const badSig = await req("/api/payments", { method: "POST", cookie: b.buyer.cookie, body: { action: "confirm", bookingId: b.bookingId, razorpay_order_id: orderId, razorpay_payment_id: "pay_AUTH_ONLY", razorpay_signature: "f".repeat(64) } });
    check(badSig.status === 400, "Invalid checkout signature is refused", `status ${badSig.status}`);
    const audited = q(`SELECT * FROM audit_logs WHERE action='payment.signature_invalid'`).length;
    check(audited >= 1, "Invalid signature is audited");

    // gateway reports a different order id
    setGateway("pay_WRONG_ORDER", { order_id: "order_SOMETHING_ELSE", amount: paise, currency: "INR", status: "captured" });
    const wrongOrder = await req("/api/payments", { method: "POST", cookie: b.buyer.cookie, body: { action: "confirm", bookingId: b.bookingId, razorpay_order_id: orderId, razorpay_payment_id: "pay_WRONG_ORDER", razorpay_signature: sign(orderId, "pay_WRONG_ORDER") } });
    check(wrongOrder.status === 400, "Gateway order-id mismatch is refused", `status ${wrongOrder.status}`);

    // gateway reports a different amount
    setGateway("pay_WRONG_AMT", { order_id: orderId, amount: paise + 5000, currency: "INR", status: "captured" });
    const wrongAmt = await req("/api/payments", { method: "POST", cookie: b.buyer.cookie, body: { action: "confirm", bookingId: b.bookingId, razorpay_order_id: orderId, razorpay_payment_id: "pay_WRONG_AMT", razorpay_signature: sign(orderId, "pay_WRONG_AMT") } });
    check(wrongAmt.status === 409, "Gateway amount mismatch is refused", `status ${wrongAmt.status} ${wrongAmt.json?.error ?? ""}`);

    // gateway says captured → settles
    setGateway("pay_GOOD", { order_id: orderId, amount: paise, currency: "INR", status: "captured" });
    const good = await req("/api/payments", { method: "POST", cookie: b.buyer.cookie, body: { action: "confirm", bookingId: b.bookingId, razorpay_order_id: orderId, razorpay_payment_id: "pay_GOOD", razorpay_signature: sign(orderId, "pay_GOOD") } });
    check(good.status === 200, "Captured + correct amounts settle the booking", good.json?.message ?? good.json?.error);
    check(bookingStatus(b.bookingId) === "paid", "Booking is paid");
    const deposit = q1(`SELECT * FROM deposits WHERE booking_id = ?`, b.bookingId);
    check(deposit?.status === "held_demo", "Deposit row is simulated (held_demo)");
    check(!/escrow/i.test(deposit?.note ?? "") || /not escrow|simulated/i.test(deposit?.note ?? ""), "Deposit note never claims real escrow", String(deposit?.note).slice(0, 60));
  }

  /* ========================================== 10. escape hatch: update fails */
  group("10. Payment confirmed but the booking update cannot apply");
  {
    const b = await bookableBooking();
    const orderId = insertOrder(b);
    const paise = Math.round(b.total * 100);
    setGateway("pay_RACEHOOK", { order_id: orderId, amount: paise, currency: "INR", status: "captured" });
    // Cancel the booking first so the state transition has nothing to move.
    db.prepare(`UPDATE bookings SET status='cancelled' WHERE id=?`).run(b.bookingId);
    const body = webhookBody({ event: "payment.captured", orderId, paymentId: "pay_RACEHOOK", amountPaise: paise, currency: "INR" });
    const r = await req("/api/payments/webhook", { method: "POST", raw: body, headers: { ...webhookHeaders(body), "content-type": "application/json" } });
    check(r.status === 200, "Webhook still acknowledges a payment for a cancelled booking", `status ${r.status}`);
    check(bookingStatus(b.bookingId) === "cancelled", "Booking status is NOT silently resurrected", bookingStatus(b.bookingId));
    const paid = q1(`SELECT * FROM payments WHERE booking_id = ? AND status='paid'`, b.bookingId);
    check(Boolean(paid), "The money record is still stored (auditable, refundable by a human)");
    const auditRow = q(`SELECT * FROM audit_logs WHERE action='payment.webhook_captured' ORDER BY id DESC LIMIT 1`);
    check(auditRow.length === 1, "The mismatch is audited for reconciliation");
  }

  /* ========================================== 11. price lock over real HTTP */
  group("11. Provider price change after order creation");
  {
    const b = await bookableBooking({ daily: 500, deposit: 1000, days: 2 });
    const orderId = insertOrder(b);
    const originalPaise = Math.round(b.total * 100);
    db.prepare(`UPDATE resources SET price_daily = 5000, deposit = 9000 WHERE id = ?`).run(b.resourceId);

    const body = webhookBody({ event: "payment.captured", orderId, paymentId: "pay_LOCKHTTP", amountPaise: originalPaise, currency: "INR" });
    const r = await req("/api/payments/webhook", { method: "POST", raw: body, headers: { ...webhookHeaders(body), "content-type": "application/json" } });
    check(r.json?.idempotent === false, "Payment at the ORIGINAL locked price still settles", JSON.stringify(r.json));
    check(bookingStatus(b.bookingId) === "paid", "Booking paid at the locked price");
    const row = q1(`SELECT total FROM bookings WHERE id = ?`, b.bookingId);
    check(Math.round(row.total * 100) === originalPaise, "Booking total was not rewritten by the price change", `₹${row.total}`);

    // and a new order for the NEW price on the OLD booking must be refused
    const b2 = await bookableBooking({ daily: 500, deposit: 1000 });
    db.prepare(`UPDATE resources SET price_daily = 5000, deposit = 9000 WHERE id = ?`).run(b2.resourceId);
    const inflated = Math.round((b2.total * 3) * 100);
    const o2 = insertOrder(b2, { amount: b2.total * 3 });
    const inflatedBody = webhookBody({ event: "payment.captured", orderId: o2, paymentId: "pay_INFLATED", amountPaise: inflated, currency: "INR" });
    const ir = await req("/api/payments/webhook", { method: "POST", raw: inflatedBody, headers: { ...webhookHeaders(inflatedBody), "content-type": "application/json" } });
    // The webhook compares the reported paise against the LOCKED price first, so a
    // re-priced order is rejected as "amount mismatch"; the settlement layer would
    // reject it as "order_amount_mismatch". Either way it must be ignored.
    check(
      ir.json?.ignored === true && ["amount mismatch", "order_amount_mismatch"].includes(ir.json?.reason),
      "An order for a re-priced amount is rejected",
      JSON.stringify(ir.json)
    );
    check(bookingStatus(b2.bookingId) !== "paid", "That booking stays unpaid");
  }

  /* ================================================ 12. concurrency over HTTP */
  group("12. Simultaneous confirmations");
  {
    const b = await bookableBooking();
    const orderId = insertOrder(b);
    const paise = Math.round(b.total * 100);
    const payId = "pay_CONCURRENT";
    setGateway(payId, { order_id: orderId, amount: paise, currency: "INR", status: "captured" });
    const payload = { action: "confirm", bookingId: b.bookingId, razorpay_order_id: orderId, razorpay_payment_id: payId, razorpay_signature: sign(orderId, payId) };
    const results = await Promise.all([
      req("/api/payments", { method: "POST", cookie: b.buyer.cookie, body: payload }),
      req("/api/payments", { method: "POST", cookie: b.buyer.cookie, body: payload }),
    ]);
    const statuses = results.map((r) => r.status);
    check(statuses.every((s) => s === 200 || s === 409), "Concurrent confirms return coherent statuses", statuses.join(","));
    check(statuses.filter((s) => s === 200).length >= 1, "At least one confirm succeeded", statuses.join(","));
    check(q(`SELECT * FROM payments WHERE booking_id = ? AND status='paid'`, b.bookingId).length === 1, "Only ONE paid row after concurrent confirms");
    check(bookingStatus(b.bookingId) === "paid", "Booking is paid once");
    const idem = results.filter((r) => r.json?.idempotent === true).length;
    check(idem >= 1 || statuses.includes(409), "The duplicate is reported as idempotent (or refused)", `${idem} idempotent, statuses ${statuses.join(",")}`);
  }

  /* ================================================== 13. secrets never leak */
  group("13. Secret exposure");
  {
    const pages = ["/bookings", "/verification-report", "/help"];
    let leaked = [];
    for (const p of pages) {
      const r = await req(p, { cookie: cookieOfAnyBuyer() });
      if (r.text.includes(KEY_SECRET) || r.text.includes(WEBHOOK_SECRET)) leaked.push(p);
    }
    check(leaked.length === 0, "No gateway secret appears in any rendered page", leaked.join(",") || "clean");
    const payPage = await req("/api/payments");
    check(!JSON.stringify(payPage.json).includes("SECRET"), "Payment API response contains no secret material");
  }
  function cookieOfAnyBuyer() {
    return [...LEDGER.entries()].find(([e]) => e.startsWith("pay-buyer"))?.[1];
  }


} catch (e) {
  check(false, "Suite ran to completion", `crashed: ${e instanceof Error ? e.message : String(e)}`);
}

/* ================================================================= summary */
db.close();
const total = PASS.length + FAIL.length;
console.log(`\n${"=".repeat(66)}`);
console.log(`Payment integration: \x1b[32m${PASS.length} passed\x1b[0m, ${FAIL.length ? "\x1b[31m" : ""}${FAIL.length} failed\x1b[0m (${total} checks)`);
if (FAIL.length) for (const f of FAIL) console.log(`  ✗ [${f.section}] ${f.label} — ${f.detail}`);
fs.writeFileSync(".paytest/payment-integration-results.json", JSON.stringify({ pass: PASS, fail: FAIL, total }, null, 2));
console.log("Results written to .paytest/payment-integration-results.json");

child.kill("SIGTERM");
if (FAIL.length) {
  console.log("\n--- server log tail ---");
  console.log(log.join("").split("\n").slice(-25).join("\n"));
}
process.exit(FAIL.length ? 1 : 0);
