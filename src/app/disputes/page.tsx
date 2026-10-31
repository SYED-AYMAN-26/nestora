import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { all, jsonParse, Row } from "@/lib/db";
import { Badge, Card, EmptyState, PageHeader, statusTone, money } from "@/components/ui";
import { DISPUTE_STATUS_LABEL } from "@/lib/constants";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Disputes" };

export default async function DisputesPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/disputes");

  const items = await all<Row>(
    `SELECT d.*, b.code, b.status AS booking_status, r.title AS resource_title,
            u.full_name AS raised_by_name, p.display_name AS provider_name
       FROM disputes d
       JOIN bookings b ON b.id = d.booking_id
       JOIN resources r ON r.id = b.resource_id
       JOIN users u ON u.id = d.raised_by
       JOIN provider_profiles p ON p.id = b.provider_id
      WHERE b.buyer_id = ? OR b.provider_id = ? OR ? = 1
      ORDER BY d.created_at DESC`,
    user.id, user.provider?.id ?? -1, user.role === "admin" ? 1 : 0
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <PageHeader
        title="Disputes"
        sub="Damage, missing equipment and late-return reports. A dispute freezes the deposit for review; an administrator decides each case on the evidence, and no deduction happens automatically."
      />
      {items.length === 0 ? (
        <EmptyState
          title="No disputes"
          body="If something goes wrong with a rental, open a dispute from the booking page. Evidence (photos or documents) is required."
          action={<Link href="/bookings" className="rounded-lg bg-electric px-3 py-1.5 text-[12.5px] font-medium text-navy-950">Go to my bookings</Link>}
        />
      ) : (
        <div className="space-y-2.5">
          {items.map((d) => {
            const evidence = jsonParse<string[]>(d.evidence, []);
            return (
              <Card key={d.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/disputes/${d.id}`} className="text-[14px] font-semibold text-ink hover:text-electric">
                        {d.kind} · {d.resource_title}
                      </Link>
                      <Badge tone={statusTone(d.status)}>{DISPUTE_STATUS_LABEL[d.status] ?? d.status}</Badge>
                      <span className="font-mono text-[10.5px] text-ink-faint">{d.code}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-[12.5px] text-ink-dim">{d.description}</p>
                    <p className="mt-1 text-[11px] text-ink-faint">
                      Raised by {d.raised_by_name} · {fmtDate(d.created_at)} · {evidence.length} evidence item(s)
                      {d.claim_amount ? ` · claim ${money(d.claim_amount)}` : ""}
                    </p>
                  </div>
                  <Link href={`/disputes/${d.id}`} className="rounded-lg border border-white/14 px-2.5 py-1.5 text-[11.5px] text-ink hover:border-electric/40">
                    Open thread
                  </Link>
                </div>
                {d.decision && (
                  <p className="mt-2 rounded-lg border border-white/10 bg-white/3 px-2.5 py-1.5 text-[11.5px] text-ink-dim">
                    <strong className="text-ink">Admin decision:</strong> {d.decision}
                    {d.deduction_amount > 0 ? ` · deduction ${money(d.deduction_amount)}` : " · no deduction"}
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
