import { guard, ok, fail } from "@/lib/http";
import { getSessionUser } from "@/lib/auth";
import { loadBookingForUser } from "@/lib/access";
import { bookingBundle } from "@/lib/lifecycle";

export const GET = guard(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await getSessionUser();
  if (!user) return fail("Authentication required", 401);
  const { id } = await ctx.params;
  const access = await loadBookingForUser(Number(id), user);
  // Same 404 for "missing" and "not yours" so listing existence is not leaked.
  if (!access) return fail("Booking not found", 404);
  const bundle = await bookingBundle(Number(id));
  if (!bundle) return fail("Booking not found", 404);
  return ok({ ...bundle, role: access.role });
});
