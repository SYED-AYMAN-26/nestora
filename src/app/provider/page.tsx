import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { all, one, Row } from "@/lib/db";
import { underusedForProvider } from "@/lib/resources";
import { Badge, Card, EmptyState, InfoNote, PageHeader, Progress, Stat, statusTone, money } from "@/components/ui";
import { BOOKING_STATUS_LABEL, VERIFICATION_LABEL } from "@/lib/constants";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Provider dashboard — RentLink 3D" };

export default async function ProviderHome() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  // A buyer-only account has no provider profile; send them to the console entry point
  // rather than crashing on a null profile.
  if (!user.provider) redirect("/provider");
  // Guarded above; the session shape is the typed subset of the provider_profiles row.
  const p = user.provider;

  const bookings = await all<Row>(
    `SELECT b.*, r.title AS resource_title, u.full_name AS buyer_name
       FROM bookings b JOIN resources r ON r.id = b.resource_id JOIN users u ON u.id = b.buyer_id
      WHERE b.provider_id = ? ORDER BY b.created_at DESC LIMIT 60`, p.id
  );
  const pending = bookings.filter((b) => b.status === "pending" || b.status === "counteroffered");
  const active = bookings.filter((b) => ["active", "return_requested", "ready_for_handover", "paid"].includes(b.status));
  const completed = bookings.filter((b) => b.status === "completed");
  const earnings = (await all<Row>(
    `SELECT COALESCE(SUM(p.amount),0) AS total FROM payments p JOIN bookings b ON b.id = p.booking_id
      WHERE b.provider_id = ? AND p.status = 'paid' AND p.kind != 'refund'`, p.id
  ))[0]?.total ?? 0;
  const listings = await underusedForProvider(p.id);
  const underused = listings.filter((l) => l.classification !== "frequently_used");
  const openExtensions = await all<Row>(
    `SELECT e.*, b.code FROM extensions e JOIN bookings b ON b.id = e.booking_id
      WHERE b.provider_id = ? AND e.status = 'pending'`, p.id
  );
  const disputes = await all<Row>(
    `SELECT d.*, b.code FROM disputes d JOIN bookings b ON b.id = d.booking_id
      WHERE b.provider_id = ? AND d.status IN ('open','evidence_requested','under_review')`, p.id
  );
  const verification = await one<Row>(`SELECT * FROM verification_requests WHERE provider_id = ? ORDER BY id DESC LIMIT 1`, p.id);

  return (
    <div className="mx-auto max-w-7xl px-4 py-7 sm:px-6">
      <PageHeader
        title="Provider overview"
        sub="Requests needing a decision, rentals in motion, what's sitting idle, and your verification standing."
        right={
          <>
            <Link href="/provider/bookings" className="rounded-lg border border-white/16 px-3 py-1.5 text-[12.5px] text-ink">All bookings</Link>
            <Link href={`/storefront/${p.storefront_slug}`} className="rounded-lg border border-white/16 px-3 py-1.5 text-[12.5px] text-ink">Storefront</Link>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Requests to decide" value={pending.length} hint="Pending or counteroffered" tone={pending.length ? "warn" : "default"} />
        <Stat label="In motion" value={active.length} hint="Paid → returned" />
        <Stat label="Completed rentals" value={completed.length} hint="Returned and confirmed" />
        <Stat label="Recorded payment total" value={money(earnings)} hint="Paid records incl. demo-mode payments" />
      </div>

      {p.verification_status !== "verified" && (
        <div className="mt-4">
          <InfoNote tone={p.verification_status === "more_info" || p.verification_status === "rejected" ? "warn" : "info"} title={`Verification: ${VERIFICATION_LABEL[p.verification_status] ?? p.verification_status}`}>
            {p.verification_status === "not_submitted"
              ? "You don't have a verified badge yet. Buyers see it as a trust signal — submit identity and ownership evidence for review."
              : p.verification_status === "pending"
                ? "Your documents are queued for admin review. The badge appears only after approval."
                : verification?.reviewer_note ?? "An administrator needs more information or rejected the submission. You can resubmit."}{" "}
            <Link href="/provider/verification" className="underline">Open verification</Link>
          </InfoNote>
        </div>
      )}

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[14px] font-semibold text-ink">Requests awaiting your decision</h2>
              <Link href="/provider/bookings?status=pending" className="text-[12px] text-electric hover:underline">View all →</Link>
            </div>
            {pending.length === 0 ? (
              <p className="text-[12.5px] text-ink-faint">No pending requests right now.</p>
            ) : (
              <ul className="space-y-2">
                {pending.slice(0, 5).map((b) => (
                  <li key={b.id} className="rounded-xl border border-white/8 bg-white/2 p-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/bookings/${b.id}`} className="text-[13px] font-medium text-ink hover:text-electric">{b.resource_title}</Link>
                      <Badge tone={statusTone(b.status)}>{BOOKING_STATUS_LABEL[b.status]}</Badge>
                      <span className="ml-auto text-[11px] text-ink-faint">{fmtDate(b.start_date)} → {fmtDate(b.end_date)}</span>
                    </div>
                    <p className="mt-0.5 text-[11.5px] text-ink-faint">
                      {b.buyer_name} · {b.units} unit(s) · {money(b.subtotal)} rental · priority {b.priority_score}
                    </p>
                    {b.purpose && <p className="mt-0.5 text-[11px] italic text-ink-faint">“{b.purpose}”</p>}
                    <Link href={`/bookings/${b.id}`} className="mt-1.5 inline-block rounded-lg bg-electric/15 px-2.5 py-1 text-[11.5px] text-electric">Review request →</Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-[14px] font-semibold text-ink">Utilisation — what&apos;s sitting idle</h2>
              <Link href="/provider/utilisation" className="text-[12px] text-electric hover:underline">Details →</Link>
            </div>
            {listings.length === 0 ? (
              <EmptyState title="No listings yet" body="Add your first resource to see utilisation insights." action={<Link href="/provider/new" className="rounded-lg bg-electric px-3 py-1.5 text-[12px] font-medium text-navy-950">Create listing</Link>} />
            ) : (
              <>
                <p className="mb-2 text-[11.5px] leading-relaxed text-ink-faint">
                  {underused.length} of {listings.length} listings are not frequently used. Estimated idle units are
                  derived from your declared internal use — they are <strong>estimates</strong>, not confirmed availability.
                </p>
                <ul className="space-y-2">
                  {listings.slice(0, 5).map((l) => (
                    <li key={l.id}>
                      <div className="mb-1 flex items-baseline justify-between gap-2">
                        <Link href={`/provider/resources/${l.id}`} className="truncate text-[12.5px] text-ink hover:text-electric">{l.title}</Link>
                        <span className="shrink-0 text-[11px] tabular-nums text-ink-faint">{l.utilisation_pct}% · idle ~{l.idle_units}</span>
                      </div>
                      <Progress value={l.utilisation_pct} tone={l.classification === "frequently_used" ? "mint" : l.utilisation_pct < 12 ? "amber" : "electric"} />
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>

          <Card className="p-4">
            <h2 className="mb-2 text-[14px] font-semibold text-ink">Recent bookings</h2>
            {bookings.length === 0 ? (
              <p className="text-[12.5px] text-ink-faint">No bookings yet.</p>
            ) : (
              <table className="w-full text-left text-[12px]">
                <thead className="text-[10px] uppercase tracking-wider text-ink-faint">
                  <tr><th className="py-1">Booking</th><th className="py-1">Resource</th><th className="py-1">Buyer</th><th className="py-1">Dates</th><th className="py-1">Status</th></tr>
                </thead>
                <tbody className="text-ink-dim">
                  {bookings.slice(0, 8).map((b) => (
                    <tr key={b.id} className="border-t border-white/6">
                      <td className="py-1.5"><Link href={`/bookings/${b.id}`} className="font-mono text-[10.5px] text-electric hover:underline">{b.code}</Link></td>
                      <td className="max-w-40 truncate py-1.5">{b.resource_title}</td>
                      <td className="py-1.5">{b.buyer_name}</td>
                      <td className="py-1.5 whitespace-nowrap">{b.start_date} → {b.end_date}</td>
                      <td className="py-1.5"><Badge tone={statusTone(b.status)}>{BOOKING_STATUS_LABEL[b.status] ?? b.status}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="p-4">
            <h2 className="text-[13.5px] font-semibold text-ink">Needs attention</h2>
            <ul className="mt-2 space-y-1.5 text-[12px]">
              <li className="flex items-center justify-between gap-2">
                <span className="text-ink-dim">Pending requests</span>
                <Badge tone={pending.length ? "warn" : "neutral"}>{pending.length}</Badge>
              </li>
              <li className="flex items-center justify-between gap-2">
                <span className="text-ink-dim">Extension requests</span>
                <Badge tone={openExtensions.length ? "warn" : "neutral"}>{openExtensions.length}</Badge>
              </li>
              <li className="flex items-center justify-between gap-2">
                <span className="text-ink-dim">Open disputes</span>
                <Badge tone={disputes.length ? "danger" : "neutral"}>{disputes.length}</Badge>
              </li>
              <li className="flex items-center justify-between gap-2">
                <span className="text-ink-dim">Returns to inspect</span>
                <Badge tone={bookings.filter((b) => b.status === "return_requested").length ? "warn" : "neutral"}>
                  {bookings.filter((b) => b.status === "return_requested").length}
                </Badge>
              </li>
              <li className="flex items-center justify-between gap-2">
                <span className="text-ink-dim">Handovers to prepare</span>
                <Badge tone={bookings.filter((b) => b.status === "paid").length ? "warn" : "neutral"}>{bookings.filter((b) => b.status === "paid").length}</Badge>
              </li>
            </ul>
          </Card>

          <Card className="p-4">
            <h2 className="text-[13.5px] font-semibold text-ink">Fast actions</h2>
            <div className="mt-2 grid grid-cols-1 gap-1.5">
              {[
                ["/provider/new", "Create a listing"],
                ["/provider/utilisation", "Review underused resources"],
                ["/provider/verification", "Verification status"],
                ["/provider/bookings?status=return_requested", "Inspect a return"],
                ["/settings", "Storefront & policies"],
              ].map(([href, label]) => (
                <Link key={href} href={href} className="rounded-lg border border-white/10 bg-white/3 px-2.5 py-1.5 text-[12px] text-ink-dim hover:border-electric/35 hover:text-ink">
                  {label}
                </Link>
              ))}
            </div>
          </Card>

          <Card className="p-4">
            <h2 className="text-[13.5px] font-semibold text-ink">Fair allocation policy</h2>
            <p className="text-[11.5px] leading-relaxed text-ink-faint">
              Buyers see exactly why they ranked where they did. Adjust these rules in settings.
            </p>
            <pre className="mt-1.5 overflow-x-auto rounded-lg bg-navy-950/70 p-2 text-[10.5px] text-ink-dim">
{JSON.stringify((() => { try { return JSON.parse(p.priority_policy || "{}"); } catch { return {}; } })(), null, 2)}
            </pre>
            <Link href="/settings" className="mt-1.5 inline-block text-[11.5px] text-electric hover:underline">Edit policy →</Link>
          </Card>
        </div>
      </div>
    </div>
  );
}
