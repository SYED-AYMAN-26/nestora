import { z } from "zod";
import { guard, ok, fail, parseBody } from "@/lib/http";
import { getSessionUser } from "@/lib/auth";
import { loadBookingForUser } from "@/lib/access";
import { all, run } from "@/lib/db";
import { notify } from "@/lib/audit";

const schema = z.object({ body: z.string().min(1).max(2000) });

/** Booking-scoped secure messaging: only the buyer, provider and admins. */
export const POST = guard(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await getSessionUser();
  if (!user) return fail("Authentication required", 401);
  const { id } = await ctx.params;
  const access = await loadBookingForUser(Number(id), user);
  if (!access) return fail("Booking not found", 404);
  const parsed = await parseBody(req, schema);
  if (!parsed.ok) return parsed.res;
  await run(`INSERT INTO messages (booking_id, sender_id, body) VALUES (?,?,?)`, access.booking.id, user.id, parsed.data.body.trim());

  const counterparty = access.role === "buyer"
    ? (await import("@/lib/db")).one<{ user_id: number }>(`SELECT user_id FROM provider_profiles WHERE id = ?`, access.booking.provider_id)?.user_id
    : access.booking.buyer_id;
  if (counterparty) await notify(counterparty, "message", "New message", `${user.full_name}: ${parsed.data.body.slice(0, 80)}`, `/bookings/${access.booking.id}`);
  return ok({ sent: true });
});

export const GET = guard(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await getSessionUser();
  if (!user) return fail("Authentication required", 401);
  const { id } = await ctx.params;
  const access = await loadBookingForUser(Number(id), user);
  if (!access) return fail("Booking not found", 404);
  const rows = await all(
    `SELECT m.*, u.full_name AS sender_name FROM messages m JOIN users u ON u.id = m.sender_id
      WHERE m.booking_id = ? ORDER BY m.id`, access.booking.id
  );
  return ok({ messages: rows });
});
