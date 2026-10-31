"use client";

/** Free-form fair-allocation policy JSON stored per provider. */
type PriorityPolicy = {
  eligible_account_types?: string[];
  boost_academic?: boolean;
  boost_underserved?: boolean;
  fair_rotation?: boolean;
  [key: string]: unknown;
};

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client";
import { Alert, Button, ChipSelect, Field, Input, Select, Textarea, Toggle, Uploader } from "@/components/form";
import { Card } from "@/components/ui";

type UserShape = {
  full_name: string; email: string; phone: string | null; account_type: string; org_name: string | null;
  country: string | null; state: string | null; city: string | null; address: string | null;
  avatar_url: string | null; bio: string | null; role: string; active_mode: string;
};
type ProviderShape = {
  display_name: string; org_type: string; description: string | null; website: string | null;
  contact_email: string | null; contact_phone: string | null; cancellation_policy: string | null;
  collection_policy: string | null; priority_policy: PriorityPolicy | null; storefront_slug: string;
};

export function SettingsClient({ user, provider, accountTypes }: { user: UserShape; provider: ProviderShape | null; accountTypes: { value: string; label: string }[] }) {
  const router = useRouter();
  const [u, setU] = useState(user);
  const [p, setP] = useState(provider);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");

  const saveProfile = async () => {
    setBusy("profile");
    setMsg(null);
    const res = await api("/api/me", { method: "PATCH", body: u });
    setBusy(null);
    setMsg(res.ok ? { kind: "success", text: "Profile saved." } : { kind: "error", text: res.error });
    router.refresh();
  };

  const saveProvider = async () => {
    if (!p) return;
    setBusy("provider");
    setMsg(null);
    const res = await api("/api/providers/me", { method: "PATCH", body: p });
    setBusy(null);
    setMsg(res.ok ? { kind: "success", text: "Storefront saved." } : { kind: "error", text: res.error });
    router.refresh();
  };

  const changePassword = async () => {
    setBusy("password");
    setMsg(null);
    const res = await api("/api/me", { body: { current, next } });
    setBusy(null);
    if (!res.ok) { setMsg({ kind: "error", text: res.error }); return; }
    setMsg({ kind: "success", text: "Password changed. All sessions were invalidated — please sign in again." });
    setCurrent(""); setNext("");
    setTimeout(() => router.push("/login"), 1500);
  };

  return (
    <div>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

      <Card className="p-4">
        <section>
          <p className="mb-3 text-[12px] font-semibold uppercase tracking-wider text-electric">Account</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Full name" htmlFor="fn"><Input id="fn" value={u.full_name} onChange={(e) => setU({ ...u, full_name: e.target.value })} /></Field>
            <Field label="Email" htmlFor="em" hint="Email changes aren't supported in this build — contact support.">
              <Input id="em" value={u.email} disabled />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Phone" htmlFor="ph"><Input id="ph" value={u.phone ?? ""} onChange={(e) => setU({ ...u, phone: e.target.value })} /></Field>
            <Field label="Account type" htmlFor="at" hint="Changes eligibility on institutional resources.">
              <Select id="at" value={u.account_type} onChange={(e) => setU({ ...u, account_type: e.target.value })}>
                {accountTypes.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Organisation name" htmlFor="on"><Input id="on" value={u.org_name ?? ""} onChange={(e) => setU({ ...u, org_name: e.target.value })} /></Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Country" htmlFor="co"><Input id="co" value={u.country ?? ""} onChange={(e) => setU({ ...u, country: e.target.value })} /></Field>
            <Field label="State" htmlFor="st"><Input id="st" value={u.state ?? ""} onChange={(e) => setU({ ...u, state: e.target.value })} /></Field>
            <Field label="City" htmlFor="ci"><Input id="ci" value={u.city ?? ""} onChange={(e) => setU({ ...u, city: e.target.value })} /></Field>
          </div>
          <Field label="Address" htmlFor="ad"><Input id="ad" value={u.address ?? ""} onChange={(e) => setU({ ...u, address: e.target.value })} /></Field>
          <Field label="Bio" htmlFor="bi" hint="Shown alongside your bookings and storefront.">
            <Textarea id="bi" rows={3} value={u.bio ?? ""} onChange={(e) => setU({ ...u, bio: e.target.value })} />
          </Field>
          <Uploader value={u.avatar_url ? [u.avatar_url] : []} onChange={(v) => setU({ ...u, avatar_url: v[0] ?? null })} label="Profile image" max={1} />
          <Button onClick={saveProfile} loading={busy === "profile"}>Save profile</Button>
        </section>
      </Card>

      {p && (
        <Card className="mt-4 p-4">
          <section>
            <p className="mb-1 text-[12px] font-semibold uppercase tracking-wider text-electric">Storefront</p>
            <p className="mb-3 text-[11px] text-ink-faint">Public at <code className="text-electric">/storefront/{p.storefront_slug}</code></p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Display name" htmlFor="dn"><Input id="dn" value={p.display_name} onChange={(e) => setP({ ...p, display_name: e.target.value })} /></Field>
              <Field label="Organisation type" htmlFor="ot">
                <Select id="ot" value={p.org_type} onChange={(e) => setP({ ...p, org_type: e.target.value })}>
                  {accountTypes.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                </Select>
              </Field>
            </div>
            <Field label="Description" htmlFor="de"><Textarea id="de" rows={3} value={p.description ?? ""} onChange={(e) => setP({ ...p, description: e.target.value })} /></Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Public email" htmlFor="pe"><Input id="pe" value={p.contact_email ?? ""} onChange={(e) => setP({ ...p, contact_email: e.target.value })} /></Field>
              <Field label="Public phone" htmlFor="pp"><Input id="pp" value={p.contact_phone ?? ""} onChange={(e) => setP({ ...p, contact_phone: e.target.value })} /></Field>
              <Field label="Website" htmlFor="we"><Input id="we" value={p.website ?? ""} onChange={(e) => setP({ ...p, website: e.target.value })} /></Field>
            </div>
            <Field label="Cancellation policy" htmlFor="cp"><Textarea id="cp" rows={2} value={p.cancellation_policy ?? ""} onChange={(e) => setP({ ...p, cancellation_policy: e.target.value })} /></Field>
            <Field label="Collection policy" htmlFor="col"><Textarea id="col" rows={2} value={p.collection_policy ?? ""} onChange={(e) => setP({ ...p, collection_policy: e.target.value })} /></Field>

            <p className="mb-1.5 mt-2 text-[12px] font-semibold uppercase tracking-wider text-electric">Fair-allocation policy</p>
            <p className="mb-2 text-[11px] leading-relaxed text-ink-faint">
              These rules are published on your storefront and used to explain priority decisions to buyers. Nothing is hidden.
            </p>
            <ChipSelect
              options={accountTypes.map((a) => ({ value: a.value, label: a.label }))}
              selected={p.priority_policy?.eligible_account_types ?? []}
              onChange={(v) => setP({ ...p, priority_policy: { ...p.priority_policy, eligible_account_types: v } })}
            />
            <div className="mt-2">
              <Toggle checked={p.priority_policy?.boost_academic !== false} onChange={(v) => setP({ ...p, priority_policy: { ...p.priority_policy, boost_academic: v } })} label="Give academic / project purposes a boost" />
              <Toggle checked={p.priority_policy?.boost_underserved !== false} onChange={(v) => setP({ ...p, priority_policy: { ...p.priority_policy, boost_underserved: v } })} label="Give first-time borrowers a fair-start boost" />
              <Toggle checked={p.priority_policy?.fair_rotation !== false} onChange={(v) => setP({ ...p, priority_policy: { ...p.priority_policy, fair_rotation: v } })} label="Apply fair rotation among recent requesters" />
            </div>
            <Button onClick={saveProvider} loading={busy === "provider"} className="mt-2">Save storefront</Button>
          </section>
        </Card>
      )}

      <Card className="mt-4 p-4">
        <p className="mb-3 text-[12px] font-semibold uppercase tracking-wider text-electric">Password</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Current password" htmlFor="cpw"><Input id="cpw" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} /></Field>
          <Field label="New password (min 8)" htmlFor="npw"><Input id="npw" type="password" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
        </div>
        <Button variant="outline" onClick={changePassword} loading={busy === "password"}>Change password</Button>
        <p className="mt-2 text-[10.5px] text-ink-faint">
          Passwords are hashed with scrypt and a per-user salt. Changing your password ends every existing session.
        </p>
      </Card>
    </div>
  );
}
