import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { all, Row } from "@/lib/db";
import { Badge, Card, EmptyState, PageHeader, statusTone } from "@/components/ui";
import { BOOKING_STATUS_LABEL } from "@/lib/constants";
import { fmtDate, money } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "My bookings — RentLink 3D" };

const GROUPS = [
  { key: "pending", label: "Pending", statuses: ["pending", "counteroffered"] },
  { key: "upcoming", label: "Upcoming & active", statuses: ["approved", "awaiting_payment", "paid", "ready_for_handover", "active", "return_requested"] },
  { key: "completed", label: "Completed", statuses: ["completed"] },
  { key: "closed", label: "Cancelled / rejected", statuses: ["cancelled", "rejected", "expired"] },
  { key: "disputed", label: "Disputed", statuses: ["disputed"] },
];

export default async function BookingsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/bookings");
  const sp = await searchParams;
  const filter = sp.status || "all";

  const items = await all<Row>(
    `SELECT b.*, r.title AS resource_title, p.display_name AS provider_name, p.storefront_slug,
            (SELECT url FROM resource_images i WHERE i.resource_id = r.id ORDER BY sort_order LIMIT 1) AS image_url,
            (SELECT COUNT(*) FROM extensions e WHERE e.booking_id = b.id AND e.status = 'pending') AS pending_extensions
       FROM bookings b JOIN resources r ON r.id = b.resource_id JOIN provider_profiles p ON p.id = b.provider_id
      WHERE b.buyer_id = ? ORDER BY b.created_at DESC`,
    user.id
  );

  const shown = filter === "all" ? items : items.filter((b) => GROUPS.find((g) => g.key === filter)?.statuses.includes(b.status));

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <PageHeader
        title="My bookings"
        sub="Every request you've made, with its current state in the rental lifecycle. Open a booking to pay, confirm collection, request an extension or submit a return."
        right={<Link href="/marketplace" className="rounded-lg bg-gradient-to-b from-electric to-electric-deep px-3.5 py-2 text-[13px] font-semibold text-navy-950">Book something</Link>}
      />

      <div className="mb-5 flex flex-wrap gap-1.5">
        <Link href="/bookings" className={`rounded-full border px-3 py-1.5 text-[12px] ${filter === "all" ? "border-electric/50 bg-electric/12 text-electric" : "border-white/12 text-ink-dim hover:border-white/25"}`}>
          All ({items.length})
        </Link>
        {GROUPS.map((g) => {
          const count = items.filter((b) => g.statuses.includes(b.status)).length;
          return (
            <Link key={g.key} href={`/bookings?status=${g.key}`} className={`rounded-full border px-3 py-1.5 text-[12px] ${filter === g.key ? "border-electric/50 bg-electric/12 text-electric" : "border-white/12 text-ink-dim hover:border-white/25"}`}>
              {g.label} ({count})
            </Link>
          );
        })}
      </div>

      {shown.length === 0 ? (
        <EmptyState title="Nothing here" body="No bookings in this state." action={<Link href="/marketplace" className="rounded-lg bg-electric px-3 py-1.5 text-[12.5px] font-medium text-navy-950">Browse marketplace</Link>} />
      ) : (
        <div className="space-y-2.5">
          {shown.map((b) => (
            <Card key={b.id} className="p-3.5">
              <div className="flex flex-wrap items-start gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={b.image_url || "/img/camera.svg"} alt="" className="h-16 w-24 rounded-lg object-cover" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/bookings/${b.id}`} className="text-[14px] font-semibold text-ink hover:text-electric">{b.resource_title}</Link>
                    <Badge tone={statusTone(b.status)}>{BOOKING_STATUS_LABEL[b.status] ?? b.status}</Badge>
                    {b.pending_extensions > 0 && <Badge tone="warn">Extension pending</Badge>}
                  </div>
                  <p className="mt-0.5 text-[12px] text-ink-dim">
                    <Link href={`/storefront/${b.storefront_slug}`} className="hover:text-electric">{b.provider_name}</Link>
                    {" · "}{fmtDate(b.start_date)} → {fmtDate(b.end_date)} · {b.days} day(s) · {b.units} unit(s)
                  </p>
                  <p className="mt-0.5 font-mono text-[10.5px] text-ink-faint">{b.code} · requested {fmtDate(b.created_at)}</p>
                </div>
                <div className="text-right">
                  <p className="text-[14px] font-semibold text-ink">{money(b.total)}</p>
                  <p className="text-[10.5px] text-ink-faint">incl. {money(b.deposit)} deposit</p>
                  <Link href={`/bookings/${b.id}`} className="mt-1 inline-block rounded-lg border border-white/14 px-2.5 py-1 text-[11.5px] text-ink hover:border-electric/40">
                    Open
                  </Link>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
