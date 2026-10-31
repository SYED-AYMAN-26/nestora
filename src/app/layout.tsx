import type { Metadata, Viewport } from "next";
import "./globals.css";
import { TopNav } from "@/components/nav";
import { getSessionUser } from "@/lib/auth";
import Link from "next/link";

export const metadata: Metadata = {
  title: "RentLink 3D — Share what sits unused",
  description:
    "RentLink 3D is a resource-sharing platform for colleges, universities, companies and communities to list idle equipment and spaces, and for everyone else to find and book what they need.",
  applicationName: "RentLink 3D",
  icons: { icon: "/img/logomark.svg" },
};

export const viewport: Viewport = {
  themeColor: "#050d18",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  const navUser = user
    ? {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        role: user.role,
        active_mode: user.active_mode,
        provider: user.provider
          ? {
              id: user.provider.id,
              storefront_slug: user.provider.storefront_slug,
              verification_status: user.provider.verification_status,
              display_name: user.provider.display_name,
            }
          : null,
      }
    : null;

  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-electric focus:px-3 focus:py-2 focus:text-navy-950">
          Skip to content
        </a>
        <TopNav user={navUser} />
        <main id="main">{children}</main>
        <footer className="mt-20 border-t border-white/8 bg-navy-950/60">
          <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-4">
            <div>
              <div className="flex items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/img/logomark.svg" alt="" className="h-7 w-7" />
                <span className="text-sm font-semibold text-ink">RentLink<span className="text-electric"> 3D</span></span>
              </div>
              <p className="mt-2 max-w-xs text-[12px] leading-relaxed text-ink-faint">
                List unused resources. Discover what you need. Share safely. A trusted resource-sharing layer for
                institutions and communities.
              </p>
            </div>
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-dim">Discover</p>
              <ul className="space-y-1.5 text-[12.5px] text-ink-faint">
                <li><Link href="/marketplace" className="hover:text-electric">Marketplace</Link></li>
                <li><Link href="/recommend" className="hover:text-electric">Find by need</Link></li>
                <li><Link href="/compare" className="hover:text-electric">Compare providers</Link></li>
                <li><Link href="/impact" className="hover:text-electric">Institutional impact</Link></li>
              </ul>
            </div>
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-dim">Share</p>
              <ul className="space-y-1.5 text-[12.5px] text-ink-faint">
                <li><Link href="/provider/new" className="hover:text-electric">List a resource</Link></li>
                <li><Link href="/provider/utilisation" className="hover:text-electric">Utilisation insights</Link></li>
                <li><Link href="/provider/verification" className="hover:text-electric">Get verified</Link></li>
                <li><Link href="/help" className="hover:text-electric">Help &amp; support</Link></li>
              </ul>
            </div>
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-dim">Demo disclosure</p>
              <p className="text-[12px] leading-relaxed text-ink-faint">
                This deployment runs seeded <strong className="text-ink-dim">fictional demo data</strong> and, without
                gateway credentials, a labelled demo payment mode. Nothing here represents a real transaction.
              </p>
            </div>
          </div>
          <div className="border-t border-white/6 px-4 py-4 text-center text-[11px] text-ink-faint sm:px-6">
            RentLink 3D · hackathon build · <Link href="/verification-report" className="underline decoration-dotted hover:text-electric">build &amp; feature verification report</Link>
          </div>
        </footer>
      </body>
    </html>
  );
}
