"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";

export type NavUser = {
  id: number; full_name: string; email: string; role: string; active_mode: string;
  provider: { id: number; storefront_slug: string; verification_status: string; display_name: string } | null;
} | null;

const BUYER_LINKS = [
  { href: "/marketplace", label: "Marketplace" },
  { href: "/recommend", label: "Find by need" },
  { href: "/impact", label: "Impact" },
  { href: "/help", label: "Help" },
];
const PROVIDER_LINKS = [
  { href: "/provider", label: "Provider home" },
  { href: "/provider/resources", label: "My listings" },
  { href: "/provider/bookings", label: "Bookings" },
  { href: "/provider/utilisation", label: "Utilisation" },
];

export function TopNav({ user }: { user: NavUser }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [unread, setUnread] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setOpen(false); setMenu(false); }, [pathname]);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    const load = async () => {
      const r = await api<{ unread: number }>("/api/notifications").catch(() => null);
      if (alive && r?.ok) setUnread(r.data.unread);
    };
    // Fire-and-forget polling: the rejection is handled inside `load`.
    void load();
    const t = setInterval(() => void load(), 45000);
    return () => { alive = false; clearInterval(t); };
  }, [user, pathname]);

  const switchMode = async () => {
    setBusy(true);
    const next = user?.active_mode === "provider" ? "buyer" : "provider";
    const r = await api<{ redirect: string }>("/api/auth/mode", { body: { mode: next } });
    setBusy(false);
    if (r.ok) router.push(r.data.redirect);
    router.refresh();
  };

  const signOut = async () => {
    await api("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  };

  const isProviderMode = user?.active_mode === "provider" && user?.provider;
  const links = isProviderMode ? PROVIDER_LINKS : BUYER_LINKS;

  return (
    <header className="sticky top-0 z-50 border-b border-white/8 bg-navy-950/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6">
        <Link href={user ? (user.role === "admin" ? "/admin" : isProviderMode ? "/provider" : "/marketplace") : "/"} className="flex shrink-0 items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/img/logomark.svg" alt="" className="h-8 w-8" width={32} height={32} />
          <span className="text-[15px] font-semibold tracking-tight text-ink">
            Nestora
          </span>
        </Link>

        <nav className="ml-4 hidden items-center gap-1 lg:flex" aria-label="Main">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`rounded-lg px-2.5 py-1.5 text-[13px] transition ${
                pathname === l.href || (l.href !== "/" && pathname.startsWith(l.href))
                  ? "bg-white/8 text-ink"
                  : "text-ink-dim hover:bg-white/5 hover:text-ink"
              }`}
            >
              {l.label}
            </Link>
          ))}
          {user?.role === "admin" && (
            <Link href="/admin" className="rounded-lg px-2.5 py-1.5 text-[13px] text-amber-300 hover:bg-amber-400/10">
              Admin
            </Link>
          )}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {user ? (
            <>
              {user.provider && (
                <button
                  type="button"
                  onClick={switchMode}
                  disabled={busy}
                  className="hidden items-center gap-1.5 rounded-lg border border-white/14 px-2.5 py-1.5 text-[12px] text-ink-dim transition hover:border-electric/40 hover:text-ink sm:inline-flex"
                  title="Switch between buying and sharing — one account, both roles"
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${isProviderMode ? "bg-emerald-400" : "bg-electric"}`} />
                  {isProviderMode ? "Provider mode" : "Buyer mode"}
                  <svg viewBox="0 0 20 20" className="h-3 w-3 opacity-60" fill="currentColor" aria-hidden="true"><path d="M7 4l6 6-6 6V4z"/></svg>
                </button>
              )}
              <Link
                href="/notifications"
                className="relative rounded-lg border border-white/12 p-2 text-ink-dim transition hover:border-electric/40 hover:text-ink"
                aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path d="M18 8a6 6 0 10-12 0c0 7-3 8-3 8h18s-3-1-3-8" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M13.7 21a2 2 0 01-3.4 0" strokeLinecap="round" />
                </svg>
                {unread > 0 && (
                  <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-electric px-1 text-[10px] font-bold text-navy-950">
                    {unread > 9 ? "9+" : unread}
                  </span>
                )}
              </Link>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setMenu((v) => !v)}
                  className="flex items-center gap-2 rounded-lg border border-white/12 px-2 py-1.5 text-[12px] text-ink-dim hover:border-electric/40 hover:text-ink"
                  aria-expanded={menu}
                  aria-haspopup="menu"
                >
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-gradient-to-br from-electric to-cyan text-[10px] font-bold text-navy-950">
                    {user.full_name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="hidden max-w-24 truncate sm:inline">{user.full_name.split(" ")[0]}</span>
                </button>
                {menu && (
                  <div className="glass absolute right-0 mt-2 w-56 rounded-xl p-1.5 text-[13px]" role="menu">
                    <div className="px-2.5 py-2">
                      <p className="truncate font-medium text-ink">{user.full_name}</p>
                      <p className="truncate text-[11px] text-ink-faint">{user.email}</p>
                    </div>
                    <hr className="my-1 border-white/8" />
                    {[
                      { href: "/dashboard", label: "Buyer dashboard" },
                      { href: "/provider", label: "Provider dashboard" },
                      { href: "/bookings", label: "My bookings" },
                      { href: "/favourites", label: "Favourites" },
                      { href: "/disputes", label: "Disputes" },
                      { href: "/settings", label: "Profile & settings" },
                      ...(user.role === "admin" ? [{ href: "/admin", label: "Admin console" }] : []),
                    ].map((i) => (
                      <Link key={i.href} href={i.href} role="menuitem" className="block rounded-lg px-2.5 py-1.5 text-ink-dim hover:bg-white/6 hover:text-ink">
                        {i.label}
                      </Link>
                    ))}
                    <hr className="my-1 border-white/8" />
                    <button type="button" onClick={signOut} role="menuitem" className="w-full rounded-lg px-2.5 py-1.5 text-left text-rose-300 hover:bg-rose-400/10">
                      Sign out
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <Link href="/login" className="rounded-lg px-3 py-1.5 text-[13px] text-ink-dim hover:text-ink">Sign in</Link>
              <Link href="/register" className="rounded-lg bg-gradient-to-b from-electric to-electric-deep px-3.5 py-2 text-[13px] font-semibold text-navy-950 shadow-[0_10px_28px_-14px_rgba(56,189,248,0.9)] hover:brightness-110">
                Get started
              </Link>
            </>
          )}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="rounded-lg border border-white/12 p-2 text-ink-dim lg:hidden"
            aria-label="Toggle navigation"
            aria-expanded={open}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-white/8 bg-navy-950/95 px-4 py-3 lg:hidden">
          <div className="grid gap-1">
            {[...links,
              ...(user ? [
                { href: "/dashboard", label: "Buyer dashboard" },
                { href: "/provider", label: "Provider dashboard" },
                { href: "/settings", label: "Settings" },
              ] : []),
              ...(user?.role === "admin" ? [{ href: "/admin", label: "Admin console" }] : []),
            ].map((l) => (
              <Link key={l.href} href={l.href} className="rounded-lg px-2 py-2 text-sm text-ink-dim hover:bg-white/6 hover:text-ink">
                {l.label}
              </Link>
            ))}
            {user?.provider && (
              <button type="button" onClick={switchMode} className="rounded-lg px-2 py-2 text-left text-sm text-electric">
                Switch to {isProviderMode ? "buyer" : "provider"} mode
              </button>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
