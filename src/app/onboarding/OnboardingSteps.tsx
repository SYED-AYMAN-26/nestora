"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/client";
import { Button, Alert, Field, Input, Textarea, Select } from "@/components/form";
import { ACCOUNT_TYPES } from "@/lib/constants";

export function OnboardingSteps({
  hasProvider, verificationStatus, providerSlug,
}: { hasProvider: boolean; verificationStatus: string | null; providerSlug: string | null }) {
  const router = useRouter();
  const [step, setStep] = useState(hasProvider ? 1 : 0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [provider, setProvider] = useState(hasProvider);
  const [slug, setSlug] = useState(providerSlug);
  // Verification status is shown from server props; the wizard never edits it locally.
  const [vStatus] = useState(verificationStatus);

  async function createProvider(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    const res = await api<{ storefront: string }>("/api/providers", {
      body: {
        display_name: String(fd.get("display_name") || ""),
        org_type: String(fd.get("org_type") || ""),
        description: String(fd.get("description") || ""),
        contact_email: String(fd.get("contact_email") || ""),
        contact_phone: String(fd.get("contact_phone") || ""),
      },
    });
    setBusy(false);
    if (!res.ok) { setErr(res.error); return; }
    setProvider(true);
    setSlug(res.data.storefront);
    setStep(2);
    router.refresh();
  }

  async function finish() {
    setBusy(true);
    await api("/api/me", { method: "PATCH", body: { onboarded: true } });
    setBusy(false);
    router.push(provider ? "/provider" : "/dashboard");
    router.refresh();
  }

  const steps = ["Confirm profile", "Become a provider (optional)", "Submit verification", "Done"];

  return (
    <div>
      <ol className="mb-6 flex flex-wrap gap-2 text-[11px]" aria-label="Onboarding progress">
        {steps.map((s, i) => (
          <li key={s} className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${i === step ? "border-electric/50 bg-electric/12 text-electric" : i < step ? "border-emerald-400/30 bg-emerald-400/8 text-emerald-300" : "border-white/10 text-ink-faint"}`}>
            <span className="font-semibold">{i + 1}</span> {s}
          </li>
        ))}
      </ol>
      {err && <Alert kind="error">{err}</Alert>}

      {step === 0 && (
        <div>
          <h2 className="text-[15px] font-semibold text-ink">Your profile is ready</h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-dim">
            Your name, location and account type are set. You can refine them any time in settings — including your
            photo and a short bio that appears alongside your bookings.
          </p>
          <ul className="mt-3 space-y-1.5 text-[12.5px] text-ink-dim">
            <li>• Account type controls eligibility for institutional resources.</li>
            <li>• Your city powers location-based matching.</li>
            <li>• You can switch between buyer and provider mode at any time.</li>
          </ul>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button onClick={() => setStep(1)}>Continue</Button>
            <Link href="/settings" className="rounded-lg border border-white/16 px-3.5 py-2 text-[13.5px] text-ink">Edit profile</Link>
          </div>
        </div>
      )}

      {step === 1 && !provider && (
        <form onSubmit={createProvider}>
          <h2 className="text-[15px] font-semibold text-ink">Share resources as a provider</h2>
          <p className="mt-1.5 mb-4 text-[13px] leading-relaxed text-ink-dim">
            Optional. Creating a provider profile gives you a public storefront and lets you list equipment or spaces.
            It never creates a second account — you keep buying with the same login.
          </p>
          <Field label="Storefront display name" required htmlFor="display_name">
            <Input id="display_name" name="display_name" placeholder="Anna Institute of Technology" />
          </Field>
          <Field label="Organisation type" required htmlFor="org_type">
            <Select id="org_type" name="org_type" defaultValue="college_university">
              {ACCOUNT_TYPES.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
            </Select>
          </Field>
          <Field label="About your storefront" htmlFor="description" hint="What you share, who you serve, and any policies.">
            <Textarea id="description" name="description" placeholder="We share lab equipment and media kit with students and neighbouring institutions…" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Public contact email" htmlFor="contact_email"><Input id="contact_email" name="contact_email" type="email" /></Field>
            <Field label="Public contact phone" htmlFor="contact_phone"><Input id="contact_phone" name="contact_phone" /></Field>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="submit" loading={busy}>Create provider profile</Button>
            <Button type="button" variant="ghost" onClick={() => setStep(3)}>Skip for now</Button>
          </div>
        </form>
      )}

      {step === 1 && provider && (
        <div>
          <h2 className="text-[15px] font-semibold text-ink">Provider profile active</h2>
          <p className="mt-1.5 text-[13px] text-ink-dim">
            Storefront: <code className="text-electric">/storefront/{slug}</code>
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => setStep(2)}>Add verification next</Button>
            <Button variant="ghost" onClick={() => setStep(3)}>Skip</Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div>
          <h2 className="text-[15px] font-semibold text-ink">Get verified</h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-dim">
            Verification unlocks the badge buyers look for. You&apos;ll upload identity and ownership evidence; an
            administrator reviews it. Your documents are stored privately and are never public.
          </p>
          <div className="mt-4 rounded-lg border border-amber-400/25 bg-amber-400/8 px-3 py-2.5 text-[12px] leading-relaxed text-amber-100">
            Current status: <strong>{vStatus?.replace(/_/g, " ") ?? "not submitted"}</strong>. A verified badge appears
            only after an admin approves your submission.
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/provider/verification" className="rounded-lg bg-gradient-to-b from-electric to-electric-deep px-3.5 py-2 text-[13.5px] font-medium text-navy-950">
              Open verification
            </Link>
            <Button variant="ghost" onClick={() => setStep(3)}>Later</Button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div>
          <h2 className="text-[15px] font-semibold text-ink">You&apos;re all set</h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-dim">
            {provider
              ? "Your storefront is live. Add your first listing, then approve requests as they arrive."
              : "Browse the marketplace, save favourites, or describe what you need and let matching find it."}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button onClick={finish} loading={busy}>Go to my dashboard</Button>
            <Link href={provider ? "/provider/new" : "/recommend"} className="rounded-lg border border-white/16 px-3.5 py-2 text-[13.5px] text-ink">
              {provider ? "Create a listing" : "Find a resource"}
            </Link>
          </div>
        </div>
      )}

      <div className="mt-6 flex items-center gap-2 border-t border-white/8 pt-3">
        {step > 0 && <Button variant="ghost" onClick={() => setStep(step - 1)}>← Back</Button>}
        <button type="button" onClick={finish} className="ml-auto text-[12px] text-ink-faint hover:text-ink">Skip setup</button>
      </div>
    </div>
  );
}
