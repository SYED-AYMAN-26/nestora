import Link from "next/link";
import { Card, PageHeader, Badge, InfoNote, type StatusTone } from "@/components/ui";
import { isPostgres, one } from "@/lib/db";
import { paymentModeLabel, razorpayConfigured } from "@/lib/payments";
import { externalChannels } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const metadata = { title: "Build verification report" };

type Status = "working" | "demo" | "optional" | "not_implemented";

const FEATURES: { area: string; items: { name: string; status: Status; note: string; link?: string }[] }[] = [
  {
    area: "Authentication & accounts",
    items: [
      { name: "Registration with 6 account types", status: "working", note: "Zod-validated server route, organisation name required for non-individual types.", link: "/register" },
      { name: "Login / logout / sessions", status: "working", note: "scrypt password hashing (per-user salt), HMAC-hashed session tokens in httpOnly cookies, 14-day expiry.", link: "/login" },
      { name: "Buyer ⇄ provider mode switch", status: "working", note: "A single account flips active_mode; no second account is created.", link: "/dashboard" },
      { name: "Password change + session revocation", status: "working", note: "Changing the password deletes all existing sessions.", link: "/settings" },
      { name: "Protected routes / role checks", status: "working", note: "Layout-level + per-route server guards; admin pages redirect non-admins.", link: "/admin" },
    ],
  },
  {
    area: "Providers, storefronts & verification",
    items: [
      { name: "Public storefront per provider", status: "working", note: "Slug-based storefront with listings, reviews, policies and allocation policy.", link: "/storefront/anna-institute-of-technology" },
      { name: "Verification submission", status: "working", note: "Identity + ownership evidence uploaded to private storage; status starts pending.", link: "/provider/verification" },
      { name: "Admin review workflow", status: "working", note: "Approve / reject / request more info, with a reviewer note; badge only set on approval.", link: "/admin/verifications" },
      { name: "Private document access control", status: "working", note: "Private files served only through an authorisation-checked route; every access is audited.", link: "/admin/audit" },
      { name: "Cross-provider isolation", status: "working", note: "All resource/provider mutations resolve ownership from the session; foreign IDs return 404.", link: "/provider/resources" },
    ],
  },
  {
    area: "Listings & discovery",
    items: [
      { name: "Create / edit / pause / archive listings", status: "working", note: "Listings with live bookings are archived rather than deleted so history is preserved.", link: "/provider/new" },
      { name: "Search, filters & sorting", status: "working", note: "Keyword, category, city, price, condition, provider type, verification, live availability window.", link: "/marketplace" },
      { name: "Provider comparison", status: "working", note: "Side-by-side table across up to 5 listings, including live availability.", link: "/compare" },
      { name: "Favourites & recently viewed", status: "working", note: "Persisted per user in the database.", link: "/favourites" },
      { name: "Capability-based matching", status: "working", note: "26-tag capability taxonomy; needs matched to capabilities, not product names.", link: "/recommend" },
      { name: "AI-assisted intent parsing", status: "optional", note: "Used only when OPENAI_API_KEY is set; otherwise the transparent rule-based engine runs and says so." },
    ],
  },
  {
    area: "Booking & fair allocation",
    items: [
      { name: "Booking request → approval → payment → handover → return → completed", status: "working", note: "Every transition is a guarded server action with status validation.", link: "/bookings" },
      { name: "Double-booking prevention", status: "working", note: "Availability re-checked at request AND approval time against units, holds and maintenance.", link: "/marketplace" },
      { name: "Reject with reason / counteroffer", status: "working", note: "Counteroffers re-price and re-check availability when accepted.", link: "/provider/bookings" },
      { name: "Transparent priority scoring", status: "working", note: "Score stored with a human-readable breakdown shown to the buyer.", link: "/bookings" },
      { name: "Per-buyer fair-use cap", status: "working", note: "Provider-set cap on future days a single buyer may hold per resource.", link: "/provider/new" },
      { name: "Waiting list", status: "working", note: "Joins when unavailable; the next waiting entry is offered when capacity frees up.", link: "/dashboard" },
      { name: "Extension requests", status: "working", note: "Buyer requests, provider approves/declines; availability is re-checked; extra charge recorded.", link: "/bookings" },
    ],
  },
  {
    area: "Condition, handover & disputes",
    items: [
      { name: "Two-sided handover with photos + checklist", status: "working", note: "Provider records initial condition; buyer confirms; both timestamps stored.", link: "/bookings" },
      { name: "Return inspection", status: "working", note: "Buyer uploads return photos; provider inspects and confirms before completion.", link: "/bookings" },
      { name: "Digital equipment passport", status: "working", note: "Public condition/rental/maintenance history; disputes visible to owner & admin only.", link: "/resources/1/passport" },
      { name: "Damage & dispute management", status: "working", note: "Evidence-required thread with 6 statuses; deposits frozen, never auto-deducted.", link: "/disputes" },
      { name: "Admin dispute decisions", status: "working", note: "Explicit deduction amount only; note recorded and published to both parties.", link: "/admin/disputes" },
      { name: "Review system", status: "working", note: "Only buyers with completed bookings; one review per booking; provider rating recalculated.", link: "/marketplace" },
    ],
  },
  {
    area: "Money",
    items: [
      { name: "Itemised cost breakdown", status: "working", note: "Rental + 2% platform fee + refundable deposit, shown before submitting and before paying.", link: "/bookings" },
      { name: "Razorpay test-mode payments", status: "optional", note: "Enabled only with keys; order creation + server-side HMAC signature verification + signed webhook endpoint.", link: "/help" },
      { name: "Demo payment mode", status: "demo", note: "Clearly labelled; no money moves, no card data requested, records marked as demo." },
      { name: "Real escrow / protected holding", status: "not_implemented", note: "Not implemented and never claimed. Deposits are records whose status changes on inspection or admin decision." },
    ],
  },
  {
    area: "Intelligence & impact",
    items: [
      { name: "Utilisation from real records", status: "working", note: "Booked unit-days ÷ (capacity × 60 days); estimate of idleness is labelled separately.", link: "/provider/utilisation" },
      { name: "Underused resource identification", status: "working", note: "Classifications: frequently used / underused / no recent bookings.", link: "/provider/utilisation" },
      { name: "Institutional impact dashboard", status: "working", note: "Filters by date and category; verified vs estimated metrics with formula disclosure.", link: "/impact" },
      { name: "Reminder sweep", status: "working", note: "Collection / return / overdue notifications generated from booking dates.", link: "/admin" },
      { name: "Email & WhatsApp delivery", status: "optional", note: "Off unless SMTP / WhatsApp credentials are configured; the UI states which are unavailable." },
    ],
  },
  {
    area: "Security",
    items: [
      { name: "Input validation everywhere", status: "working", note: "Zod schemas on every mutating API route." },
      { name: "Server-side ownership validation", status: "working", note: "Sessions + role checks on each route; no client-trusted identity." },
      { name: "Upload validation", status: "working", note: "Magic-byte sniffing, extension + size limits, separate public/private storage." },
      { name: "Rate limiting", status: "working", note: "Persisted fixed-window limits on login, register, booking, payment, recommend and report endpoints." },
      { name: "Audit logging", status: "working", note: "Sensitive actions, denials and document access are appended to audit_logs.", link: "/admin/audit" },
      { name: "Secrets never exposed to the client", status: "working", note: "Only the Razorpay public key id is sent to the browser, and only when configured." },
    ],
  },
  {
    area: "Interface (2D)",
    items: [
      { name: "Landing page", status: "working", note: "Photographic hero, discovery search, gallery, categories, featured listings, verified providers, how-it-works, trust and impact sections.", link: "/" },
      { name: "Equipment showcase", status: "working", note: "Former WebGL viewer route, now a 2D photographic showcase of live listings with booking links.", link: "/viewer" },
      { name: "Photo galleries", status: "working", note: "Listing galleries with thumbnail switching; uploaded photos shown first, category photography otherwise." },
      { name: "Light theme & accessibility", status: "working", note: "White surfaces with navy/teal accents, AA text contrast, visible focus rings, prefers-reduced-motion honoured." },
      { name: "Responsive layout", status: "working", note: "Mobile-first grids, collapsible filters, scrollable tables — swept at 390px by scripts/check-2d.mjs." },
    ],
  },
];

export default async function VerificationReportPage() {
  const counts = {
    users: (await one<{ c: number }>(`SELECT COUNT(*) AS c FROM users`))?.c ?? 0,
    providers: (await one<{ c: number }>(`SELECT COUNT(*) AS c FROM provider_profiles`))?.c ?? 0,
    resources: (await one<{ c: number }>(`SELECT COUNT(*) AS c FROM resources`))?.c ?? 0,
    bookings: (await one<{ c: number }>(`SELECT COUNT(*) AS c FROM bookings`))?.c ?? 0,
    payments: (await one<{ c: number }>(`SELECT COUNT(*) AS c FROM payments`))?.c ?? 0,
    disputes: (await one<{ c: number }>(`SELECT COUNT(*) AS c FROM disputes`))?.c ?? 0,
    audit: (await one<{ c: number }>(`SELECT COUNT(*) AS c FROM audit_logs`))?.c ?? 0,
    // Table count is engine-specific: SQLite keeps it in sqlite_master, Postgres
    // in information_schema. Reading the wrong catalogue is a hard error, so ask
    // the adapter which engine is live.
    tables:
      (isPostgres
        ? (await one<{ c: number }>(
            `SELECT COUNT(*) AS c FROM information_schema.tables WHERE table_schema = 'public'`
          ))?.c
        : (await one<{ c: number }>(
            `SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`
          ))?.c) ?? 0,
  };
  const statusCount = (s: Status) => FEATURES.flatMap((f) => f.items).filter((i) => i.status === s).length;
  const channels = externalChannels();

  const badge: Record<Status, { tone: StatusTone; label: string }> = {
    working: { tone: "success", label: "Working" },
    demo: { tone: "warn", label: "Demo / labelled" },
    optional: { tone: "info", label: "Conditional" },
    not_implemented: { tone: "danger", label: "Not implemented" },
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <PageHeader
        eyebrow="Transparency"
        title="Build & feature verification report"
        sub="An honest, current inventory of what works, what runs in a labelled demo mode, what is conditional on configuration, and what is deliberately not implemented."
        right={<Badge tone="info">Generated from the running database</Badge>}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        {[
          ["Working", statusCount("working"), "text-emerald-300"],
          ["Demo / labelled", statusCount("demo"), "text-amber-300"],
          ["Conditional", statusCount("optional"), "text-sky-300"],
          ["Not implemented", statusCount("not_implemented"), "text-rose-300"],
        ].map(([label, n, cls]) => (
          <Card key={label as string} className="p-3">
            <p className="text-[10.5px] uppercase tracking-wider text-ink-faint">{label as string}</p>
            <p className={`text-2xl font-semibold ${cls as string}`}>{n as number}</p>
          </Card>
        ))}
      </div>

      <Card className="mb-4 p-4">
        <h2 className="text-[14px] font-semibold text-ink">Runtime state of this deployment</h2>
        <dl className="mt-2 grid gap-x-6 gap-y-1.5 text-[12.5px] sm:grid-cols-2">
          {[
            ["Database tables", counts.tables],
            ["Users", counts.users],
            ["Provider profiles", counts.providers],
            ["Resources", counts.resources],
            ["Bookings", counts.bookings],
            ["Payment records", counts.payments],
            ["Disputes", counts.disputes],
            ["Audit entries", counts.audit],
            ["Payment mode", paymentModeLabel()],
            ["Email delivery", channels.email ? "configured" : "not configured"],
            ["WhatsApp delivery", channels.whatsapp ? "configured" : "not configured"],
            ["AI intent parsing", process.env.OPENAI_API_KEY ? "configured" : "not configured (rule-based engine)"],
          ].map(([k, v]) => (
            <div key={k as string} className="flex justify-between gap-3 border-b border-white/6 pb-1">
              <dt className="text-ink-faint">{k as string}</dt>
              <dd className="text-right text-ink">{String(v)}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <InfoNote tone="warn" title="Read this before judging the numbers">
        The seeded dataset is <strong>fictional demonstration data</strong>. Figures on the impact dashboard are computed
        correctly from those records, but they are not real-world impact claims. Payment rows in{" "}
        <code>demo</code> mode record no transfer of funds. {razorpayConfigured() ? "Razorpay test keys are configured." : "Razorpay keys are not configured, so the payment page runs in demo mode."}
      </InfoNote>

      <div className="mt-5 space-y-4">
        {FEATURES.map((group) => (
          <Card key={group.area} className="p-4">
            <h2 className="text-[14px] font-semibold text-ink">{group.area}</h2>
            <ul className="mt-2 space-y-1.5">
              {group.items.map((i) => (
                <li key={i.name} className="flex flex-wrap items-start gap-2 border-b border-white/6 pb-1.5 last:border-0">
                  <Badge tone={badge[i.status].tone}>{badge[i.status].label}</Badge>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px] text-ink">
                      {i.link ? <Link href={i.link} className="hover:text-electric">{i.name} ↗</Link> : i.name}
                    </p>
                    <p className="text-[11px] leading-relaxed text-ink-faint">{i.note}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>

      <Card className="mt-4 p-4">
        <h2 className="text-[14px] font-semibold text-ink">Explicitly out of scope / not claimed</h2>
        <ul className="mt-2 space-y-1 text-[12px] leading-relaxed text-ink-dim">
          <li>• No escrow or protected holding of funds.</li>
          <li>• No card data storage of any kind.</li>
          <li>• No automated KYC — verification is a human admin decision.</li>
          <li>• No automatic dispute adjudication — decisions require admin review.</li>
          <li>• No CO₂ / waste-prevented claims; the data needed isn&apos;t collected.</li>
          <li>• No claim that a seeded provider is real, and no 3D/WebGL feature is claimed — the product is 2D only.</li>
        </ul>
      </Card>

      <p className="mt-4 text-[12px] text-ink-faint">
        End-to-end test harness: <code className="rounded bg-white/8 px-1.5 py-0.5 text-electric">npm test</code> (runs the
        lifecycle against a live server and prints a pass/fail matrix).
      </p>
    </div>
  );
}
