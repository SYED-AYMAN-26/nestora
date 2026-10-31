"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, money } from "@/lib/client";
import { Alert, Button } from "@/components/form";
import { Card } from "@/components/ui";

type RazorpayOrder = { id: string; amount: number; currency: string };

/** What Razorpay's checkout handler hands back to us. */
type RazorpayHandlerResponse = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};

/** Minimal shape of the Razorpay checkout global we actually use. */
type RazorpayCheckout = new (options: {
  key: string | null;
  order_id: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  theme?: { color?: string };
  handler: (response: RazorpayHandlerResponse) => void | Promise<void>;
  modal?: { ondismiss?: () => void };
}) => { open: () => void };

declare global {
  interface Window { Razorpay?: RazorpayCheckout }
}

export function PaymentClient({
  bookingId, amount, payable, mode, razorpayKeyId,
}: {
  bookingId: number; amount: number; payable: boolean; mode: "razorpay_test" | "demo"; razorpayKeyId: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "success" | "info"; text: string } | null>(null);
  const [step, setStep] = useState<"idle" | "order">("idle");

  const confirmDemo = async () => {
    setBusy(true);
    setMsg(null);
    const res = await api<{ message: string }>("/api/payments", { body: { action: "confirm", bookingId } });
    setBusy(false);
    if (!res.ok) { setMsg({ kind: "error", text: res.error }); return; }
    setMsg({ kind: "success", text: res.data.message });
    router.refresh();
    setTimeout(() => router.push(`/bookings/${bookingId}`), 900);
  };

  const startRazorpay = async () => {
    setBusy(true);
    setMsg(null);
    const created = await api<{ order: RazorpayOrder; keyId: string }>("/api/payments", { body: { action: "create", bookingId } });
    if (!created.ok) { setBusy(false); setMsg({ kind: "error", text: created.error }); return; }
    setStep("order");

    const loadSdk = () =>
      new Promise<boolean>((resolve) => {
        if (window.Razorpay) return resolve(true);
        const s = document.createElement("script");
        s.src = "https://checkout.razorpay.com/v1/checkout.js";
        s.onload = () => resolve(true);
        s.onerror = () => resolve(false);
        document.body.appendChild(s);
      });

    const okSdk = await loadSdk();
    if (!okSdk) {
      setBusy(false);
      setMsg({ kind: "error", text: "Could not load the Razorpay checkout script (network blocked). The test order exists but no payment was taken." });
      return;
    }

    const Checkout = window.Razorpay;
    if (!Checkout) {
      setBusy(false);
      setMsg({ kind: "error", text: "Razorpay checkout is unavailable in this browser." });
      return;
    }

    const rzp = new Checkout({
      key: created.data.keyId || razorpayKeyId,
      order_id: created.data.order.id,
      amount: created.data.order.amount,
      currency: created.data.order.currency,
      name: "Nestora",
      description: "Booking payment (TEST MODE)",
      theme: { color: "#38bdf8" },
      handler: async (response: RazorpayHandlerResponse) => {
        const confirmed = await api<{ message: string }>("/api/payments", {
          body: {
            action: "confirm",
            bookingId,
            razorpay_order_id: response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature: response.razorpay_signature,
          },
        });
        setBusy(false);
        if (!confirmed.ok) { setMsg({ kind: "error", text: confirmed.error }); return; }
        setMsg({ kind: "success", text: confirmed.data.message });
        router.refresh();
        setTimeout(() => router.push(`/bookings/${bookingId}`), 900);
      },
      modal: {
        ondismiss: () => {
          setBusy(false);
          setMsg({ kind: "info", text: "Checkout closed. Nothing was charged — the order stays unpaid." });
        },
      },
    });
    rzp.open();
  };

  if (!payable) {
    return (
      <Card className="p-5">
        <p className="text-[13px] text-ink-dim">
          Payment isn&apos;t available in this booking state. If you believe this is wrong, check the booking page or message the provider.
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-5">
      {msg && <Alert kind={msg.kind === "success" ? "success" : msg.kind === "info" ? "info" : "error"}>{msg.text}</Alert>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-wider text-ink-faint">Amount due</p>
          <p className="text-2xl font-semibold text-ink">{money(amount)}</p>
          <p className="mt-0.5 text-[11px] text-ink-faint">
            {mode === "demo" ? "Demo mode — simulated payment, no funds move" : "Razorpay test mode — test cards only"}
          </p>
        </div>
        <Button loading={busy} onClick={mode === "demo" ? confirmDemo : startRazorpay}>
          {mode === "demo" ? "Confirm demo payment" : "Pay with Razorpay (test)"}
        </Button>
      </div>
      {step === "order" && <p className="mt-2 text-[11px] text-ink-faint">Opening Razorpay…</p>}
      <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
        We never store card details. In Razorpay mode the payment is only marked successful after the server verifies the
        HMAC signature returned by the gateway, or a signed webhook is received.
      </p>
    </Card>
  );
}
