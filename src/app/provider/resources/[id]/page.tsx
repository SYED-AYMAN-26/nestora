import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { ownedResource } from "@/lib/access";
import { all, jsonParse, one, Row } from "@/lib/db";
import { Card, PageHeader, Badge, InfoNote, money } from "@/components/ui";
import { ListingForm, type ListingDraft } from "@/components/ListingForm";
import { BOOKING_STATUS_LABEL } from "@/lib/constants";
import { statusTone } from "@/components/ui";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function EditListingPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  const { id } = await params;
  if (!user) redirect(`/login?next=/provider/resources/${id}`);
  const r = await ownedResource(Number(id), user);
  if (!r) notFound(); // ownership check: another provider's listing is a 404

  const images = await all<{ url: string }>(`SELECT url FROM resource_images WHERE resource_id = ? ORDER BY sort_order`, r.id).map((i) => i.url);
  const blocked = await all<{ date: string }>(`SELECT date FROM resource_availability WHERE resource_id = ?`, r.id).map((b) => b.date);
  const bookings = await all<Row>(
    `SELECT b.*, u.full_name AS buyer_name FROM bookings b JOIN users u ON u.id = b.buyer_id
      WHERE b.resource_id = ? ORDER BY b.created_at DESC LIMIT 20`, r.id
  );
  const util = await one<Row>(`SELECT * FROM utilisation_snapshots WHERE resource_id = ? ORDER BY snapshot_date DESC LIMIT 1`, r.id);

  const draft: ListingDraft = {
    id: r.id,
    title: r.title, category: r.category, subcategory: r.subcategory, description: r.description,
    brand: r.brand, model: r.model, condition: r.condition,
    quantity_total: r.quantity_total, quantity_active: r.quantity_active,
    internal_usage_hours_month: r.internal_usage_hours_month,
    location_city: r.location_city ?? "", location_state: r.location_state ?? "",
    price_hourly: r.price_hourly, price_daily: r.price_daily, price_weekly: r.price_weekly, deposit: r.deposit,
    eligibility: r.eligibility, training_required: r.training_required, supervision_required: r.supervision_required,
    usage_rules: r.usage_rules, cancellation_policy: r.cancellation_policy,
    min_hours: r.min_hours, max_days: r.max_days, status: r.status, model_3d: r.model_3d,
    capabilities: jsonParse<string[]>(r.capabilities, []), best_for: r.best_for,
    approval_mode: r.approval_mode, booking_limit_days: r.booking_limit_days,
    images, blocked_dates: blocked,
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-7 sm:px-6">
      <PageHeader
        breadcrumb={<><Link href="/provider/resources" className="hover:text-electric">My listings</Link> / Edit</>}
        title={r.title}
        sub={`Listing #${r.id} · ${r.status} · ${money(r.price_daily)}/day · ${money(r.deposit)} deposit`}
        right={<Link href={`/resources/${r.id}`} className="rounded-lg border border-white/16 px-3 py-1.5 text-[12.5px] text-ink">View public page</Link>}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Card className="p-3">
          <p className="text-[10.5px] uppercase tracking-wider text-ink-faint">Utilisation (latest snapshot)</p>
          <p className="text-lg font-semibold text-ink">{util?.utilisation_pct?.toFixed?.(1) ?? "0"}%</p>
          <p className="text-[10.5px] text-ink-faint">{util?.booked_days ?? 0} booked unit-days · {util?.basis === "sample_demo" ? "demo records" : "records"}</p>
        </Card>
        <Card className="p-3">
          <p className="text-[10.5px] uppercase tracking-wider text-ink-faint">Estimated idle units</p>
          <p className="text-lg font-semibold text-ink">{util?.idle_units_estimate ?? Math.max(0, r.quantity_total - r.quantity_active)}</p>
          <p className="text-[10.5px] text-ink-faint">Estimate only — confirm availability</p>
        </Card>
        <Card className="p-3">
          <p className="text-[10.5px] uppercase tracking-wider text-ink-faint">Bookings</p>
          <p className="text-lg font-semibold text-ink">{bookings.length}</p>
          <p className="text-[10.5px] text-ink-faint">all-time on this listing</p>
        </Card>
      </div>

      {r.status === "archived" && (
        <div className="mb-4"><InfoNote tone="warn">This listing is archived. It isn&apos;t bookable, but its history is preserved. Set status to active to re-open it.</InfoNote></div>
      )}

      <Card className="mb-4 p-4">
        <h2 className="mb-2 text-[13.5px] font-semibold text-ink">Booking history on this listing</h2>
        {bookings.length === 0 ? (
          <p className="text-[12px] text-ink-faint">No bookings yet.</p>
        ) : (
          <table className="w-full text-left text-[12px]">
            <thead className="text-[10px] uppercase tracking-wider text-ink-faint"><tr><th className="py-1">Code</th><th className="py-1">Buyer</th><th className="py-1">Dates</th><th className="py-1">Status</th></tr></thead>
            <tbody className="text-ink-dim">
              {bookings.map((b) => (
                <tr key={b.id} className="border-t border-white/6">
                  <td className="py-1.5"><Link href={`/bookings/${b.id}`} className="font-mono text-[10.5px] text-electric hover:underline">{b.code}</Link></td>
                  <td className="py-1.5">{b.buyer_name}</td>
                  <td className="py-1.5 whitespace-nowrap">{fmtDate(b.start_date)} → {fmtDate(b.end_date)}</td>
                  <td className="py-1.5"><Badge tone={statusTone(b.status)}>{BOOKING_STATUS_LABEL[b.status] ?? b.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <ListingForm initial={draft} mode="edit" />
    </div>
  );
}
