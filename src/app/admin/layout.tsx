import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

const TABS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/verifications", label: "Verifications" },
  { href: "/admin/disputes", label: "Disputes" },
  { href: "/admin/resources", label: "Listings & reports" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/audit", label: "Audit log" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Server-side role check. Ordinary users never reach an admin page.
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/admin");
  if (user.role !== "admin") redirect("/dashboard");

  return (
    <div>
      <div className="border-b border-amber-400/20 bg-amber-400/5">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-2 py-2">
            <p className="text-[12px] font-semibold uppercase tracking-wider text-amber-300">Admin console</p>
            <p className="text-[11px] text-amber-200/70">Every sensitive action here is written to the audit log.</p>
          </div>
          <nav className="flex gap-1 overflow-x-auto pb-2" aria-label="Admin">
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
