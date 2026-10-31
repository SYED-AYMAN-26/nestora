import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { loadBookingForUser } from "@/lib/access";
import { bookingBundle } from "@/lib/lifecycle";
import { Badge, Card, InfoNote, PageHeader, statusTone, money } from "@/components/ui";
import { BOOKING_STATUS_LABEL, CHECKLIST_ITEMS, CONDITIONS } from "@/lib/constants";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { BookingWorkspace, type Extension, type Handover, type ReturnRec } from "./BookingWorkspace";

export const dynamic = "force-dynamic";

export default async function BookingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  const { id } = await params;
  if (!user) redirect(`/login?next=/bookings/${id}`);

  const access = await loadBookingForUser(Number(id), user);
  if (!access) notFound();
  const bundle = await bookingBundle(Number(id));
  if (!bundle) notFound();

  const { booking: b, resource: r, buyer, providerUser, handover, returnRecord, payments, deposit, extensions, dispute, review, conditionReports, messages, overdue, daysLeft } = bundle;
  const role = access.role;
  const isBuyer = role === "buyer";

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <PageHeader
        breadcrumb={<><Link href={isBuyer ? "/bookings" : "/provider/bookings"} className="hover:text-electric">{isBuyer ? "My bookings" : "Provider bookings"}</Link> / {b.code}</>}
        title={r?.title ?? "Booking"}
        sub={`${b.code} · ${fmtDate(b.start_date)} → ${fmtDate(b.end_date)} · ${b.days} day(s) · ${b.units} unit(s)`}
        right={
          <>
            <Badge tone={statusTone(b.status)}>{BOOKING_STATUS_LABEL[b.status] ?? b.status}</Badge>
            {overdue && <Badge tone="danger">Overdue</Badge>}
            {role !== "admin" && <Badge tone="neutral">{role} view</Badge>}
            {role === "admin" && <Badge tone="warn">admin view</Badge>}
            <Link href={`/resources/${r?.id}`} className="rounded-lg border border-white/16 px-3 py-1.5 text-[12.5px] text-ink">View listing</Link>
          </>
        }
      />

      {role === "provider" && (
        <InfoNote tone="info" title="Provider responsibility">
          You can approve, reject with a reason, or counter-propose dates. Record the initial condition with photos before
          collection, and inspect thoroughly at return. Nothing about the deposit changes automatically.
        </InfoNote>
      )}

      <div className="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          {/* progress rail */}
          <Card className="p-4">
            <h2 className="text-[13.5px] font-semibold text-ink">Lifecycle</h2>
            <ol className="mt-2.5 flex flex-wrap gap-1.5 text-[10.5px]">
              {[
                ["Requested", ["pending", "approved", "awaiting_payment", "paid", "ready_for_handover", "active", "return_requested", "completed", "disputed"]],
                ["Approved", ["approved", "awaiting_payment", "paid", "ready_for_handover", "active", "return_requested", "completed", "disputed"]],
                ["Paid", ["paid", "ready_for_handover", "active", "return_requested", "completed", "disputed"]],
                ["Handover", ["ready_for_handover", "active", "return_requested", "completed", "disputed"]],
                ["Active", ["active", "return_requested", "completed", "disputed"]],
                ["Returned", ["return_requested", "completed", "disputed"]],
                ["Complete", ["completed"]],
              ].map(([label, states], i) => {
                const done = (states as string[]).includes(b.status);
                return (
                  <li key={i} className={`flex items-center gap-1 rounded-full border px-2 py-1 ${done ? "border-electric/40 bg-electric/12 text-electric" : "border-white/10 text-ink-faint"}`}>
                    <span>{done ? "●" : "○"}</span>{label as string}
                  </li>
                );
              })}
            </ol>
            {["cancelled", "rejected", "expired"].includes(b.status) && (
              <p className="mt-2 rounded-lg border border-rose-400/25 bg-rose-400/10 px-2.5 py-1.5 text-[12px] text-rose-200">
                This booking ended as <strong>{b.status}</strong>. {b.provider_note ? `Reason: ${b.provider_note}` : ""}
              </p>
            )}
            {b.counter_start && b.status === "counteroffered" && (
              <div className="mt-2 rounded-lg border border-amber-400/25 bg-amber-400/10 px-2.5 py-1.5 text-[12px] text-amber-100">
                <p className="font-semibold">Counteroffer: {fmtDate(b.counter_start)} → {fmtDate(b.counter_end)}</p>
                {b.counter_note && <p className="mt-0.5">{b.counter_note}</p>}
              </div>
            )}
            {b.priority_reason && (
              <details className="mt-2 rounded-lg border border-white/10 bg-white/3 px-2.5 py-1.5">
                <summary className="cursor-pointer text-[12px] text-ink-dim">Why this priority score ({b.priority_score})?</summary>
                <p className="mt-1 text-[11.5px] leading-relaxed text-ink-faint">{b.priority_reason}</p>
                <p className="mt-1 text-[10.5px] leading-relaxed text-ink-faint">
                  Scores are computed at request time from the provider&apos;s published policy — eligibility, stated purpose,
                  previous use and fair rotation. Nothing is hidden or arbitrary.
                </p>
              </details>
            )}
          </Card>

          <BookingWorkspace
            role={role}
            booking={{
              id: b.id, code: b.code, status: b.status, start: b.start_date, end: b.end_date, days: b.days,
              units: b.units, total: b.total, deposit: b.deposit, fees: b.fees, subtotal: b.subtotal,
              providerNote: b.provider_note, counterStart: b.counter_start, counterEnd: b.counter_end,
              overdue, daysLeft,
            }}
            resource={{
              title: r?.title ?? "", trainingRequired: Boolean(r?.training_required),
              supervisionRequired: Boolean(r?.supervision_required), usageRules: r?.usage_rules ?? null,
              cancellationPolicy: r?.cancellation_policy ?? null,
            }}
            handover={handover as unknown as Handover}
            returnRecord={returnRecord as unknown as ReturnRec}
            extensions={extensions as unknown as Extension[]}
            checklistItems={CHECKLIST_ITEMS}
            conditions={CONDITIONS.map((c) => ({ value: c.value, label: c.label }))}
            hasDispute={Boolean(dispute)}
            hasReview={Boolean(review)}
            counterparty={isBuyer ? { name: providerUser?.full_name ?? "", email: providerUser?.email ?? null, phone: providerUser?.phone ?? null } : { name: buyer?.full_name ?? "", email: buyer?.email ?? null, phone: buyer?.phone ?? null }}
          />
        </div>

        <aside className="space-y-4">
          <Card className="p-4">
            <h2 className="text-[13.5px] font-semibold text-ink">Cost breakdown</h2>
            <dl className="mt-2 space-y-1 text-[12.5px]">
              <div className="flex justify-between"><dt className="text-ink-dim">Rental ({b.quote.rateLabel})</dt><dd className="text-ink">{money(b.quote.subtotal)}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-dim">Platform fee</dt><dd className="text-ink">{money(b.fees)}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-dim">Refundable deposit</dt><dd className="text-ink">{money(b.deposit)}</dd></div>
              <div className="flex justify-between border-t border-white/10 pt-1.5 font-semibold"><dt>Total</dt><dd className="text-electric">{money(b.total)}</dd></div>
            </dl>
            <div className="mt-2 rounded-lg border border-white/10 bg-white/3 px-2.5 py-2 text-[11px] leading-relaxed text-ink-faint">
              Deposit status: <strong className="text-ink-dim">{deposit?.status?.replace(/_/g, " ") ?? "not recorded yet"}</strong>
              {deposit?.note ? ` — ${deposit.note}` : ""}
            </div>
          </Card>

          <Card className="p-4">
            <h2 className="text-[13.5px] font-semibold text-ink">Payments</h2>
            {payments.length === 0 ? (
              <p className="mt-1.5 text-[12px] text-ink-faint">No payment recorded yet.</p>
            ) : (
              <ul className="mt-2 space-y-1.5 text-[12px]">
                {payments.map((p: Row) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-white/6 pb-1.5">
                    <span className="capitalize text-ink-dim">{p.kind}</span>
                    <span className="text-ink">{money(p.amount)}</span>
                    <Badge tone={statusTone(p.status)}>{p.status}</Badge>
                    <span className="w-full text-[10px] text-ink-faint">
                      {p.mode === "demo" ? "DEMO MODE — no money transferred" : "Razorpay test"} · {p.paid_at ? fmtDateTime(p.paid_at) : "not paid"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="p-4">
            <h2 className="text-[13.5px] font-semibold text-ink">Counterparty</h2>
            <p className="mt-1.5 text-[12.5px] font-medium text-ink">{isBuyer ? `Provider contact: ${providerUser?.full_name}` : `Buyer: ${buyer?.full_name}`}</p>
            <p className="text-[11.5px] text-ink-faint">{isBuyer ? providerUser?.email : buyer?.email} {isBuyer && providerUser?.phone ? `· ${providerUser.phone}` : ""}</p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">
              Contact details are shared only between the two parties on a confirmed booking. Use the secure message thread
              below for anything that should stay on record.
            </p>
            {b.buyer_id ? <p className="mt-1 text-[10.5px] text-ink-faint">Buyer account type: {buyer?.account_type?.replace(/_/g, " ")}</p> : null}
          </Card>

          <Card className="p-4">
            <h2 className="text-[13.5px] font-semibold text-ink">Condition evidence</h2>
            {conditionReports.length === 0 ? (
              <p className="mt-1.5 text-[12px] text-ink-faint">No condition records yet. The provider records the initial state before collection.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {conditionReports.map((c: Row) => (
                  <li key={c.id} className="rounded-lg border border-white/8 bg-white/2 p-2">
                    <div className="flex items-center gap-2">
                      <Badge tone={c.stage === "damage" ? "danger" : c.stage === "initial" ? "info" : "success"}>{c.stage}</Badge>
                      <span className="text-[12px] text-ink capitalize">{c.condition}</span>
                      <span className="ml-auto text-[10px] text-ink-faint">{fmtDateTime(c.created_at)}</span>
                    </div>
                    {c.notes && <p className="mt-1 text-[11px] text-ink-faint">{c.notes}</p>}
                    {c.photos?.length > 0 && (
                      <div className="mt-1.5 flex gap-1.5">
                        {c.photos.slice(0, 3).map((p: string) => (
                          <a key={p} href={p} target="_blank" rel="noopener noreferrer">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={p} alt="Condition evidence" className="h-12 w-16 rounded object-cover" />
                          </a>
                        ))}
                      </div>
                    )}
                    {c.checklist?.length > 0 && (
                      <ul className="mt-1 text-[10.5px] text-ink-faint">
                        {c.checklist.slice(0, 3).map((i: string) => <li key={i}>✓ {i}</li>)}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {dispute && (
            <Card className="border-rose-400/25 p-4">
              <h2 className="text-[13.5px] font-semibold text-ink">Dispute</h2>
              <p className="mt-1 text-[12px] text-ink-dim">{dispute.kind} · <Badge tone={statusTone(dispute.status)}>{dispute.status.replace(/_/g, " ")}</Badge></p>
              <Link href={`/disputes/${dispute.id}`} className="mt-2 inline-block text-[12px] text-electric hover:underline">Open dispute thread →</Link>
            </Card>
          )}

          {(() => {
            const notes = messages as Row[];
            return (
              <Card className="p-4">
                <h2 className="mb-2 text-[13.5px] font-semibold text-ink">Messages</h2>
                {notes.length === 0 ? (
                  <p className="text-[12px] text-ink-faint">No messages yet — use the thread to keep a record.</p>
                ) : (
                  <ul className="mb-2 space-y-1.5 text-[12px]">
                    {notes.slice(-5).map((m) => (
                      <li key={m.id} className="rounded-lg bg-white/4 px-2 py-1.5">
                        <p className="text-[10.5px] text-ink-faint">{m.sender_name} · {fmtDateTime(m.created_at)}</p>
                        <p className="text-ink-dim">{m.body}</p>
                      </li>
                    ))}
                  </ul>
                )}
                <MessageBox bookingId={b.id} />
              </Card>
            );
          })()}

          {extensions.length > 0 && (
            <Card className="p-4">
              <h2 className="text-[13.5px] font-semibold text-ink">Extension requests</h2>
              <ul className="mt-1.5 space-y-1.5 text-[12px]">
                {extensions.map((e: Row) => (
                  <li key={e.id} className="flex flex-wrap items-center gap-2 border-b border-white/6 pb-1.5">
                    <span className="text-ink">to {fmtDate(e.requested_end)}</span>
                    <Badge tone={statusTone(e.status)}>{e.status}</Badge>
                    <span className="text-[11px] text-ink-faint">+{e.extra_days} day(s) · {money(e.extra_cost)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {review && (
            <Card className="p-4">
              <h2 className="text-[13.5px] font-semibold text-ink">Your review</h2>
              <p className="mt-1 text-[12.5px] text-ink-dim">{"★".repeat(review.rating)}<span className="text-white/20">{"★".repeat(5 - review.rating)}</span></p>
              {review.body && <p className="mt-1 text-[12px] text-ink-dim">{review.body}</p>}
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}

import { MessageBox } from "./MessageBox";
import type { Row } from "@/lib/db";
