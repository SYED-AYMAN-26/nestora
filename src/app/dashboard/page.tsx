import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { all, one, Row } from "@/lib/db";
import { Badge, Card, EmptyState, InfoNote, PageHeader, Stat, StatusTone, statusTone, money } from "@/components/ui";
import { BOOKING_STATUS_LABEL } from "@/lib/constants";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Buyer dashboard" };

export default async function BuyerDashboard() {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/dashboard");

  const bookings = await all<Row>(
    `SELECT b.*, r.title AS resource_title, p.display_name AS provider_name,
            (SELECT url FROM resource_images i WHERE i.resource_id = r.id ORDER BY sort_order LIMIT 1) AS image_url
       FROM bookings b JOIN resources r ON r.id = b.resource_id JOIN provider_profiles p ON p.id = b.provider_id
      WHERE b.buyer_id = ? ORDER BY b.created_at DESC`,
    user.id
  );
  const pending = bookings.filter((b) => b.status === "pending" || b.status === "counteroffered");
  const active = bookings.filter((b) => ["approved", "awaiting_payment", "paid", "ready_for_handover", "active", "return_requested"].includes(b.status));
  const completed = bookings.filter((b) => b.status === "completed");
  const dueSoon = bookings.filter((b) => b.status === "active");

  const favourites = await all<Row>(
    `SELECT r.id, r.title, r.price_daily, p.display_name AS provider_name,
            (SELECT url FROM resource_images i WHERE i.resource_id = r.id ORDER BY sort_order LIMIT 1) AS image_url
       FROM favourites f JOIN resources r ON r.id = f.resource_id JOIN provider_profiles p ON p.id = r.provider_id
      WHERE f.user_id = ? ORDER BY f.created_at DESC LIMIT 6`, user.id
  );
  const recent = await all<Row>(
    `SELECT r.id, r.title, r.price_daily, p.display_name AS provider_name, rv.viewed_at,
            (SELECT url FROM resource_images i WHERE i.resource_id = r.id ORDER BY sort_order LIMIT 1) AS image_url
       FROM recently_viewed rv JOIN resources r ON r.id = rv.resource_id JOIN provider_profiles p ON p.id = r.provider_id
      WHERE rv.user_id = ? ORDER BY rv.viewed_at DESC LIMIT 6`, user.id
  );
  const payments = await all<Row>(
    `SELECT pay.*, b.code FROM payments pay JOIN bookings b ON b.id = pay.booking_id
      WHERE b.buyer_id = ? ORDER BY pay.id DESC LIMIT 6`, user.id
  );
  const disputes = await all<Row>(
    `SELECT d.*, b.code FROM disputes d JOIN bookings b ON b.id = d.booking_id WHERE b.buyer_id = ? ORDER BY d.created_at DESC LIMIT 5`, user.id
  );
  const waitlist = await all<Row>(
    `SELECT w.*, r.title AS resource_title FROM waiting_list w JOIN resources r ON r.id = w.resource_id
      WHERE w.user_id = ? AND w.status IN ('waiting','offered') ORDER BY w.created_at DESC`, user.id
  );
  const unread = (await one<{ c: number }>(`SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read_at IS NULL`, user.id))?.c ?? 0;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <PageHeader
        title={`Hello, ${user.full_name.split(" ")[0]}`}
        sub="Everything on the buying side: pending requests, active rentals, return deadlines, favourites and payments."
        right={
          <>
            <Link href="/marketplace" className="rounded-lg bg-gradient-to-b from-electric to-electric-deep px-3.5 py-2 text-[13px] font-semibold text-navy-950">Browse marketplace</Link>
            {!user.provider && <Link href="/onboarding" className="rounded-lg border border-white/16 px-3.5 py-2 text-[13px] text-ink">Become a provider</Link>}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Pending requests" value={pending.length} hint="Awaiting provider decisions or your response to a counteroffer" />
        <Stat label="In motion" value={active.length} hint="Approved, paid, active or awaiting return" />
        <Stat label="Completed" value={completed.length} hint="Returned and confirmed by the provider" />
        <Stat label="Unread notifications" value={unread} hint="Booking, payment and dispute updates" />
      </div>

      {dueSoon.length > 0 && (
        <div className="mt-5">
          <Card className="border-amber-400/25 bg-amber-400/6 p-4">
            <p className="text-[12px] font-semibold uppercase tracking-wider text-amber-300">Return deadlines</p>
            <ul className="mt-2 space-y-1.5">
              {dueSoon.map((b) => {
                const days = Math.round((new Date(b.end_date + "T00:00:00Z").getTime() - Date.now()) / 864e5);
                return (
                  <li key={b.id} className="flex flex-wrap items-center gap-2 text-[12.5px]">
                    <Link href={`/bookings/${b.id}`} className="text-ink hover:text-electric">{b.resource_title}</Link>
                    <span className="text-ink-faint">from {b.provider_name}</span>
                    <Badge tone={days < 0 ? "danger" : days <= 1 ? "warn" : "neutral"}>
                      {days < 0 ? `${Math.abs(days)} day(s) overdue` : days === 0 ? "Due today" : `Due in ${days} day(s)`}
                    </Badge>
                    <span className="ml-auto text-[11px] text-ink-faint">{fmtDate(b.end_date)}</span>
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
      )}

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div>
          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[14px] font-semibold text-ink">My bookings</h2>
              <Link href="/bookings" className="text-[12px] text-electric hover:underline">All bookings →</Link>
            </div>
            {bookings.length === 0 ? (
              <EmptyState title="No bookings yet" body="Find something you need and send a request — the provider approves before any payment." action={<Link href="/recommend" className="rounded-lg bg-electric px-3 py-1.5 text-[12.5px] font-medium text-navy-950">Find by need</Link>} />
            ) : (
              <ul className="space-y-2">
                {bookings.slice(0, 6).map((b) => (
                  <li key={b.id}>
                    <Link href={`/bookings/${b.id}`} className="flex items-center gap-3 rounded-xl border border-white/8 bg-white/2 p-2.5 transition hover:border-electric/35">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={b.image_url || "/img/camera.svg"} alt="" className="h-12 w-16 rounded-lg object-cover" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12.5px] font-medium text-ink">{b.resource_title}</p>
                        <p className="truncate text-[11px] text-ink-faint">{b.provider_name} · {fmtDate(b.start_date)} → {fmtDate(b.end_date)}</p>
                      </div>
                      <Badge tone={statusTone(b.status)}>{BOOKING_STATUS_LABEL[b.status] ?? b.status}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="mt-4 p-4">
            <h2 className="mb-2 text-[14px] font-semibold text-ink">Recent payments</h2>
            {payments.length === 0 ? (
              <p className="text-[12.5px] text-ink-faint">No payments recorded.</p>
            ) : (
              <table className="w-full text-left text-[12px]">
                <thead className="text-[10px] uppercase tracking-wider text-ink-faint"><tr><th className="py-1">Booking</th><th className="py-1">Kind</th><th className="py-1">Amount</th><th className="py-1">Mode</th><th className="py-1">Status</th></tr></thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id} className="border-t border-white/6">
                      <td className="py-1.5 font-mono text-[10.5px] text-electric">{p.code}</td>
                      <td className="py-1.5 capitalize text-ink-dim">{p.kind}</td>
                      <td className="py-1.5 text-ink">{money(p.amount)}</td>
                      <td className="py-1.5 text-ink-faint">{p.mode === "demo" ? "Demo" : "Razorpay test"}</td>
                      <td className="py-1.5"><Badge tone={statusTone(p.status)}>{p.status}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="p-4">
            <h2 className="mb-2 text-[14px] font-semibold text-ink">Favourites</h2>
            {favourites.length === 0 ? (
              <p className="text-[12.5px] text-ink-faint">Save resources with the heart button to keep them here.</p>
            ) : (
              <ul className="space-y-1.5">
                {favourites.map((f) => (
                  <li key={f.id}>
                    <Link href={`/resources/${f.id}`} className="flex items-center gap-2 rounded-lg px-1.5 py-1.5 hover:bg-white/4">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={f.image_url || "/img/camera.svg"} alt="" className="h-9 w-12 rounded object-cover" />
                      <span className="min-w-0 flex-1 truncate text-[12px] text-ink">{f.title}</span>
                      <span className="text-[11.5px] text-ink-faint">{money(f.price_daily)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <Link href="/favourites" className="mt-2 block text-[11.5px] text-electric hover:underline">All favourites →</Link>
          </Card>

          <Card className="p-4">
            <h2 className="mb-2 text-[14px] font-semibold text-ink">Recently viewed</h2>
            {recent.length === 0 ? (
              <p className="text-[12.5px] text-ink-faint">Nothing yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {recent.slice(0, 4).map((f) => (
                  <li key={f.id}>
                    <Link href={`/resources/${f.id}`} className="flex items-center gap-2 rounded-lg px-1.5 py-1.5 hover:bg-white/4">
                      <span className="min-w-0 flex-1 truncate text-[12px] text-ink">{f.title}</span>
                      <span className="text-[11px] text-ink-faint">{f.provider_name}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {waitlist.length > 0 && (
            <Card className="p-4">
              <h2 className="mb-2 text-[14px] font-semibold text-ink">Waiting list</h2>
              <ul className="space-y-1.5 text-[12px]">
                {waitlist.map((w) => (
                  <li key={w.id} className="flex flex-wrap items-center gap-2">
                    <span className="text-ink">{w.resource_title}</span>
                    <Badge tone={w.status === "offered" ? "success" : "info"}>{w.status}</Badge>
                    <span className="text-[11px] text-ink-faint">{w.start_date} → {w.end_date}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {disputes.length > 0 && (
            <Card className="p-4">
              <h2 className="mb-2 text-[14px] font-semibold text-ink">Disputes</h2>
              <ul className="space-y-1.5 text-[12px]">
                {disputes.map((d) => (
                  <li key={d.id} className="flex items-center gap-2">
                    <Link href={`/disputes/${d.id}`} className="text-ink hover:text-electric">{d.kind} · {d.code}</Link>
                    <Badge tone={statusTone(d.status)}>{d.status.replace(/_/g, " ")}</Badge>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {!user.provider && (
            <InfoNote tone="info" title="One account, both sides">
              You can list your own unused equipment without a second account.{" "}
              <Link href="/onboarding" className="underline">Create a provider profile</Link>.
            </InfoNote>
          )}
        </div>
      </div>
    </div>
  );
}

export type { StatusTone };
