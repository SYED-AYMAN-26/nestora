"use client";

import { useState } from "react";
import Link from "next/link";
import { api, money } from "@/lib/client";
import { Alert, Button, Field, Input } from "@/components/form";
import { Badge, Card, DemoTag, InfoNote, Stars, VerifiedBadge } from "@/components/ui";
import { listingPhoto } from "@/lib/photos";

type Rec = {
  resource: {
    id: number; title: string; category?: string | null; image_url: string | null; provider_name: string; location_city: string | null;
    price_daily: number; is_demo: number | null; verification_status: string | null;
    rating_cached: number | null; rating_count: number | null;
  }; score: number; capabilityMatches: string[]; reasons: string[]; availabilityNote: string; available: boolean;
};
type Result = {
  engine: "ai" | "rules"; engineNote: string;
  intents: { label: string; capabilities: string[]; categories: string[]; keywordsHit: string[] }[];
  capabilities: string[];
  constraints: { maxBudget: number | null; days: number | null; city: string | null };
  results: Rec[];
  excluded: { title: string; reason: string }[];
};

const EXAMPLES = [
  "I need equipment for a college robotics project",
  "I need to record a short film for a community screening",
  "Looking for a quiet space to record a podcast with good acoustics",
  "We need a projector and PA system for a seminar for 80 people",
  "I want to 3D print an enclosure prototype for my final-year project",
];

export function RecommendClient() {
  const [query, setQuery] = useState("");
  const [city, setCity] = useState("");
  const [maxBudget, setMaxBudget] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<Result | null>(null);

  const run = async (q?: string) => {
    const text = q ?? query;
    if (text.trim().length < 3) { setErr("Describe what you need in a few more words."); return; }
    setBusy(true);
    setErr(null);
    const r = await api<Result>("/api/recommend", {
      body: {
        query: text,
        city: city || null,
        maxBudget: maxBudget ? Number(maxBudget) : null,
        start: start || null,
        end: end || null,
      },
    });
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    setRes(r.data);
  };

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <Card className="p-4">
        <label htmlFor="q" className="mb-1.5 block text-[12.5px] font-medium text-ink-dim">What do you need to do?</label>
        <textarea
          id="q"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          rows={4}
          maxLength={600}
          placeholder="e.g. I need equipment for a college robotics project"
          className="w-full rounded-lg border border-white/12 bg-navy-900/70 px-3 py-2 text-[13px] text-ink outline-none focus:border-electric/55"
        />
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Field label="City (optional)" htmlFor="city"><Input id="city" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Chennai" /></Field>
          <Field label="Max ₹/day" htmlFor="budget"><Input id="budget" type="number" min={0} value={maxBudget} onChange={(e) => setMaxBudget(e.target.value)} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Need from" htmlFor="rs"><Input id="rs" type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="until" htmlFor="re"><Input id="re" type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        </div>
        <Button onClick={() => { void run(); }} loading={busy} className="w-full">Find matching resources</Button>
        {err && <div className="mt-2"><Alert kind="error">{err}</Alert></div>}

        <p className="mt-4 mb-1.5 text-[11px] uppercase tracking-wider text-ink-faint">Try an example</p>
        <div className="space-y-1.5">
          {EXAMPLES.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => { setQuery(e); void run(e); }}
              className="w-full rounded-lg border border-white/10 bg-white/3 px-2.5 py-1.5 text-left text-[11.5px] text-ink-dim hover:border-electric/35 hover:text-ink"
            >
              {e}
            </button>
          ))}
        </div>
      </Card>

      <div>
        {!res ? (
          <Card className="p-6 text-center">
            <p className="text-[13px] text-ink-dim">Your matches will appear here, with the reason each one matched.</p>
            <p className="mt-1.5 text-[11.5px] text-ink-faint">
              Unavailable resources are never presented as bookable — they are listed separately with the reason.
            </p>
          </Card>
        ) : (
          <div className="space-y-3">
            <Card className="p-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={res.engine === "ai" ? "verified" : "info"}>{res.engine === "ai" ? "AI-assisted" : "Rule-based"}</Badge>
                <Badge tone="neutral">{res.results.length} bookable match{res.results.length === 1 ? "" : "es"}</Badge>
                {res.constraints.maxBudget && <Badge tone="neutral">≤ {money(res.constraints.maxBudget)}/day</Badge>}
                {res.constraints.city && <Badge tone="neutral">{res.constraints.city}</Badge>}
              </div>
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-faint">{res.engineNote}</p>
              {res.intents.length > 0 && (
                <div className="mt-2 space-y-1">
                  {res.intents.slice(0, 2).map((i) => (
                    <p key={i.label} className="text-[11.5px] text-ink-dim">
                      <span className="text-ink">Detected need:</span> {i.label}
                      {i.keywordsHit.length ? ` (matched “${i.keywordsHit.slice(0, 3).join("”, “")}”)` : ""}
                    </p>
                  ))}
                </div>
              )}
              {res.capabilities.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {res.capabilities.map((c) => (
                    <span key={c} className="rounded border border-electric/25 bg-electric/8 px-1.5 py-0.5 text-[10px] text-electric">{c}</span>
                  ))}
                </div>
              )}
            </Card>

            {res.results.length === 0 && (
              <InfoNote tone="warn" title="Nothing bookable matched">
                We found no available resource for that need in the selected window. Try widening the dates, raising the
                budget, or removing the city filter.
              </InfoNote>
            )}

            {res.results.map((r) => (
              <Card key={r.resource.id} className="p-3.5">
                <div className="flex gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={listingPhoto(r.resource.image_url, r.resource.category)} alt="" width={1408} height={768} loading="lazy" className="h-20 w-28 shrink-0 rounded-lg object-cover" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/resources/${r.resource.id}`} className="text-[13.5px] font-semibold text-ink hover:text-electric">{r.resource.title}</Link>
                      {r.resource.is_demo ? <DemoTag /> : null}
                      <VerifiedBadge status={r.resource.verification_status} />
                    </div>
                    <p className="text-[11.5px] text-ink-dim">
                      {r.resource.provider_name} · {r.resource.location_city} · {money(r.resource.price_daily)}/day
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <Stars rating={Number(r.resource.rating_cached || 0)} count={Number(r.resource.rating_count || 0)} />
                      <span className="text-[11px] text-ink-faint">match score {r.score}</span>
                    </div>
                  </div>
                </div>
                <ul className="mt-2 space-y-0.5 text-[11.5px] text-ink-dim">
                  {r.reasons.slice(0, 4).map((reason, i) => (
                    <li key={i} className="flex gap-1.5"><span className="text-electric">◆</span><span>{reason}</span></li>
                  ))}
                </ul>
                <p className="mt-1.5 rounded-lg border border-emerald-400/25 bg-emerald-400/8 px-2 py-1 text-[11px] text-emerald-200">{r.availabilityNote}</p>
                <div className="mt-2 flex gap-2">
                  <Link href={`/resources/${r.resource.id}`} className="rounded-lg bg-gradient-to-b from-electric to-electric-deep px-2.5 py-1.5 text-[11.5px] font-semibold text-white">View &amp; book</Link>
                  <Link href={`/compare?ids=${r.resource.id}`} className="rounded-lg border border-white/14 px-2.5 py-1.5 text-[11.5px] text-ink-dim hover:border-electric/40 hover:text-ink">Compare</Link>
                </div>
              </Card>
            ))}

            {res.excluded.length > 0 && (
              <Card className="p-3.5">
                <h3 className="text-[12.5px] font-semibold text-ink">Not bookable for your request</h3>
                <p className="mt-0.5 text-[11px] text-ink-faint">Shown for transparency — these are not offered as booking options.</p>
                <ul className="mt-1.5 space-y-1 text-[11.5px] text-ink-dim">
                  {res.excluded.map((x, i) => (
                    <li key={i} className="flex flex-wrap gap-1.5 border-b border-white/6 pb-1">
                      <span className="text-ink">{x.title}</span>
                      <span className="text-ink-faint">— {x.reason}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
