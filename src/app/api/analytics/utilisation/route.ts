import { guard, ok, fail } from "@/lib/http";
import { getSessionUser } from "@/lib/auth";
import { underusedForProvider } from "@/lib/resources";
import { computeUtilisation } from "@/lib/booking";
import { all, one } from "@/lib/db";

/**
 * Resource Utilisation Intelligence — computed from stored records.
 * Every number is derived from bookings/maintenance; estimated idleness is
 * labelled separately from confirmed availability.
 */
export const GET = guard(async (req: Request) => {
  const user = await getSessionUser();
  if (!user) return fail("Authentication required", 401);
  if (!user.provider && user.role !== "admin") return fail("Provider profile required", 403);

  const url = new URL(req.url);
  const requested = url.searchParams.get("providerId");
  // An admin may have no provider profile of their own, so a missing providerId
  // is a client error — not a null dereference.
  if (user.role === "admin" && !requested) {
    return fail("providerId is required for admin requests", 400);
  }
  const providerId = user.role === "admin" ? Number(requested) : user.provider!.id;
  if (!Number.isInteger(providerId) || providerId <= 0) return fail("Invalid providerId", 400);

  if (user.role !== "admin" && user.provider!.id !== providerId) return fail("Forbidden", 403);

  const refresh = url.searchParams.get("refresh") === "1";
  if (refresh) {
    for (const r of await all<{ id: number }>(`SELECT id FROM resources WHERE provider_id = ?`, providerId)) await computeUtilisation(r.id);
  }

  const items = await underusedForProvider(providerId);
  const totals = items.reduce(
    (acc, r) => {
      acc.totalUnits += Number(r.quantity_total);
      acc.idleUnits += r.idle_units;
      acc.listings += 1;
      acc.weightedUtil += r.utilisation_pct * Number(r.quantity_total);
      return acc;
    },
    { totalUnits: 0, idleUnits: 0, listings: 0, weightedUtil: 0 }
  );

  const summary = {
    listings: totals.listings,
    totalUnits: totals.totalUnits,
    estimatedIdleUnits: totals.idleUnits,
    avgUtilisationPct: totals.totalUnits ? Math.round((totals.weightedUtil / totals.totalUnits) * 10) / 10 : 0,
    frequentlyUsed: items.filter((r) => r.classification === "frequently_used").length,
    underused: items.filter((r) => r.classification === "underused").length,
    noRecentBookings: items.filter((r) => r.classification === "no_recent_bookings").length,
    isDemo: Boolean(items[0]?.is_demo),
  };

  const provider = await one(`SELECT * FROM provider_profiles WHERE id = ?`, providerId);
  return ok({
    items, summary,
    provider: { id: providerId, name: provider?.display_name, isDemo: Boolean(provider?.is_demo) },
    methodology: {
      utilisation: "Booked unit-days ÷ (shareable capacity × window days), over a rolling 60-day window, from stored booking records.",
      idleEstimate: "Total units − units the provider declares as in internal use. This is an ESTIMATE of idleness, not confirmed availability.",
      confirmation: "A resource only becomes bookable once the provider marks it active and its availability calendar allows it.",
    },
  });
});
