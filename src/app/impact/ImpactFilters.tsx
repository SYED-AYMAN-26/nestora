"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ImpactFilters({ categories, initial }: { categories: { value: string; label: string }[]; initial: { from: string; to: string; category: string } }) {
  const router = useRouter();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [category, setCategory] = useState(initial.category);

  const apply = () => {
    const p = new URLSearchParams();
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    if (category && category !== "all") p.set("category", category);
    router.push(`/impact?${p.toString()}`);
  };

  const field = "rounded-lg border border-white/12 bg-navy-900/70 px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-electric/50";

  return (
    <div className="glass flex flex-wrap items-end gap-2 rounded-xl p-3">
      <div>
        <label htmlFor="if" className="mb-1 block text-[10.5px] uppercase tracking-wider text-ink-faint">From</label>
        <input id="if" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={field} />
      </div>
      <div>
        <label htmlFor="it" className="mb-1 block text-[10.5px] uppercase tracking-wider text-ink-faint">To</label>
        <input id="it" type="date" value={to} onChange={(e) => setTo(e.target.value)} className={field} />
      </div>
      <div>
        <label htmlFor="ic" className="mb-1 block text-[10.5px] uppercase tracking-wider text-ink-faint">Category</label>
        <select id="ic" value={category} onChange={(e) => setCategory(e.target.value)} className={field}>
          <option value="all">All categories</option>
          {categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </div>
      <button type="button" onClick={apply} className="rounded-lg bg-gradient-to-b from-electric to-electric-deep px-3 py-1.5 text-[12.5px] font-semibold text-white">Apply</button>
      <button type="button" onClick={() => { setFrom(""); setTo(""); setCategory("all"); router.push("/impact"); }} className="rounded-lg border border-white/14 px-3 py-1.5 text-[12.5px] text-ink-dim hover:text-ink">Reset</button>
    </div>
  );
}
