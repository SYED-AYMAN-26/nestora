import Link from "next/link";
import { all, one, Row } from "@/lib/db";
import { listAudit } from "@/lib/audit";
import { Badge, Card, InfoNote, PageHeader, Stat, statusTone, money } from "@/components/ui";
import { BOOKING_STATUS_LABEL } from "@/lib/constants";
import { fmtDateTime } from "@/lib/format";
import { SweepButton } from "./SweepButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin overview — RentLink 3D" };

export default async function AdminHome() {
  const counts = {
    users: (await one<{ c: number }>(`SELECT COUNT(*) AS c FROM users`))?.c ?? 0,
    providers: (await one<{ c: number }>(`SELECT COUNT(*) AS c FROM provider_profiles`))?.c ?? 0,
    verified: (await one<{ c: number }>(`SELECT COUNT(*) AS c FROM provider_profiles WHERE verification_status='verified'`))?.c ?? 0,
    pendingVerifications: (await one<{ c: number }>(`SELECT COUNT(*) AS c FROM verification_requests WHERE status='pending'`))?.c ?? 0,
    resources: (await one<{ c: number }>(`SELECT COUNT(*) AS c FROM resources`))?.c ?? 0,
    activeResources: (await one<{ c: number }>(`SELECT COUNT(*) AS c FROM resources WHERE status='active'`))?.c ?? 0,
    bookings: (await one<{ c: number }>(`SELECT COUNT(*) AS c FROM bookings`))?.c ?? 0,
    pendingBookings: (await one<{ c: number }>(`SELECT COUNT(*) AS c FROM bookings WHERE status='pending'`))?.c ?? 0,
    activeRentals: (await one<{ c: number }>(`SELECT COUNT(*) AS c FROM bookings WHERE status='active'`))?.c ?? 0,
    openDisputes: (await one<{ c: number }>(`SELECT COUNT(*) AS c FROM disputes WHERE status IN ('open','evidence_requested','under_review')`))?.c ?? 0,
    openReports: (await one<{ c: number }>(`SELECT COUNT(*) AS c FROM reports WHERE status='open'`))?.c ?? 0,
    paid: (await one<{ c: number }>(`SELECT COUNT(*) AS c FROM payments WHERE status='paid'`))?.c ?? 0,
  };

  const recentBookings = await all<Row>(
    `SELECT b.id, b.code, b.status, b.start_date, b.end_date, b.total, b.created_at,
            r.title AS resource_title, p.display_name AS provider_name, u.full_name AS buyer_name
       FROM bookings b JOIN resources r ON r.id = b.resource_id JOIN provider_profiles p ON p.id = b.provider_id
       JOIN users u ON u.id = b.buyer_id ORDER BY b.created_at DESC LIMIT 10`
  );
  const payments = await all<Row>(`SELECT pay.*, b.code FROM payments pay JOIN bookings b ON b.id = pay.booking_id ORDER BY pay.id DESC LIMIT 8`);
  const audit = await listAudit(12);

  return (
    <div className="mx-auto max-w-7xl px-4 py-7 sm:px-6">
      <PageHeader
        title="Platform overview"
        sub="Verification queue, disputes, listings, payments and the audit trail."
        right={<SweepButton />}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Users" value={counts.users} hint={`${counts.providers} providers · ${counts.verified} verified`} />
        <Stat label="Verification queue" value={counts.pendingVerifications} tone={counts.pendingVerifications ? "warn" : "default"} hint="Awaiting admin review" />
        <Stat label="Listings" value={`${counts.activeResources} / ${counts.resources}`} hint="Active / total" />
        <Stat label="Bookings" value={counts.bookings} hint={`${counts.pendingBookings} pending · ${counts.activeRentals} active`} />
        <Stat label="Open disputes" value={counts.openDisputes} tone={counts.openDisputes ? "warn" : "default"} hint="Needs a decision" />
        <Stat label="Open reports" value={counts.openReports} tone={counts.openReports ? "warn" : "default"} hint="Reported listings" />
        <Stat label="Paid payment records" value={counts.paid} hint="Includes demo-mode payments" />
        <Stat label="Deposits" value={(await one<{ c: number }>(`SELECT COUNT(*) AS c FROM deposits`))?.c ?? 0} hint="Recorded deposit rows" />
      </div>

      <div className="mt-4">
        <InfoNote tone="warn" title="Demo dataset + demo payments">
          This deployment is seeded with fictional demonstration records. Payment rows marked <code>demo</code> represent
          no transfer of funds. Dispute decisions and verification approvals are recorded against your admin account in
          the audit log.
        </InfoNote>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-[14px] font-semibold text-ink">Recent bookings</h2>
            <Link href="/admin/resources" className="text-[12px] text-electric hover:underline">Listings →</Link>
          </div>
          <table className="w-full text-left text-[12px]">
            <thead className="text-[10px] uppercase tracking-wider text-ink-faint"><tr><th className="py-1">Code</th><th className="py-1">Resource</th><th className="py-1">Buyer</th><th className="py-1">Status</th></tr></thead>
            <tbody className="text-ink-dim">
              {recentBookings.map((b) => (
                <tr key={b.id} className="border-t border-white/6">
                  <td className="py-1.5"><Link href={`/bookings/${b.id}`} className="font-mono text-[10.5px] text-electric hover:underline">{b.code}</Link></td>
                  <td className="max-w-36 truncate py-1.5">{b.resource_title}</td>
                  <td className="py-1.5">{b.buyer_name}</td>
                  <td className="py-1.5"><Badge tone={statusTone(b.status)}>{BOOKING_STATUS_LABEL[b.status] ?? b.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card className="p-4">
          <h2 className="mb-2 text-[14px] font-semibold text-ink">Recent payment records</h2>
          <table className="w-full text-left text-[12px]">
            <thead className="text-[10px] uppercase tracking-wider text-ink-faint"><tr><th className="py-1">Booking</th><th className="py-1">Kind</th><th className="py-1">Amount</th><th className="py-1">Mode</th><th className="py-1">Status</th></tr></thead>
            <tbody className="text-ink-dim">
              {payments.map((p) => (
                <tr key={p.id} className="border-t border-white/6">
                  <td className="py-1.5 font-mono text-[10.5px] text-electric">{p.code}</td>
                  <td className="py-1.5 capitalize">{p.kind}</td>
                  <td className="py-1.5">{money(p.amount)}</td>
                  <td className="py-1.5">{p.mode === "demo" ? "Demo" : "Razorpay"}</td>
                  <td className="py-1.5"><Badge tone={statusTone(p.status)}>{p.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[10.5px] text-ink-faint">Refunds: none generated in this build beyond deposit release records.</p>
        </Card>
      </div>

      <Card className="mt-4 p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-[14px] font-semibold text-ink">Latest audit entries</h2>
          <Link href="/admin/audit" className="text-[12px] text-electric hover:underline">Full log →</Link>
        </div>
        <ul className="space-y-1 text-[12px]">
          {audit.map((a) => (
            <li key={a.id} className="flex flex-wrap items-baseline gap-2 border-b border-white/6 pb-1">
              <span className="font-mono text-[10.5px] text-electric">{a.action}</span>
              <span className="text-ink-dim">{a.entity}{a.entity_id ? ` #${a.entity_id}` : ""}</span>
              <span className="text-ink-faint">{a.actor_email ?? "system"}</span>
              <span className="ml-auto text-[10.5px] text-ink-faint">{fmtDateTime(a.created_at)}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
