import Link from "next/link";
import { all, jsonParse, Row } from "@/lib/db";
import { Badge, Card, EmptyState, PageHeader, money } from "@/components/ui";
import { DISPUTE_STATUS_LABEL } from "@/lib/constants";
import { fmtDateTime } from "@/lib/format";
import { DisputeDecision } from "./DisputeDecision";

export const dynamic = "force-dynamic";
export const metadata = { title: "Disputes — RentLink admin" };

export default async function AdminDisputes({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const sp = await searchParams;
  const status = sp.status || "open_all";
  const where = status === "open_all" ? "WHERE d.status IN ('open','evidence_requested','under_review')" : status === "all" ? "" : "WHERE d.status = ?";
  const items = await all<Row>(
    `SELECT d.*, b.code AS booking_code, b.buyer_id, b.provider_id, b.deposit, r.title AS resource_title, r.id AS resource_id,
            u.full_name AS raised_by_name, p.display_name AS provider_name, bu.full_name AS buyer_name
       FROM disputes d JOIN bookings b ON b.id = d.booking_id JOIN resources r ON r.id = b.resource_id
       JOIN users u ON u.id = d.raised_by JOIN provider_profiles p ON p.id = b.provider_id
       JOIN users bu ON bu.id = b.buyer_id
       ${where} ORDER BY d.created_at DESC`,
    ...(where.includes("?") ? [status] : [])
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-7 sm:px-6">
      <PageHeader
        title="Dispute management"
        sub="Review evidence from both parties and record a reasoned decision. A deduction is only applied when you explicitly set an amount — never automatically."
      />
      <div className="mb-4 flex flex-wrap gap-1.5">
        {[["open_all", "Open queue"], ["under_review", "Under review"], ["evidence_requested", "Evidence requested"], ["resolved", "Resolved"], ["rejected", "Rejected"], ["all", "All"]].map(([k, l]) => (
          <Link key={k} href={`/admin/disputes?status=${k}`} className={`rounded-full border px-3 py-1.5 text-[12px] ${status === k ? "border-electric/50 bg-electric/12 text-electric" : "border-white/12 text-ink-dim hover:border-white/25"}`}>{l}</Link>
        ))}
      </div>

      {items.length === 0 ? (
        <EmptyState title="No disputes in this view" body="Nothing needs a decision right now." />
      ) : (
        <div className="space-y-3">
          {items.map((d) => {
            const evidence = jsonParse<string[]>(d.evidence, []);
            return (
              <Card key={d.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[14px] font-semibold capitalize text-ink">{d.kind.replace(/_/g, " ")} — {d.resource_title}</p>
                      <Badge tone={d.status === "resolved" ? "success" : d.status === "rejected" ? "danger" : "warn"}>{DISPUTE_STATUS_LABEL[d.status] ?? d.status}</Badge>
                      <Link href={`/bookings/${d.booking_id}`} className="font-mono text-[10.5px] text-electric hover:underline">{d.booking_code}</Link>
                      <Link href={`/disputes/${d.id}`} className="text-[11px] text-electric hover:underline">Thread ↗</Link>
                    </div>
                    <p className="mt-1 text-[12px] text-ink-dim">
                      Raised by {d.raised_by_name} · buyer {d.buyer_name} · provider {d.provider_name} · deposit {money(d.deposit)}
                    </p>
                    <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-ink-dim">{d.description}</p>
                    <p className="mt-1 text-[11.5px] text-ink-faint">Claimed: {money(d.claim_amount)} · opened {fmtDateTime(d.created_at)}</p>
                    {evidence.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {evidence.map((e) => (
                          <a key={e} href={e} target="_blank" rel="noopener noreferrer" className="rounded border border-white/12 p-0.5">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={e} alt="Evidence" className="h-16 w-24 rounded object-cover" />
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                {["open", "evidence_requested", "under_review"].includes(d.status) ? (
                  <div className="mt-3 border-t border-white/8 pt-3">
                    <DisputeDecision disputeId={d.id} claimAmount={Number(d.claim_amount)} deposit={Number(d.deposit)} />
                  </div>
                ) : (
                  <p className="mt-2 rounded-lg border border-white/10 bg-white/3 px-2.5 py-1.5 text-[11.5px] text-ink-dim">
                    <strong className="text-ink">Decision:</strong> {d.decision || "—"} · deduction {money(d.deduction_amount)}
                  </p>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
