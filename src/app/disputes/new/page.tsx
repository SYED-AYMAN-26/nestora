import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { loadBookingForUser } from "@/lib/access";
import { bookingBundle } from "@/lib/lifecycle";
import { Card, InfoNote, PageHeader, money } from "@/components/ui";
import { NewDisputeForm } from "./NewDisputeForm";
import { all, Row } from "@/lib/db";
import { Badge, EmptyState, statusTone } from "@/components/ui";
import { BOOKING_STATUS_LABEL } from "@/lib/constants";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function NewDisputePage({ searchParams }: { searchParams: Promise<{ bookingId?: string }> }) {
  const user = await getSessionUser();
  const sp = await searchParams;
  const bookingId = Number(sp.bookingId);
  if (!user) redirect(`/login?next=/disputes/new${sp.bookingId ? `?bookingId=${sp.bookingId}` : ""}`);

  // Landing here without a booking is a normal thing to do, so offer a chooser
  // instead of a dead 404.
  if (!Number.isInteger(bookingId) || bookingId <= 0) return <ChooseBooking userId={user.id} providerId={user.provider?.id ?? null} />;

  const access = await loadBookingForUser(bookingId, user);
  if (!access) notFound();
  const bundle = await bookingBundle(bookingId);
  if (!bundle) notFound();

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <PageHeader
        breadcrumb={<><Link href={`/bookings/${bookingId}`} className="hover:text-electric">Booking {bundle.booking.code}</Link> / New dispute</>}
        title="Open a dispute"
        sub={`${bundle.resource?.title} · ${bundle.booking.code}`}
        right={<span className="text-[12px] text-ink-faint">Deposit recorded: {money(bundle.deposit?.amount ?? bundle.booking.deposit)}</span>}
      />
      <InfoNote tone="warn" title="What happens next">
        Opening a dispute freezes the deposit and asks an administrator to review. Nothing is deducted automatically. Both
        parties can add evidence and explanations to the thread. False or unsupported claims will be rejected.
      </InfoNote>
      <Card className="mt-4 p-5">
        <NewDisputeForm bookingId={bookingId} role={access.role} claimable={Number(bundle.booking.deposit) || 0} />
      </Card>
    </div>
  );
}

/** Shown when /disputes/new is opened without a bookingId. */
async function ChooseBooking({ userId, providerId }: { userId: number; providerId: number | null }) {
  const rows = await all<Row>(
    `SELECT b.id, b.code, b.status, b.start_date, b.end_date, r.title AS resource_title
       FROM bookings b JOIN resources r ON r.id = b.resource_id
      WHERE (b.buyer_id = ? OR b.provider_id = ?)
        AND b.status IN ('active','return_requested','completed','disputed','paid','ready_for_handover')
      ORDER BY b.updated_at DESC LIMIT 20`,
    userId, providerId ?? -1
  );
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <PageHeader
        breadcrumb={<><Link href="/disputes" className="hover:text-electric">Disputes</Link> / New dispute</>}
        title="Open a dispute"
        sub="Pick the rental the issue relates to. Disputes can only be opened on rentals you are party to, and evidence is required."
      />
      <InfoNote tone="warn" title="Before you open a dispute">
        Message the other party first — most issues are resolved in the booking thread. A dispute freezes the deposit
        for admin review; it never deducts anything automatically.
      </InfoNote>
      <div className="mt-4">
        {rows.length === 0 ? (
          <EmptyState
            title="No eligible rentals"
            body="You can open a dispute on a paid, active or completed rental. Nothing on your account qualifies yet."
            action={<Link href="/bookings" className="rounded-lg bg-electric px-3 py-1.5 text-[12.5px] font-medium text-navy-950">My bookings</Link>}
          />
        ) : (
          <Card className="p-3">
            <ul className="space-y-2">
              {rows.map((b) => (
                <li key={b.id}>
                  <Link href={`/disputes/new?bookingId=${b.id}`} className="flex flex-wrap items-center gap-3 rounded-xl border border-white/8 bg-white/2 p-2.5 hover:border-rose-400/35">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] font-medium text-ink">{b.resource_title}</p>
                      <p className="text-[11px] text-ink-faint">{b.code} · {fmtDate(b.start_date)} → {fmtDate(b.end_date)}</p>
                    </div>
                    <Badge tone={statusTone(b.status)}>{BOOKING_STATUS_LABEL[b.status] ?? b.status}</Badge>
                    <span className="text-[11px] text-electric">Select →</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}
