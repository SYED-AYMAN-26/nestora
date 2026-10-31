import { guard, ok } from "@/lib/http";
import { computeImpact } from "@/lib/impact";

/** Institutional impact dashboard data — calculated from stored records. */
export const GET = guard(async (req: Request) => {
  const url = new URL(req.url);
  const data = await computeImpact({
    from: url.searchParams.get("from") || undefined,
    to: url.searchParams.get("to") || undefined,
    category: url.searchParams.get("category") || undefined,
  });
  return ok(data);
});
