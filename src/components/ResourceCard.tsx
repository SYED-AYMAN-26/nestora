import Link from "next/link";
import { Badge, DemoTag, Stars, VerifiedBadge, money } from "./ui";
import { listingPhoto, listingPhotoAlt } from "@/lib/photos";

export type CardResource = {
  id: number;
  title: string;
  category: string;
  condition: string;
  price_daily: number;
  price_hourly: number;
  price_weekly?: number;
  deposit: number;
  location_city: string | null;
  provider_name: string;
  storefront_slug: string;
  verification_status: string;
  org_type: string;
  rating_cached?: number;
  rating_count?: number;
  image_url?: string | null;
  is_demo?: number;
  utilisation_state?: string | null;
  best_for?: string | null;
};

const CONDITION_LABEL: Record<string, string> = { new: "New", excellent: "Excellent", good: "Good", fair: "Fair" };

export function ResourceCard({ r, compareHref, showCompare = false }: { r: CardResource; compareHref?: string; showCompare?: boolean }) {
  return (
    <article className="card-3d glass group relative flex flex-col overflow-hidden rounded-2xl">
      <Link href={`/resources/${r.id}`} className="relative block aspect-[16/10] overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={listingPhoto(r.image_url, r.category)}
          alt={listingPhotoAlt(r.title, r.image_url)}
          width={1408}
          height={768}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.045]"
        />
        {/* light scrim so price/condition chips stay legible over a photograph */}
        <div className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-[#0b1622]/55 to-transparent" />
        <div className="absolute left-2.5 top-2.5 flex flex-wrap gap-1.5">
          {r.is_demo ? <DemoTag /> : null}
          {r.verification_status === "verified" && (
            <span className="inline-flex items-center gap-1 rounded-md bg-white/95 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700 shadow-sm ring-1 ring-emerald-500/30">
              ✓ Verified
            </span>
          )}
          {r.verification_status === "pending" && (
            <span className="rounded-md bg-white/95 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700 shadow-sm ring-1 ring-amber-500/30">
              Pending
            </span>
          )}
        </div>
        <div className="absolute inset-x-2.5 bottom-2.5 flex items-end justify-between gap-2">
          <span className="rounded-md bg-white/95 px-2 py-0.5 text-[11px] font-medium text-ink-dim shadow-sm">
            {CONDITION_LABEL[r.condition] ?? r.condition}
          </span>
          <span className="rounded-md bg-white px-2 py-1 text-right shadow-sm">
            <span className="text-sm font-semibold text-ink">{money(r.price_daily || r.price_hourly * 8)}</span>
            <span className="text-[10px] text-ink-faint">/{r.price_daily ? "day" : "8h"}</span>
          </span>
        </div>
      </Link>

      <div className="card-3d-lift flex flex-1 flex-col p-3.5">
        <Link href={`/resources/${r.id}`} className="line-clamp-2 text-[13.5px] font-semibold leading-snug text-ink hover:text-electric">
          {r.title}
        </Link>
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <Link href={`/storefront/${r.storefront_slug}`} className="truncate text-[12px] text-ink-dim hover:text-electric">
            {r.provider_name}
          </Link>
          <Stars rating={Number(r.rating_cached || 0)} count={Number(r.rating_count || 0)} />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-faint">
          {r.location_city && <span>◦ {r.location_city}</span>}
          {r.deposit > 0 && <span>· deposit {money(r.deposit)}</span>}
        </div>
        {r.best_for && <p className="mt-1.5 line-clamp-1 text-[11px] text-ink-faint">Best for: {r.best_for}</p>}
        <div className="mt-auto flex items-center gap-1.5 pt-3">
          <Link
            href={`/resources/${r.id}`}
            className="flex-1 rounded-lg border border-white/12 bg-white/4 px-2.5 py-1.5 text-center text-[12px] font-medium text-ink transition hover:border-electric/45 hover:bg-white/8"
          >
            View &amp; book
          </Link>
          {showCompare && compareHref && (
            <Link
              href={compareHref}
              className="rounded-lg border border-electric/30 bg-electric/10 px-2.5 py-1.5 text-[12px] font-medium text-electric transition hover:bg-electric/18"
              aria-label={`Compare ${r.title} with other providers`}
            >
              Compare
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}

export function ResourceRow({ r }: { r: CardResource & { status?: string } }) {
  return (
    <Link href={`/resources/${r.id}`} className="glass flex items-center gap-3 rounded-xl p-2.5 transition hover:border-electric/35">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={listingPhoto(r.image_url, r.category)}
        alt=""
        width={1408}
        height={768}
        className="h-14 w-20 shrink-0 rounded-lg object-cover"
        loading="lazy"
        decoding="async"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-ink">{r.title}</p>
        <p className="truncate text-[11.5px] text-ink-faint">
          {r.provider_name} · {r.location_city}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-[13px] font-semibold text-ink">{money(r.price_daily)}</p>
        <p className="text-[10px] text-ink-faint">per day</p>
      </div>
    </Link>
  );
}

export function CompareBar({ items, onClear }: { items: { id: number; title: string }[]; onClear: () => void }) {
  if (!items.length) return null;
  return (
    <div className="fixed inset-x-0 bottom-4 z-40 mx-auto flex w-fit items-center gap-3 rounded-full border border-electric/25 bg-white px-4 py-2 shadow-xl">
      <span className="text-[12px] text-ink-dim">{items.length} selected for comparison</span>
      <Link href={`/compare?ids=${items.map((i) => i.id).join(",")}`} className="rounded-full bg-electric px-3 py-1 text-[12px] font-semibold text-white">
        Compare
      </Link>
      <button type="button" onClick={onClear} className="text-[12px] text-ink-faint hover:text-ink">Clear</button>
    </div>
  );
}

export function ConditionBadge({ condition }: { condition: string }) {
  const tone = condition === "new" || condition === "excellent" ? "verified" : condition === "good" ? "info" : "warn";
  return <Badge tone={tone}>{CONDITION_LABEL[condition] ?? condition}</Badge>;
}

export { VerifiedBadge };
