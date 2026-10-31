import Link from "next/link";
import { HeroScene } from "@/components/three/HeroScene";
import { Canvas3D } from "@/components/three/Canvas3D";
import { ResourceCard } from "@/components/ResourceCard";
import { Reveal, CountUp } from "@/components/motion";
import { Badge, Card, DemoTag, InfoNote } from "@/components/ui";
import { searchResources } from "@/lib/resources";
import { computeImpact } from "@/lib/impact";
import { CATEGORIES } from "@/lib/constants";
import { all, Row } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function LandingPage() {
  const { items: featured } = await searchResources({ limit: 6, sort: "rating" });
  const impact = await computeImpact();
  const topProviders = await all<Row>(
    `SELECT p.id, p.display_name, p.storefront_slug, p.org_type, p.verification_status, p.rating_cached, p.rating_count,
            (SELECT COUNT(*) FROM resources r WHERE r.provider_id = p.id AND r.status='active') AS resources
       FROM provider_profiles p WHERE p.verification_status = 'verified' ORDER BY p.rating_cached DESC LIMIT 4`
  );
  const user = await getSessionUser();

  return (
    <>
      {/* ---------------------------------------------------------------- hero */}
      <section className="relative overflow-hidden">
        <div className="grid-fade pointer-events-none absolute inset-0 opacity-70" aria-hidden="true" />
        <div className="mx-auto grid grid-cols-1 max-w-7xl items-center gap-8 px-4 pb-10 pt-10 sm:px-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:pb-16 lg:pt-16">
          <div className="fade-up">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-electric/25 bg-electric/8 px-3 py-1 text-[11px] font-medium text-electric">
              <span className="h-1.5 w-1.5 rounded-full bg-electric" />
              Property-tech for institutions &amp; communities
            </div>
            <h1 className="text-4xl font-semibold leading-[1.06] tracking-tight sm:text-5xl lg:text-[56px]">
              <span className="gradient-text">Discover your space.</span>
              <br />
              <span className="text-ink">Experience it in 3D.</span>
            </h1>
            <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-ink-dim">
              Colleges, companies and community groups are sitting on halls, studios, labs and equipment that go
              unused for most of the year. Nestora makes that space visible, explorable in 3D and bookable — with
              verified providers, condition records and a full rental lifecycle.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link
                href={user ? "/marketplace" : "/register"}
                className="rounded-xl bg-gradient-to-b from-electric to-electric-deep px-5 py-3 text-sm font-semibold text-navy-950 shadow-[0_18px_44px_-18px_rgba(56,189,248,0.95)] transition hover:brightness-110"
              >
                {user ? "Browse the marketplace" : "Create a free account"}
              </Link>
              <Link
                href="/recommend"
                className="rounded-xl border border-white/16 bg-white/5 px-5 py-3 text-sm font-medium text-ink transition hover:border-electric/45 hover:bg-white/8"
              >
                Describe what you need →
              </Link>
            </div>
            <dl className="mt-9 grid max-w-lg grid-cols-3 gap-3">
              {[
                { k: "Resources listed", v: impact.verified.resources_listed },
                { k: "Completed bookings", v: impact.verified.bookings_completed },
                { k: "Idle units identified", v: impact.estimated.idle_units_identified },
              ].map((s) => (
                <div key={s.k} className="glass-soft rounded-xl px-3 py-2.5">
                  <dd className="text-xl font-semibold tabular-nums text-ink">
                    <CountUp to={s.v} />
                  </dd>
                  <dt className="mt-0.5 text-[10.5px] uppercase tracking-wider text-ink-faint">{s.k}</dt>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
              Figures come from this deployment&apos;s database, which is currently seeded with labelled demo records —{" "}
              <Link href="/impact" className="text-electric hover:underline">see the impact dashboard</Link> for the exact provenance.
            </p>
          </div>

          <div className="relative">
            <div className="absolute -inset-6 rounded-[36px] bg-[radial-gradient(circle_at_60%_40%,rgba(56,189,248,0.16),transparent_65%)]" aria-hidden="true" />
            <Card className="relative overflow-hidden p-0">
              <Canvas3D
                height={470}
                label="Rotating 3D scene of shared equipment — a camera, robotic arm, microphone and 3D printer orbiting provider nodes"
                fallback={
                  <div className="relative grid h-[470px] place-items-center overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/img/camera.svg" alt="DSLR camera" className="h-full w-full object-cover opacity-80" />
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-navy-950 to-transparent p-4 text-center text-[11px] text-ink-faint">
                      3D view unavailable on this device — showing a static illustration.
                    </div>
                  </div>
                }
              >
                <HeroScene reducedMotion={false} />
              </Canvas3D>
              <div className="pointer-events-none absolute left-0 top-0 p-3">
                <Badge tone="info">Live 3D scene</Badge>
              </div>
            </Card>
            <div className="glass absolute -bottom-4 left-4 hidden rounded-xl px-3 py-2 sm:block">
              <p className="text-[10px] uppercase tracking-wider text-ink-faint">Trust layer</p>
              <p className="text-[12px] font-medium text-ink">Verified providers · condition passports</p>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- problem */}
      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
        <Reveal>
          <div className="grid gap-4 md:grid-cols-3">
            {[
              {
                t: "Idle assets are invisible",
                d: "A department owns 20 cameras and uses 5. Nobody else knows the other 15 exist, so they stay in a cupboard.",
                icon: "◍",
              },
              {
                t: "Buying what already exists",
                d: "Students and small organisations buy cheap equipment they'll use twice, while nearby institutions hold better kit unused.",
                icon: "◎",
              },
              {
                t: "Sharing without trust fails",
                d: "Informal lending breaks down without verification, condition records, fair allocation and a way to resolve damage disputes.",
                icon: "◈",
              },
            ].map((c) => (
              <Card key={c.t} className="p-5" >
                <div className="mb-3 grid h-9 w-9 place-items-center rounded-lg border border-electric/25 bg-electric/10 text-electric">{c.icon}</div>
                <h3 className="text-[15px] font-semibold text-ink">{c.t}</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-ink-dim">{c.d}</p>
              </Card>
            ))}
          </div>
        </Reveal>
      </section>

      {/* ---------------------------------------------------------------- lifecycle */}
      <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <Reveal>
          <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-electric">The whole lifecycle</p>
              <h2 className="text-2xl font-semibold tracking-tight text-ink">Not a listings page — an accountable handover chain</h2>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-dim">
                Every step below is implemented end-to-end against the database: verification, availability, fair
                allocation, payment, condition capture, return inspection, disputes and utilisation analytics.
              </p>
            </div>
            <Link href="/verification-report" className="text-[12.5px] text-electric hover:underline">
              See what&apos;s verified working →
            </Link>
          </div>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            {[
              { n: "01", t: "Provider verifies", d: "Institution uploads identity + ownership evidence. A verified badge appears only after admin approval." },
              { n: "02", t: "Resources listed", d: "Prices, condition, capabilities, availability windows, eligibility and internal-use declarations." },
              { n: "03", t: "Buyer discovers", d: "Search, filter, compare providers and match by capability, not just product name." },
              { n: "04", t: "Fair allocation", d: "Transparent priority scoring, booking caps, waiting lists and double-booking prevention." },
              { n: "05", t: "Request & approve", d: "Provider accepts, rejects with a reason, or sends a counteroffer with new dates." },
              { n: "06", t: "Pay & hand over", d: "Test-mode or labelled demo payment, then a two-sided condition checklist with photos." },
              { n: "07", t: "Return & inspect", d: "Buyer submits return photos; provider inspects and confirms before completion." },
              { n: "08", t: "Dispute if needed", d: "Evidence-based review by an admin. Deposits are never auto-deducted." },
            ].map((s) => (
              <Card key={s.n} className="p-4">
                <span className="text-[11px] font-semibold tracking-wider text-electric">{s.n}</span>
                <h3 className="mt-1.5 text-[13.5px] font-semibold text-ink">{s.t}</h3>
                <p className="mt-1 text-[12px] leading-relaxed text-ink-dim">{s.d}</p>
              </Card>
            ))}
          </div>
        </Reveal>
      </section>

      {/* ---------------------------------------------------------------- underuse feature */}
      <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <Reveal>
          <Card className="overflow-hidden p-0">
            <div className="grid grid-cols-1 gap-6 p-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:p-8">
              <div>
                <Badge tone="info">Utilisation intelligence</Badge>
                <h2 className="mt-3 text-2xl font-semibold tracking-tight text-ink">
                  Find the 15 cameras nobody is using
                </h2>
                <p className="mt-2.5 text-sm leading-relaxed text-ink-dim">
                  Providers declare how many units exist and how many are genuinely in internal use. Nestora
                  computes utilisation from real booking records and surfaces what could be shared.
                </p>
                <ul className="mt-4 space-y-2 text-[13px] text-ink-dim">
                  <li className="flex gap-2"><span className="text-electric">◆</span> Utilisation % per listing, from booked unit-days ÷ shareable capacity</li>
                  <li className="flex gap-2"><span className="text-electric">◆</span> Estimated idle units, clearly separated from confirmed availability</li>
                  <li className="flex gap-2"><span className="text-electric">◆</span> No fabricated data — if there are no records, it says so</li>
                </ul>
                <Link href="/provider/utilisation" className="mt-5 inline-flex rounded-lg border border-white/16 bg-white/5 px-3.5 py-2 text-[13px] text-ink hover:border-electric/45">
                  Open the utilisation dashboard →
                </Link>
              </div>
              <div className="glass-soft rounded-xl p-4">
                <p className="mb-3 text-[11px] uppercase tracking-wider text-ink-faint">Example calculation · demo records</p>
                {[
                  { t: "Canon EOS 90D fleet", total: 20, inUse: 5, pct: 6.2 },
                  { t: "ThinkPad loaner pool", total: 16, inUse: 3, pct: 21.4 },
                  { t: "Prusa 3D printers", total: 4, inUse: 1, pct: 12.8 },
                  { t: "Mini seminar hall", total: 1, inUse: 0, pct: 0 },
                ].map((r) => (
                  <div key={r.t} className="mb-3 last:mb-0">
                    <div className="mb-1 flex items-baseline justify-between gap-2">
                      <span className="truncate text-[12.5px] text-ink">{r.t}</span>
                      <span className="shrink-0 text-[11px] tabular-nums text-ink-faint">
                        {r.inUse}/{r.total} in use · {r.pct}%
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/8">
                      <div className="h-full rounded-full bg-gradient-to-r from-electric to-cyan" style={{ width: `${Math.max(2, r.pct)}%` }} />
                    </div>
                    <p className="mt-1 text-[10.5px] text-ink-faint">
                      ~{r.total - r.inUse} unit(s) estimated idle — availability must be confirmed
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </Reveal>
      </section>

      {/* ---------------------------------------------------------------- categories */}
      <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <Reveal>
          <h2 className="text-2xl font-semibold tracking-tight text-ink">What institutions actually share</h2>
          <p className="mt-1.5 text-sm text-ink-dim">Ten categories spanning media, labs, fabrication, spaces and transport.</p>
          <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
            {CATEGORIES.map((c) => (
              <Link key={c.slug} href={`/marketplace?category=${c.slug}`} className="card-3d glass rounded-xl p-3.5 hover:border-electric/35">
                <p className="text-[13px] font-medium text-ink">{c.name}</p>
                <p className="mt-0.5 text-[11px] text-ink-faint">{c.subcategories.length} subcategories</p>
              </Link>
            ))}
          </div>
        </Reveal>
      </section>

      {/* ---------------------------------------------------------------- featured */}
      <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <Reveal>
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-ink">Recently listed</h2>
              <p className="mt-1.5 text-sm text-ink-dim">
                Real listings from the database — <DemoTag label="DEMO DATA" /> records are fictional demo providers.
              </p>
            </div>
            <Link href="/marketplace" className="text-[12.5px] text-electric hover:underline">Browse all →</Link>
          </div>
          <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((r) => (
              <ResourceCard key={r.id} r={r} />
            ))}
          </div>
        </Reveal>
      </section>

      {/* ---------------------------------------------------------------- providers */}
      <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <Reveal>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <Card className="p-5">
              <h2 className="text-lg font-semibold text-ink">Verified storefronts</h2>
              <p className="mt-1 text-[13px] text-ink-dim">
                A badge is only shown after an admin has reviewed identity and ownership evidence.
              </p>
              <div className="mt-4 space-y-2">
                {topProviders.map((p) => (
                  <Link key={p.id} href={`/storefront/${p.storefront_slug}`} className="glass-soft flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 transition hover:border-electric/35">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium text-ink">{p.display_name}</p>
                      <p className="text-[11px] text-ink-faint">{p.resources} listing(s) · {p.org_type.replace(/_/g, " ")}</p>
                    </div>
                    <Badge tone="verified">✓ Verified</Badge>
                  </Link>
                ))}
              </div>
            </Card>
            <Card className="p-5">
              <h2 className="text-lg font-semibold text-ink">Try the demo in 60 seconds</h2>
              <p className="mt-1 text-[13px] text-ink-dim">
                Every demo account uses the password <code className="rounded bg-white/8 px-1.5 py-0.5 text-electric">Demo@1234</code>.
                These are seeded test accounts, not real people or institutions.
              </p>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {[
                  { r: "Buyer", e: "buyer@student.demo", d: "Book, pay, hand over, return" },
                  { r: "Provider", e: "provider@anna.demo", d: "Approve, inspect, analyse utilisation" },
                  { r: "Unverified provider", e: "provider@creators.demo", d: "See the verification flow" },
                  { r: "Admin", e: "admin@rentlink.demo", d: "Verify, resolve disputes, audit" },
                ].map((a) => (
                  <div key={a.e} className="glass-soft rounded-lg px-3 py-2.5">
                    <p className="text-[12px] font-semibold text-ink">{a.r}</p>
                    <p className="mt-0.5 font-mono text-[11px] text-electric">{a.e}</p>
                    <p className="mt-0.5 text-[10.5px] text-ink-faint">{a.d}</p>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link href="/login" className="rounded-lg bg-gradient-to-b from-electric to-electric-deep px-3.5 py-2 text-[13px] font-semibold text-navy-950">Sign in</Link>
                <Link href="/help" className="rounded-lg border border-white/16 px-3.5 py-2 text-[13px] text-ink">Demo walkthrough</Link>
              </div>
            </Card>
          </div>
        </Reveal>
      </section>

      {/* ---------------------------------------------------------------- disclosure */}
      <section className="mx-auto max-w-7xl px-4 pb-6 pt-4 sm:px-6">
        <InfoNote tone="warn" title="What is real in this build, and what isn't">
          Everything you interact with is backed by a SQLite database and real server routes: accounts, sessions,
          listings, availability, bookings, approvals, handover, returns, disputes, utilisation maths and audit logs.
          The <strong>data</strong> is seeded demo data. Payments run in <strong>demo mode</strong> unless Razorpay test
          keys are configured, and we never claim escrow. 3D models are interactive procedural meshes, not CAD assets.
          Email/WhatsApp delivery is off unless configured. The{" "}
          <Link href="/verification-report" className="underline">verification report</Link> lists this precisely.
        </InfoNote>
      </section>

      {/* ---------------------------------------------------------------- cta */}
      <section className="mx-auto max-w-7xl px-4 pb-14 sm:px-6">
        <Card className="relative overflow-hidden p-8 text-center">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(56,189,248,0.14),transparent_60%)]" aria-hidden="true" />
          <h2 className="relative text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
            Idle capacity is a shared resource waiting for a system.
          </h2>
          <p className="relative mx-auto mt-2.5 max-w-xl text-sm text-ink-dim">
            Register as a college, company, community group or individual. One account lets you both borrow and share.
          </p>
          <div className="relative mt-6 flex flex-wrap justify-center gap-3">
            <Link href="/register" className="rounded-xl bg-gradient-to-b from-electric to-electric-deep px-5 py-3 text-sm font-semibold text-navy-950">Create an account</Link>
            <Link href="/marketplace" className="rounded-xl border border-white/16 px-5 py-3 text-sm text-ink">Explore listings</Link>
          </div>
        </Card>
      </section>
    </>
  );
}
