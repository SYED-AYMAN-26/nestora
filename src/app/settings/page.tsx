import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { one, Row } from "@/lib/db";
import { PageHeader, VerifiedBadge, DemoTag } from "@/components/ui";
import { SettingsClient } from "./SettingsClient";
import { ACCOUNT_TYPES } from "@/lib/constants";

type UserRow = {
  id: number; email: string; full_name: string; phone: string | null; account_type: string;
  org_name: string | null; country: string | null; state: string | null; city: string | null;
  address: string | null; avatar_url: string | null; bio: string | null; role: string; active_mode: string;
};

export const dynamic = "force-dynamic";
export const metadata = { title: "Profile & settings — RentLink 3D" };

export default async function SettingsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/settings");
  const full = await one<UserRow>(
    `SELECT id, email, full_name, phone, account_type, org_name, country, state, city, address, avatar_url, bio, role, active_mode FROM users WHERE id = ?`,
    user.id
  );
  // The session user always exists in `users`; if the row vanished the account was deleted
  // mid-session, so bounce to login rather than rendering a broken profile.
  if (!full) redirect("/login?next=/settings");
  const provider = user.provider ? await one<Row>(`SELECT * FROM provider_profiles WHERE id = ?`, user.provider.id) : null;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <PageHeader
        title="Profile & settings"
        sub="Your account details, provider storefront and fair-allocation policy. You can only ever edit your own records — enforced server-side."
        right={<>{full?.role === "admin" && <DemoTag label="ADMIN" />}<VerifiedBadge status={provider?.verification_status} /></>}
      />

      <SettingsClient
        user={{
          full_name: full.full_name, email: full.email, phone: full.phone, account_type: full.account_type,
          org_name: full.org_name, country: full.country, state: full.state, city: full.city,
          address: full.address, avatar_url: full.avatar_url, bio: full.bio, role: full.role, active_mode: full.active_mode,
        }}
        provider={provider ? {
          display_name: provider.display_name, org_type: provider.org_type, description: provider.description,
          website: provider.website, contact_email: provider.contact_email, contact_phone: provider.contact_phone,
          cancellation_policy: provider.cancellation_policy, collection_policy: provider.collection_policy,
          priority_policy: (() => { try { return JSON.parse(provider.priority_policy || "{}"); } catch { return {}; } })(),
          storefront_slug: provider.storefront_slug,
        } : null}
        accountTypes={ACCOUNT_TYPES.map((a) => ({ value: a.value, label: a.label }))}
      />

      <div className="mt-4 flex flex-wrap gap-2 text-[12px]">
        <Link href="/notifications" className="rounded-lg border border-white/14 px-3 py-1.5 text-ink-dim hover:text-ink">Notification centre</Link>
        <Link href="/disputes" className="rounded-lg border border-white/14 px-3 py-1.5 text-ink-dim hover:text-ink">Disputes</Link>
        {provider && <Link href="/provider/verification" className="rounded-lg border border-white/14 px-3 py-1.5 text-ink-dim hover:text-ink">Verification</Link>}
        <Link href="/help" className="rounded-lg border border-white/14 px-3 py-1.5 text-ink-dim hover:text-ink">Help</Link>
      </div>
    </div>
  );
}
