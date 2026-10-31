import type { Metadata, Viewport } from "next";
import "./globals.css";
import { TopNav } from "@/components/nav";
import { getSessionUser } from "@/lib/auth";
import { assertProductionConfigReady } from "@/instrumentation";
import Link from "next/link";

const TAGLINE = "Discover Your Space. Experience It in 3D.";
const DESCRIPTION =
  "Nestora is a property-tech platform where colleges, companies and communities list unused spaces and equipment, " +
  "and everyone else discovers, explores in 3D and books them.";

export const metadata: Metadata = {
  // Template keeps every page's <title> on-brand without touching each file.
  title: { default: `Nestora — ${TAGLINE}`, template: "%s · Nestora" },
  description: DESCRIPTION,
  applicationName: "Nestora",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/img/logomark.svg", type: "image/svg+xml", sizes: "any" },
    ],
    apple: "/img/logomark.svg",
  },
  openGraph: {
    type: "website",
    siteName: "Nestora",
    title: `Nestora — ${TAGLINE}`,
    description: DESCRIPTION,
    images: [{ url: "/img/logomark.svg", width: 64, height: 64, alt: "Nestora" }],
  },
  twitter: {
    card: "summary",
    title: `Nestora — ${TAGLINE}`,
    description: DESCRIPTION,
    images: ["/img/logomark.svg"],
  },
  other: { "apple-mobile-web-app-title": "Nestora" },
};

export const viewport: Viewport = {
  themeColor: "#06121f",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Enforces production configuration on the first request even if the
  // instrumentation hook was not wired into this build. A fatal problem throws,
  // so an unsafe deployment serves nothing rather than degrading silently.
  await assertProductionConfigReady();
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
                <span className="text-sm font-semibold tracking-tight text-ink">Nestora</span>
              </div>
              <p className="mt-2 max-w-xs text-[12px] font-medium leading-relaxed text-ink-dim">{TAGLINE}</p>
              <p className="mt-1.5 max-w-xs text-[12px] leading-relaxed text-ink-faint">
                List unused spaces and equipment. Discover what you need. Explore it in 3D.
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
            Nestora · {TAGLINE} · <Link href="/verification-report" className="underline decoration-dotted hover:text-electric">build &amp; feature verification report</Link>
          </div>
        </footer>
      </body>
    </html>
  );
}
