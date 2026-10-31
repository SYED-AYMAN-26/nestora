import { z } from "zod";
import { guard, ok, fail } from "@/lib/http";
import { getSessionUser } from "@/lib/auth";
import { loadBookingForUser } from "@/lib/access";
import { audit } from "@/lib/audit";
import {
  approveBooking, rejectBooking, counterOffer, respondCounter, providerCancel, buyerCancel,
  providerReady, buyerConfirmHandover, buyerRequestReturn, providerConfirmReturn,
  requestExtension, decideExtension,
} from "@/lib/lifecycle";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve") }),
  z.object({ action: z.literal("reject"), reason: z.string().min(5).max(500) }),
  z.object({ action: z.literal("counter"), start: z.string(), end: z.string(), note: z.string().max(500).optional() }),
  z.object({ action: z.literal("counter_accept") }),
  z.object({ action: z.literal("counter_decline") }),
  z.object({ action: z.literal("provider_cancel"), reason: z.string().min(5).max(500) }),
  z.object({ action: z.literal("buyer_cancel"), reason: z.string().max(500).optional() }),
  z.object({
    action: z.literal("provider_ready"),
    initial_condition: z.enum(["new", "excellent", "good", "fair"]),
    checklist: z.array(z.string().max(120)).min(1),
    photos: z.array(z.string().max(300)).min(1),
    note: z.string().max(500).optional(),
  }),
  z.object({ action: z.literal("buyer_confirm"), accepted: z.boolean(), note: z.string().max(500).optional(), photos: z.array(z.string().max(300)).default([]) }),
  z.object({ action: z.literal("request_return"), photos: z.array(z.string().max(300)).min(1), note: z.string().max(500).optional(), condition: z.enum(["new", "excellent", "good", "fair"]) }),
  z.object({
    action: z.literal("confirm_return"), accept: z.boolean(),
    condition: z.enum(["new", "excellent", "good", "fair"]),
    checklist: z.array(z.string().max(120)).default([]),
    photos: z.array(z.string().max(300)).min(1),
    note: z.string().max(500).optional(),
  }),
  z.object({ action: z.literal("request_extension"), end: z.string(), note: z.string().max(500).optional() }),
  z.object({ action: z.literal("decide_extension"), extensionId: z.number().int(), approve: z.boolean(), note: z.string().max(500).optional() }),
  z.object({ action: z.literal("pay") }),
]);

/**
 * Single dispatch endpoint for the booking lifecycle. Every branch re-checks
 * the caller's relationship to the booking and the current status server-side.
 */
export const POST = guard(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await getSessionUser();
  if (!user) return fail("Authentication required", 401);
  const { id } = await ctx.params;
  const access = await loadBookingForUser(Number(id), user);
  if (!access) return fail("Booking not found", 404);

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return fail(`${first?.path?.join(".") || "input"}: ${first?.message || "invalid"}`, 422);
  }
  const d = parsed.data;

  let result: Awaited<ReturnType<typeof approveBooking>>;
  switch (d.action) {
    case "approve": result = await approveBooking(access); break;
    case "reject": result = await rejectBooking(access, d.reason); break;
    case "counter": result = await counterOffer(access, d.start, d.end, d.note ?? ""); break;
    case "counter_accept": result = await respondCounter(access, true); break;
    case "counter_decline": result = await respondCounter(access, false); break;
    case "provider_cancel": result = await providerCancel(access, d.reason); break;
    case "buyer_cancel": result = await buyerCancel(access, d.reason ?? ""); break;
    case "provider_ready": result = await providerReady(access, d); break;
    case "buyer_confirm": result = await buyerConfirmHandover(access, d); break;
    case "request_return": result = await buyerRequestReturn(access, d); break;
    case "confirm_return": result = await providerConfirmReturn(access, d); break;
    case "request_extension": result = await requestExtension(access, d.end, d.note); break;
    case "decide_extension": result = await decideExtension(access, d.extensionId, d.approve, d.note); break;
    case "pay": return fail("Use the payment endpoint", 400);
  }

  if (!result.ok) {
    await audit({
      actorId: user.id, actorEmail: user.email, action: `booking.${d.action}_denied`,
      entity: "booking", entityId: access.booking.id, detail: { error: result.error, status: access.booking.status },
    });
    return fail(result.error, result.code ?? 409);
  }

  await audit({
    actorId: user.id, actorEmail: user.email, action: `booking.${d.action}`,
    entity: "booking", entityId: access.booking.id,
    detail: { from: access.booking.status, to: result.status ?? null },
  });
  return ok({ message: result.message, status: result.status ?? null });
});
