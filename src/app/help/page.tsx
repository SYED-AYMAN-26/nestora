import Link from "next/link";
import { Card, InfoNote, PageHeader, Badge } from "@/components/ui";

export const metadata = { title: "Help & support" };

const DEMO_LOGINS = [
  ["Buyer (college)", "buyer@student.demo", "Has a completed booking, an active rental, a paid booking awaiting handover and a pending extension."],
  ["Buyer (individual)", "buyer@individual.demo", "Active camera rental plus an open damage dispute on a projector."],
  ["Provider — verified college", "provider@anna.demo", "Pending request, active rental, return inspection, utilisation data."],
  ["Provider — verified university", "provider@bharat.demo", "Studio capacity 1 with a waiting list, a counteroffer case."],
  ["Provider — pending verification", "provider@creators.demo", "Shows the verification-in-progress state."],
  ["Provider — more info needed", "provider@sunrise.demo", "Verification rejected back for ownership evidence."],
  ["Admin", "admin@rentlink.demo", "Verification queue, disputes, listings, users, audit log."],
];

const FLOW = [
  ["1", "Register", "Pick an account type. Anyone can also switch to provider mode from the same account."],
  ["2", "Submit verification", "Provider uploads identity + ownership evidence. Status starts as pending."],
  ["3", "Admin approves", "An administrator reviews the private documents and approves, rejects, or requests more info."],
  ["4", "Create a listing", "Photos, condition, quantity, internal use, prices, capabilities and availability."],
  ["5", "Buyer discovers", "Search, filter, compare, or describe a need and let capability matching work."],
  ["6", "Request a booking", "Dates, units, purpose. The server checks availability, cap and eligibility, then scores priority."],
  ["7", "Provider decides", "Approve, reject with a reason, or propose different dates (counteroffer)."],
  ["8", "Pay", "Demo mode or Razorpay test mode — clearly labelled, and never claimed as escrow."],
  ["9", "Handover", "Provider records initial condition + photos; buyer confirms collection. Rental becomes active."],
  ["10", "Return", "Buyer uploads return photos; provider inspects and confirms. Deposit is released on confirmation."],
  ["11", "Dispute, if needed", "Evidence-based thread; an admin decides. Nothing is deducted automatically."],
  ["12", "History", "The equipment passport and utilisation analytics update from the completed records."],
];

export default function HelpPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <PageHeader
        eyebrow="Help"
        title="How Nestora works"
        sub="A practical walkthrough of the lifecycle, the demo accounts, and exactly what is (and isn't) connected in this build."
      />

      <Card className="p-5">
        <h2 className="text-[15px] font-semibold text-ink">The rental lifecycle, end to end</h2>
        <ol className="mt-3 space-y-2.5">
          {FLOW.map(([n, t, d]) => (
            <li key={n} className="flex gap-3">
              <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border border-electric/35 bg-electric/12 text-[11px] font-semibold text-electric">{n}</span>
              <div>
                <p className="text-[13px] font-medium text-ink">{t}</p>
                <p className="text-[12px] leading-relaxed text-ink-dim">{d}</p>
              </div>
            </li>
          ))}
        </ol>
      </Card>

      <Card className="mt-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[15px] font-semibold text-ink">Demo credentials</h2>
          <Badge tone="warn">Fictional seeded data</Badge>
        </div>
        <p className="mt-1 text-[12px] text-ink-dim">
          Password for every account: <code className="rounded bg-white/8 px-1.5 py-0.5 text-electric">Demo@1234</code>
        </p>
        <table className="mt-3 w-full text-left text-[12px]">
          <thead className="text-[10px] uppercase tracking-wider text-ink-faint"><tr><th className="py-1">Role</th><th className="py-1">Email</th><th className="py-1">What to look at</th></tr></thead>
          <tbody className="text-ink-dim">
            {DEMO_LOGINS.map(([role, email, note]) => (
              <tr key={email} className="border-t border-white/6">
                <td className="py-1.5 pr-2 text-ink">{role}</td>
                <td className="py-1.5 pr-2 font-mono text-[11px] text-electric">{email}</td>
                <td className="py-1.5">{note}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Link href="/login" className="mt-3 inline-block rounded-lg bg-gradient-to-b from-electric to-electric-deep px-3.5 py-2 text-[13px] font-semibold text-navy-950">
          Open sign-in (with quick-fill buttons)
        </Link>
      </Card>

      <Card className="mt-4 p-5">
        <h2 className="text-[15px] font-semibold text-ink">Honest status of each integration</h2>
        <ul className="mt-2 space-y-2 text-[12.5px] leading-relaxed text-ink-dim">
          <li><strong className="text-emerald-300">Working:</strong> accounts, sessions, roles, storefronts, listings, search & filters, availability engine, booking lifecycle, handover, returns, extensions, waiting list, disputes, reviews, utilisation, impact metrics, audit log.</li>
          <li><strong className="text-amber-300">Demo mode:</strong> payments. Without Razorpay keys no money moves; records are labelled demo. With keys, real test orders + server-side signature verification.</li>
          <li><strong className="text-amber-300">Optional:</strong> AI intent parsing (falls back to the transparent rule-based engine), email &amp; WhatsApp delivery (in-app always works).</li>
          <li><strong className="text-amber-300">Illustrative:</strong> 3D models are interactive procedural meshes, not manufacturer CAD. Listings without a model say so.</li>
          <li><strong className="text-rose-300">Not implemented:</strong> real escrow, card storage, KYC automation, automated dispute adjudication.</li>
        </ul>
      </Card>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Card className="p-4">
          <h2 className="text-[13.5px] font-semibold text-ink">Common questions</h2>
          <details className="mt-2 border-b border-white/8 pb-2">
            <summary className="cursor-pointer text-[12.5px] text-ink-dim">Why can&apos;t I book my own listing?</summary>
            <p className="mt-1 text-[12px] leading-relaxed text-ink-faint">Self-booking is blocked server-side so availability and utilisation stay meaningful.</p>
          </details>
          <details className="mt-2 border-b border-white/8 pb-2">
            <summary className="cursor-pointer text-[12.5px] text-ink-dim">Why was my booking request unavailable?</summary>
            <p className="mt-1 text-[12px] leading-relaxed text-ink-faint">The availability engine checks every date against live bookings, provider holds and maintenance. It will tell you which dates failed.</p>
          </details>
          <details className="mt-2 border-b border-white/8 pb-2">
            <summary className="cursor-pointer text-[12.5px] text-ink-dim">How is priority decided?</summary>
            <p className="mt-1 text-[12px] leading-relaxed text-ink-faint">A published policy set by the provider: eligible account types, academic purpose, first-time borrowers and fair rotation. Your booking page shows the exact breakdown.</p>
          </details>
          <details className="mt-2">
            <summary className="cursor-pointer text-[12.5px] text-ink-dim">Is my deposit held safely?</summary>
            <p className="mt-1 text-[12px] leading-relaxed text-ink-faint">No escrow is implemented. Deposits are recorded, and their status changes only through inspection and, if needed, an admin-reviewed dispute.</p>
          </details>
        </Card>
        <div className="space-y-4">
          <InfoNote tone="info" title="Need something specific?">
            Use the secure message thread on any booking for booking-level questions. For account, verification or dispute
            questions, an admin can be reached through the dispute thread.
          </InfoNote>
          <Card className="p-4">
            <h2 className="text-[13.5px] font-semibold text-ink">Quick links</h2>
            <div className="mt-2 grid grid-cols-1 gap-1.5 text-[12.5px]">
              {[
                ["/marketplace", "Browse the marketplace"],
                ["/recommend", "Describe what you need"],
                ["/impact", "Institutional impact dashboard"],
                ["/provider/utilisation", "Utilisation insights"],
                ["/verification-report", "Build verification report"],
              ].map(([href, label]) => (
                <Link key={href} href={href} className="rounded-lg border border-white/10 bg-white/3 px-2.5 py-1.5 text-ink-dim hover:border-electric/35 hover:text-ink">{label}</Link>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
