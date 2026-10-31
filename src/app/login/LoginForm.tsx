"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client";
import { Field, Input, Button, Alert } from "@/components/form";

export function LoginForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const res = await api<{ redirect: string }>("/api/auth/login", { body: { email, password } });
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    router.push(res.data.redirect);
    router.refresh();
  }

  const quick = (e: string) => { setEmail(e); setPassword("Demo@1234"); };

  return (
    <form onSubmit={submit}>
      <h2 className="mb-4 text-lg font-semibold text-ink">Sign in</h2>
      {error && <Alert kind="error">{error}</Alert>}
      <Field label="Email" required htmlFor="email">
        <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@institution.edu" />
      </Field>
      <Field label="Password" required htmlFor="password">
        <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
      </Field>
      <Button type="submit" loading={busy} className="w-full">Sign in</Button>

      <div className="mt-4 border-t border-white/8 pt-3">
        <p className="mb-2 text-[11px] uppercase tracking-wider text-ink-faint">Quick fill (demo)</p>
        <div className="flex flex-wrap gap-1.5">
          {[
            ["buyer@student.demo", "Student"],
            ["provider@anna.demo", "Provider"],
            ["admin@rentlink.demo", "Admin"],
          ].map(([mail, label]) => (
            <button key={mail} type="button" onClick={() => quick(mail)} className="rounded-md border border-white/12 px-2 py-1 text-[11px] text-ink-dim hover:border-electric/40 hover:text-ink">
              {label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[10.5px] leading-relaxed text-ink-faint">
          Fills the form with a seeded demo account (password <code className="text-electric">Demo@1234</code>) — no real credentials.
        </p>
      </div>
    </form>
  );
}
