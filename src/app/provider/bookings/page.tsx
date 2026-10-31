import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { all, Row } from "@/lib/db";
import { Badge, Card, EmptyState, PageHeader, statusTone, money } from "@/components/ui";
import { BOOKING_STATUS_LABEL } from "@/lib/constants";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Provider bookings — RentLink 3D" };

const GROUPS = [
  { key: "pending", label: "Needs decision", statuses: ["pending", "counteroffered"] },
  { key: "handover", label: "Handover", statuses: ["approved", "awaiting_payment", "paid", "ready_for_handover"] },
  { key: "active", label: "Active", statuses: ["active"] },
  { key: "returns", label: "Returns to inspect", statuses: ["return_requested"] },
  { key: "completed", label: "Completed", statuses: ["completed"] },
  { key: "disputed", label: "Disputed", statuses: ["disputed"] },
  { key: "closed", label: "Cancelled / rejected", statuses: ["cancelled", "rejected", "expired"] },
];

export default async function ProviderBookings({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const user = await getSessionUser();
  if (!user?.provider) redirect("/provider");
  const sp = await searchParams;
  const filter = sp.status || "all";

  const items = await all<Row>(
    `SELECT b.*, r.title AS resource_title, u.full_name AS buyer_name, u.account_type,
            (SELECT COUNT(*) FROM extensions e WHERE e.booking_id = b.id AND e.status='pending') AS pending_ext,
            (SELECT COUNT(*) FROM returns rt WHERE rt.booking_id = b.id AND rt.provider_inspected_at IS NULL) AS awaiting_inspection
       FROM bookings b JOIN resources r ON r.id = b.resource_id JOIN users u ON u.id = b.buyer_id
      WHERE b.provider_id = ? ORDER BY b.created_at DESC`,
    user.provider.id
  );
  const shown = filter === "all" ? items : items.filter((b) => GROUPS.find((g) => g.key === filter)?.statuses.includes(b.status));

  return (
    <div className="mx-auto max-w-6xl px-4 py-7 sm:px-6">
      <PageHeader
        title="Booking requests & rentals"
        sub="Decide on requests, prepare handovers, inspect returns. Every action is recorded with a timestamp and becomes part of the equipment passport."
      />
      <div className="mb-5 flex flex-wrap gap-1.5">
        <Link href="/provider/bookings" className={`rounded-full border px-3 py-1.5 text-[12px] ${filter === "all" ? "border-electric/50 bg-electric/12 text-electric" : "border-white/12 text-ink-dim hover:border-white/25"}`}>All ({items.length})</Link>
        {GROUPS.map((g) => {
          const c = items.filter((b) => g.statuses.includes(b.status)).length;
          return (
            <Link key={g.key} href={`/provider/bookings?status=${g.key}`} className={`rounded-full border px-3 py-1.5 text-[12px] ${filter === g.key ? "border-electric/50 bg-electric/12 text-electric" : "border-white/12 text-ink-dim hover:border-white/25"}`}>
              {g.label} ({c})
            </Link>
          );
        })}
      </div>

      {shown.length === 0 ? (
        <EmptyState title="Nothing in this state" body="Try another filter." />
      ) : (
        <div className="space-y-2.5">
          {shown.map((b) => (
            <Card key={b.id} className="p-3.5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/bookings/${b.id}`} className="text-[13.5px] font-semibold text-ink hover:text-electric">{b.resource_title}</Link>
                    <Badge tone={statusTone(b.status)}>{BOOKING_STATUS_LABEL[b.status] ?? b.status}</Badge>
                    {b.pending_ext > 0 && <Badge tone="warn">Extension request</Badge>}
                    {b.awaiting_inspection > 0 && <Badge tone="info">Awaiting inspection</Badge>}
                  </div>
                  <p className="mt-0.5 text-[12px] text-ink-dim">
                    {b.buyer_name} <span className="text-ink-faint">({b.account_type.replace(/_/g, " ")})</span> ·{" "}
                    {fmtDate(b.start_date)} → {fmtDate(b.end_date)} · {b.units} unit(s)
                  </p>
                  {b.purpose && <p className="mt-0.5 text-[11px] italic text-ink-faint">“{b.purpose}”</p>}
                  <p className="mt-0.5 font-mono text-[10.5px] text-ink-faint">{b.code} · priority {b.priority_score}</p>
                </div>
                <div className="text-right">
                  <p className="text-[13.5px] font-semibold text-ink">{money(b.subtotal)}</p>
                  <p className="text-[10px] text-ink-faint">rental · {money(b.deposit)} deposit</p>
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
