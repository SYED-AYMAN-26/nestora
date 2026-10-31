import Link from "next/link";
import { computeImpact, type ImpactCategory, type ImpactTrendPoint, type ImpactUtilPoint } from "@/lib/impact";
import { CATEGORIES, categoryName } from "@/lib/constants";
import { Badge, Card, InfoNote, PageHeader, Progress, Stat, money } from "@/components/ui";
import { ImpactFilters } from "./ImpactFilters";

export const dynamic = "force-dynamic";
export const metadata = { title: "Institutional impact — RentLink 3D" };

export default async function ImpactPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; category?: string }> }) {
  const sp = await searchParams;
  const data = await computeImpact({ from: sp.from, to: sp.to, category: sp.category });
  const maxBookings = Math.max(1, ...data.byCategory.map((c: ImpactCategory) => Number(c.bookings)));

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <PageHeader
        eyebrow="Impact"
        title="Institutional impact dashboard"
        sub="What sharing actually changed: resources listed, bookings completed, idle capacity identified and money buyers didn't spend elsewhere. Every figure is computed from this deployment's stored records."
        right={<Badge tone={data.dataProvenance.is_demo_dataset ? "warn" : "verified"}>{data.dataProvenance.is_demo_dataset ? "Demo dataset" : "Live records"}</Badge>}
      />

      <ImpactFilters categories={CATEGORIES.map((c) => ({ value: c.slug, label: c.name }))} initial={{ from: sp.from ?? "", to: sp.to ?? "", category: sp.category ?? "all" }} />

      <div className="mt-4">
        <InfoNote tone={data.dataProvenance.is_demo_dataset ? "warn" : "info"} title="Data provenance">
          {data.dataProvenance.statement}
        </InfoNote>
      </div>

      <h2 className="mb-2 mt-6 text-[13px] font-semibold uppercase tracking-wider text-emerald-300">Verified metrics (counted from records)</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Participating institutions" value={data.participants.institutions} hint="Distinct provider accounts" />
        <Stat label="Providers" value={`${data.verified.providers_verified} / ${data.verified.providers_total}`} hint="Verified / total providers" />
        <Stat label="Resources listed" value={data.verified.resources_listed} hint="Active listings matching filters" />
        <Stat label="Successful bookings" value={data.verified.bookings_completed} hint="Reached the completed state" />
        <Stat label="Resources shared" value={data.verified.resources_shared} hint="Completed rentals" />
        <Stat label="Total bookings" value={data.verified.bookings_total} hint="All requests in range" />
        <Stat label="Completion rate" value={`${data.verified.booking_completion_rate_pct}%`} hint="Completed ÷ (completed + cancelled/rejected)" />
        <Stat label="Active rentals" value={data.verified.bookings_active} hint="Paid through returned" />
      </div>

      <h2 className="mb-2 mt-6 text-[13px] font-semibold uppercase tracking-wider text-amber-300">Estimated metrics (formula disclosed)</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Estimated idle units" value={data.estimated.idle_units_identified} hint="Units declared as not in internal use" tone="warn" />
        <Stat label="Underused listings" value={data.estimated.resources_underused} hint="Not classified as frequently used" tone="warn" />
        <Stat label="Idle hours recovered" value={data.estimated.idle_hours_recovered} hint={data.estimated.formula.idle_hours_recovered} tone="warn" />
        <Stat label="Buyer spend avoided" value={money(data.estimated.money_saved_by_buyers_inr)} hint={data.estimated.formula.money_saved_by_buyers_inr} tone="warn" />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="text-[14px] font-semibold text-ink">Most shared categories</h2>
          <ul className="mt-3 space-y-2.5">
            {data.byCategory.map((c: ImpactCategory) => (
              <li key={c.category}>
                <div className="mb-1 flex items-baseline justify-between gap-2 text-[12px]">
                  <span className="text-ink">{categoryName(c.category)}</span>
                  <span className="tabular-nums text-ink-faint">{c.bookings} booking(s) · {c.days} days</span>
                </div>
                <Progress value={(Number(c.bookings) / maxBookings) * 100} />
              </li>
            ))}
            {data.byCategory.length === 0 && <p className="text-[12px] text-ink-faint">No bookings recorded in this range.</p>}
          </ul>
        </Card>

        <Card className="p-4">
          <h2 className="text-[14px] font-semibold text-ink">Booking trend (last 6 months)</h2>
          <table className="mt-2 w-full text-left text-[12px]">
            <thead className="text-[10px] uppercase tracking-wider text-ink-faint">
              <tr><th className="py-1">Month</th><th className="py-1">Bookings</th><th className="py-1">Completed</th><th className="py-1">Value</th></tr>
            </thead>
            <tbody className="text-ink-dim">
              {data.trend.map((t: ImpactTrendPoint) => (
                <tr key={t.month} className="border-t border-white/6">
                  <td className="py-1.5">{t.month}</td>
                  <td className="py-1.5 tabular-nums">{t.bookings}</td>
                  <td className="py-1.5 tabular-nums">{t.completed}</td>
                  <td className="py-1.5 tabular-nums">{money(t.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.trend.length === 0 && <p className="mt-2 text-[12px] text-ink-faint">No bookings in the last 6 months.</p>}

          <h3 className="mt-4 text-[12.5px] font-semibold text-ink">Average utilisation over time</h3>
          <ul className="mt-1.5 space-y-1.5">
            {data.utilisationTrend.map((u: ImpactUtilPoint) => (
              <li key={u.month} className="flex items-center gap-2 text-[11.5px]">
                <span className="w-16 text-ink-faint">{u.month}</span>
                <Progress value={Number(u.avg_util)} className="flex-1" />
                <span className="w-12 text-right tabular-nums text-ink-dim">{Number(u.avg_util).toFixed(1)}%</span>
              </li>
            ))}
            {data.utilisationTrend.length === 0 && <li className="text-[12px] text-ink-faint">No utilisation snapshots yet.</li>}
          </ul>
        </Card>
      </div>

      <Card className="mt-4 p-4">
        <h2 className="text-[14px] font-semibold text-ink">What we deliberately do not claim</h2>
        <ul className="mt-2 space-y-1 text-[12px] leading-relaxed text-ink-dim">
          <li>• We don&apos;t claim CO₂ savings or &ldquo;waste prevented&rdquo; — those need lifecycle data we don&apos;t collect.</li>
          <li>• &ldquo;Money saved&rdquo; is what buyers were charged on RentLink, not an asserted market-price comparison.</li>
          <li>• Estimated idle units are potential capacity, not confirmed bookable availability.</li>
          <li>• With seeded demo records, none of this is a real-world impact claim.</li>
        </ul>
        <p className="mt-2 text-[11px] text-ink-faint">
          Methodology and implementation status: <Link href="/verification-report" className="text-electric hover:underline">build verification report</Link>
        </p>
      </Card>
    </div>
  );
}
