import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { all, jsonParse, one, Row } from "@/lib/db";
import { Badge, Card, PageHeader, statusTone, money } from "@/components/ui";
import { DISPUTE_STATUS_LABEL } from "@/lib/constants";
import { fmtDateTime } from "@/lib/format";
import { DisputeThread } from "./DisputeThread";

export const dynamic = "force-dynamic";

export default async function DisputePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  const { id } = await params;
  if (!user) redirect(`/login?next=/disputes/${id}`);

  const d = await one<Row>(
    `SELECT d.*, b.code, b.id AS booking_id, b.buyer_id, b.status AS booking_status,
            r.title AS resource_title, r.id AS resource_id, p.display_name AS provider_name, p.user_id AS provider_user_id,
            u.full_name AS raised_by_name
       FROM disputes d JOIN bookings b ON b.id = d.booking_id JOIN resources r ON r.id = b.resource_id
       JOIN provider_profiles p ON p.id = b.provider_id JOIN users u ON u.id = d.raised_by
      WHERE d.id = ?`, Number(id)
  );
  if (!d) notFound();
  const isParty = user.id === d.buyer_id || user.provider?.id === d.provider_id || user.id === d.provider_user_id;
  if (!isParty && user.role !== "admin") notFound();

  const messages = await all<Row>(
    `SELECT dm.*, u.full_name AS sender_name, u.role AS sender_role FROM dispute_messages dm
       JOIN users u ON u.id = dm.user_id WHERE dm.dispute_id = ? ORDER BY dm.id`, d.id
  );
  const evidence = jsonParse<string[]>(d.evidence, []);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <PageHeader
        breadcrumb={<><Link href="/disputes" className="hover:text-electric">Disputes</Link> / #{d.id}</>}
        title={`${d.kind.replace(/_/g, " ")} dispute — ${d.resource_title}`}
        sub={`Booking ${d.code} · raised by ${d.raised_by_name} on ${fmtDateTime(d.created_at)}`}
        right={
          <>
            <Badge tone={statusTone(d.status)}>{DISPUTE_STATUS_LABEL[d.status] ?? d.status}</Badge>
            <Link href={`/bookings/${d.booking_id}`} className="rounded-lg border border-white/16 px-3 py-1.5 text-[12.5px] text-ink">Booking</Link>
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-[1.6fr_1fr]">
        <div className="space-y-4">
          <Card className="p-4">
            <h2 className="text-[13.5px] font-semibold text-ink">Claim</h2>
            <p className="mt-1.5 whitespace-pre-line text-[12.5px] leading-relaxed text-ink-dim">{d.description}</p>
            <p className="mt-2 text-[12px] text-ink-faint">Claimed amount: <span className="text-ink">{money(d.claim_amount)}</span></p>
            {evidence.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {evidence.map((e) => (
                  <a key={e} href={e} target="_blank" rel="noopener noreferrer" className="rounded border border-white/12 p-1">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={e} alt="Dispute evidence" className="h-20 w-28 rounded object-cover" />
                  </a>
                ))}
              </div>
            )}
          </Card>

          <Card className="p-4">
            <h2 className="mb-2 text-[13.5px] font-semibold text-ink">Thread</h2>
            {messages.length === 0 ? (
              <p className="text-[12px] text-ink-faint">No messages yet.</p>
            ) : (
              <ul className="space-y-2">
                {messages.map((m) => (
                  <li key={m.id} className={`rounded-xl border px-3 py-2 ${m.user_id === user.id ? "border-electric/25 bg-electric/6" : "border-white/10 bg-white/3"}`}>
                    <p className="text-[10.5px] text-ink-faint">
                      {m.sender_name} {m.sender_role === "admin" ? "(admin)" : ""} · {fmtDateTime(m.created_at)}
                    </p>
                    <p className="mt-0.5 text-[12.5px] text-ink-dim">{m.body}</p>
                    {jsonParse<string[]>(m.attachments, []).length > 0 && (
                      <div className="mt-1.5 flex gap-1.5">
                        {jsonParse<string[]>(m.attachments, []).map((a) => (
                          <a key={a} href={a} target="_blank" rel="noopener noreferrer">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={a} alt="Attachment" className="h-14 w-20 rounded object-cover" />
                          </a>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3">
              <DisputeThread disputeId={d.id} closed={["resolved", "rejected", "closed"].includes(d.status) && user.role !== "admin"} />
            </div>
          </Card>
        </div>

        <aside className="space-y-4">
          <Card className="p-4">
            <h2 className="text-[13.5px] font-semibold text-ink">Status</h2>
            <ol className="mt-2 space-y-1.5 text-[12px] text-ink-dim">
              {["open", "evidence_requested", "under_review", "resolved"].map((s, i) => {
                const reached = ["open", "evidence_requested", "under_review", "resolved"].indexOf(d.status) >= i;
                return (
                  <li key={s} className="flex items-center gap-2">
                    <span className={reached ? "text-electric" : "text-ink-faint"}>{reached ? "●" : "○"}</span>
                    <span className={reached ? "text-ink" : "text-ink-faint"}>{DISPUTE_STATUS_LABEL[s]}</span>
                  </li>
                );
              })}
            </ol>
            <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
              A dispute freezes the deposit. Deductions only occur if an administrator records a specific amount after
              reviewing the evidence.
            </p>
          </Card>

          {d.decision && (
            <Card className="border-emerald-400/25 p-4">
              <h2 className="text-[13.5px] font-semibold text-ink">Decision</h2>
              <p className="mt-1 text-[12.5px] text-ink-dim">{d.decision}</p>
              <p className="mt-1 text-[12px] text-ink-faint">
                Deduction: {money(d.deduction_amount)} · decided {d.decided_at ? fmtDateTime(d.decided_at) : "—"}
              </p>
            </Card>
          )}

          <Card className="p-4">
            <h2 className="text-[13.5px] font-semibold text-ink">Parties</h2>
            <p className="mt-1 text-[12px] text-ink-dim">Buyer: booking holder</p>
            <p className="text-[12px] text-ink-dim">Provider: {d.provider_name}</p>
            <p className="mt-1.5 text-[11px] text-ink-faint">Admins see this thread when reviewing. Other users cannot access it.</p>
          </Card>
        </aside>
      </div>
    </div>
  );
}
