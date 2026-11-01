import Link from "next/link";
import { ResourceCard } from "@/components/ResourceCard";
import { Reveal, CountUp } from "@/components/motion";
import { DemoTag, Stars, VerifiedBadge } from "@/components/ui";
import { searchResources } from "@/lib/resources";
import { computeImpact } from "@/lib/impact";
import { CATEGORIES } from "@/lib/constants";
import { GALLERY, categoryPhoto } from "@/lib/photos";
import { all, Row } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Category slug -> photograph, used by the category tiles. */
const CATEGORY_PHOTO: Record<string, string> = {
  "cameras-photography": categoryPhoto("cameras-photography"),
  "audio-visual": categoryPhoto("audio-visual"),
  computing: categoryPhoto("computing"),
  "robotics-electronics": categoryPhoto("robotics-electronics"),
  "lab-equipment": categoryPhoto("lab-equipment"),
  "3d-printing": categoryPhoto("3d-printing"),
  "spaces-rooms": categoryPhoto("spaces-rooms"),
  "event-equipment": categoryPhoto("event-equipment"),
  "vehicles-transport": categoryPhoto("vehicles-transport"),
  "tools-workshop": categoryPhoto("tools-workshop"),
};

const HOW_IT_WORKS = [
  {
    n: "1",
    t: "Search or describe what you need",
    d: "Filter by category, city, price, condition and availability — or describe the job and let capability matching find it.",
  },
  {
    n: "2",
    t: "Request the dates",
    d: "Send a booking request with your dates and purpose. The provider approves, declines with a reason, or offers different dates.",
  },
  {
    n: "3",
    t: "Pay and collect",
    d: "Payment runs through the platform, then both sides sign a condition checklist with photos at handover.",
  },
  {
    n: "4",
    t: "Return and close",
    d: "Submit return photos, the provider inspects, and the deposit is released. Disputes stay on record if anything goes wrong.",
  },
];

const TRUST = [
  {
    t: "Verified providers only get a badge",
    d: "A provider submits identity and ownership evidence. The badge appears after an admin reviews and approves it — never on self-declaration.",
  },
  {
    t: "Condition passports",
    d: "Every handover and return records a checklist and photos against the booking, so damage claims are argued from evidence, not memory.",
  },
  {
    t: "Fair allocation, in the open",
    d: "Priority scoring, per-buyer booking caps, waiting lists and double-booking prevention are all computed from stored records.",
  },
  {
    t: "Deposits and disputes on-record",
    d: "Deposits are tracked per booking and released, partly released or deducted with an audited reason. Every step lands in the audit log.",
  },
];

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
      {/* ------------------------------------------------------------- 1. hero */}
      <section className="relative overflow-hidden border-b border-white/8 bg-gradient-to-b from-navy-900 to-white">
        <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 pb-14 pt-12 sm:px-6 lg:grid-cols-[minmax(0,1.02fr)_minmax(0,1fr)] lg:pb-20 lg:pt-16">
          <div className="fade-up">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-electric/25 bg-white px-3 py-1 text-[11.5px] font-medium text-electric shadow-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-[--accent-2]" />
              Verified sharing for institutions &amp; communities
            </div>
            <h1 className="text-[34px] font-semibold leading-[1.08] tracking-tight text-ink sm:text-5xl lg:text-[52px]">
              Find the space and equipment
              <br />
              <span className="gradient-text">already near you.</span>
            </h1>
            <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-ink-dim">
              Colleges, companies and community groups hold halls, studios, labs and kit that sit idle most of the
              year. Nestora makes that capacity visible, bookable and accountable — with verified providers, real
              availability and a condition record at every handover.
            </p>

            {/* -------------------------------------------- discovery / search */}
            <form
              action="/marketplace"
              method="get"
              className="mt-7 rounded-2xl border border-white/14 bg-white p-2 shadow-[0_2px_6px_rgba(12,27,42,0.05),0_18px_40px_-28px_rgba(12,27,42,0.4)]"
              role="search"
              aria-label="Search the marketplace"
            >
              <div className="flex flex-col gap-2 sm:flex-row">
                <label htmlFor="hero-q" className="sr-only">
                  What do you need?
                </label>
                <input
                  id="hero-q"
                  name="q"
                  type="search"
                  placeholder="Camera, seminar hall, 3D printer…"
                  className="min-w-0 flex-1 rounded-xl border border-transparent bg-navy-850 px-3.5 py-2.5 text-[14px] text-ink placeholder:text-ink-faint focus:border-electric/40 focus:bg-white focus:outline-none"
                />
                <label htmlFor="hero-category" className="sr-only">
                  Category
                </label>
                <select
                  id="hero-category"
                  name="category"
                  defaultValue=""
                  className="rounded-xl border border-white/14 bg-white px-3 py-2.5 text-[13.5px] text-ink-dim focus:border-electric/40 focus:outline-none sm:w-44"
                >
                  <option value="">All categories</option>
                  {CATEGORIES.map((c) => (
                    <option key={c.slug} value={c.slug}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="rounded-xl bg-electric px-5 py-2.5 text-[14px] font-semibold text-white shadow-[0_8px_20px_-10px_rgba(15,118,110,0.75)] transition hover:bg-electric-deep"
                >
                  Search
                </button>
              </div>
            </form>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Link
                href="/marketplace"
                className="rounded-xl bg-electric px-5 py-3 text-sm font-semibold text-white shadow-[0_10px_26px_-14px_rgba(15,118,110,0.85)] transition hover:bg-electric-deep"
              >
                Browse marketplace
              </Link>
              <Link
                href={user ? "/provider/new" : "/register"}
                className="rounded-xl border border-white/16 bg-white px-5 py-3 text-sm font-medium text-ink transition hover:border-electric/45 hover:bg-navy-850"
              >
                {user ? "List a resource" : "Create account"}
              </Link>
              <Link href="/recommend" className="text-[13px] font-medium text-electric hover:underline">
                Or describe what you need →
              </Link>
            </div>

            <dl className="mt-8 grid max-w-lg grid-cols-3 gap-3">
              {[
                { k: "Resources listed", v: impact.verified.resources_listed },
                { k: "Bookings completed", v: impact.verified.bookings_completed },
                { k: "Providers verified", v: impact.verified.providers_verified },
              ].map((s) => (
                <div key={s.k} className="rounded-xl border border-white/12 bg-white px-3 py-2.5 shadow-sm">
                  <dd className="text-xl font-semibold tabular-nums text-ink">
                    <CountUp to={s.v} />
                  </dd>
                  <dt className="mt-0.5 text-[10.5px] uppercase tracking-wider text-ink-faint">{s.k}</dt>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
              Figures come from this deployment&apos;s database, currently seeded with labelled demo records —{" "}
              <Link href="/impact" className="text-electric hover:underline">
                see the impact dashboard
              </Link>{" "}
              for exact provenance.
            </p>
          </div>

          {/* ------------------------------------------------- hero photograph */}
          <div className="relative">
            <div className="overflow-hidden rounded-3xl border border-white/14 bg-white shadow-[0_24px_60px_-32px_rgba(12,27,42,0.45)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/img/photos/hero.jpg"
                alt="A shared equipment store: camera on a tripod, projector, microphone and 3D printer on a light oak bench"
                width={1408}
                height={768}
                className="h-[300px] w-full object-cover sm:h-[380px] lg:h-[440px]"
                fetchPriority="high"
              />
              <div className="flex items-center justify-between gap-3 border-t border-white/8 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-[12.5px] font-medium text-ink">Shared equipment library</p>
                  <p className="truncate text-[11px] text-ink-faint">Cameras · audio · fabrication · rooms</p>
                </div>
                <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-wider text-emerald-700 ring-1 ring-emerald-200">
                  Verified providers
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------- 2. gallery */}
      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6" aria-labelledby="gallery-heading">
        <Reveal>
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-electric">Explore</p>
              <h2 id="gallery-heading" className="text-2xl font-semibold tracking-tight text-ink">
                What is available to borrow
              </h2>
              <p className="mt-1.5 max-w-2xl text-sm text-ink-dim">
                Photos from the categories institutions actually list, each linking straight into filtered results.
              </p>
            </div>
            <Link href="/marketplace" className="text-[13px] font-medium text-electric hover:underline">
              See everything →
            </Link>
          </div>

          <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
            {GALLERY.map((g, i) => (
              <Link
                key={g.src}
                href={g.href}
                className={`group relative overflow-hidden rounded-2xl border border-white/12 bg-navy-850 shadow-sm transition hover:shadow-lg ${
                  i === 0 ? "sm:col-span-2 lg:col-span-2" : ""
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={g.src}
                  alt={g.alt}
                  width={1408}
                  height={768}
                  loading={i < 2 ? "eager" : "lazy"}
                  decoding="async"
                  className={`w-full object-cover transition duration-500 group-hover:scale-[1.03] ${
                    i === 0 ? "h-56 lg:h-[268px]" : "h-44"
                  }`}
                />
                <div className="absolute inset-x-0 bottom-0 flex items-end bg-gradient-to-t from-[#0b1622]/80 via-[#0b1622]/25 to-transparent p-3.5">
                  <span className="text-[13px] font-semibold text-white drop-shadow">{g.caption}</span>
                </div>
              </Link>
            ))}
          </div>
        </Reveal>
      </section>

      {/* ----------------------------------------------------- 3. categories */}
      <section className="border-y border-white/8 bg-navy-900/60" aria-labelledby="categories-heading">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
          <Reveal>
            <div className="mb-5">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-electric">
                Popular categories
              </p>
              <h2 id="categories-heading" className="text-2xl font-semibold tracking-tight text-ink">
                Browse by what you need
              </h2>
              <p className="mt-1.5 text-sm text-ink-dim">
                Ten categories spanning media, labs, fabrication, spaces and transport.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {CATEGORIES.map((c) => (
                <Link
                  key={c.slug}
                  href={`/marketplace?category=${c.slug}`}
                  className="group overflow-hidden rounded-xl border border-white/12 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-electric/40 hover:shadow-md"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={CATEGORY_PHOTO[c.slug] ?? categoryPhoto(c.slug)}
                    alt=""
                    width={1408}
                    height={768}
                    loading="lazy"
                    decoding="async"
                    className="h-24 w-full object-cover transition duration-500 group-hover:brightness-105"
                  />
                  <div className="p-3">
                    <p className="truncate text-[13px] font-semibold text-ink">{c.name}</p>
                    <p className="mt-0.5 text-[11px] text-ink-faint">{c.subcategories.length} subcategories</p>
                  </div>
                </Link>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ------------------------------------------------------- 4. featured */}
      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6" aria-labelledby="featured-heading">
        <Reveal>
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-electric">Featured</p>
              <h2 id="featured-heading" className="text-2xl font-semibold tracking-tight text-ink">
                Top-rated listings right now
              </h2>
              <p className="mt-1.5 text-sm text-ink-dim">
                Live records from the database — <DemoTag label="DEMO DATA" /> rows are fictional demo providers.
              </p>
            </div>
            <Link href="/marketplace" className="text-[13px] font-medium text-electric hover:underline">
              Browse all listings →
            </Link>
          </div>
          {featured.length === 0 ? (
            <div className="rounded-2xl border border-white/12 bg-white px-6 py-10 text-center text-sm text-ink-dim">
              No live listings yet.{" "}
              <Link href="/provider/new" className="text-electric hover:underline">
                List the first resource
              </Link>
              .
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {featured.map((r) => (
                <ResourceCard key={r.id} r={r} />
              ))}
            </div>
          )}
        </Reveal>
      </section>

      {/* ---------------------------------------------- 5. verified providers */}
      <section className="border-y border-white/8 bg-navy-900/60" aria-labelledby="providers-heading">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
          <Reveal>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
              <div className="min-w-0 rounded-2xl border border-white/12 bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-electric">
                      Verified providers
                    </p>
                    <h2 id="providers-heading" className="text-xl font-semibold tracking-tight text-ink">
                      Storefronts that passed review
                    </h2>
                  </div>
                  <VerifiedBadge status="verified" />
                </div>
                <div className="space-y-2">
                  {topProviders.length === 0 && (
                    <p className="rounded-lg bg-navy-850 px-3 py-4 text-[13px] text-ink-dim">
                      No verified providers yet.{" "}
                      <Link href="/provider/verification" className="text-electric hover:underline">
                        Start a verification
                      </Link>
                      .
                    </p>
                  )}
                  {topProviders.map((p) => (
                    <Link
                      key={p.id}
                      href={`/storefront/${p.storefront_slug}`}
                      className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-navy-850 px-3 py-2.5 transition hover:border-electric/40 hover:bg-white"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[13.5px] font-medium text-ink">{p.display_name}</p>
                        <p className="truncate text-[11.5px] text-ink-faint">
                          {p.resources} listing(s) · {String(p.org_type).replace(/_/g, " ")}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Stars rating={Number(p.rating_cached || 0)} count={Number(p.rating_count || 0)} />
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
                          ✓ Verified
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
                <Link href="/marketplace?verified=1" className="mt-4 inline-block text-[12.5px] font-medium text-electric hover:underline">
                  Browse verified listings only →
                </Link>
              </div>

              <div className="min-w-0 rounded-2xl border border-white/12 bg-white p-5 shadow-sm">
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-electric">Try it</p>
                <h2 className="text-xl font-semibold tracking-tight text-ink">Sign in with a demo account</h2>
                <p className="mt-1.5 text-[13px] leading-relaxed text-ink-dim">
                  Every demo account uses the password{" "}
                  <code className="rounded bg-navy-850 px-1.5 py-0.5 font-mono text-[12px] text-electric">Demo@1234</code>.
                  These are seeded test accounts, not real people or institutions.
                </p>
                <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {[
                    { r: "Buyer", e: "buyer@student.demo", d: "Book, pay, hand over, return" },
                    { r: "Provider", e: "provider@anna.demo", d: "Approve, inspect, analyse utilisation" },
                    { r: "Unverified provider", e: "provider@creators.demo", d: "See the verification flow" },
                    { r: "Admin", e: "admin@rentlink.demo", d: "Verify, resolve disputes, audit" },
                  ].map((a) => (
                    <div key={a.e} className="min-w-0 rounded-lg border border-white/10 bg-navy-850 px-3 py-2.5">
                      <p className="text-[12px] font-semibold text-ink">{a.r}</p>
                      <p className="mt-0.5 truncate font-mono text-[11px] text-electric">{a.e}</p>
                      <p className="mt-0.5 text-[10.5px] text-ink-faint">{a.d}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Link href="/login" className="rounded-lg bg-electric px-3.5 py-2 text-[13px] font-semibold text-white transition hover:bg-electric-deep">
                    Sign in
                  </Link>
                  <Link href="/help" className="rounded-lg border border-white/16 px-3.5 py-2 text-[13px] text-ink transition hover:border-electric/45">
                    Demo walkthrough
                  </Link>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* --------------------------------------------------- 6. how it works */}
      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6" aria-labelledby="how-heading">
        <Reveal>
          <div className="mb-6 max-w-2xl">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-electric">How it works</p>
            <h2 id="how-heading" className="text-2xl font-semibold tracking-tight text-ink">
              From search to signed return, in four steps
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-dim">
              Every step below runs against the database — verification, availability, fair allocation, payment,
              condition capture, return inspection, disputes and utilisation analytics.
            </p>
          </div>
          <ol className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
            {HOW_IT_WORKS.map((s) => (
              <li key={s.n} className="relative rounded-2xl border border-white/12 bg-white p-5 shadow-sm">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-electric/10 text-[13px] font-bold text-electric ring-1 ring-electric/20">
                  {s.n}
                </span>
                <h3 className="mt-3 text-[14.5px] font-semibold text-ink">{s.t}</h3>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-dim">{s.d}</p>
              </li>
            ))}
          </ol>
          <div className="mt-4 flex flex-wrap gap-3 text-[12.5px]">
            <Link href="/marketplace" className="rounded-lg bg-electric px-3.5 py-2 font-semibold text-white transition hover:bg-electric-deep">
              Start browsing
            </Link>
            <Link href="/provider/new" className="rounded-lg border border-white/16 bg-white px-3.5 py-2 text-ink transition hover:border-electric/45">
              List something you own
            </Link>
            <Link href="/verification-report" className="rounded-lg px-1 py-2 text-electric hover:underline">
              What is verified working →
            </Link>
          </div>
        </Reveal>
      </section>

      {/* --------------------------------------------------- 7. trust & safety */}
      <section className="border-y border-white/8 bg-navy-900/60" aria-labelledby="trust-heading">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
          <Reveal>
            <div className="grid gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:items-center">
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-electric">
                  Trust &amp; safety
                </p>
                <h2 id="trust-heading" className="text-2xl font-semibold tracking-tight text-ink">
                  Sharing only works when it is accountable
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-ink-dim">
                  Informal lending between departments breaks down for four predictable reasons. Nestora handles each
                  in the product, not in a policy PDF.
                </p>
              </div>
              <ul className="grid gap-3 sm:grid-cols-2">
                {TRUST.map((t) => (
                  <li key={t.t} className="rounded-xl border border-white/12 bg-white p-4 shadow-sm">
                    <h3 className="text-[13.5px] font-semibold text-ink">{t.t}</h3>
                    <p className="mt-1 text-[12.5px] leading-relaxed text-ink-dim">{t.d}</p>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ------------------------------------------------------- 8. impact */}
      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6" aria-labelledby="impact-heading">
        <Reveal>
          <div className="rounded-2xl border border-white/12 bg-white p-6 shadow-sm sm:p-8">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-electric">
                  Measured impact
                </p>
                <h2 id="impact-heading" className="text-2xl font-semibold tracking-tight text-ink">
                  Capacity that stopped sitting idle
                </h2>
                <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-dim">
                  Confirmed figures are counted from records; estimates are labelled as estimates and never mixed in.
                </p>
              </div>
              <Link href="/impact" className="text-[13px] font-medium text-electric hover:underline">
                Open the impact dashboard →
              </Link>
            </div>
            <dl className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
              {[
                { k: "Resources listed", v: impact.verified.resources_listed, h: "Confirmed in the database" },
                { k: "Bookings completed", v: impact.verified.bookings_completed, h: "Completed rentals only" },
                { k: "Providers verified", v: impact.verified.providers_verified, h: "Admin-approved submissions" },
                { k: "Idle units identified", v: impact.estimated.idle_units_identified, h: "Estimate — needs confirmation" },
              ].map((s) => (
                <div key={s.k} className="rounded-xl border border-white/10 bg-navy-850 px-4 py-3.5">
                  <dd className="text-2xl font-semibold tabular-nums tracking-tight text-ink">
                    <CountUp to={s.v} />
                  </dd>
                  <dt className="mt-1 text-[11px] font-medium uppercase tracking-[0.12em] text-ink-faint">{s.k}</dt>
                  <p className="mt-1 text-[11px] leading-snug text-ink-faint">{s.h}</p>
                </div>
              ))}
            </dl>
          </div>
        </Reveal>
      </section>

      {/* ------------------------------------------------- 9. closing CTA */}
      <section className="mx-auto max-w-7xl px-4 pb-4 sm:px-6">
        <div className="relative overflow-hidden rounded-2xl bg-charcoal px-6 py-10 text-center sm:px-10">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(94,234,212,0.16),transparent_62%)]" aria-hidden="true" />
          <h2 className="relative text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Idle capacity is a shared resource waiting for a system.
          </h2>
          <p className="relative mx-auto mt-2.5 max-w-xl text-sm leading-relaxed text-white/70">
            Register as a college, company, community group or individual. One account lets you both borrow and share.
          </p>
          <div className="relative mt-6 flex flex-wrap justify-center gap-3">
            <Link href="/register" className="rounded-xl bg-white px-5 py-3 text-sm font-semibold text-charcoal transition hover:bg-white/90">
              Create account
            </Link>
            <Link href="/marketplace" className="rounded-xl border border-white/25 px-5 py-3 text-sm font-medium text-white transition hover:bg-white/10">
              Browse marketplace
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
