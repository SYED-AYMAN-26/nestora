"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, money, todayStr, addDays } from "@/lib/client";
import { Alert, Button, Field, Input, Select, Textarea } from "@/components/form";

type ResourceLite = {
  id: number; title: string; priceHourly: number; priceDaily: number; priceWeekly: number; deposit: number;
  minDays: number; maxDays: number; capacity: number; status: string; approvalMode: string;
  eligibility: string | null; storefrontSlug: string; providerName: string;
};

type CalendarDay = { date: string; capacity: number; booked: number; available: number; blocked: boolean };
type Quote = { days: number; units: number; basis: string; rateLabel: string; subtotal: number; fees: number; deposit: number; total: number; rentalDue: number };
type AvailResp = {
  capacity: number; calendar: CalendarDay[];
  check: { ok: boolean; reason?: string; minUnitsAvailable: number } | null;
};

export function BookingPanel({ resource, authed, isOwner, isAdmin }: { resource: ResourceLite; authed: boolean; isOwner: boolean; isAdmin: boolean }) {
  const router = useRouter();
  const today = todayStr();
  const [start, setStart] = useState(addDays(today, 1));
  const [end, setEnd] = useState(addDays(today, 2));
  const [units, setUnits] = useState(1);
  const [basis, setBasis] = useState<"hourly" | "daily" | "weekly">("daily");
  const [purpose, setPurpose] = useState("");
  const [data, setData] = useState<AvailResp | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "success" | "info"; text: string; canWait?: boolean } | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      setLoading(true);
      const qs = new URLSearchParams({ start, end, units: String(units), basis, months: "2" });
      const res = await api<AvailResp & { quote: Quote | null }>(`/api/resources/${resource.id}/availability?${qs}`);
      if (!alive) return;
      setLoading(false);
      if (res.ok) {
        setData(res.data);
        setQuote(res.data.quote ?? null);
      }
    };
    const t = setTimeout(() => void load(), 220);
    return () => { alive = false; clearTimeout(t); };
  }, [resource.id, start, end, units, basis]);

  const blockedHint = useMemo(() => {
    if (!data?.calendar) return "";
    const blocked = data.calendar.filter((d) => d.blocked).slice(0, 3).map((d) => d.date);
    return blocked.length ? `Blocked near your dates: ${blocked.join(", ")}` : "";
  }, [data]);

  const book = async (joinWaitingList = false) => {
    if (!authed) { router.push(`/login?next=/resources/${resource.id}`); return; }
    setBusy(true);
    setMsg(null);
    const res = await api<{ bookingId: number; code: string; message: string; priority: { score: number; reason: string } }>("/api/bookings", {
      body: { resourceId: resource.id, start, end, units, basis, purpose },
    });
    setBusy(false);
    if (!res.ok) {
      const canWait = Boolean(res.data?.canJoinWaitingList);
      setMsg({ kind: "error", text: res.error, canWait });
      if (canWait && joinWaitingList) {
        const w = await api<{ message: string }>("/api/waiting-list", { body: { action: "join", resourceId: resource.id, start, end, units } });
        setMsg({ kind: w.ok ? "success" : "error", text: w.ok ? w.data.message : w.error });
      }
      return;
    }
    router.push(`/bookings/${res.data.bookingId}`);
  };

  const disabled = isOwner || isAdmin || resource.status !== "active";

  return (
    <div className="glass rounded-2xl p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <div>
          <p className="text-2xl font-semibold text-ink">{money(resource.priceDaily || resource.priceHourly * 8)}</p>
          <p className="text-[11px] text-ink-faint">per {resource.priceDaily ? "day" : "8 hours"} · {resource.capacity} shareable unit(s)</p>
        </div>
        <span className="rounded-md border border-white/12 px-2 py-1 text-[10.5px] text-ink-dim">
          {resource.approvalMode === "auto" ? "Instant approval" : "Provider approval"}
        </span>
      </div>

      {msg && <Alert kind={msg.kind === "success" ? "success" : msg.kind === "info" ? "info" : "error"}>{msg.text}</Alert>}

      {disabled ? (
        <div className="rounded-xl border border-white/10 bg-white/3 p-3 text-[12.5px] leading-relaxed text-ink-dim">
          {isOwner
            ? "This is your own listing — you can't book it. Manage it from the provider console."
            : isAdmin
              ? "Admins review the platform rather than book resources."
              : `This listing is currently "${resource.status}" and is not accepting bookings.`}
          {isOwner && (
            <Link href={`/provider/resources/${resource.id}`} className="mt-2 block text-electric hover:underline">
              Manage listing →
            </Link>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Start date" htmlFor="start">
              <Input id="start" type="date" min={today} value={start} onChange={(e) => { setStart(e.target.value); if (e.target.value > end) setEnd(e.target.value); }} />
            </Field>
            <Field label="End date" htmlFor="end">
              <Input id="end" type="date" min={start} value={end} onChange={(e) => setEnd(e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Units" htmlFor="units">
              <Select id="units" value={units} onChange={(e) => setUnits(Number(e.target.value))}>
                {Array.from({ length: Math.max(1, Math.min(10, resource.capacity || 1)) }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </Select>
            </Field>
            <Field label="Rate basis" htmlFor="basis">
              <Select id="basis" value={basis} onChange={(e) => setBasis(e.target.value as "hourly" | "daily" | "weekly")}>
                <option value="daily">Daily</option>
                <option value="hourly">Hourly (8h/day)</option>
                {resource.priceWeekly > 0 && <option value="weekly">Weekly</option>}
              </Select>
            </Field>
          </div>

          <Field label="Purpose (helps priority decisions)" htmlFor="purpose" hint="e.g. college project, community workshop, client shoot">
            <Textarea id="purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} rows={2} maxLength={500} placeholder="What will you use it for?" />
          </Field>

          {data?.check && !data.check.ok && (
            <Alert kind="warn">
              Not available for these dates: {data.check.reason}
              {blockedHint && <> {blockedHint}</>}
            </Alert>
          )}

          {quote && (
            <dl className="mb-3 space-y-1 rounded-xl border border-white/10 bg-white/3 p-3 text-[12.5px]">
              <div className="flex justify-between"><dt className="text-ink-dim">{quote.rateLabel}</dt><dd className="text-ink">{money(quote.subtotal)}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-dim">Platform fee (2%)</dt><dd className="text-ink">{money(quote.fees)}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-dim">Refundable deposit</dt><dd className="text-ink">{money(quote.deposit)}</dd></div>
              <div className="mt-1 flex justify-between border-t border-white/10 pt-1.5 font-semibold"><dt>Total</dt><dd className="text-electric">{money(quote.total)}</dd></div>
              <p className="pt-1 text-[10.5px] leading-snug text-ink-faint">
                {quote.days} day(s) × {quote.units} unit(s). Payment is requested only after the provider approves.
              </p>
            </dl>
          )}

          <Button
            onClick={() => book(false)}
            loading={busy || loading}
            disabled={Boolean(data?.check && !data.check.ok)}
            className="w-full"
          >
            {authed ? "Request booking" : "Sign in to book"}
          </Button>

          {data?.check && !data.check.ok && (
            <Button variant="outline" className="mt-2 w-full" onClick={() => book(true)}>
              Join the waiting list instead
            </Button>
          )}

          <p className="mt-2.5 text-[10.5px] leading-relaxed text-ink-faint">
            Requests are subject to the provider&apos;s approval and a transparent priority score based on stated purpose,
            eligibility and fair rotation. You&apos;ll see the score on your booking page.
          </p>
        </>
      )}

      {data?.calendar && (
        <div className="mt-3 border-t border-white/8 pt-3">
          <p className="mb-1.5 text-[11px] uppercase tracking-wider text-ink-faint">Next 6 weeks (availability computed from bookings)</p>
          <div className="flex flex-wrap gap-1">
            {data.calendar.slice(0, 42).map((d) => {
              const selected = d.date >= start && d.date <= end;
              const tone = d.blocked ? "border-rose-400/40 bg-rose-400/15" : d.available <= 0 ? "border-amber-400/40 bg-amber-400/15" : "border-emerald-400/30 bg-emerald-400/10";
              return (
                <span
                  key={d.date}
                  title={`${d.date}: ${d.blocked ? "blocked" : `${d.available}/${d.capacity} free`}`}
                  className={`h-4 w-6 rounded-[3px] border text-center text-[8px] leading-4 ${tone} ${selected ? "ring-1 ring-electric" : ""}`}
                >
                  {d.date.slice(8)}
                </span>
              );
            })}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-3 text-[10px] text-ink-faint">
            <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-emerald-400/60" />free</span>
            <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-amber-400/60" />fully booked</span>
            <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-rose-400/60" />blocked / maintenance</span>
          </div>
        </div>
      )}
    </div>
  );
}
