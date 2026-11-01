import Link from "next/link";
import { searchResources, type ResourceSearch } from "@/lib/resources";
import { CATEGORIES, CONDITIONS, ACCOUNT_TYPES } from "@/lib/constants";
import { ResourceCard } from "@/components/ResourceCard";
import { EmptyState, InfoNote } from "@/components/ui";
import { MarketplaceFilters } from "./Filters";
import { getSessionUser } from "@/lib/auth";
import { all } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata = { title: "Marketplace" };

type SP = Record<string, string | string[] | undefined>;
const str = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function MarketplacePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const filters = {
    q: str(sp.q),
    category: str(sp.category),
    city: str(sp.city),
    maxPrice: str(sp.maxPrice) ? Number(str(sp.maxPrice)) : undefined,
    condition: str(sp.condition),
    providerType: str(sp.providerType),
    verifiedOnly: str(sp.verified) === "1",
    availableFrom: str(sp.from),
    availableTo: str(sp.to),
    sort: (str(sp.sort) ?? "relevance") as ResourceSearch["sort"],
  };

  const { items, total } = await searchResources({ ...filters, limit: 48 });
  const user = await getSessionUser();
  const cities = (await all<{ city: string }>(
    `SELECT DISTINCT location_city AS city FROM resources WHERE status='active' AND location_city IS NOT NULL ORDER BY location_city`
  )).map((c) => c.city);
  const capability = str(sp.capability);
  const filtered = capability ? items.filter((r) => String(r.capabilities || "").includes(capability)) : items;

  const activeCount = Object.entries(filters).filter(([k, v]) => v && k !== "sort").length;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-electric">Marketplace</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink sm:text-[28px]">
            {total} resource{total === 1 ? "" : "s"} available to share
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm text-ink-dim">
            Availability shown here is computed from real booking records. Verification badges come from reviewed
            submissions, not self-declaration.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/recommend" className="rounded-lg border border-electric/30 bg-electric/10 px-3.5 py-2 text-[13px] text-electric hover:bg-electric/18">
            Describe what you need
          </Link>
          <Link href="/compare" className="rounded-lg border border-white/16 px-3.5 py-2 text-[13px] text-ink hover:border-electric/40">
            Compare providers
          </Link>
        </div>
      </div>

      {/* category rail */}
      <div className="mb-5 flex gap-1.5 overflow-x-auto pb-1">
        <Link href="/marketplace" className={`shrink-0 rounded-full border px-3 py-1.5 text-[12px] ${!filters.category ? "border-electric/50 bg-electric/12 text-electric" : "border-white/12 text-ink-dim hover:border-white/25"}`}>
          All categories
        </Link>
        {CATEGORIES.map((c) => (
          <Link
            key={c.slug}
            href={`/marketplace?category=${c.slug}${filters.q ? `&q=${encodeURIComponent(filters.q)}` : ""}`}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-[12px] ${filters.category === c.slug ? "border-electric/50 bg-electric/12 text-electric" : "border-white/12 text-ink-dim hover:border-white/25"}`}
          >
            {c.name}
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[248px_minmax(0,1fr)]">
        <aside>
          <MarketplaceFilters
            initial={{ ...filters, maxPrice: filters.maxPrice ? String(filters.maxPrice) : "" }}
            cities={cities}
            categories={CATEGORIES.map((c) => ({ value: c.slug, label: c.name }))}
            conditions={CONDITIONS.map((c) => ({ value: c.value, label: c.label }))}
            providerTypes={ACCOUNT_TYPES.map((a) => ({ value: a.value, label: a.label }))}
            activeCount={activeCount}
          />
        </aside>

        <div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[12.5px] text-ink-faint">
              Showing {filtered.length} of {total} listing{total === 1 ? "" : "s"}
              {filters.availableFrom && filters.availableTo && ` available ${filters.availableFrom} → ${filters.availableTo}`}
            </p>
            <SortBar current={filters.sort ?? "relevance"} />
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              title="No resources match those filters"
              body="Try widening your search: clear the price ceiling, remove the availability window, or search by capability instead of an exact product name."
              action={<Link href="/marketplace" className="rounded-lg bg-electric px-3.5 py-2 text-[13px] font-medium text-white">Reset filters</Link>}
            />
          ) : (
            <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
              {filtered.map((r) => (
                <ResourceCard key={r.id} r={r} showCompare compareHref={`/compare?ids=${r.id}`} />
              ))}
            </div>
          )}

          {!user && (
            <div className="mt-6">
              <InfoNote tone="info" title="Sign in to book">
                Browsing is open to everyone. Booking a resource, saving favourites, joining a waiting list and
                contacting a provider require an account.{" "}
                <Link href="/register" className="underline">Create one free</Link>.
              </InfoNote>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SortBar({ current }: { current: string }) {
  const opts = [
    { v: "relevance", l: "Recommended" },
    { v: "price_asc", l: "Price ↑" },
    { v: "price_desc", l: "Price ↓" },
    { v: "rating", l: "Rating" },
    { v: "newest", l: "Newest" },
  ];
  return (
    <div className="flex flex-wrap gap-1">
      {opts.map((o) => (
        <Link
          key={o.v}
          href={`?sort=${o.v}`}
          className={`rounded-md border px-2 py-1 text-[11.5px] ${current === o.v ? "border-electric/50 bg-electric/12 text-electric" : "border-white/10 text-ink-dim hover:border-white/25"}`}
        >
          {o.l}
        </Link>
      ))}
    </div>
  );
}
