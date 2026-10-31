"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { api, money, addDays } from "@/lib/client";
import { Alert, Button, Field, Input, Select, Textarea, Uploader, CheckboxList, Toggle } from "@/components/form";
import { Card, InfoNote, Badge } from "@/components/ui";

type Role = "buyer" | "provider" | "admin";
type Booking = {
  id: number; code: string; status: string; start: string; end: string; days: number; units: number;
  total: number; deposit: number; fees: number; subtotal: number; providerNote: string | null;
  counterStart: string | null; counterEnd: string | null; overdue: boolean; daysLeft: number;
};
export type Handover = { initial_condition: string | null; checklist: string[]; provider_photos: string[]; provider_ready_at: string | null; buyer_confirmed_at: string | null; buyer_note: string | null; buyer_photos: string[] } | null;
export type ReturnRec = { buyer_requested_at: string | null; buyer_photos: string[]; buyer_note: string | null; provider_inspected_at: string | null; return_condition: string | null; provider_photos: string[]; provider_note: string | null; checklist: string[] } | null;
export type Extension = { id: number; requested_end: string; extra_days: number; extra_cost: number; status: string; note: string | null };

export function BookingWorkspace({
  role, booking, resource, handover, returnRecord, extensions, checklistItems, conditions, hasDispute, hasReview, counterparty,
}: {
  role: Role;
  booking: Booking;
  resource: { title: string; trainingRequired: boolean; supervisionRequired: boolean; usageRules: string | null; cancellationPolicy: string | null };
  handover: Handover;
  returnRecord: ReturnRec;
  extensions: Extension[];
  checklistItems: string[];
  conditions: { value: string; label: string }[];
  hasDispute: boolean;
  hasReview: boolean;
  counterparty: { name: string; email: string | null; phone: string | null };
}) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ kind: "error" | "success" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const act = async (payload: Record<string, unknown>, label: string) => {
    setBusy(label);
    setMsg(null);
    const res = await api<{ message: string }>(`/api/bookings/${booking.id}/actions`, { body: payload });
    setBusy(null);
    if (!res.ok) { setMsg({ kind: "error", text: res.error }); return false; }
    setMsg({ kind: "success", text: res.data.message });
    router.refresh();
    return true;
  };

  // local form state
  const [rejectReason, setRejectReason] = useState("");
  const [counterStart, setCounterStart] = useState(booking.start);
  const [counterEnd, setCounterEnd] = useState(booking.end);
  const [counterNote, setCounterNote] = useState("");
  const [initialCondition, setInitialCondition] = useState("excellent");
  const [readyChecklist, setReadyChecklist] = useState<string[]>([]);
  const [readyPhotos, setReadyPhotos] = useState<string[]>([]);
  const [readyNote, setReadyNote] = useState("");
  const [buyerPhotos, setBuyerPhotos] = useState<string[]>([]);
  const [buyerNote, setBuyerNote] = useState("");
  const [accepted, setAccepted] = useState(true);
  const [returnPhotos, setReturnPhotos] = useState<string[]>([]);
  const [returnNote, setReturnNote] = useState("");
  const [returnCondition, setReturnCondition] = useState("excellent");
  const [inspectAccept, setInspectAccept] = useState(true);
  const [inspectPhotos, setInspectPhotos] = useState<string[]>([]);
  const [inspectNote, setInspectNote] = useState("");
  const [inspectConditions, setInspectConditions] = useState<string[]>([]);
  const [extensionEnd, setExtensionEnd] = useState(addDays(booking.end, 2));
  const [extensionNote, setExtensionNote] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewBody, setReviewBody] = useState("");
  const [reviewAccuracy, setReviewAccuracy] = useState(5);

  const pendingExtension = extensions.find((e) => e.status === "pending");
  const can = {
    approve: role === "provider" && ["pending", "counteroffered"].includes(booking.status),
    reject: role === "provider" && ["pending", "counteroffered"].includes(booking.status),
    counter: role === "provider" && booking.status === "pending",
    respondCounter: role === "buyer" && booking.status === "counteroffered",
    pay: (role === "buyer" || role === "admin") && ["approved", "awaiting_payment"].includes(booking.status),
    providerReady: role === "provider" && ["paid", "approved"].includes(booking.status),
    buyerConfirm: role === "buyer" && booking.status === "ready_for_handover",
    requestReturn: role === "buyer" && booking.status === "active",
    confirmReturn: role === "provider" && booking.status === "return_requested",
    extension: role === "buyer" && booking.status === "active" && !pendingExtension,
    decideExtension: role === "provider" && Boolean(pendingExtension) && booking.status === "active",
    cancel: (role === "buyer" && ["pending", "approved", "awaiting_payment", "counteroffered", "paid", "ready_for_handover"].includes(booking.status))
      || (role === "provider" && ["pending", "approved", "awaiting_payment", "paid", "ready_for_handover", "active"].includes(booking.status)),
    review: role === "buyer" && booking.status === "completed" && !hasReview,
    dispute: ["buyer", "provider"].includes(role) && ["active", "return_requested", "completed", "disputed", "paid", "ready_for_handover"].includes(booking.status) && !hasDispute,
  };
  const anyAction = Object.values(can).some(Boolean);

  return (
    <div className="space-y-4">
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

      {/* provider decisions */}
      {(can.approve || can.reject || can.counter) && (
        <Card className="border-electric/25 p-4">
          <h2 className="text-[14px] font-semibold text-ink">Decide on this request</h2>
          <p className="mt-1 text-[12px] text-ink-dim">
            Requested {booking.start} → {booking.end} · {booking.days} day(s) · {money(booking.subtotal)} rental ·{" "}
            {money(booking.deposit)} deposit. Approving re-checks availability to prevent double bookings.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {can.approve && <Button variant="success" loading={busy === "approve"} onClick={() => act({ action: "approve" }, "approve")}>Approve request</Button>}
          </div>

          {can.counter && (
            <details className="mt-3 rounded-lg border border-white/10 bg-white/3 p-3">
              <summary className="cursor-pointer text-[12.5px] text-ink-dim">Suggest different dates (counteroffer)</summary>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <Field label="New start" htmlFor="cs"><Input id="cs" type="date" value={counterStart} onChange={(e) => setCounterStart(e.target.value)} /></Field>
                <Field label="New end" htmlFor="ce"><Input id="ce" type="date" value={counterEnd} onChange={(e) => setCounterEnd(e.target.value)} /></Field>
              </div>
              <Field label="Note to the buyer" htmlFor="cn"><Textarea id="cn" rows={2} value={counterNote} onChange={(e) => setCounterNote(e.target.value)} placeholder="Why these dates work better…" /></Field>
              <Button variant="outline" loading={busy === "counter"} onClick={() => act({ action: "counter", start: counterStart, end: counterEnd, note: counterNote }, "counter")}>
                Send counteroffer
              </Button>
            </details>
          )}

          {can.reject && (
            <details className="mt-2 rounded-lg border border-white/10 bg-white/3 p-3">
              <summary className="cursor-pointer text-[12.5px] text-ink-dim">Reject with a reason</summary>
              <Field label="Reason (shown to the buyer)" htmlFor="rr" hint="Required — a rejection without a reason is not allowed.">
                <Textarea id="rr" rows={2} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="e.g. The kit is booked for a scheduled practical that week." />
              </Field>
              <Button variant="danger" loading={busy === "reject"} onClick={() => act({ action: "reject", reason: rejectReason }, "reject")}>Reject request</Button>
            </details>
          )}
        </Card>
      )}

      {can.respondCounter && (
        <Card className="border-amber-400/30 p-4">
          <h2 className="text-[14px] font-semibold text-ink">Respond to the counteroffer</h2>
          <p className="mt-1 text-[12.5px] text-ink-dim">
            The provider proposed <strong className="text-amber-200">{booking.counterStart} → {booking.counterEnd}</strong>. Accepting re-prices the booking and re-checks availability before anything is charged.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="success" loading={busy === "accept-counter"} onClick={() => act({ action: "counter_accept" }, "accept-counter")}>Accept new dates</Button>
            <Button variant="danger" loading={busy === "decline-counter"} onClick={() => act({ action: "counter_decline" }, "decline-counter")}>Decline</Button>
          </div>
        </Card>
      )}

      {/* payment */}
      {can.pay && (
        <Card className="border-electric/30 p-4">
          <h2 className="text-[14px] font-semibold text-ink">Complete payment</h2>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-dim">
            The provider approved your request. Pay the rental amount plus the refundable deposit to confirm. The payment
            page shows the gateway mode before you confirm.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Link href={`/bookings/${booking.id}/payment`} className="rounded-lg bg-gradient-to-b from-electric to-electric-deep px-3.5 py-2 text-[13px] font-semibold text-navy-950">
              Go to payment · {money(booking.total)}
            </Link>
            <Badge tone="warn">Not paid yet</Badge>
          </div>
        </Card>
      )}

      {/* provider: record initial condition */}
      {can.providerReady && (
        <Card className="border-emerald-400/25 p-4">
          <h2 className="text-[14px] font-semibold text-ink">Record initial condition before collection</h2>
          <p className="mt-1 text-[12px] text-ink-dim">
            Upload at least one photo and complete the checklist. This becomes the baseline for any later damage claim.
          </p>
          <div className="mt-3">
            <Field label="Condition" htmlFor="ic">
              <Select id="ic" value={initialCondition} onChange={(e) => setInitialCondition(e.target.value)}>
                {conditions.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </Select>
            </Field>
            <CheckboxList items={checklistItems} selected={readyChecklist} onChange={setReadyChecklist} label="Inspection checklist" />
            <Uploader value={readyPhotos} onChange={setReadyPhotos} label="Initial condition photos" max={4} hint="JPEG/PNG/WebP up to 5 MB. Stored privately and linked to this booking." />
            <Field label="Note to the buyer" htmlFor="rn"><Textarea id="rn" rows={2} value={readyNote} onChange={(e) => setReadyNote(e.target.value)} placeholder="Anything the buyer should know at collection…" /></Field>
            <Button
              loading={busy === "ready"}
              onClick={() => act({ action: "provider_ready", initial_condition: initialCondition, checklist: readyChecklist, photos: readyPhotos, note: readyNote }, "ready")}
            >
              Save condition &amp; mark ready for collection
            </Button>
          </div>
        </Card>
      )}

      {/* buyer: confirm collection */}
      {can.buyerConfirm && handover && (
        <Card className="border-emerald-400/25 p-4">
          <h2 className="text-[14px] font-semibold text-ink">Confirm collection</h2>
          <div className="mt-2 rounded-lg border border-white/10 bg-white/3 p-3">
            <p className="text-[11px] uppercase tracking-wider text-ink-faint">Provider recorded at handover</p>
            <p className="mt-1 text-[12.5px] text-ink">Condition: <strong className="capitalize">{handover.initial_condition}</strong></p>
            <ul className="mt-1 space-y-0.5 text-[11.5px] text-ink-dim">
              {handover.checklist.map((c) => <li key={c}>✓ {c}</li>)}
            </ul>
            {handover.provider_photos.length > 0 && (
              <div className="mt-2 flex gap-1.5">
                {handover.provider_photos.map((p) => (
                  <a key={p} href={p} target="_blank" rel="noopener noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p} alt="Initial condition" className="h-16 w-20 rounded object-cover" />
                  </a>
                ))}
              </div>
            )}
          </div>
          <div className="mt-3">
            <Toggle checked={accepted} onChange={setAccepted} label="The equipment matches the recorded condition" hint="Untick if something is wrong — the rental won't start until it's resolved." />
            <Uploader value={buyerPhotos} onChange={setBuyerPhotos} label="Your own collection photos (optional)" max={3} />
            <Field label="Note" htmlFor="bn"><Textarea id="bn" rows={2} value={buyerNote} onChange={(e) => setBuyerNote(e.target.value)} placeholder="e.g. One small scuff already present on the base." /></Field>
            <Button
              loading={busy === "confirm"}
              onClick={() => act({ action: "buyer_confirm", accepted, note: buyerNote, photos: buyerPhotos }, "confirm")}
            >
              {accepted ? "Confirm collection — start rental" : "Report a problem at collection"}
            </Button>
          </div>
        </Card>
      )}

      {/* buyer: return */}
      {can.requestReturn && (
        <Card className="border-electric/25 p-4">
          <h2 className="text-[14px] font-semibold text-ink">Submit return</h2>
          <p className="mt-1 text-[12px] text-ink-dim">
            {booking.overdue
              ? "This rental is overdue. Submit the return photos as soon as possible — the provider may raise a late-return report."
              : booking.daysLeft <= 1
                ? "Due today or tomorrow. Upload return photos to start the inspection."
                : `Due back on ${booking.end}. You can submit the return early.`}
          </p>
          <div className="mt-3">
            <Field label="Condition on return" htmlFor="rc">
              <Select id="rc" value={returnCondition} onChange={(e) => setReturnCondition(e.target.value)}>
                {conditions.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </Select>
            </Field>
            <Uploader value={returnPhotos} onChange={setReturnPhotos} label="Return photos" max={4} hint="Required — at least one photo." />
            <Field label="Note" htmlFor="rnote"><Textarea id="rnote" rows={2} value={returnNote} onChange={(e) => setReturnNote(e.target.value)} placeholder="Anything the provider should check…" /></Field>
            <Button loading={busy === "return"} onClick={() => act({ action: "request_return", photos: returnPhotos, note: returnNote, condition: returnCondition }, "return")}>
              Submit return
            </Button>
          </div>
        </Card>
      )}

      {/* provider: inspect return */}
      {can.confirmReturn && returnRecord && (
        <Card className="border-emerald-400/25 p-4">
          <h2 className="text-[14px] font-semibold text-ink">Inspect &amp; confirm return</h2>
          <div className="mt-2 rounded-lg border border-white/10 bg-white/3 p-3">
            <p className="text-[11px] uppercase tracking-wider text-ink-faint">Buyer submission</p>
            <p className="mt-1 text-[12.5px] text-ink">Buyer-stated condition: <strong className="capitalize">{returnCondition}</strong></p>
            {returnRecord.buyer_note && <p className="text-[11.5px] text-ink-dim">{returnRecord.buyer_note}</p>}
            <div className="mt-2 flex gap-1.5">
              {returnRecord.buyer_photos.map((p) => (
                <a key={p} href={p} target="_blank" rel="noopener noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p} alt="Return evidence from buyer" className="h-16 w-20 rounded object-cover" />
                </a>
              ))}
            </div>
          </div>
          <div className="mt-3">
            <Toggle checked={inspectAccept} onChange={setInspectAccept} label="Everything is returned in acceptable condition" hint="If untrue, an issue is recorded and a dispute opens for admin review — the deposit is never deducted automatically." />
            <Field label="Inspected condition" htmlFor="ic2">
              <Select id="ic2" value={returnCondition} onChange={(e) => setReturnCondition(e.target.value)}>
                {conditions.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </Select>
            </Field>
            <CheckboxList items={checklistItems} selected={inspectConditions} onChange={setInspectConditions} label="Return checklist" />
            <Uploader value={inspectPhotos} onChange={setInspectPhotos} label="Your inspection photos" max={4} hint="Required — at least one photo." />
            <Field label="Inspection note" htmlFor="inote"><Textarea id="inote" rows={2} value={inspectNote} onChange={(e) => setInspectNote(e.target.value)} placeholder="Findings, including any new damage…" /></Field>
            <Button
              loading={busy === "inspect"}
              onClick={() => act({ action: "confirm_return", accept: inspectAccept, condition: returnCondition, checklist: inspectConditions, photos: inspectPhotos, note: inspectNote }, "inspect")}
            >
              {inspectAccept ? "Confirm return — complete booking" : "Record condition issue"}
            </Button>
          </div>
        </Card>
      )}

      {/* extensions */}
      {can.extension && (
        <Card className="p-4">
          <h2 className="text-[14px] font-semibold text-ink">Request an extension</h2>
          <p className="mt-1 text-[12px] text-ink-dim">The provider must approve. We check availability for the extra days before sending.</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <Field label="New return date" htmlFor="ex"><Input id="ex" type="date" min={addDays(booking.end, 1)} value={extensionEnd} onChange={(e) => setExtensionEnd(e.target.value)} /></Field>
            <Field label="Reason" htmlFor="exn"><Input id="exn" value={extensionNote} onChange={(e) => setExtensionNote(e.target.value)} placeholder="Why you need more time" /></Field>
          </div>
          <Button variant="outline" loading={busy === "extension"} onClick={() => act({ action: "request_extension", end: extensionEnd, note: extensionNote }, "extension")}>
            Send extension request
          </Button>
        </Card>
      )}

      {can.decideExtension && pendingExtension && (
        <Card className="border-amber-400/25 p-4">
          <h2 className="text-[14px] font-semibold text-ink">Extension request</h2>
          <p className="mt-1 text-[12.5px] text-ink-dim">
            Requested new end date <strong className="text-ink">{pendingExtension.requested_end}</strong> (+{pendingExtension.extra_days} days, {money(pendingExtension.extra_cost)} extra).
            {pendingExtension.note && ` Buyer note: ${pendingExtension.note}`}
          </p>
          <div className="mt-2 flex gap-2">
            <Button variant="success" loading={busy === "ext-yes"} onClick={() => act({ action: "decide_extension", extensionId: pendingExtension.id, approve: true }, "ext-yes")}>Approve</Button>
            <Button variant="danger" loading={busy === "ext-no"} onClick={() => act({ action: "decide_extension", extensionId: pendingExtension.id, approve: false, note: "Not possible for these dates." }, "ext-no")}>Decline</Button>
          </div>
        </Card>
      )}

      {/* review */}
      {can.review && (
        <Card className="p-4">
          <h2 className="text-[14px] font-semibold text-ink">Leave a review</h2>
          <p className="mt-1 text-[12px] text-ink-dim">Only buyers with a completed booking can review. This is public on the listing.</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <Field label="Overall rating" htmlFor="rr2">
              <Select id="rr2" value={reviewRating} onChange={(e) => setReviewRating(Number(e.target.value))}>
                {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} star{n > 1 ? "s" : ""}</option>)}
              </Select>
            </Field>
            <Field label="Did the condition match the listing?" htmlFor="ra">
              <Select id="ra" value={reviewAccuracy} onChange={(e) => setReviewAccuracy(Number(e.target.value))}>
                {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} / 5</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Your experience" htmlFor="rb"><Textarea id="rb" rows={3} value={reviewBody} onChange={(e) => setReviewBody(e.target.value)} placeholder="Was the handover smooth? Was the equipment as described?" /></Field>
          <Button
            loading={busy === "review"}
            onClick={async () => {
              setBusy("review");
              const res = await api("/api/reviews", { body: { bookingId: booking.id, rating: reviewRating, body: reviewBody, condition_accuracy: reviewAccuracy } });
              setBusy(null);
              setMsg(res.ok ? { kind: "success", text: "Review published." } : { kind: "error", text: res.error });
              router.refresh();
            }}
          >
            Publish review
          </Button>
        </Card>
      )}

      {/* dispute */}
      {can.dispute && (
        <Card className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-[14px] font-semibold text-ink">Report damage, missing items or a problem</h2>
              <p className="mt-1 text-[12px] text-ink-dim">Evidence is required. A dispute freezes the deposit for admin review — nothing is deducted automatically.</p>
            </div>
            <Link href={`/disputes/new?bookingId=${booking.id}`} className="rounded-lg border border-rose-400/35 bg-rose-400/10 px-3 py-1.5 text-[12.5px] text-rose-200">
              Open a dispute
            </Link>
          </div>
        </Card>
      )}

      {/* cancel */}
      {can.cancel && (
        <Card className="p-4">
          <details>
            <summary className="cursor-pointer text-[13px] text-ink-dim">
              {role === "provider" ? "Cancel this booking (provider)" : "Cancel my booking"}
            </summary>
            <p className="mt-2 text-[11.5px] leading-relaxed text-ink-faint">
              {role === "buyer"
                ? "Free cancellation up to 48 hours before the start date. Inside 48 hours the provider's policy applies and any deduction needs review."
                : "Cancelling refunds the recorded deposit to the buyer and frees the dates for the waiting list."}
            </p>
            <Field label="Reason" htmlFor="cr"><Textarea id="cr" rows={2} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} /></Field>
            <Button
              variant="danger"
              loading={busy === "cancel"}
              onClick={() => act({ action: role === "provider" ? "provider_cancel" : "buyer_cancel", reason: cancelReason }, "cancel")}
            >
              Cancel booking
            </Button>
          </details>
        </Card>
      )}

      {!anyAction && !hasDispute && (
        <InfoNote tone="info">
          No actions are available to you in this state. {booking.status === "completed" ? "This booking is complete — its condition records stay in the equipment passport." : "The other party may need to act next."}
        </InfoNote>
      )}

      <Card className="p-4">
        <h2 className="text-[13.5px] font-semibold text-ink">Requirements &amp; policies</h2>
        <ul className="mt-1.5 space-y-1 text-[12px] text-ink-dim">
          <li>Training: {resource.trainingRequired ? "required before first use" : "not required"}</li>
          <li>Supervision: {resource.supervisionRequired ? "provider supervision on site" : "not required"}</li>
          <li>Usage rules: {resource.usageRules || "—"}</li>
          <li>Cancellation: {resource.cancellationPolicy || "provider default"}</li>
          <li>Contact: {counterparty.name}{counterparty.email ? ` · ${counterparty.email}` : ""}</li>
        </ul>
      </Card>
    </div>
  );
}
