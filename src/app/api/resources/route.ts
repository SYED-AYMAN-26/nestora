import { guard, ok } from "@/lib/http";
import { getSessionUser } from "@/lib/auth";
import { searchResources, type ResourceSearch } from "@/lib/resources";
import { pageParams } from "@/lib/access";

export const GET = guard(async (req: Request) => {
  await getSessionUser(); // ensures cookie parse / session validity
  const url = new URL(req.url);
  const { limit, offset } = pageParams(url, 24);
  const num = (k: string) => (url.searchParams.get(k) ? Number(url.searchParams.get(k)) : undefined);
  const res = await searchResources({
    q: url.searchParams.get("q") || undefined,
    category: url.searchParams.get("category") || undefined,
    city: url.searchParams.get("city") || undefined,
    minPrice: num("minPrice"),
    maxPrice: num("maxPrice"),
    condition: url.searchParams.get("condition") || undefined,
    providerType: url.searchParams.get("providerType") || undefined,
    verifiedOnly: url.searchParams.get("verified") === "1",
    availableFrom: url.searchParams.get("from") || undefined,
    availableTo: url.searchParams.get("to") || undefined,
    capability: url.searchParams.get("capability") || undefined,
    sort: (url.searchParams.get("sort") ?? "relevance") as ResourceSearch["sort"],
    limit,
    offset,
  });
  return ok(res);
});
