import { z } from "zod";
import { guard, ok, fail, parseBody } from "@/lib/http";
import { getSessionUser } from "@/lib/auth";
import { loadBookingForUser } from "@/lib/access";
import { audit, rateLimit } from "@/lib/audit";
import {
  bookingPrice, bookingSettled, createRazorpayOrder, depositSafetyNote, paymentMode, paymentModeLabel,
  razorpayConfigured, recordPayment, settleCapturedPayment, verifyCaptureWithGateway, verifyRazorpaySignature,
} from "@/lib/payments";
import { markPaid } from "@/lib/lifecycle";

export const GET = guard(async () => {
  return ok({
    mode: paymentMode(),
    label: paymentModeLabel(),
    razorpayKeyId: razorpayConfigured() ? process.env.RAZORPAY_KEY_ID : null,
    deposit: depositSafetyNote(),
  });
});

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), bookingId: z.number().int() }),
  z.object({
    action: z.literal("confirm"), bookingId: z.number().int(),
    razorpay_order_id: z.string().max(120).optional(),
    razorpay_payment_id: z.string().max(120).optional(),
    razorpay_signature: z.string().max(200).optional(),
  }),
]);

export const POST = guard(async (req: Request) => {
  const user = await getSessionUser();
  if (!user) return fail("Authentication required", 401);
  const rl = await rateLimit(`pay:${user.id}`, 20, 3600);
  if (!rl.ok) return fail(`Too many payment attempts. Try again in ${rl.retryAfter}s.`, 429);

  const parsed = await parseBody(req, schema);
  if (!parsed.ok) return parsed.res;
  const d = parsed.data;

  // Ownership is re-derived from the session on every call: a buyer can only ever
  // pay their own booking, and a provider can never pay their own listing.
  const access = await loadBookingForUser(d.bookingId, user);
  if (!access) return fail("Booking not found", 404);
  if (access.role === "provider") {
    await audit({ actorId: user.id, actorEmail: user.email, action: "payment.rejected", entity: "booking", entityId: d.bookingId, detail: { reason: "provider_self_payment" } });
    return fail("Providers cannot pay for their own resource bookings", 403);
  }
  if (access.role !== "buyer" && access.role !== "admin") return fail("Only the buyer can pay for this booking", 403);

  // The amount always comes from the booking's locked snapshot — never the client,
  // never the provider's current price list.
  const price = await bookingPrice(access.booking.id);
  if (!price) return fail("Booking not found", 404);

  if (d.action === "create") {
    if (!["approved", "awaiting_payment"].includes(access.booking.status)) {
      return fail(`Payment is not available while the booking is "${access.booking.status}"`, 409);
    }
    if (!razorpayConfigured()) {
      return ok({
        mode: "demo",
        amount: price.amountRupees,
        breakdown: price.breakdown,
        deposit: depositSafetyNote(),
        message:
          "DEMO PAYMENT MODE — no gateway credentials are configured, so no money moves and no card details are collected. Confirm to record a simulated payment.",
      });
    }
    try {
      const order = await createRazorpayOrder(price.amountRupees, `booking_${access.booking.id}`, {
        booking_id: String(access.booking.id),
      });
      // The order we just created is the ONLY thing that may later settle this booking.
      const paymentId = await recordPayment({
        bookingId: access.booking.id, kind: "rental", amount: price.amountRupees, mode: "razorpay",
        status: "created", providerOrderId: order.id,
        meta: {
          order, breakdown: price.breakdown, snapshot: price.snapshot,
          order_amount_paise: order.amount, currency: order.currency,
        },
      });
      await audit({ actorId: user.id, actorEmail: user.email, action: "payment.order_created", entity: "payment", entityId: paymentId, detail: { orderId: order.id, amountDue: price.amountRupees, orderAmount: order.amount, currency: order.currency } });
      return ok({ mode: "razorpay_test", order, amount: price.amountRupees, breakdown: price.breakdown, keyId: process.env.RAZORPAY_KEY_ID, paymentRow: paymentId });
    } catch (e) {
      console.error("[payments] razorpay order failed", e);
      return fail("Could not create a Razorpay test order. Check the configured keys, or use demo mode.", 502);
    }
  }

  // --- confirm -------------------------------------------------------------
  if (razorpayConfigured()) {
    if (!d.razorpay_order_id || !d.razorpay_payment_id || !d.razorpay_signature) {
      return fail("Missing Razorpay verification fields", 422);
    }
    if (!verifyRazorpaySignature(d.razorpay_order_id, d.razorpay_payment_id, d.razorpay_signature)) {
      await audit({ actorId: user.id, actorEmail: user.email, action: "payment.signature_invalid", entity: "booking", entityId: access.booking.id, detail: { orderId: d.razorpay_order_id } });
      return fail("Payment signature verification failed. Nothing has been marked as paid.", 400);
    }

    // A valid signature proves the triples came from a checkout — NOT that money
    // was captured. Confirm capture with Razorpay's server API before settling.
    const gateway = await verifyCaptureWithGateway(d.razorpay_payment_id, d.razorpay_order_id);
    if (!gateway.ok) {
      await audit({ actorId: user.id, actorEmail: user.email, action: "payment.capture_unverified", entity: "booking", entityId: access.booking.id, detail: { orderId: d.razorpay_order_id, paymentId: d.razorpay_payment_id, error: gateway.error } });
      return fail(
        "Could not confirm the payment capture with Razorpay. Nothing has been marked as paid — the verified webhook will settle this booking if the payment did capture.",
        502
      );
    }
    if (gateway.orderId && gateway.orderId !== d.razorpay_order_id) {
      await audit({ actorId: user.id, actorEmail: user.email, action: "payment.rejected", entity: "booking", entityId: access.booking.id, detail: { reason: "gateway_order_mismatch", orderId: d.razorpay_order_id, gatewayOrderId: gateway.orderId } });
      return fail("The payment does not belong to that order. Nothing has been marked as paid.", 400);
    }
    if (!gateway.captured) {
      await audit({ actorId: user.id, actorEmail: user.email, action: "payment.not_captured", entity: "booking", entityId: access.booking.id, detail: { orderId: d.razorpay_order_id, paymentId: d.razorpay_payment_id, gatewayStatus: gateway.status } });
      return fail(
        `The payment is "${gateway.status}", not captured. Nothing has been marked as paid — an authorised payment only becomes paid once Razorpay captures it.`,
        409
      );
    }

    const settled = await settleCapturedPayment({
      bookingId: access.booking.id,
      orderId: d.razorpay_order_id,
      paymentId: d.razorpay_payment_id,
      amountPaise: gateway.amountPaise,
      currency: gateway.currency,
      source: "checkout",
    });
    if (!settled.ok) {
      await audit({
        actorId: user.id, actorEmail: user.email, action: "payment.rejected", entity: "booking",
        entityId: access.booking.id,
        detail: { reason: settled.reason, orderId: d.razorpay_order_id, paymentId: d.razorpay_payment_id },
      });
      return fail(settled.error, settled.code);
    }
    await audit({
      actorId: user.id, actorEmail: user.email, action: settled.idempotent ? "payment.repeated_confirm" : "payment.paid",
      entity: "booking", entityId: access.booking.id,
      detail: { amount: price.amountRupees, mode: "razorpay_test", orderId: d.razorpay_order_id, paymentId: d.razorpay_payment_id, idempotent: settled.idempotent },
    });
    return ok({
      message: settled.idempotent
        ? "This payment was already confirmed. Your booking is paid."
        : "Razorpay test payment verified with the gateway and matched to this booking. Your booking is confirmed.",
      breakdown: price.breakdown,
      mode: "razorpay_test",
      idempotent: settled.idempotent,
      deposit: depositSafetyNote(),
    });
  }

  // --- demo mode -----------------------------------------------------------
  if (!["approved", "awaiting_payment"].includes(access.booking.status)) {
    return fail(`Payment is not available while the booking is "${access.booking.status}"`, 409);
  }
  if (await bookingSettled(access.booking.id)) {
    return ok({
      message: "A demo payment is already recorded for this booking (no money was transferred).",
      breakdown: price.breakdown, mode: "demo", idempotent: true, deposit: depositSafetyNote(),
    });
  }
  await recordPayment({
    bookingId: access.booking.id, kind: "rental", amount: price.amountRupees, mode: "demo", status: "paid",
    meta: {
      label: "DEMO PAYMENT — simulated, no money transferred, no gateway involved",
      simulated_only: true,
      gateway_order: null,
    },
  });
  const res = await markPaid(access);
  if (!res.ok) return fail(res.error, res.code ?? 409);

  await audit({
    actorId: user.id, actorEmail: user.email, action: "payment.paid", entity: "booking", entityId: access.booking.id,
    detail: { amount: price.amountRupees, mode: "demo", simulated: true },
  });
  return ok({
    message: "Demo payment recorded (no money transferred). Your booking is confirmed.",
    breakdown: price.breakdown,
    mode: "demo",
    deposit: depositSafetyNote(),
  });
});
