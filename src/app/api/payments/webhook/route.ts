import { fail, ok } from "@/lib/http";
import { run } from "@/lib/db";
import {
  bookingPrice, orderFor, recordAuthorizedPayment, settleCapturedPayment, toPaise, verifyWebhook,
} from "@/lib/payments";
import { audit } from "@/lib/audit";

type RazorpayPaymentEntity = {
  id?: string;
  entity?: string;
  order_id?: string | null;
  amount?: number | string | null;
  currency?: string | null;
  status?: string;
  captured?: boolean;
};
type RazorpayEvent = {
  event?: string;
  payload?: { payment?: { entity?: RazorpayPaymentEntity } };
};

const SUPPORTED = new Set([
  "payment.captured",
  "payment.authorized",
  "payment.failed",
  "payment.refunded",
  "refund.created",
  "refund.processed",
]);

/**
 * Razorpay webhook receiver.
 *
 * Order of operations, each step mandatory:
 *   1. HMAC-SHA256 over the EXACT raw request body (text(), never the parsed JSON)
 *   2. the event type must be one we handle
 *   3. the order id must exist in `payments` (created by this deployment)
 *   4. the payment entity must carry the fields we need — missing amount/currency
 *      is a rejection for capture events, not an "assume it's fine"
 *   5. amount (paise) and currency are compared against the booking's locked
 *      price snapshot AND the stored order amount
 *   6. only then does await settleCapturedPayment() run, inside a transaction
 *
 * `payment.authorized` is deliberately NOT a settlement: authorised ≠ captured.
 * Failed / refunded payments can never later become paid.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const signature = req.headers.get("x-razorpay-signature");

  if (!process.env.RAZORPAY_WEBHOOK_SECRET) {
    return fail("Webhook secret is not configured on this deployment", 503);
  }
  if (!verifyWebhook(raw, signature)) {
    await audit({ action: "payment.webhook_signature_invalid", entity: "payment", detail: { signature: signature ? "present" : "missing" } });
    return fail("Invalid webhook signature", 400);
  }

  let event: RazorpayEvent;
  try {
    event = JSON.parse(raw) as RazorpayEvent;
  } catch {
    return fail("Malformed JSON", 400);
  }

  const eventName = event.event ?? "";
  if (!SUPPORTED.has(eventName)) {
    await audit({ action: "payment.webhook_unsupported_event", entity: "payment", detail: { event: eventName } });
    return ok({ received: true, ignored: true, reason: `unsupported event ${eventName || "(none)"}` });
  }

  const entity = event?.payload?.payment?.entity;
  const orderId = entity?.order_id ?? null;
  const paymentId = entity?.id ?? null;
  if (!orderId || !paymentId) {
    await audit({ action: "payment.webhook_missing_ids", entity: "payment", detail: { event: eventName, hasOrder: Boolean(orderId), hasPayment: Boolean(paymentId) } });
    return ok({ received: true, ignored: true, reason: "missing order or payment id" });
  }

  const payment = await orderFor(orderId);
  if (!payment) {
    // Unknown order: acknowledge (so Razorpay stops retrying) but change nothing.
    await audit({ action: "payment.webhook_unknown_order", entity: "payment", detail: { orderId, paymentId, event: eventName } });
    return ok({ received: true, ignored: true, reason: "unknown order" });
  }

  const price = await bookingPrice(payment.booking_id);

  switch (eventName) {
    case "payment.captured": {
      // Capture events MUST carry amount and currency. Absence is a rejection.
      const hasAmount = entity?.amount !== undefined && entity?.amount !== null && entity?.amount !== "";
      const hasCurrency = typeof entity?.currency === "string" && entity.currency.length > 0;
      if (!hasAmount || !hasCurrency) {
        await audit({
          action: "payment.webhook_missing_amount", entity: "payment", entityId: payment.id,
          detail: { orderId, paymentId, event: eventName, amount: entity?.amount ?? null, currency: entity?.currency ?? null },
        });
        return ok({ received: true, ignored: true, reason: "captured event missing amount or currency" });
      }
      if (!price) {
        await audit({ action: "payment.webhook_no_booking", entity: "payment", entityId: payment.id, detail: { orderId, paymentId } });
        return ok({ received: true, ignored: true, reason: "booking not found" });
      }

      // Razorpay reports PAISE; the database stores RUPEES. Compare in paise.
      const reportedPaise = Number(entity.amount);
      const expectedPaise = price.amountPaise;
      const storedPaise = toPaise(payment.amount);
      const currency = String(entity.currency).toUpperCase();

      if (!Number.isFinite(reportedPaise) || reportedPaise !== expectedPaise || reportedPaise !== storedPaise) {
        await audit({
          action: "payment.webhook_amount_mismatch", entity: "payment", entityId: payment.id,
          detail: { orderId, paymentId, reportedPaise, expectedPaise, storedPaise },
        });
        return ok({ received: true, ignored: true, reason: "amount mismatch" });
      }
      if (currency !== price.currency) {
        await audit({
          action: "payment.webhook_currency_mismatch", entity: "payment", entityId: payment.id,
          detail: { orderId, paymentId, reported: currency, expected: price.currency },
        });
        return ok({ received: true, ignored: true, reason: "currency mismatch" });
      }
      // Razorpay may send `status: authorized` with captured=true in odd cases; trust
      // the explicit captured flag/status pair.
      if (entity.status && entity.status !== "captured" && entity.captured !== true) {
        await audit({
          action: "payment.webhook_not_captured", entity: "payment", entityId: payment.id,
          detail: { orderId, paymentId, status: entity.status, captured: entity.captured ?? null },
        });
        return ok({ received: true, ignored: true, reason: `payment status is ${entity.status}` });
      }

      const settled = await settleCapturedPayment({
        bookingId: payment.booking_id, orderId, paymentId,
        amountPaise: reportedPaise, currency, source: "webhook",
      });
      if (!settled.ok) {
        await audit({
          action: "payment.webhook_rejected", entity: "payment", entityId: payment.id,
          detail: { reason: settled.reason, orderId, paymentId },
        });
        return ok({ received: true, ignored: true, reason: settled.reason });
      }
      await audit({
        action: settled.idempotent ? "payment.webhook_repeated" : "payment.webhook_captured",
        entity: "payment", entityId: payment.id,
        detail: { orderId, paymentId, amountPaise: reportedPaise, currency, idempotent: settled.idempotent },
      });
      return ok({ received: true, idempotent: settled.idempotent });
    }

    case "payment.authorized": {
      // Authorised is NOT captured. Record it, never mark the booking paid.
      if (payment.status === "failed" || payment.status === "refunded") {
        await audit({ action: "payment.webhook_rejected", entity: "payment", entityId: payment.id, detail: { reason: `authorized_after_${payment.status}`, orderId, paymentId } });
        return ok({ received: true, ignored: true, reason: `payment is ${payment.status}` });
      }
      const res = await recordAuthorizedPayment(orderId, paymentId);
      await audit({
        action: "payment.webhook_authorized", entity: "payment", entityId: payment.id,
        detail: { orderId, paymentId, bookedPaid: false, note: "authorised only — not captured, booking NOT marked paid", recorded: res.ok },
      });
      return ok({ received: true, status: "authorized", bookingPaid: false });
    }

    case "payment.failed": {
      if (payment.status !== "paid") {
        await run(`UPDATE payments SET status='failed', provider_payment_id=? WHERE id=?`, paymentId, payment.id);
        await audit({ action: "payment.webhook_failed", entity: "payment", entityId: payment.id, detail: { orderId, paymentId, amount: entity?.amount ?? null } });
        return ok({ received: true });
      }
      // A failed event for an already-paid order is a contradiction; keep the money
      // state and flag it for a human.
      await audit({ action: "payment.webhook_failed_after_paid", entity: "payment", entityId: payment.id, detail: { orderId, paymentId } });
      return ok({ received: true, ignored: true, reason: "order already paid — left untouched" });
    }

    case "payment.refunded":
    case "refund.created":
    case "refund.processed": {
      if (payment.status === "paid" || payment.status === "authorized") {
        await run(`UPDATE payments SET status='refunded' WHERE id=?`, payment.id);
      }
      await audit({ action: "payment.webhook_refunded", entity: "payment", entityId: payment.id, detail: { orderId, paymentId, event: eventName, amount: entity?.amount ?? null } });
      return ok({ received: true });
    }

    default:
      return ok({ received: true, ignored: true, reason: `unhandled event ${eventName}` });
  }
}
