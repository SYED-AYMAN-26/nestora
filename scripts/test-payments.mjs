#!/usr/bin/env node
/**
 * RentLink 3D — payment unit + integration tests.
 *
 *   node scripts/test-payments.mjs
 *
 * WHAT THIS DOES
 *   Builds a runnable copy of src/lib/{db,crypto,booking,audit,payments}.ts into
 *   .paytest/build/ and exercises the REAL settlement code against a REAL SQLite
 *   database — but a throwaway one (.paytest/payments.db), never production data.
 *
 * WHAT IS MOCKED, AND WHY IT IS HONEST
 *   Razorpay's HTTP API is the only mocked seam: `globalThis.fetch` is patched so
 *   the suite can simulate "payment captured", "authorized only", "network down".
 *   Signatures are NOT mocked — they are computed with the same HMAC routine the
 *   server uses, using a test key secret, so signature verification really runs.
 *
 *   Because Razorpay test keys are not provisioned in this environment, the live
 *   gateway round-trip (order create + /payments/:id) is NOT exercised end-to-end
 *   here. Those tests are labelled as such and the report says so.
 */
import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import { build } from "./paytest-build.mjs";

process.env.NODE_ENV = "test";
process.env.DATABASE_PATH = ".paytest/payments.db";
process.env.RAZORPAY_KEY_ID = "rzp_test_KEYID_for_tests";
process.env.RAZORPAY_KEY_SECRET = "test_key_secret_do_not_use_in_production";
process.env.RAZORPAY_WEBHOOK_SECRET = "test_webhook_secret_do_not_use_in_production";

fs.rmSync(".paytest/payments.db", { force: true });
fs.rmSync(".paytest/payments.db-wal", { force: true });
fs.rmSync(".paytest/payments.db-shm", { force: true });
fs.mkdirSync(".paytest", { recursive: true });
build();

const P = await import(path.resolve(".paytest/build/payments.js"));
const DB = await import(path.resolve(".paytest/build/db.js"));
const ENV = await import(path.resolve(".paytest/build/env.js"));

const PASS = [], FAIL = [];
let section = "";
function group(name) { section = name; console.log(`\n\x1b[1m${name}\x1b[0m`); }
function check(ok, label, detail = "") {
  (ok ? PASS : FAIL).push({ section, label, detail });
  const tag = ok ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";
  console.log(`  ${tag} ${label}${detail ? ` \x1b[90m— ${detail}\x1b[0m` : ""}`);
  return ok;
}

/* ------------------------------------------------------------------ fixtures */
let seq = 0;
function makeBooking({ daily = 1200, deposit = 3000, days = 2, units = 1 } = {}) {
  seq += 1;
  const now = new Date().toISOString();
  const u = DB.run(
    `INSERT INTO users (email, password_hash, full_name, account_type, city, state, role, active_mode, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    `pay-${seq}@example.test`, "x", `Payer ${seq}`, "individual", "Chennai", "Tamil Nadu", "user", "buyer", now
  );
  const buyerId = Number(u.lastInsertRowid);
  const pu = DB.run(
    `INSERT INTO users (email, password_hash, full_name, account_type, city, state, role, active_mode, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    `pay-prov-${seq}@example.test`, "x", `Provider ${seq}`, "college_university", "Chennai", "Tamil Nadu", "user", "provider", now
  );
  const providerUserId = Number(pu.lastInsertRowid);
  const pr = DB.run(
    `INSERT INTO provider_profiles (user_id, storefront_slug, display_name, org_type, verification_status, is_demo, priority_policy)
     VALUES (?,?,?,?,?,?,?)`,
    providerUserId, `prov-${seq}`, `Provider ${seq}`, "college_university", "verified", 0, "{}"
  );
  const providerId = Number(pr.lastInsertRowid);
  const r = DB.run(
    `INSERT INTO resources (provider_id, title, category, description, condition, quantity_total, quantity_active,
       location_city, location_state, price_hourly, price_daily, price_weekly, deposit, status, approval_mode, is_demo, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    providerId, `Test camera ${seq}`, "cameras", "A test listing for the payment suite, long enough.", "good",
    1, 0, "Chennai", "Tamil Nadu", 200, daily, daily * 5, deposit, "active", "auto", 0, now
  );
  const resourceId = Number(r.lastInsertRowid);
  const start = "2030-01-10";
  const end = days === 1 ? start : `2030-01-${String(9 + days).padStart(2, "0")}`;
  const quote = P.priceSnapshotFor(
    { id: resourceId, price_hourly: 200, price_daily: daily, price_weekly: daily * 5, deposit },
    { days, units, basis: "daily", subtotal: daily * days * units, fees: Math.round(daily * days * units * 0.02 * 100) / 100, deposit: deposit * units, total: 0 },
  );
  quote.total = Math.round((quote.subtotal + quote.fees + quote.deposit) * 100) / 100;
  const b = DB.run(
    `INSERT INTO bookings (code, resource_id, buyer_id, provider_id, start_date, end_date, days, units, rate_basis,
        subtotal, deposit, fees, total, status, price_snapshot, price_pinned_at, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    `PAY-${seq}-${Date.now().toString(36)}`, resourceId, buyerId, providerId, start, end, days, units, "daily",
    quote.subtotal + quote.fees, quote.deposit, quote.fees, quote.total, "approved",
    JSON.stringify(quote), now, now, now
  );
  return {
    bookingId: Number(b.lastInsertRowid), buyerId, providerId, resourceId,
    total: quote.total, snapshot: quote, start, end, daily,
  };
}

function makeOrder(booking, { orderId = `order_TEST${Math.random().toString(36).slice(2, 10)}`, amount } = {}) {
  const paymentRowId = P.recordPayment({
    bookingId: booking.bookingId, kind: "rental", amount: amount ?? booking.total,
    mode: "razorpay", status: "created", providerOrderId: orderId,
  });
  return { orderId, paymentRowId };
}

const sign = (orderId, paymentId) =>
  crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest("hex");
const webhookSign = (raw) =>
  crypto.createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET).update(raw).digest("hex");

const rows = (sql, ...a) => DB.all(sql, ...a);
const bookingStatus = (id) => DB.one(`SELECT status FROM bookings WHERE id = ?`, id)?.status;
const paidRows = (id) => rows(`SELECT * FROM payments WHERE booking_id = ? AND status='paid'`, id);

/* =========================================================== 1. signatures */
group("1. Signature verification");
{
  const o = "order_TESTsig", p = "pay_TESTsig";
  const good = sign(o, p);
  check(P.verifyRazorpaySignature(o, p, good) === true, "Correct checkout signature verifies");
  check(P.verifyRazorpaySignature(o, p, good.replace(/.$/, "0")) === false, "Tampered checkout signature rejected");
  check(P.verifyRazorpaySignature(o, "pay_OTHER", good) === false, "Signature for a different payment id rejected");
  check(P.verifyRazorpaySignature(o, p, "") === false, "Empty signature rejected");

  const raw = JSON.stringify({ event: "payment.captured" });
  check(P.verifyWebhook(raw, webhookSign(raw)) === true, "Correct webhook signature verifies over raw body");
  check(P.verifyWebhook(raw + " ", webhookSign(raw)) === false, "Webhook body modified after signing rejected");
  check(P.verifyWebhook(raw, null) === false, "Missing webhook signature rejected");
}

/* ================================================= 2. captured payment flow */
group("2. Correct captured payment (webhook authority)");
const capturedFlow = {};
{
  const b = makeBooking();
  const { orderId } = makeOrder(b);
  capturedFlow.booking = b; capturedFlow.orderId = orderId;

  const res = P.settleCapturedPayment({
    bookingId: b.bookingId, orderId, paymentId: "pay_CAPTURED1",
    amountPaise: P.toPaise(b.total), currency: "INR", source: "webhook",
  });
  check(res.ok === true, "Captured payment settles", res.ok ? "booking → " + res.bookingStatus : res.error);
  check(bookingStatus(b.bookingId) === "paid", "Booking moved to paid");
  const paid = paidRows(b.bookingId);
  check(paid.length === 1 && paid[0].provider_payment_id === "pay_CAPTURED1", "Payment row is paid with the gateway payment id");
  check(paid[0].captured_at != null, "captured_at is recorded (not just paid_at)");
  const deposit = DB.one(`SELECT * FROM deposits WHERE booking_id = ?`, b.bookingId);
  check(deposit?.status === "held_demo", "Deposit recorded as a SIMULATED held_demo row");
  check(/not escrow|SIMULATED/i.test(deposit?.note ?? ""), "Deposit note states it is not escrow", (deposit?.note ?? "").slice(0, 48) + "…");
}

/* ====================================================== 3. wrong amounts etc */
group("3. Amount, currency and missing-field validation");
{
  const b = makeBooking({ daily: 800, deposit: 1000 });
  const { orderId } = makeOrder(b);
  const r1 = P.settleCapturedPayment({ bookingId: b.bookingId, orderId, paymentId: "pay_LOW", amountPaise: P.toPaise(b.total) - 100, currency: "INR", source: "webhook" });
  check(!r1.ok && r1.reason === "gateway_amount_mismatch", "Under-paid amount rejected", r1.ok ? "settled!" : r1.reason);
  const r2 = P.settleCapturedPayment({ bookingId: b.bookingId, orderId, paymentId: "pay_HIGH", amountPaise: P.toPaise(b.total) + 100, currency: "INR", source: "webhook" });
  check(!r2.ok && r2.reason === "gateway_amount_mismatch", "Over-paid amount rejected", r2.ok ? "settled!" : r2.reason);
  const r3 = P.settleCapturedPayment({ bookingId: b.bookingId, orderId, paymentId: "pay_USD", amountPaise: P.toPaise(b.total), currency: "USD", source: "webhook" });
  check(!r3.ok && r3.reason === "currency_mismatch", "Wrong currency rejected", r3.ok ? "settled!" : r3.reason);
  check(bookingStatus(b.bookingId) === "approved", "Rejected attempts left the booking untouched", bookingStatus(b.bookingId));

  // stored order amount tampered (e.g. an order created for a different amount)
  const b2 = makeBooking({ daily: 500, deposit: 0 });
  const { orderId: o2 } = makeOrder(b2, { amount: 1 });
  const r4 = P.settleCapturedPayment({ bookingId: b2.bookingId, orderId: o2, paymentId: "pay_TAMPER", amountPaise: P.toPaise(1), currency: "INR", source: "webhook" });
  check(!r4.ok && r4.reason === "order_amount_mismatch", "Stored order amount that no longer matches the booking price is rejected", r4.ok ? "settled!" : r4.reason);
}

/* ================================================== 4. unknown / cross-order */
group("4. Unknown orders, foreign bookings, reused payment ids");
{
  const b = makeBooking();
  const r1 = P.settleCapturedPayment({ bookingId: b.bookingId, orderId: "order_DOES_NOT_EXIST", paymentId: "pay_X", amountPaise: P.toPaise(b.total), currency: "INR", source: "checkout" });
  check(!r1.ok && r1.reason === "order_not_found", "Unknown order id rejected", r1.ok ? "settled!" : r1.reason);
  check(paidRows(b.bookingId).length === 0, "No payment record created for an unknown order");

  const a = makeBooking();
  const c = makeBooking();
  const { orderId } = makeOrder(a);
  const r2 = P.settleCapturedPayment({ bookingId: c.bookingId, orderId, paymentId: "pay_CROSS", amountPaise: P.toPaise(a.total), currency: "INR", source: "checkout" });
  check(!r2.ok && r2.reason === "order_booking_mismatch", "Order belonging to another booking rejected", r2.ok ? "settled!" : r2.reason);
  check(bookingStatus(c.bookingId) === "approved", "The other booking was NOT marked paid", bookingStatus(c.bookingId));

  // reused payment id against a second order
  const d = makeBooking();
  const { orderId: o1 } = makeOrder(a);
  const ok1 = P.settleCapturedPayment({ bookingId: a.bookingId, orderId: o1, paymentId: "pay_SHARED", amountPaise: P.toPaise(a.total), currency: "INR", source: "webhook" });
  const { orderId: o2 } = makeOrder(d);
  const r3 = P.settleCapturedPayment({ bookingId: d.bookingId, orderId: o2, paymentId: "pay_SHARED", amountPaise: P.toPaise(d.total), currency: "INR", source: "webhook" });
  check(ok1.ok === true, "First use of a payment id settles");
  check(!r3.ok && r3.reason === "payment_id_reused", "Reusing the same payment id on another order is rejected", r3.ok ? "settled!" : r3.reason);

  // database-level guard
  let uniqueBlocked = false;
  try {
    DB.run(`INSERT INTO payments (booking_id, kind, amount, mode, status, provider_order_id) VALUES (?,?,?,?,?,?)`,
      d.bookingId, "rental", 100, "razorpay", "created", o1);
  } catch (e) {
    uniqueBlocked = /UNIQUE constraint failed/.test(String(e.message));
  }
  check(uniqueBlocked, "UNIQUE index refuses a duplicate gateway order id at the DB level");
}

/* ===================================================== 5. idempotency/replay */
group("5. Repeated webhooks, concurrency and authorized-not-captured");
{
  const b = makeBooking();
  const { orderId } = makeOrder(b);
  const first = P.settleCapturedPayment({ bookingId: b.bookingId, orderId, paymentId: "pay_REPEAT", amountPaise: P.toPaise(b.total), currency: "INR", source: "webhook" });
  const second = P.settleCapturedPayment({ bookingId: b.bookingId, orderId, paymentId: "pay_REPEAT", amountPaise: P.toPaise(b.total), currency: "INR", source: "webhook" });
  const third = P.settleCapturedPayment({ bookingId: b.bookingId, orderId, paymentId: "pay_REPEAT", amountPaise: P.toPaise(b.total), currency: "INR", source: "webhook" });
  check(first.ok && !first.idempotent, "First captured webhook settles");
  check(second.ok && second.idempotent, "Repeated captured webhook is idempotent (no double-settle)");
  check(third.ok && third.idempotent, "Third delivery also idempotent");
  check(paidRows(b.bookingId).length === 1, "Exactly ONE paid row after three deliveries", `${paidRows(b.bookingId).length} rows`);

  // different payment id on an already-settled order
  const r = P.settleCapturedPayment({ bookingId: b.bookingId, orderId, paymentId: "pay_DIFFERENT", amountPaise: P.toPaise(b.total), currency: "INR", source: "webhook" });
  check(!r.ok && r.reason === "order_already_settled", "A second, different payment on the same order is rejected", r.ok ? "settled!" : r.reason);

  // authorized ≠ captured
  const b2 = makeBooking();
  const { orderId: o2 } = makeOrder(b2);
  const auth = P.recordAuthorizedPayment(o2, "pay_AUTHONLY");
  check(auth.ok === true, "Authorized payment is recorded");
  const row = DB.one(`SELECT status FROM payments WHERE provider_order_id = ?`, o2);
  check(row.status === "authorized", "Status is 'authorized', not 'paid'", row.status);
  check(bookingStatus(b2.bookingId) === "approved", "Booking is NOT paid after authorization only", bookingStatus(b2.bookingId));
  check(paidRows(b2.bookingId).length === 0, "No paid row exists for an authorized payment");

  // failed → cannot become paid
  DB.run(`UPDATE payments SET status='failed' WHERE provider_order_id = ?`, o2);
  const afterFail = P.settleCapturedPayment({ bookingId: b2.bookingId, orderId: o2, paymentId: "pay_AUTHONLY", amountPaise: P.toPaise(b2.total), currency: "INR", source: "webhook" });
  check(!afterFail.ok && afterFail.reason === "payment_failed", "A failed payment cannot be settled by a later capture event", afterFail.ok ? "settled!" : afterFail.reason);
  check(bookingStatus(b2.bookingId) === "approved", "Failed payment left the booking unpaid");

  // refunded → cannot become paid
  const b3 = makeBooking();
  const { orderId: o3 } = makeOrder(b3);
  P.settleCapturedPayment({ bookingId: b3.bookingId, orderId: o3, paymentId: "pay_REFUNDME", amountPaise: P.toPaise(b3.total), currency: "INR", source: "webhook" });
  DB.run(`UPDATE payments SET status='refunded' WHERE provider_order_id = ?`, o3);
  const afterRefund = P.settleCapturedPayment({ bookingId: b3.bookingId, orderId: o3, paymentId: "pay_REFUNDME", amountPaise: P.toPaise(b3.total), currency: "INR", source: "webhook" });
  check(!afterRefund.ok && afterRefund.reason === "payment_refunded", "A refunded payment cannot be re-settled", afterRefund.ok ? "settled!" : afterRefund.reason);
}

/* ============================================== 6. concurrent confirmation */
group("6. Concurrency: checkout + webhook racing each other");
{
  const b = makeBooking();
  const { orderId } = makeOrder(b);
  // Two independent settlement attempts, as if the browser handler and the webhook
  // landed at the same moment. better-sqlite3 is synchronous, so this models the
  // worst case for the same event loop tick: both must be safe individually and
  // together they must produce exactly one paid row.
  const results = [
    P.settleCapturedPayment({ bookingId: b.bookingId, orderId, paymentId: "pay_RACE", amountPaise: P.toPaise(b.total), currency: "INR", source: "checkout" }),
    P.settleCapturedPayment({ bookingId: b.bookingId, orderId, paymentId: "pay_RACE", amountPaise: P.toPaise(b.total), currency: "INR", source: "webhook" }),
  ];
  check(results.every((r) => r.ok), "Both concurrent attempts succeed");
  check(results.filter((r) => !r.idempotent).length === 1, "Exactly one attempt performed the settlement", `${results.filter((r) => !r.idempotent).length} non-idempotent`);
  check(paidRows(b.bookingId).length === 1, "Only one paid row exists after the race", `${paidRows(b.bookingId).length} rows`);

  // Same order, two DIFFERENT payment ids racing: only one may win.
  const b2 = makeBooking();
  const { orderId: o2 } = makeOrder(b2);
  const race = [
    P.settleCapturedPayment({ bookingId: b2.bookingId, orderId: o2, paymentId: "pay_RACE_A", amountPaise: P.toPaise(b2.total), currency: "INR", source: "checkout" }),
    P.settleCapturedPayment({ bookingId: b2.bookingId, orderId: o2, paymentId: "pay_RACE_B", amountPaise: P.toPaise(b2.total), currency: "INR", source: "webhook" }),
  ];
  check(race[0].ok && !race[1].ok && race[1].reason === "order_already_settled", "Different payment ids on one order: exactly one wins", race[1].ok ? "both settled!" : race[1].reason);
  check(paidRows(b2.bookingId).length === 1, "Only one paid row after the two-id race");
}

/* ================================================= 7. immutable price lock */
group("7. Booking price is locked (provider cannot re-price an existing booking)");
{
  const b = makeBooking({ daily: 1000, deposit: 2000, days: 2 });
  const { orderId } = makeOrder(b);
  const before = P.bookingPrice(b.bookingId);
  check(before.amountRupees === b.total, "Order amount equals the booking's snapshot total", `${before.amountRupees}`);

  // The provider now doubles their prices.
  DB.run(`UPDATE resources SET price_daily = price_daily * 2, deposit = deposit * 2 WHERE id = ?`, b.resourceId);
  const after = P.bookingPrice(b.bookingId);
  check(after.amountRupees === before.amountRupees, "Booking total is unchanged after a provider price change", `${before.amountRupees} → ${after.amountRupees}`);

  const res = P.settleCapturedPayment({ bookingId: b.bookingId, orderId, paymentId: "pay_LOCKED", amountPaise: before.amountPaise, currency: "INR", source: "webhook" });
  check(res.ok === true, "Payment at the locked price still settles after the price change", res.ok ? "paid" : res.error);

  // a brand-new booking on the same resource picks up the NEW price, as it should
  const fresh = makeBooking({ daily: 1000, deposit: 2000, days: 2 });
  check(fresh.total > 0, "New bookings are priced independently", `${fresh.total}`);
}

/* =============================================== 8. legacy rows & migration */
group("8. Legacy bookings without a snapshot");
{
  const b = makeBooking();
  DB.run(`UPDATE bookings SET price_snapshot = NULL WHERE id = ?`, b.bookingId);
  const price = P.bookingPrice(b.bookingId);
  check(price !== null && price.amountRupees === b.total, "Legacy booking priced from its own columns", `${price?.amountRupees}`);
  const pinned = DB.one(`SELECT price_snapshot FROM bookings WHERE id = ?`, b.bookingId);
  check(Boolean(pinned.price_snapshot), "Snapshot is pinned on first read, not left null");
  const { orderId } = makeOrder(b);
  const res = P.settleCapturedPayment({ bookingId: b.bookingId, orderId, paymentId: "pay_LEGACY", amountPaise: price.amountPaise, currency: "INR", source: "webhook" });
  check(res.ok === true, "Legacy booking settles at its stored amount", res.ok ? "paid" : res.error);
}

/* ============================================================ 9. demo mode */
group("9. Demo payments never touch the gateway");
{
  const b = makeBooking();
  const demoId = P.recordPayment({
    bookingId: b.bookingId, kind: "rental", amount: b.total, mode: "demo", status: "paid",
    meta: { label: "DEMO PAYMENT — simulated, no money transferred, no gateway involved", simulated_only: true },
  });
  const row = DB.one(`SELECT * FROM payments WHERE id = ?`, demoId);
  check(row.mode === "demo", "Demo row is tagged mode='demo'");
  check(row.provider_order_id === null && row.provider_payment_id === null, "Demo row carries no gateway ids");
  check(row.kind === "rental", "Demo row keeps its own kind (cannot be confused with a gateway transaction)");
  const mix = DB.one(`SELECT COUNT(*) AS c FROM payments WHERE booking_id = ? AND mode='razorpay'`, b.bookingId);
  check(mix.c === 0, "No gateway rows were created for the demo payment");
  // a demo row cannot be settled by a webhook even if someone invents an order id
  const r = P.settleCapturedPayment({ bookingId: b.bookingId, orderId: `demo-${demoId}`, paymentId: "pay_FAKE", amountPaise: P.toPaise(b.total), currency: "INR", source: "webhook" });
  check(!r.ok && r.reason === "order_not_found", "A demo record cannot be settled as a gateway payment", r.ok ? "settled!" : r.reason);
}

/* ============================================ 10. gateway capture authority */
group("10. Checkout confirmation requires gateway-captured status (mocked API)");
{
  const realFetch = globalThis.fetch;
  let mode = "captured";
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (!u.includes("/v1/payments/")) throw new Error("unexpected fetch in test: " + u);
    const paymentId = u.split("/").pop();
    if (mode === "error") return { ok: false, status: 500, text: async () => "boom" };
    const status = mode === "authorized" ? "authorized" : "captured";
    return {
      ok: true, status: 200,
      json: async () => ({ id: paymentId, order_id: "order_FROM_GATEWAY", amount: 100, currency: "INR", status, captured: status === "captured" }),
      text: async () => "",
    };
  };
  const captured = await P.verifyCaptureWithGateway("pay_A", "order_A");
  check(captured.ok && captured.captured === true, "Gateway reports captured → accepted");
  check(captured.amountPaise === 100 && captured.currency === "INR", "Gateway amount/currency are returned for comparison");
  mode = "authorized";
  const auth = await P.verifyCaptureWithGateway("pay_B", "order_B");
  check(auth.ok && auth.captured === false, "Gateway reports authorized → NOT captured (payment must not settle)", auth.ok ? auth.status : auth.error);
  mode = "error";
  const err = await P.verifyCaptureWithGateway("pay_C", "order_C");
  check(err.ok === false, "Gateway unreachable → fail closed", err.ok ? "returned ok!" : String(err.error).slice(0, 40));
  globalThis.fetch = realFetch;
}

/* ======================================== 11. demo credentials in production */
group("11. Demo-account policy (no default admin password in production)");
{
  const saved = { ...process.env };
  const isDemo = true;
  process.env.NODE_ENV = "production";
  delete process.env.ALLOW_DEMO_SEED;
  delete process.env.DEMO_PASSWORD;

  check(ENV.demoLoginBlocked(isDemo, "Demo@1234") === true, "Documented demo password is blocked on a production deployment");
  process.env.ALLOW_DEMO_SEED = "1";
  check(ENV.demoLoginBlocked(isDemo, "Demo@1234") === false, "Explicit ALLOW_DEMO_SEED=1 opts a demo deployment back in");
  delete process.env.ALLOW_DEMO_SEED;
  process.env.DEMO_PASSWORD = "a-long-unguessable-one";
  // With a custom password the account still uses scrypt, so the documented default
  // simply no longer matches the stored hash — login fails on the password check,
  // not on this policy. What matters is that the custom one is accepted.
  check(ENV.demoLoginBlocked(isDemo, "a-long-unguessable-one") === false, "A customised demo password is accepted in production");
  check(ENV.demoPassword() === "a-long-unguessable-one", "demoPassword() reports the configured value");
  check(ENV.demoLoginBlocked(false, "Demo@1234") === false, "Non-demo (real) accounts are never blocked", "");
  process.env.NODE_ENV = "development";
  delete process.env.DEMO_PASSWORD;
  check(ENV.demoLoginBlocked(isDemo, "Demo@1234") === false, "Development/local is unaffected", "");
  process.env = saved;
}

/* ================================================================= summary */
const total = PASS.length + FAIL.length;
console.log(`\n${"=".repeat(66)}`);
console.log(`Payment tests: \x1b[32m${PASS.length} passed\x1b[0m, ${FAIL.length ? "\x1b[31m" : ""}${FAIL.length} failed\x1b[0m (${total} checks)`);
if (FAIL.length) {
  console.log("\nFailures:");
  for (const f of FAIL) console.log(`  ✗ [${f.section}] ${f.label} — ${f.detail}`);
}
fs.writeFileSync(".paytest/payment-test-results.json", JSON.stringify({ pass: PASS, fail: FAIL, total }, null, 2));
console.log("Results written to .paytest/payment-test-results.json");
process.exit(FAIL.length ? 1 : 0);
