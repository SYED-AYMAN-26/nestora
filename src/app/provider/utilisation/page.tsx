import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { underusedForProvider } from "@/lib/resources";
import { Badge, Card, EmptyState, InfoNote, PageHeader, Progress, Stat, type StatusTone } from "@/components/ui";
import { categoryName } from "@/lib/constants";
import { money } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Resource utilisation" };

const CLASSIFICATION: Record<string, { label: string; tone: StatusTone }> = {
  frequently_used: { label: "Frequently used", tone: "success" },
  underused: { label: "Underused", tone: "warn" },
  no_recent_bookings: { label: "No recent bookings", tone: "danger" },
};

export default async function UtilisationPage() {
  const user = await getSessionUser();
  if (!user?.provider) redirect("/provider");

  const items = await underusedForProvider(user.provider.id);
  const totals = items.reduce(
    (a, r) => {
      a.units += Number(r.quantity_total);
      a.idle += r.idle_units;
      a.weighted += r.utilisation_pct * Number(r.quantity_total);
      return a;
    },
    { units: 0, idle: 0, weighted: 0 }
  );
  const avg = totals.units ? Math.round((totals.weighted / totals.units) * 10) / 10 : 0;
  const anyDemo = items.some((r) => r.is_demo);

  return (
    <div className="mx-auto max-w-6xl px-4 py-7 sm:px-6">
      <PageHeader
        title="Resource utilisation intelligence"
        sub="Find the capacity you already own but aren't using. Calculated from your stored booking records — never invented."
        right={<Link href="/provider/utilisation?refresh=1" className="rounded-lg border border-white/16 px-3 py-1.5 text-[12.5px] text-ink">Recompute now</Link>}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Listings analysed" value={items.length} />
        <Stat label="Total units owned" value={totals.units} />
        <Stat label="Estimated idle units" value={totals.idle} hint="Total units − units you declare as internally in use" tone="warn" />
        <Stat label="Weighted utilisation" value={`${avg}%`} hint="Booked unit-days ÷ shareable capacity, rolling 60 days" />
      </div>

      {anyDemo && (
        <div className="mt-4">
          <InfoNote tone="warn" title="Demo dataset">
            Some of these listings are seeded demonstration records. Utilisation is computed correctly from their
            booking history, but the records themselves are fictional.
          </InfoNote>
        </div>
      )}

      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card className="p-4">
          <h2 className="mb-3 text-[14px] font-semibold text-ink">Listings by utilisation</h2>
          {items.length === 0 ? (
            <EmptyState title="No listings to analyse" body="Create a listing first." action={<Link href="/provider/new" className="rounded-lg bg-electric px-3 py-1.5 text-[12px] font-medium text-navy-950">Create listing</Link>} />
          ) : (
            <ul className="space-y-3">
              {items.map((r) => (
                <li key={r.id} className="rounded-xl border border-white/8 bg-white/2 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/provider/resources/${r.id}`} className="text-[13px] font-medium text-ink hover:text-electric">{r.title}</Link>
                        <Badge tone={CLASSIFICATION[r.classification]?.tone ?? "neutral"}>{CLASSIFICATION[r.classification]?.label ?? r.classification}</Badge>
                        {r.status !== "active" && <Badge tone="neutral">{r.status}</Badge>}
                      </div>
                      <p className="mt-0.5 text-[11px] text-ink-faint">
                        {categoryName(r.category)} · {r.completed_bookings} completed · {r.active_bookings} live · {money(r.price_daily)}/day
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[13px] font-semibold tabular-nums text-ink">{r.utilisation_pct}%</p>
                      <p className="text-[10px] text-ink-faint">utilisation</p>
                    </div>
                  </div>
                  <div className="mt-2"><Progress value={r.utilisation_pct} tone={r.classification === "frequently_used" ? "mint" : r.utilisation_pct < 12 ? "amber" : "electric"} /></div>
                  <div className="mt-2 grid gap-1 text-[11px] text-ink-faint sm:grid-cols-3">
                    <span>Total units: <span className="text-ink-dim">{r.quantity_total}</span></span>
                    <span>In internal use: <span className="text-ink-dim">{r.quantity_active}</span></span>
                    <span>Estimated idle: <span className="text-amber-300">{r.idle_units}</span></span>
                  </div>
                  <p className="mt-1.5 text-[10.5px] leading-relaxed text-ink-faint">{r.estimate_note}</p>
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    <Link href={`/provider/resources/${r.id}`} className="rounded-md border border-white/12 px-2 py-0.5 text-[10.5px] text-ink-dim hover:border-electric/40 hover:text-ink">Adjust quantity / availability</Link>
                    <Link href={`/resources/${r.id}`} className="rounded-md border border-white/12 px-2 py-0.5 text-[10.5px] text-ink-dim hover:border-electric/40 hover:text-ink">Public listing</Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <aside className="space-y-4">
          <Card className="p-4">
            <h2 className="text-[13.5px] font-semibold text-ink">How these numbers are produced</h2>
            <ul className="mt-2 space-y-2 text-[11.5px] leading-relaxed text-ink-dim">
              <li><strong className="text-ink">Utilisation %</strong> = booked unit-days ÷ (shareable capacity × 60 days), from bookings in the last 60 days.</li>
              <li><strong className="text-ink">Estimated idle units</strong> = total units − units you declared as internally in use. This is an <em>estimate of potential</em>.</li>
              <li><strong className="text-ink">Confirmed availability</strong> is separate: only dates that pass the availability engine (no bookings, no holds, no maintenance) can actually be booked.</li>
            </ul>
          </Card>

          <Card className="p-4">
            <h2 className="text-[13.5px] font-semibold text-ink">Classification rules</h2>
            <ul className="mt-1.5 space-y-1 text-[12px] text-ink-dim">
              <li><Badge tone="success">Frequently used</Badge> ≥ 55% utilisation</li>
              <li><Badge tone="warn">Underused</Badge> 12–55%</li>
              <li><Badge tone="danger">No recent bookings</Badge> &lt; 12% and zero completed bookings</li>
            </ul>
          </Card>

          <InfoNote tone="info" title="Turning idle equipment into shared equipment">
            Lower the deposit or offer a student rate for quiet categories, then confirm availability in the calendar.
            Buyers can only book what the availability engine confirms.
          </InfoNote>
        </aside>
      </div>
    </div>
  );
}
