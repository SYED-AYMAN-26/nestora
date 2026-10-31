import crypto from "node:crypto";
import { all, one, run, tx, type Bind } from "./db";
import { hmacHex } from "./crypto";
import { quote, priceSnapshotFor, type PriceSnapshot } from "./booking";
import { notify } from "./audit";

/**
 * Payment layer.
 *
 * Two modes, never mixed:
 *   demo      — no gateway. Nothing is charged. Every row is labelled demo.
 *   razorpay  — Razorpay TEST-mode orders; money "moves" only in test mode.
 *
 * SECURITY MODEL
 * ---------------
 * A valid HMAC signature proves only that *a* Razorpay checkout produced those
 * three strings. It does not prove the order is ours, that it belongs to this
 * booking, or that the money was captured. So nothing is marked paid until all of
 * the following hold, checked server-side:
 *
 *   1. the order id exists in `payments` and was created by this deployment,
 *   2. it belongs to the booking being settled,
 *   3. the stored amount equals the booking's IMMUTABLE price snapshot
 *      (bookings.price_snapshot — not today's price list),
 *   4. currency is INR everywhere,
 *   5. Razorpay itself reports the payment as `captured` (server API or a
 *      signature-verified webhook) — an `authorized` payment is never "paid",
 *   6. neither the order id nor the payment id has been used before
 *      (unique indexes + an explicit check),
 *   ...and all of that happens inside one SQLite transaction so a concurrent
 *   checkout confirmation and webhook cannot both settle the same booking.
 *
 * What this is NOT: escrow. Deposits are recorded as *simulated* rows
 * (`held_demo`) and no funds are held by anybody. See depositSafetyNote().
 */

export type PaymentMode = "demo" | "razorpay";
export type PaymentStatus = "pending" | "created" | "authorized" | "paid" | "failed" | "refunded";

export type PaymentRow = {
  id: number;
  booking_id: number;
  kind: string;
  amount: number;
  currency: string;
  mode: PaymentMode;
  status: PaymentStatus;
  provider_order_id: string | null;
  provider_payment_id: string | null;
  signature_valid: number | null;
  meta: string | null;
  captured_at: string | null;
  created_at: string;
  paid_at: string | null;
};

export const razorpayConfigured = () =>
  Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);

export function paymentMode(): "razorpay_test" | "demo" {
  return razorpayConfigured() ? "razorpay_test" : "demo";
}

export function paymentModeLabel() {
  return razorpayConfigured()
    ? "Razorpay TEST MODE — real test transactions, no live money"
    : "DEMO PAYMENT MODE — no money is transferred, no card data is collected";
}

/** Single source of truth for the wording shown anywhere a deposit is mentioned. */
export function depositSafetyNote() {
  return "Deposits in RentLink 3D are SIMULATED RECORDS, not escrow. No money is held by the platform or by any third party, and no deposit is ever moved automatically.";
}

// ---------------------------------------------------------------- amounts
/** Amounts are stored in rupees with 2 decimals; compare in paise to avoid float drift. */
export const toPaise = (rupees: number | string | null | undefined) => Math.round(Number(rupees ?? 0) * 100);
export const sameAmount = (a: number | string | null | undefined, b: number | string | null | undefined) =>
  toPaise(a) === toPaise(b);

export type BookingPrice = {
  amountRupees: number;
  amountPaise: number;
  currency: "INR";
  snapshot: PriceSnapshot | null;
  /** True when the figure came from a stored snapshot; false for legacy rows. */
  fromSnapshot: boolean;
  breakdown: ReturnType<typeof quote>;
};

/**
 * The amount this booking must be paid at.
 *
 * Authoritative source is `bookings.price_snapshot`, written once when the
 * booking was created (and re-pinned only when a counteroffer is accepted).
 * A provider editing their price list afterwards cannot change it.
 *
 * Legacy bookings created before snapshots existed have none, so the figure is
 * computed once from the booking's own stored subtotal/fees/deposit and then
 * pinned — still never from the current price list.
 */
export async function bookingPrice(bookingId: number): Promise<BookingPrice | null> {
  const b = await one<{
    id: number; resource_id: number; start_date: string; end_date: string; units: number; rate_basis: string;
    subtotal: number; fees: number; deposit: number; total: number; price_snapshot: string | null;
    price_hourly: number; price_daily: number; price_weekly: number; currency?: string;
  }>(
    `SELECT b.id, b.resource_id, b.start_date, b.end_date, b.units, b.rate_basis, b.subtotal, b.fees, b.deposit,
            b.total, b.price_snapshot,
            r.price_hourly, r.price_daily, r.price_weekly
       FROM bookings b JOIN resources r ON r.id = b.resource_id
      WHERE b.id = ?`,
    bookingId
  );
  if (!b) return null;

  let snapshot: PriceSnapshot | null = null;
  if (b.price_snapshot) {
    try {
      snapshot = JSON.parse(b.price_snapshot) as PriceSnapshot;
    } catch {
      snapshot = null;
    }
  }
  if (!snapshot) {
    // Legacy row: pin from the booking's OWN columns (not the resource's today prices).
    const legacy: PriceSnapshot = {
      version: 1,
      resource_id: b.resource_id,
      rate_basis: (b.rate_basis === "hourly" || b.rate_basis === "weekly" ? b.rate_basis : "daily"),
      unit_rate: 0,
      days: 0,
      units: Number(b.units),
      subtotal: Number(b.subtotal) - Number(b.fees),
      fees: Number(b.fees),
      deposit: Number(b.deposit),
      total: Number(b.total),
      currency: "INR",
      pinned_at: new Date().toISOString(),
    };
    snapshot = legacy;
    await run(`UPDATE bookings SET price_snapshot = ?, price_pinned_at = ? WHERE id = ? AND price_snapshot IS NULL`,
      JSON.stringify(legacy), legacy.pinned_at, bookingId);
  }

  const amountRupees = Math.round(Number(snapshot.total) * 100) / 100;
  const res = await one<{ id: number }>(`SELECT id FROM resources WHERE id = ?`, b.resource_id);
  const breakdown = res
    ? quote(
        // quote() only needs the rate columns; recompute for display only.
        { id: b.resource_id, price_hourly: b.price_hourly, price_daily: b.price_daily, price_weekly: b.price_weekly, deposit: snapshot.deposit },
        b.start_date, b.end_date, Number(b.units), snapshot.rate_basis
      )
    : ({} as ReturnType<typeof quote>);

  return {
    amountRupees,
    amountPaise: toPaise(amountRupees),
    currency: "INR",
    snapshot,
    fromSnapshot: Boolean(b.price_snapshot),
    breakdown,
  };
}

/** Backwards-compatible helper used by older call sites. */
export async function expectedBookingAmount(bookingId: number): Promise<number | null> {
  return (await bookingPrice(bookingId))?.amountRupees ?? null;
}

export { priceSnapshotFor };

// ---------------------------------------------------------------- gateway
/**
 * Base URL of the Razorpay API. Overridable so the payment test suite can point
 * it at a local stand-in; unset means the real API. This is server-side config
 * only — it is never read from a request and never exposed to the browser.
 */
const razorpayApiBase = () => (process.env.RAZORPAY_API_BASE || "https://api.razorpay.com").replace(/\/$/, "");

export async function createRazorpayOrder(amountRupees: number, receipt: string, notes?: Record<string, string>) {
  if (!razorpayConfigured()) throw new Error("Razorpay is not configured");
  const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString("base64");
  const res = await fetch(`${razorpayApiBase()}/v1/orders`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Basic ${auth}` },
    body: JSON.stringify({
      amount: toPaise(amountRupees),
      currency: "INR",
      receipt,
      notes: { source: "rentlink3d", ...(notes ?? {}) },
    }),
  });
  if (!res.ok) throw new Error(`Razorpay order failed (${res.status}): ${await res.text()}`);
  return (await res.json()) as { id: string; amount: number; currency: string; status: string };
}

/** Razorpay checkout handler signature: HMAC_SHA256(order_id|payment_id, key_secret). */
export function verifyRazorpaySignature(orderId: string, paymentId: string, signature: string) {
  const secret = process.env.RAZORPAY_KEY_SECRET || "";
  if (!secret) return false;
  const expected = hmacHex(`${orderId}|${paymentId}`, secret);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature || "");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Webhook signature: HMAC_SHA256(rawBody, webhook_secret) vs x-razorpay-signature. */
export function verifyWebhook(rawBody: string, signature: string | null) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const expected = hmacHex(rawBody, secret);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function fetchRazorpayPayment(paymentId: string) {
  if (!razorpayConfigured()) throw new Error("Razorpay is not configured");
  const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString("base64");
  const res = await fetch(`${razorpayApiBase()}/v1/payments/${encodeURIComponent(paymentId)}`, {
    headers: { authorization: `Basic ${auth}` },
    // Never cache a money query.
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Razorpay payment lookup failed (${res.status}): ${await res.text()}`);
  return (await res.json()) as {
    id: string;
    order_id: string | null;
    amount: number;
    currency: string;
    status: "created" | "authorized" | "captured" | "refunded" | "failed";
    captured?: boolean;
  };
}

/**
 * Ask Razorpay what actually happened to this payment.
 *
 * The checkout `handler` callback is browser-side, so the signature proves
 * possession of the key secret but NOT capture. We therefore confirm with the
 * server API before treating money as received. If the API cannot be reached we
 * fail closed and tell the client to wait for the webhook.
 */
export async function verifyCaptureWithGateway(paymentId: string, orderId: string) {
  try {
    const p = await fetchRazorpayPayment(paymentId);
    const captured = p.status === "captured" || p.captured === true;
    return {
      ok: true as const,
      captured,
      status: p.status,
      orderId: p.order_id,
      amountPaise: p.amount,
      currency: p.currency,
    };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : String(e), orderId };
  }
}

// ---------------------------------------------------------------- records
export async function recordPayment(opts: {
  bookingId: number;
  kind: "rental" | "deposit" | "extension" | "refund";
  amount: number;
  mode: PaymentMode;
  status: PaymentStatus;
  currency?: string;
  providerOrderId?: string | null;
  providerPaymentId?: string | null;
  signatureValid?: boolean | null;
  meta?: unknown;
}) {
  const r = await run(
    `INSERT INTO payments (booking_id, kind, amount, currency, mode, status, provider_order_id, provider_payment_id, signature_valid, meta, paid_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    opts.bookingId, opts.kind, Number(opts.amount), opts.currency ?? "INR", opts.mode, opts.status,
    opts.providerOrderId ?? null, opts.providerPaymentId ?? null,
    opts.signatureValid == null ? null : opts.signatureValid ? 1 : 0,
    opts.meta ? JSON.stringify(opts.meta) : null,
    opts.status === "paid" ? new Date().toISOString() : null
  );
  return Number(r.lastInsertRowid);
}

export async function markPaymentPaid(paymentId: number, providerPaymentId?: string, signatureValid?: boolean) {
  await run(
    `UPDATE payments SET status='paid', paid_at=?, provider_payment_id = COALESCE(?, provider_payment_id),
       signature_valid = COALESCE(?, signature_valid), captured_at = COALESCE(captured_at, ?) WHERE id = ?`,
    new Date().toISOString(), providerPaymentId ?? null,
    signatureValid == null ? null : signatureValid ? 1 : 0,
    new Date().toISOString(), paymentId
  );
}

export async function bookingPayments(bookingId: number) {
  return await one<{ paid: number }>(
    `SELECT COALESCE(SUM(amount),0) AS paid FROM payments WHERE booking_id = ? AND status='paid' AND kind != 'refund'`,
    bookingId
  )?.paid ?? 0;
}

export async function orderFor(orderId: string) {
  if (!orderId) return undefined;
  return await one<PaymentRow>(
    `SELECT * FROM payments WHERE provider_order_id = ? AND mode = 'razorpay' ORDER BY id DESC LIMIT 1`,
    orderId
  );
}

export async function paymentIdOwner(paymentId: string) {
  if (!paymentId) return undefined;
  return await one<PaymentRow>(`SELECT * FROM payments WHERE provider_payment_id = ? LIMIT 1`, paymentId);
}

export async function abandonedOrders(bookingId: number) {
  return await all<PaymentRow>(
    `SELECT * FROM payments WHERE booking_id = ? AND mode='razorpay' AND status IN ('created','authorized')`,
    bookingId as Bind
  );
}

/** True when a validated, settled payment already exists for this booking. */
export async function bookingSettled(bookingId: number) {
  return Boolean(
    await one(`SELECT 1 AS x FROM payments WHERE booking_id = ? AND status = 'paid' AND kind != 'refund'`, bookingId)
  );
}

// ---------------------------------------------------------------- settle
export type CheckFailure = { ok: false; code: number; error: string; reason: string };
export type CheckSuccess = { ok: true; payment: PaymentRow; idempotent: boolean; bookingStatus: string };

/**
 * The one and only path from "gateway says captured" to "booking is paid".
 *
 * Callers must have already established one of:
 *   - a valid checkout signature AND a server-API `/payments/:id` capture, or
 *   - a valid webhook signature with event `payment.captured`.
 * Everything else is re-derived here from stored state, inside a transaction.
 */
export async function settleCapturedPayment(opts: {
  bookingId: number;
  orderId: string;
  paymentId: string;
  /** Amount in paise as reported by the gateway. Required by the webhook path. */
  amountPaise?: number;
  currency?: string;
  source: "checkout" | "webhook";
}): Promise<CheckSuccess | CheckFailure> {
  const { bookingId, orderId, paymentId } = opts;
  if (!orderId || !paymentId) {
    return { ok: false, code: 422, error: "Missing gateway order/payment id", reason: "missing_ids" };
  }

  return await tx(async (): Promise<CheckSuccess | CheckFailure> => {
    const payment = await orderFor(orderId);

    // 1. the order must exist, in this deployment, for this booking
    if (!payment) {
      return { ok: false, code: 400, error: "Unknown payment order. No order with that id exists here — nothing was marked as paid.", reason: "order_not_found" };
    }
    if (payment.booking_id !== bookingId) {
      return { ok: false, code: 400, error: "That payment order belongs to a different booking. Nothing was marked as paid.", reason: "order_booking_mismatch" };
    }
    if (payment.mode !== "razorpay") {
      return { ok: false, code: 400, error: "That payment record is not a gateway order. Nothing was marked as paid.", reason: "order_mode_mismatch" };
    }

    // 2. terminal-negative states can never come back to life
    if (payment.status === "failed") {
      return { ok: false, code: 409, error: "That payment failed. Start a new payment attempt.", reason: "payment_failed" };
    }
    if (payment.status === "refunded") {
      return { ok: false, code: 409, error: "That payment was refunded and cannot be used to pay again.", reason: "payment_refunded" };
    }

    // 3. reuse / replay of a payment id against a different order
    const owner = await paymentIdOwner(paymentId);
    if (owner && owner.id !== payment.id) {
      return { ok: false, code: 409, error: "That payment id was already used for another order. Nothing was marked as paid.", reason: "payment_id_reused" };
    }
    if (payment.provider_payment_id && payment.provider_payment_id !== paymentId) {
      return { ok: false, code: 409, error: "That order was already settled by a different payment. Nothing was marked as paid.", reason: "order_already_settled" };
    }

    // 4. amount must match the booking's immutable snapshot
    const price = await bookingPrice(bookingId);
    if (!price) {
      return { ok: false, code: 404, error: "Booking not found", reason: "booking_not_found" };
    }
    if (!sameAmount(payment.amount, price.amountRupees)) {
      return { ok: false, code: 409, error: "The stored order amount does not match this booking's locked price. Nothing was marked as paid.", reason: "order_amount_mismatch" };
    }
    if (opts.amountPaise != null && Number(opts.amountPaise) !== price.amountPaise) {
      return { ok: false, code: 409, error: "The amount reported by the gateway does not match the booking total. Nothing was marked as paid.", reason: "gateway_amount_mismatch" };
    }
    const currency = String(opts.currency ?? payment.currency ?? "INR").toUpperCase();
    if (currency !== price.currency) {
      return { ok: false, code: 409, error: "The payment currency does not match this booking. Nothing was marked as paid.", reason: "currency_mismatch" };
    }

    // 5. idempotent replay: same order, same payment id, already paid
    if (payment.status === "paid" && payment.provider_payment_id === paymentId) {
      const b = await one<{ status: string }>(`SELECT status FROM bookings WHERE id = ?`, bookingId);
      return { ok: true, payment, idempotent: true, bookingStatus: b?.status ?? "paid" };
    }

    // 6. settle: payment row, booking status, deposit record — atomically
    const now = new Date().toISOString();
    await run(
      `UPDATE payments SET status='paid', paid_at=?, captured_at=?, provider_payment_id=?, signature_valid=1
        WHERE id = ? AND status IN ('created','pending','authorized')`,
      now, now, paymentId, payment.id
    );
    await run(
      `UPDATE bookings SET status = CASE WHEN status IN ('approved','awaiting_payment') THEN 'paid' ELSE status END,
              updated_at = ? WHERE id = ?`,
      now, bookingId
    );
    await run(
      `INSERT INTO deposits (booking_id, amount, status, note)
       SELECT id, deposit, 'held_demo', ? FROM bookings
        WHERE id = ? AND NOT EXISTS (SELECT 1 FROM deposits WHERE booking_id = ?)`,
      depositSafetyNote(), bookingId, bookingId
    );
    // Notify the provider inside the same transaction as the money transition.
    const prov = await one<{ user_id: number; code: string }>(
      `SELECT p.user_id, b.code FROM bookings b JOIN provider_profiles p ON p.id = b.provider_id WHERE b.id = ?`,
      bookingId
    );
    if (prov) {
      await notify(prov.user_id, "payment", "Payment received",
        `${prov.code} is paid (${opts.source === "webhook" ? "confirmed by webhook" : "confirmed with Razorpay"}). Prepare the equipment for handover.`,
        `/provider/bookings/${bookingId}`);
    }
    const b = await one<{ status: string }>(`SELECT status FROM bookings WHERE id = ?`, bookingId);
    return {
      ok: true,
      payment: { ...payment, status: "paid", provider_payment_id: paymentId, captured_at: now, paid_at: now },
      idempotent: false,
      bookingStatus: b?.status ?? "paid",
    };
  });
}

/** Kept for callers written against the earlier name. */
export const applyConfirmedPayment = settleCapturedPayment;

/** Records an authorised-but-uncaptured payment. Never makes a booking payable. */
export async function recordAuthorizedPayment(orderId: string, paymentId: string) {
  const payment = await orderFor(orderId);
  if (!payment) return { ok: false as const, reason: "order_not_found" };
  if (payment.status === "paid") return { ok: true as const, idempotent: true };
  if (payment.status === "failed" || payment.status === "refunded") {
    return { ok: false as const, reason: `payment_${payment.status}` };
  }
  await run(
    `UPDATE payments SET status='authorized', provider_payment_id=?, signature_valid=1
      WHERE id=? AND status IN ('created','pending')`,
    paymentId, payment.id
  );
  return { ok: true as const, idempotent: false };
}
