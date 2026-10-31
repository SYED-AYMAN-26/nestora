import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { loadBookingForUser } from "@/lib/access";
import { bookingBundle } from "@/lib/lifecycle";
import { Badge, Card, InfoNote, PageHeader, money } from "@/components/ui";
import { paymentMode, paymentModeLabel, razorpayConfigured } from "@/lib/payments";
import { PaymentClient } from "./PaymentClient";
import { fmtDate } from "@/lib/format";
import type { Row } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function PaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  const { id } = await params;
  if (!user) redirect(`/login?next=/bookings/${id}/payment`);
  const access = await loadBookingForUser(Number(id), user);
  if (!access) notFound();
  const bundle = await bookingBundle(Number(id));
  if (!bundle) notFound();
  const { booking: b, resource: r, payments, deposit } = bundle;

  const payable = ["approved", "awaiting_payment"].includes(b.status);
  const mode = paymentMode();

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <PageHeader
        breadcrumb={<><Link href={`/bookings/${b.id}`} className="hover:text-electric">Booking {b.code}</Link> / Payment</>}
        title="Complete payment"
        sub={`${r?.title} · ${fmtDate(b.start_date)} → ${fmtDate(b.end_date)}`}
        right={<Badge tone={payable ? "warn" : "success"}>{payable ? "Payment due" : b.status.replace(/_/g, " ")}</Badge>}
      />

      <InfoNote tone={mode === "demo" ? "warn" : "info"} title={paymentModeLabel()}>
        {mode === "demo" ? (
          <>
            This deployment has no Razorpay credentials configured, so <strong>no money moves</strong>. Confirming records a
            simulated payment against the booking so the lifecycle (handover → return → dispute) can be demonstrated
            end-to-end. No card details are requested or stored.
          </>
        ) : (
          <>
            Razorpay <strong>test-mode</strong> keys are configured. A real Razorpay test order is created; the returned
            signature is verified server-side <em>and</em> the capture is confirmed with Razorpay&apos;s server API before
            the booking is marked paid. An authorised-but-uncaptured payment is never treated as paid. Use Razorpay&apos;s
            test cards only — no live money can move.
          </>
        )}
      </InfoNote>

      <Card className="mt-4 p-5">
        <h2 className="text-[15px] font-semibold text-ink">Cost breakdown</h2>
        <dl className="mt-3 space-y-1.5 text-[13px]">
          <div className="flex justify-between"><dt className="text-ink-dim">Rental — {b.quote.rateLabel}</dt><dd className="text-ink">{money(b.quote.subtotal)}</dd></div>
          <div className="flex justify-between"><dt className="text-ink-dim">Platform fee (2%)</dt><dd className="text-ink">{money(b.fees)}</dd></div>
          <div className="flex justify-between"><dt className="text-ink-dim">Refundable security deposit</dt><dd className="text-ink">{money(b.deposit)}</dd></div>
          <div className="flex justify-between border-t border-white/10 pt-2 text-[15px] font-semibold"><dt>Total due now</dt><dd className="text-electric">{money(b.total)}</dd></div>
        </dl>
        <div className="mt-3 rounded-lg border border-white/10 bg-white/3 px-3 py-2 text-[11.5px] leading-relaxed text-ink-faint">
          <p><strong className="text-ink-dim">Refund conditions:</strong> The deposit is returned after the provider inspects the
          equipment on return. A deduction can only happen through a documented dispute decision by an admin — never
          automatically.</p>
          <p className="mt-1"><strong className="text-ink-dim">Not escrow:</strong> Nestora does not hold funds. A deposit
          row is a simulated record — no money is held by the platform or any third party.</p>
          {deposit && <p className="mt-1">Deposit record: <span className="text-ink-dim">{deposit.status.replace(/_/g, " ")}</span>{deposit.note ? ` — ${deposit.note}` : ""}</p>}
        </div>
      </Card>

      {payments.length > 0 && (
        <Card className="mt-4 p-4">
          <h2 className="text-[13.5px] font-semibold text-ink">Payment records</h2>
          <ul className="mt-2 space-y-1 text-[12px]">
            {payments.map((p: Row) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-white/6 pb-1.5">
                <span className="capitalize text-ink-dim">{p.kind}</span>
                <span className="text-ink">{money(p.amount)}</span>
                <Badge tone={p.status === "paid" ? "success" : "warn"}>{p.status}</Badge>
                <span className="w-full text-[10px] text-ink-faint">{p.mode === "demo" ? "DEMO — no money transferred" : "Razorpay test"} · {p.created_at?.slice(0, 16).replace("T", " ")}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="mt-4">
        <PaymentClient
          bookingId={b.id}
          amount={b.total}
          payable={payable}
          mode={mode}
          razorpayKeyId={razorpayConfigured() ? process.env.RAZORPAY_KEY_ID ?? null : null}
        />
      </div>
    </div>
  );
}
