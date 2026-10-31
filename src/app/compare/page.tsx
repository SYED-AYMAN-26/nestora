import Link from "next/link";
import { all, jsonParse, Row } from "@/lib/db";
import { Badge, Card, EmptyState, PageHeader, Stars, VerifiedBadge, money } from "@/components/ui";
import { CAPABILITIES, CONDITIONS, categoryName } from "@/lib/constants";
import { checkAvailability } from "@/lib/booking";

export const dynamic = "force-dynamic";
export const metadata = { title: "Compare providers" };

export default async function ComparePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const idsRaw = Array.isArray(sp.ids) ? sp.ids[0] : sp.ids;
  const ids = (idsRaw || "").split(",").map((s) => Number(s)).filter((n) => Number.isInteger(n) && n > 0).slice(0, 5);

  const rows = ids.length
    ? await all<Row>(
        `SELECT r.*, p.display_name AS provider_name, p.storefront_slug, p.verification_status, p.org_type,
                p.rating_cached, p.rating_count, p.cancellation_policy AS provider_cancellation,
                p.contact_email, p.priority_policy,
                (SELECT url FROM resource_images i WHERE i.resource_id = r.id ORDER BY sort_order LIMIT 1) AS image_url
           FROM resources r JOIN provider_profiles p ON p.id = r.provider_id WHERE r.id IN (${ids.map(() => "?").join(",")})`,
        ...ids
      )
    : [];

  // Availability is resolved up-front: a table cell cannot await.
  const today = new Date().toISOString().slice(0, 10);
  const end = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
  const avail: Record<number, boolean> = {};
  for (const r of rows) {
    const a = await checkAvailability(r.id, today, end, 1);
    avail[r.id] = Boolean(a.ok);
  }

  const anyId = rows[0]?.id;
  const suggestions = anyId
    ? await all<Row>(
        `SELECT r.id, r.title, r.price_daily, p.display_name AS provider_name
           FROM resources r JOIN provider_profiles p ON p.id = r.provider_id
          WHERE r.category = (SELECT category FROM resources WHERE id = ?) AND r.status='active'
          ORDER BY r.price_daily ASC LIMIT 5`,
        anyId
      )
    : await all<Row>(`SELECT r.id, r.title, r.price_daily, p.display_name AS provider_name FROM resources r JOIN provider_profiles p ON p.id = r.provider_id WHERE r.status='active' ORDER BY p.rating_cached DESC LIMIT 5`);

  const cheapest = rows.length ? Math.min(...rows.map((r) => Number(r.price_daily) || Number(r.price_hourly) * 8 || Infinity)) : 0;

  const FEATURES: { label: string; get: (r: Row) => React.ReactNode }[] = [
    { label: "Provider", get: (r) => <Link href={`/storefront/${r.storefront_slug}`} className="text-electric hover:underline">{r.provider_name}</Link> },
    { label: "Provider type", get: (r) => r.org_type.replace(/_/g, " ") },
    { label: "Verification", get: (r) => <VerifiedBadge status={r.verification_status} /> },
    { label: "Rating", get: (r) => <Stars rating={Number(r.rating_cached || 0)} count={Number(r.rating_count || 0)} /> },
    { label: "Category", get: (r) => categoryName(r.category) },
    { label: "Condition", get: (r) => CONDITIONS.find((c) => c.value === r.condition)?.label ?? r.condition },
    {
      label: "Daily price", get: (r) => (
        <span className={Number(r.price_daily) === cheapest ? "font-semibold text-emerald-300" : "text-ink"}>
          {money(r.price_daily)}{Number(r.price_daily) === cheapest && <span className="ml-1 text-[10px]">lowest</span>}
        </span>
      ),
    },
    { label: "Hourly price", get: (r) => money(r.price_hourly) },
    { label: "Weekly price", get: (r) => (r.price_weekly ? money(r.price_weekly) : "—") },
    { label: "Deposit", get: (r) => (r.deposit ? money(r.deposit) : "None") },
    { label: "Location", get: (r) => `${r.location_city ?? "—"}` },
    { label: "Shareable units", get: (r) => `${Math.max(0, r.quantity_total - r.quantity_active)} of ${r.quantity_total}` },
    {
      label: "Available today+2d", get: (r) =>
        avail[r.id] ? <Badge tone="success">Available</Badge> : <Badge tone="warn">Not available</Badge>,
    },
    { label: "Training", get: (r) => (r.training_required ? "Required" : "None") },
    { label: "Supervision", get: (r) => (r.supervision_required ? "Required" : "None") },
    { label: "Eligibility", get: (r) => <span className="text-[11.5px] text-ink-faint">{r.eligibility || "Open to all verified accounts"}</span> },
    { label: "Capabilities", get: (r) => (
      <div className="flex flex-wrap gap-1">
        {jsonParse<string[]>(r.capabilities, []).slice(0, 5).map((c) => (
          <span key={c} className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-ink-dim">{CAPABILITIES[c]?.label ?? c}</span>
        ))}
      </div>
    ) },
    { label: "Cancellation", get: (r) => <span className="text-[11px] text-ink-faint">{r.cancellation_policy || r.provider_cancellation || "—"}</span> },
    { label: "Action", get: (r) => (
      <Link href={`/resources/${r.id}`} className="rounded-lg bg-gradient-to-b from-electric to-electric-deep px-2.5 py-1.5 text-[11.5px] font-semibold text-navy-950">
        View &amp; book
      </Link>
    ) },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <PageHeader
        title="Compare resources across providers"
        sub="The same capability can be offered by a verified university, a company and an individual. Compare price, condition, verification, eligibility and live availability side by side."
        right={<Link href="/marketplace" className="rounded-lg border border-white/16 px-3 py-1.5 text-[12.5px] text-ink">Back to marketplace</Link>}
      />

      {rows.length === 0 ? (
        <EmptyState
          title="Pick resources to compare"
          body="Open any listing and choose Compare, or pick from the suggestions below to start a side-by-side comparison."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {suggestions.map((s) => (
                <Link key={s.id} href={`/compare?ids=${s.id}`} className="rounded-lg border border-white/14 px-2.5 py-1.5 text-[12px] text-ink-dim hover:border-electric/40 hover:text-ink">
                  {s.title} — {s.provider_name}
                </Link>
              ))}
            </div>
          }
        />
      ) : (
        <>
          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[720px] border-collapse text-left text-[12.5px]">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 w-40 bg-navy-900/90 p-3 text-[10.5px] uppercase tracking-wider text-ink-faint">Attribute</th>
                  {rows.map((r) => (
                    <th key={r.id} className="min-w-[190px] border-l border-white/8 p-3 align-top">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={r.image_url || "/img/camera.svg"} alt="" className="mb-2 h-24 w-full rounded-lg object-cover" />
                      <Link href={`/resources/${r.id}`} className="block text-[12.5px] font-semibold leading-snug text-ink hover:text-electric">{r.title}</Link>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {FEATURES.map((f) => (
                  <tr key={f.label} className="border-t border-white/6">
                    <td className="sticky left-0 z-10 bg-navy-900/90 p-3 align-top text-[11px] uppercase tracking-wider text-ink-faint">{f.label}</td>
                    {rows.map((r) => (
                      <td key={r.id} className="border-l border-white/8 p-3 align-top text-ink-dim">{f.get(r)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <p className="mt-3 text-[11.5px] leading-relaxed text-ink-faint">
            Prices shown are the provider&apos;s listed rates; the platform fee (2%) and refundable deposit are added at
            checkout and are visible before you submit a request. Availability is computed live for{" "}
            {today} → {end}.
          </p>
        </>
      )}
    </div>
  );
}
