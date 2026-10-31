import { z } from "zod";
import { guard, ok, fail, parseBody } from "@/lib/http";
import { getSessionUser } from "@/lib/auth";
import { all, Bind, one } from "@/lib/db";
import { createBooking, quote } from "@/lib/booking";
import { audit, notify, rateLimit } from "@/lib/audit";
import { joinWaitingList } from "@/lib/lifecycle";

const schema = z.object({
  resourceId: z.number().int().positive(),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  units: z.number().int().min(1).max(100).default(1),
  basis: z.enum(["hourly", "daily", "weekly"]).default("daily"),
  purpose: z.string().max(500).optional().nullable(),
  joinWaitingList: z.boolean().optional().default(false),
});

export const POST = guard(async (req: Request) => {
  const user = await getSessionUser();
  if (!user) return fail("Authentication required", 401);
  const rl = await rateLimit(`booking:${user.id}`, 12, 3600);
  if (!rl.ok) return fail(`Too many booking requests. Try again in ${rl.retryAfter}s.`, 429);

  const parsed = await parseBody(req, schema);
  if (!parsed.ok) return parsed.res;
  const d = parsed.data;

  const res = await one(`SELECT * FROM resources WHERE id = ?`, d.resourceId);
  if (!res) return fail("Resource not found", 404);

  // Eligibility is enforced server-side, never in the client only.
  const eligibleTypes = res.eligibility?.match(/institutional accounts/i) ? ["college_university", "company", "organisation", "other_institution", "community_organisation"] : null;
  if (eligibleTypes && !eligibleTypes.includes(user.account_type)) {
    return fail("This resource is limited to institutional accounts. Update your account type in settings if that is incorrect.", 403);
  }

  const result = await createBooking({
    resourceId: d.resourceId, buyerId: user.id, start: d.start, end: d.end,
    units: d.units, basis: d.basis, purpose: d.purpose ?? null,
  });

  if (!result.ok) {
    if (result.waiting && d.joinWaitingList) {
      const w = await joinWaitingList({ resource: res, userId: user.id }, d.start, d.end, d.units);
      if (w.ok) return ok({ waitingListed: true, message: w.message });
      return fail(w.ok ? "" : w.error, 409);
    }
    return fail(result.error, 409, { canJoinWaitingList: Boolean(result.waiting) });
  }

  const booking = await one(`SELECT * FROM bookings WHERE id = ?`, result.bookingId)!;
  const providerUser = await one<{ user_id: number }>(`SELECT user_id FROM provider_profiles WHERE id = ?`, booking.provider_id);
  if (providerUser) {
    await notify(providerUser.user_id, "booking_request", "New booking request",
      `${user.full_name} requested ${res.title} (${booking.code}).`, `/provider/bookings/${booking.id}`);
  }
  await notify(user.id, "booking_request", "Booking request sent",
    `Your request ${booking.code} was sent to the provider. Priority score: ${booking.priority_score}.`, `/bookings/${booking.id}`);
  await audit({ actorId: user.id, actorEmail: user.email, action: "booking.create", entity: "booking", entityId: booking.id, detail: { resourceId: d.resourceId, start: d.start, end: d.end } });

  return ok({
    bookingId: booking.id,
    code: booking.code,
    status: booking.status,
    quote: quote(res, d.start, d.end, d.units, d.basis),
    priority: { score: booking.priority_score, reason: booking.priority_reason },
    message: "Booking request submitted. The provider must approve it before you pay.",
  });
});

export const GET = guard(async (req: Request) => {
  const user = await getSessionUser();
  if (!user) return fail("Authentication required", 401);
  const url = new URL(req.url);
  const as = url.searchParams.get("as") || "buyer";
  const status = url.searchParams.get("status");
  const where: string[] = [];
  const params: Bind[] = [];
  if (as === "provider") {
    if (!user.provider) return ok({ items: [], providerProfile: false });
    where.push("b.provider_id = ?");
    params.push(user.provider.id);
  } else {
    where.push("b.buyer_id = ?");
    params.push(user.id);
  }
  if (status && status !== "all") {
    const list = status.split(",");
    where.push(`b.status IN (${list.map(() => "?").join(",")})`);
    params.push(...list);
  }
  const items = await all(
    `SELECT b.*, r.title AS resource_title, r.category,
            (SELECT url FROM resource_images i WHERE i.resource_id = r.id ORDER BY sort_order LIMIT 1) AS image_url,
            p.display_name AS provider_name, p.storefront_slug,
            u.full_name AS buyer_name
       FROM bookings b
       JOIN resources r ON r.id = b.resource_id
       JOIN provider_profiles p ON p.id = b.provider_id
       JOIN users u ON u.id = b.buyer_id
      WHERE ${where.join(" AND ")}
      ORDER BY b.created_at DESC LIMIT 200`,
    ...params
  );
  return ok({ items, providerProfile: Boolean(user.provider) });
});
