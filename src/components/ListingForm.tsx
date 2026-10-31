"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, addDays, todayStr } from "@/lib/client";
import { Alert, Button, ChipSelect, Field, Input, Select, Textarea, Toggle, Uploader } from "@/components/form";
import { CAPABILITIES, CATEGORIES, CONDITIONS } from "@/lib/constants";

export type ListingDraft = {
  id?: number;
  title: string; category: string; subcategory: string | null; description: string;
  brand: string | null; model: string | null; condition: string;
  quantity_total: number; quantity_active: number; internal_usage_hours_month: number;
  location_city: string; location_state: string;
  price_hourly: number; price_daily: number; price_weekly: number; deposit: number;
  eligibility: string | null; training_required: number | boolean; supervision_required: number | boolean;
  usage_rules: string | null; cancellation_policy: string | null;
  min_hours: number; max_days: number; status: string; model_3d: string | null;
  capabilities: string[]; best_for: string | null; approval_mode: string;
  booking_limit_days: number; images: string[]; blocked_dates: string[];
};

const MODEL_KEYS = ["camera", "laptop", "projector", "robotics", "microphone", "printer", "chip", "drill", "drone", "flask", "room", "van"];

export function ListingForm({ initial, mode }: { initial: ListingDraft; mode: "create" | "edit" }) {
  const router = useRouter();
  const [f, setF] = useState<ListingDraft>(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [newBlock, setNewBlock] = useState(addDays(todayStr(), 7));
  const [maint, setMaint] = useState<{ start_date: string; end_date: string | null; kind: "service" | "repair" | "inspection"; notes: string }[]>([]);

  const set = <K extends keyof ListingDraft>(k: K, v: ListingDraft[K]) => setF((p) => ({ ...p, [k]: v }));

  const submit = async () => {
    setMsg(null);
    if (f.title.trim().length < 4) { setMsg({ kind: "error", text: "Title must be at least 4 characters." }); return; }
    if (f.description.trim().length < 20) { setMsg({ kind: "error", text: "Description must be at least 20 characters." }); return; }
    if (!f.price_daily && !f.price_hourly && !f.price_weekly) { setMsg({ kind: "error", text: "Set at least one price." }); return; }
    if (f.quantity_active > f.quantity_total) { setMsg({ kind: "error", text: "Units in internal use cannot exceed the total." }); return; }

    const payload = {
      ...f,
      training_required: Boolean(f.training_required),
      supervision_required: Boolean(f.supervision_required),
      maintenance: maint,
    };
    setBusy(true);
    const res = mode === "create"
      ? await api<{ resourceId: number; message: string }>("/api/resources/create", { body: payload })
      : await api<{ resourceId: number }>(`/api/resources/${f.id}`, { method: "PATCH", body: payload });
    setBusy(false);
    if (!res.ok) { setMsg({ kind: "error", text: res.error }); return; }
    setMsg({ kind: "success", text: mode === "create" ? "Listing created." : "Listing updated." });
    router.push("/provider/resources");
    router.refresh();
  };

  const subcats = CATEGORIES.find((c) => c.slug === f.category)?.subcategories ?? [];
  const section = "mb-5 rounded-xl border border-white/8 bg-white/2 p-4";
  const legend = "mb-3 text-[12px] font-semibold uppercase tracking-wider text-electric";

  return (
    <div>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

      <section className={section}>
        <p className={legend}>1 · Identity</p>
        <Field label="Resource name" required htmlFor="title">
          <Input id="title" value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="Canon EOS 90D DSLR Camera (body + lens)" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Category" required htmlFor="category">
            <Select id="category" value={f.category} onChange={(e) => { set("category", e.target.value); set("subcategory", ""); }}>
              {CATEGORIES.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Subcategory" htmlFor="subcategory">
            <Select id="subcategory" value={f.subcategory ?? ""} onChange={(e) => set("subcategory", e.target.value)}>
              <option value="">—</option>
              {subcats.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </Field>
          <Field label="Condition" htmlFor="condition">
            <Select id="condition" value={f.condition} onChange={(e) => set("condition", e.target.value)}>
              {CONDITIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </Select>
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Brand" htmlFor="brand"><Input id="brand" value={f.brand ?? ""} onChange={(e) => set("brand", e.target.value)} /></Field>
          <Field label="Model" htmlFor="model"><Input id="model" value={f.model ?? ""} onChange={(e) => set("model", e.target.value)} /></Field>
        </div>
        <Field label="Description" required htmlFor="description" hint="Mention what's included, its state, and anything a buyer must know. Minimum 20 characters.">
          <Textarea id="description" rows={5} value={f.description} onChange={(e) => set("description", e.target.value)} />
        </Field>
        <Uploader value={f.images} onChange={(v) => set("images", v)} label="Photos" max={6} hint="Real photos of the actual item build trust. JPEG/PNG/WebP up to 5 MB." />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="3D model (optional)" htmlFor="model_3d" hint="Adds an interactive procedural 3D viewer to your listing.">
            <Select id="model_3d" value={f.model_3d ?? ""} onChange={(e) => set("model_3d", e.target.value || null)}>
              <option value="">No 3D model (photo only)</option>
              {MODEL_KEYS.map((m) => <option key={m} value={m}>{m}</option>)}
            </Select>
          </Field>
          <Field label="Best for" htmlFor="best_for"><Input id="best_for" value={f.best_for ?? ""} onChange={(e) => set("best_for", e.target.value)} placeholder="Events, student films, product shots" /></Field>
        </div>
      </section>

      <section className={section}>
        <p className={legend}>2 · Capabilities (this drives recommendation matching)</p>
        <ChipSelect
          options={Object.entries(CAPABILITIES).map(([value, v]) => ({ value, label: v.label }))}
          selected={f.capabilities}
          onChange={(v) => set("capabilities", v)}
        />
        <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
          Pick what the item can actually do — buyers search by need (&ldquo;I need to record a short film&rdquo;), and the
          matcher uses these tags rather than exact product names.
        </p>
      </section>

      <section className={section}>
        <p className={legend}>3 · Quantity &amp; utilisation inputs</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Total units owned" htmlFor="qt" hint="The full quantity you hold.">
            <Input id="qt" type="number" min={1} value={f.quantity_total} onChange={(e) => set("quantity_total", Number(e.target.value))} />
          </Field>
          <Field label="Units in internal use" htmlFor="qa" hint="Not available for sharing. Idle estimate = total − this.">
            <Input id="qa" type="number" min={0} value={f.quantity_active} onChange={(e) => set("quantity_active", Number(e.target.value))} />
          </Field>
          <Field label="Internal usage hours / month" htmlFor="iuh" hint="Your own records, used in utilisation insights.">
            <Input id="iuh" type="number" min={0} value={f.internal_usage_hours_month} onChange={(e) => set("internal_usage_hours_month", Number(e.target.value))} />
          </Field>
        </div>
        <p className="text-[11px] leading-relaxed text-ink-faint">
          Nestora calculates utilisation from actual bookings. The figures above let us show <em>estimated</em> idle capacity —
          which stays clearly labelled as an estimate until you confirm availability.
        </p>
      </section>

      <section className={section}>
        <p className={legend}>4 · Pricing</p>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Hourly (₹)" htmlFor="ph"><Input id="ph" type="number" min={0} value={f.price_hourly} onChange={(e) => set("price_hourly", Number(e.target.value))} /></Field>
          <Field label="Daily (₹)" htmlFor="pd"><Input id="pd" type="number" min={0} value={f.price_daily} onChange={(e) => set("price_daily", Number(e.target.value))} /></Field>
          <Field label="Weekly (₹)" htmlFor="pw"><Input id="pw" type="number" min={0} value={f.price_weekly} onChange={(e) => set("price_weekly", Number(e.target.value))} /></Field>
          <Field label="Deposit (₹)" htmlFor="dep"><Input id="dep" type="number" min={0} value={f.deposit} onChange={(e) => set("deposit", Number(e.target.value))} /></Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Minimum days" htmlFor="min"><Input id="min" type="number" min={1} value={f.min_hours} onChange={(e) => set("min_hours", Number(e.target.value))} /></Field>
          <Field label="Maximum days" htmlFor="max"><Input id="max" type="number" min={1} value={f.max_days} onChange={(e) => set("max_days", Number(e.target.value))} /></Field>
          <Field label="Fair-use cap (days per buyer)" htmlFor="bl" hint="Prevents one buyer reserving everything.">
            <Input id="bl" type="number" min={1} value={f.booking_limit_days} onChange={(e) => set("booking_limit_days", Number(e.target.value))} />
          </Field>
        </div>
        <Field label="Approval mode" htmlFor="am">
          <Select id="am" value={f.approval_mode} onChange={(e) => set("approval_mode", e.target.value)}>
            <option value="manual">Manual — I review every request</option>
            <option value="auto">Automatic — approve instantly if free and eligible</option>
          </Select>
        </Field>
      </section>

      <section className={section}>
        <p className={legend}>5 · Rules, eligibility &amp; policy</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="City" required htmlFor="city"><Input id="city" value={f.location_city} onChange={(e) => set("location_city", e.target.value)} /></Field>
          <Field label="State" htmlFor="state"><Input id="state" value={f.location_state} onChange={(e) => set("location_state", e.target.value)} /></Field>
        </div>
        <Field label="Eligibility requirements" htmlFor="elig" hint="Who may book. Enforced server-side, e.g. 'Institutional accounts with a named supervisor'.">
          <Textarea id="elig" rows={2} value={f.eligibility ?? ""} onChange={(e) => set("eligibility", e.target.value)} />
        </Field>
        <Toggle checked={Boolean(f.training_required)} onChange={(v) => set("training_required", v)} label="Training required before first use" />
        <Toggle checked={Boolean(f.supervision_required)} onChange={(v) => set("supervision_required", v)} label="Provider supervision required on site" />
        <Field label="Usage rules" htmlFor="rules"><Textarea id="rules" rows={2} value={f.usage_rules ?? ""} onChange={(e) => set("usage_rules", e.target.value)} /></Field>
        <Field label="Cancellation policy" htmlFor="cancel"><Textarea id="cancel" rows={2} value={f.cancellation_policy ?? ""} onChange={(e) => set("cancellation_policy", e.target.value)} /></Field>
      </section>

      <section className={section}>
        <p className={legend}>6 · Availability</p>
        <p className="mb-2 text-[11.5px] text-ink-faint">
          Calendar availability is derived from bookings. Add provider holds for dates you can&apos;t share, and maintenance
          windows for servicing.
        </p>
        <div className="mb-2 flex flex-wrap items-end gap-2">
          <Field label="Block a date" htmlFor="block"><Input id="block" type="date" value={newBlock} onChange={(e) => setNewBlock(e.target.value)} /></Field>
          <Button variant="outline" className="mb-4" onClick={() => { if (!f.blocked_dates.includes(newBlock)) set("blocked_dates", [...f.blocked_dates, newBlock]); }}>Add hold</Button>
        </div>
        {f.blocked_dates.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {f.blocked_dates.map((d) => (
              <span key={d} className="inline-flex items-center gap-1 rounded-md border border-rose-400/30 bg-rose-400/10 px-2 py-0.5 text-[11px] text-rose-200">
                {d}
                <button type="button" onClick={() => set("blocked_dates", f.blocked_dates.filter((x) => x !== d))} aria-label={`Remove hold ${d}`}>✕</button>
              </span>
            ))}
          </div>
        )}
        <div className="grid gap-2 sm:grid-cols-4">
          <Field label="Maintenance from" htmlFor="mf"><Input id="mf" type="date" value={maint[0]?.start_date ?? ""} onChange={(e) => setMaint([{ start_date: e.target.value, end_date: e.target.value, kind: "service", notes: "" }, ...maint.slice(1)])} /></Field>
          <Field label="to" htmlFor="mt"><Input id="mt" type="date" value={maint[0]?.end_date ?? ""} onChange={(e) => setMaint([{ start_date: maint[0]?.start_date ?? "", end_date: e.target.value, kind: maint[0]?.kind ?? "service", notes: "" }, ...maint.slice(1)])} /></Field>
          <Field label="Kind" htmlFor="mk">
            <Select id="mk" value={maint[0]?.kind ?? "service"} onChange={(e) => setMaint([{ start_date: maint[0]?.start_date ?? "", end_date: maint[0]?.end_date ?? null, kind: e.target.value as "service" | "repair" | "inspection", notes: "" }, ...maint.slice(1)])}>
              <option value="service">Service</option>
              <option value="repair">Repair</option>
              <option value="inspection">Inspection</option>
            </Select>
          </Field>
          <Field label="Notes" htmlFor="mn"><Input id="mn" value={maint[0]?.notes ?? ""} onChange={(e) => setMaint([{ start_date: maint[0]?.start_date ?? "", end_date: maint[0]?.end_date ?? null, kind: maint[0]?.kind ?? "service", notes: e.target.value }, ...maint.slice(1)])} /></Field>
        </div>
        <p className="text-[11px] text-ink-faint">Maintenance windows block those dates automatically in availability checks.</p>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={submit} loading={busy}>{mode === "create" ? "Create listing" : "Save changes"}</Button>
        <Select value={f.status} onChange={(e) => set("status", e.target.value)} className="max-w-40">
          <option value="active">Active (bookable)</option>
          <option value="draft">Draft</option>
          <option value="paused">Paused</option>
        </Select>
      </div>
    </div>
  );
}
