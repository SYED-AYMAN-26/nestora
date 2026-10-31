"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/client";
import { Field, Input, Select, Button, Alert, Toggle } from "@/components/form";
import { ACCOUNT_TYPES } from "@/lib/constants";

export function RegisterForm() {
  const router = useRouter();
  const [accountType, setAccountType] = useState("college_university");
  const [wantsProvider, setWantsProvider] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const needsOrg = accountType !== "individual";

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    const fd = new FormData(e.currentTarget);
    const payload = {
      full_name: String(fd.get("full_name") || "").trim(),
      email: String(fd.get("email") || "").trim(),
      phone: String(fd.get("phone") || "").trim(),
      password: String(fd.get("password") || ""),
      account_type: accountType,
      org_name: needsOrg ? String(fd.get("org_name") || "").trim() : null,
      country: String(fd.get("country") || "").trim(),
      state: String(fd.get("state") || "").trim(),
      city: String(fd.get("city") || "").trim(),
      address: String(fd.get("address") || "").trim(),
      wants_provider: wantsProvider,
    };

    const local: Record<string, string> = {};
    if (payload.full_name.length < 2) local.full_name = "Enter your full name";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(payload.email)) local.email = "Enter a valid email address";
    if (payload.phone.length < 6) local.phone = "Enter a contact number";
    if (payload.password.length < 8) local.password = "Use at least 8 characters";
    if (needsOrg && (payload.org_name ?? "").length < 2) local.org_name = "Organisation name is required";
    if (!payload.city) local.city = "City is required";
    if (Object.keys(local).length) { setFieldErrors(local); return; }

    setBusy(true);
    const res = await api<{ redirect: string }>("/api/auth/register", { body: payload });
    setBusy(false);
    if (!res.ok) {
      const issues = res.data?.issues as { path: string; message: string }[] | undefined;
      if (issues) setFieldErrors(Object.fromEntries(issues.map((i) => [i.path, i.message])));
      setError(res.error);
      return;
    }
    router.push(res.data.redirect);
    router.refresh();
  }

  return (
    <form onSubmit={submit} noValidate>
      <h2 className="mb-4 text-lg font-semibold text-ink">Create your RentLink account</h2>
      {error && <Alert kind="error">{error}</Alert>}

      <Field label="Account type" required htmlFor="account_type" hint="This affects eligibility rules and which priority policies apply to you.">
        <Select id="account_type" value={accountType} onChange={(e) => setAccountType(e.target.value)}>
          {ACCOUNT_TYPES.map((a) => (
            <option key={a.value} value={a.value}>{a.label} — {a.group}</option>
          ))}
        </Select>
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Full name" required error={fieldErrors.full_name} htmlFor="full_name">
          <Input id="full_name" name="full_name" autoComplete="name" placeholder="Riya Sharma" />
        </Field>
        <Field label="Phone number" required error={fieldErrors.phone} htmlFor="phone">
          <Input id="phone" name="phone" autoComplete="tel" placeholder="+91 90000 00000" />
        </Field>
      </div>

      {needsOrg && (
        <Field label="Organisation / institution name" required error={fieldErrors.org_name} htmlFor="org_name">
          <Input id="org_name" name="org_name" placeholder="Anna Institute of Technology" />
        </Field>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Email" required error={fieldErrors.email} htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="email" placeholder="you@institution.edu" />
        </Field>
        <Field label="Password" required error={fieldErrors.password} htmlFor="password" hint="Minimum 8 characters. Hashed with scrypt + per-user salt.">
          <Input id="password" name="password" type="password" autoComplete="new-password" placeholder="••••••••" />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Country" htmlFor="country"><Input id="country" name="country" defaultValue="India" /></Field>
        <Field label="State" htmlFor="state"><Input id="state" name="state" placeholder="Tamil Nadu" /></Field>
        <Field label="City" required error={fieldErrors.city} htmlFor="city"><Input id="city" name="city" placeholder="Chennai" /></Field>
      </div>

      <Field label="Address" htmlFor="address" hint="Used for pickup instructions on your listings and storefront.">
        <Input id="address" name="address" placeholder="Street, area, PIN code" />
      </Field>

      <Toggle
        checked={wantsProvider}
        onChange={setWantsProvider}
        label="Also let me share resources (provider mode)"
        hint="You can turn this on later — it never requires a second account."
      />

      <Button type="submit" loading={busy} className="mt-3 w-full">Create account</Button>

      <p className="mt-3 text-center text-[11.5px] leading-relaxed text-ink-faint">
        By registering you agree to share accurate condition and ownership information. Verification evidence is stored
        privately and only reviewed by platform admins.
      </p>
      <p className="mt-2 text-center text-[12px] text-ink-dim">
        Already registered? <Link href="/login" className="text-electric hover:underline">Sign in</Link>
      </p>
    </form>
  );
}
