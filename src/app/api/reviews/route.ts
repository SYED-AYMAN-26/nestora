import { z } from "zod";
import { guard, ok, fail, parseBody } from "@/lib/http";
import { getSessionUser } from "@/lib/auth";
import { one, Row, run } from "@/lib/db";
import { audit, notify } from "@/lib/audit";

const schema = z.object({
  bookingId: z.number().int(),
  rating: z.number().int().min(1).max(5),
  body: z.string().max(2000).optional(),
  condition_accuracy: z.number().int().min(1).max(5).optional(),
});

/** Reviews are only possible on completed bookings, one per booking. */
export const POST = guard(async (req: Request) => {
  const user = await getSessionUser();
  if (!user) return fail("Authentication required", 401);
  const parsed = await parseBody(req, schema);
  if (!parsed.ok) return parsed.res;
  const d = parsed.data;

  const b = await one<Row>(`SELECT * FROM bookings WHERE id = ?`, d.bookingId);
  if (!b) return fail("Booking not found", 404);
  if (b.buyer_id !== user.id) return fail("Only the buyer on this booking can review it", 403);
  if (b.status !== "completed") return fail("You can review a resource once the booking is completed", 409);
  if (await one(`SELECT 1 FROM reviews WHERE booking_id = ?`, b.id)) return fail("You have already reviewed this booking", 409);

  await run(`INSERT INTO reviews (booking_id, resource_id, provider_id, buyer_id, rating, body, condition_accuracy) VALUES (?,?,?,?,?,?,?)`,
    b.id, b.resource_id, b.provider_id, user.id, d.rating, d.body ?? null, d.condition_accuracy ?? null);

  const agg = await one<{ avg: number; c: number }>(`SELECT AVG(rating) AS avg, COUNT(*) AS c FROM reviews WHERE provider_id = ?`, b.provider_id);
  await run(`UPDATE provider_profiles SET rating_cached = ?, rating_count = ? WHERE id = ?`,
    Math.round((agg?.avg ?? 0) * 10) / 10, agg?.c ?? 0, b.provider_id);

  const pu = await one<{ user_id: number }>(`SELECT user_id FROM provider_profiles WHERE id = ?`, b.provider_id);
  if (pu) await notify(pu.user_id, "review", "New review", `${user.full_name} rated your resource ${d.rating}/5.`, `/bookings/${b.id}`);
  await audit({ actorId: user.id, actorEmail: user.email, action: "review.create", entity: "booking", entityId: b.id, detail: { rating: d.rating } });
  return ok({ message: "Thanks — your review is published." });
});
