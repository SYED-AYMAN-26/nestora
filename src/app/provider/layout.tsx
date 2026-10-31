import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { VerifiedBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

const TABS = [
  { href: "/provider", label: "Overview" },
  { href: "/provider/resources", label: "My listings" },
  { href: "/provider/bookings", label: "Bookings" },
  { href: "/provider/utilisation", label: "Utilisation" },
  { href: "/provider/verification", label: "Verification" },
];

export default async function ProviderLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/provider");
  if (!user.provider) redirect("/onboarding");

  return (
    <div>
      <div className="border-b border-white/8 bg-navy-950/50">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-white/12 bg-gradient-to-br from-navy-800 to-navy-900 text-[12px] font-semibold text-electric">
                {user.provider.display_name.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="truncate text-[13.5px] font-semibold text-ink">{user.provider.display_name}</p>
                <div className="flex items-center gap-2">
                  <VerifiedBadge status={user.provider.verification_status} />
                  <Link href={`/storefront/${user.provider.storefront_slug}`} className="text-[11px] text-ink-faint hover:text-electric">
                    View public storefront ↗
                  </Link>
                </div>
              </div>
            </div>
            <Link href="/provider/new" className="rounded-lg bg-gradient-to-b from-electric to-electric-deep px-3.5 py-2 text-[12.5px] font-semibold text-navy-950">
              + New listing
            </Link>
          </div>
          <nav className="flex gap-1 overflow-x-auto pb-2" aria-label="Provider console">
            {TABS.map((t) => (
              <Link key={t.href} href={t.href} className="shrink-0 rounded-lg px-2.5 py-1.5 text-[12.5px] text-ink-dim hover:bg-white/6 hover:text-ink">
                {t.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>
      {children}
    </div>
  );
}
