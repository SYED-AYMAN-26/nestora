"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { Card } from "@/components/ui";

type Option = { value: string; label: string };

export function MarketplaceFilters({
  initial, cities, categories, conditions, providerTypes, activeCount,
}: {
  initial: { q?: string; category?: string; city?: string; maxPrice?: string; condition?: string; providerType?: string; verifiedOnly?: boolean; availableFrom?: string; availableTo?: string };
  cities: string[];
  categories: Option[];
  conditions: Option[];
  providerTypes: Option[];
  activeCount: number;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);

  const apply = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    start(() => router.push(`/marketplace?${next.toString()}`));
  };

  const field = "w-full rounded-lg border border-white/12 bg-navy-900/70 px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-electric/50";
  const label = "mb-1 block text-[11px] font-medium uppercase tracking-wider text-ink-faint";

  return (
    <Card className="p-4 lg:sticky lg:top-20">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[12.5px] font-semibold text-ink">Filters {activeCount > 0 && <span className="ml-1 rounded-full bg-electric/15 px-1.5 text-[10px] text-electric">{activeCount}</span>}</p>
        <button type="button" className="text-[11px] text-ink-faint hover:text-ink lg:hidden" onClick={() => setOpen((v) => !v)}>
          {open ? "Hide" : "Show"}
        </button>
        {activeCount > 0 && (
          <button type="button" onClick={() => router.push("/marketplace")} className="text-[11px] text-rose-300 hover:underline">
            Reset
          </button>
        )}
      </div>

      <div className={`${open ? "block" : "hidden"} lg:block`}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            apply({ q: String(fd.get("q") || "") });
          }}
          className="mb-3"
        >
          <label className={label} htmlFor="q">Search</label>
          <input id="q" name="q" defaultValue={initial.q} placeholder="camera, 3D printer, studio…" className={field} />
        </form>

        <div className="mb-3">
          <label className={label} htmlFor="category">Category</label>
          <select id="category" value={initial.category || ""} onChange={(e) => apply({ category: e.target.value })} className={field}>
            <option value="">All categories</option>
            {categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>

        <div className="mb-3">
          <label className={label} htmlFor="city">Location</label>
          <select id="city" value={initial.city || ""} onChange={(e) => apply({ city: e.target.value })} className={field}>
            <option value="">Anywhere</option>
            {cities.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        <div className="mb-3">
          <label className={label} htmlFor="maxPrice">Max price per day (₹)</label>
          <input
            id="maxPrice"
            type="number"
            min={0}
            defaultValue={initial.maxPrice}
            onBlur={(e) => apply({ maxPrice: e.target.value })}
            placeholder="e.g. 1200"
            className={field}
          />
        </div>

        <div className="mb-3 grid grid-cols-2 gap-2">
          <div>
            <label className={label} htmlFor="from">Available from</label>
            <input id="from" type="date" defaultValue={initial.availableFrom} onChange={(e) => apply({ from: e.target.value, to: initial.availableTo || e.target.value })} className={field} />
          </div>
          <div>
            <label className={label} htmlFor="to">to</label>
            <input id="to" type="date" defaultValue={initial.availableTo} onChange={(e) => apply({ to: e.target.value })} className={field} />
          </div>
        </div>

        <div className="mb-3">
          <label className={label} htmlFor="condition">Condition</label>
          <select id="condition" value={initial.condition || ""} onChange={(e) => apply({ condition: e.target.value })} className={field}>
            <option value="">Any condition</option>
            {conditions.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>

        <div className="mb-3">
          <label className={label} htmlFor="providerType">Provider type</label>
          <select id="providerType" value={initial.providerType || ""} onChange={(e) => apply({ providerType: e.target.value })} className={field}>
            <option value="">Any provider</option>
            {providerTypes.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>

        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-white/10 bg-white/3 px-2.5 py-2 text-[12px] text-ink-dim">
          <input
            type="checkbox"
            checked={Boolean(initial.verifiedOnly)}
            onChange={(e) => apply({ verified: e.target.checked ? "1" : null })}
            className="h-3.5 w-3.5 accent-[#38bdf8]"
          />
          Verified providers only
        </label>

        {pending && <p className="mt-2 text-[11px] text-electric">Updating…</p>}
      </div>
    </Card>
  );
}
