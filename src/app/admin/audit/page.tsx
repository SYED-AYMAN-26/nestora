import Link from "next/link";
import { listAudit } from "@/lib/audit";
import { Card, PageHeader, Badge } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Audit log admin" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ entity?: string; action?: string }> }) {
  const sp = await searchParams;
  const rows = await listAudit(300, { entity: sp.entity, action: sp.action });

  return (
    <div className="mx-auto max-w-6xl px-4 py-7 sm:px-6">
      <PageHeader
        title="Audit log"
        sub="Append-only record of sensitive actions: verification decisions, dispute outcomes, listing moderation, document access, payment events, role changes and logins."
      />
      <form action="/admin/audit" className="mb-4 flex flex-wrap gap-2">
        <input name="entity" defaultValue={sp.entity ?? ""} placeholder="Entity (booking, dispute, resource…)" className="rounded-lg border border-white/12 bg-navy-900/70 px-3 py-1.5 text-[12.5px] text-ink outline-none focus:border-electric/50" />
        <input name="action" defaultValue={sp.action ?? ""} placeholder="Action contains…" className="rounded-lg border border-white/12 bg-navy-900/70 px-3 py-1.5 text-[12.5px] text-ink outline-none focus:border-electric/50" />
        <button type="submit" className="rounded-lg bg-gradient-to-b from-electric to-electric-deep px-3 py-1.5 text-[12.5px] font-semibold text-navy-950">Filter</button>
        <Link href="/admin/audit" className="rounded-lg border border-white/14 px-3 py-1.5 text-[12.5px] text-ink-dim hover:text-ink">Reset</Link>
      </form>

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[800px] text-left text-[12px]">
          <thead className="bg-white/4 text-[10px] uppercase tracking-wider text-ink-faint">
            <tr><th className="p-2.5">When</th><th className="p-2.5">Actor</th><th className="p-2.5">Action</th><th className="p-2.5">Entity</th><th className="p-2.5">Detail</th></tr>
          </thead>
          <tbody className="text-ink-dim">
            {rows.map((a) => (
              <tr key={a.id} className="border-t border-white/6">
                <td className="whitespace-nowrap p-2.5 text-[10.5px] text-ink-faint">{fmtDateTime(a.created_at)}</td>
                <td className="p-2.5 text-[11px]">{a.actor_email ?? "system"}</td>
                <td className="p-2.5"><Badge tone={a.action.includes("denied") || a.action.includes("invalid") ? "danger" : a.action.startsWith("admin") ? "warn" : "neutral"}>{a.action}</Badge></td>
                <td className="p-2.5 text-[11px]">{a.entity}{a.entity_id ? ` #${a.entity_id}` : ""}</td>
                <td className="max-w-md truncate p-2.5 text-[10.5px] text-ink-faint" title={a.detail ?? ""}>{a.detail ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p className="mt-2 text-[11px] text-ink-faint">{rows.length} entries (most recent first). Records cannot be edited or deleted from the UI.</p>
    </div>
  );
}
