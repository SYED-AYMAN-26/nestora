import Link from "next/link";
import { all, Row } from "@/lib/db";
import { Badge, Card, EmptyState, PageHeader, VerifiedBadge } from "@/components/ui";
import { VERIFICATION_LABEL } from "@/lib/constants";
import { fmtDateTime } from "@/lib/format";
import { VerificationReview } from "./VerificationReview";

export const dynamic = "force-dynamic";
export const metadata = { title: "Verification queue — RentLink 3D" };

export default async function AdminVerifications({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const sp = await searchParams;
  const status = sp.status || "pending";
  const items = await all<Row>(
    `SELECT v.*, p.display_name, p.storefront_slug, p.user_id, u.email, u.account_type, u.city, u.state
       FROM verification_requests v JOIN provider_profiles p ON p.id = v.provider_id JOIN users u ON u.id = p.user_id
      ${status === "all" ? "" : "WHERE v.status = ?"}
      ORDER BY CASE v.status WHEN 'pending' THEN 0 ELSE 1 END, v.created_at DESC`,
    ...(status === "all" ? [] : [status])
  );
  const unsubmitted = await all<Row>(
    `SELECT p.id, p.display_name, p.verification_status, p.created_at, u.email FROM provider_profiles p
       JOIN users u ON u.id = p.user_id WHERE p.verification_status = 'not_submitted' ORDER BY p.created_at DESC`
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-7 sm:px-6">
      <PageHeader
        title="Provider verification queue"
        sub="Review identity, registration and ownership evidence. Approving here — and only here — sets the verified badge."
      />
      <div className="mb-4 flex flex-wrap gap-1.5">
        {["pending", "more_info", "approved", "rejected", "all"].map((s) => (
          <Link key={s} href={`/admin/verifications?status=${s}`} className={`rounded-full border px-3 py-1.5 text-[12px] ${status === s ? "border-electric/50 bg-electric/12 text-electric" : "border-white/12 text-ink-dim hover:border-white/25"}`}>
            {s === "all" ? "All" : VERIFICATION_LABEL[s] ?? s}
          </Link>
        ))}
      </div>

      {items.length === 0 ? (
        <EmptyState title="Nothing in this queue" body="No verification requests with that status." />
      ) : (
        <div className="space-y-3">
          {items.map((v) => (
            <Card key={v.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[14px] font-semibold text-ink">{v.display_name}</p>
                    <Badge tone={v.status === "approved" ? "success" : v.status === "pending" ? "warn" : v.status === "rejected" ? "danger" : "info"}>{v.status}</Badge>
                    <Link href={`/storefront/${v.storefront_slug}`} className="text-[11px] text-electric hover:underline">Storefront ↗</Link>
                  </div>
                  <p className="mt-0.5 text-[12px] text-ink-dim">
                    {v.legal_name} · {v.account_type?.replace(/_/g, " ")} · {v.city}, {v.state} · {v.email}
                  </p>
                  <p className="mt-0.5 text-[11.5px] text-ink-faint">
                    Reg: {v.registration_number || "—"} · Role: {v.contact_role || "—"} · Submitted {fmtDateTime(v.created_at)}
                  </p>
                  {v.statement && <p className="mt-1 max-w-2xl text-[12px] italic text-ink-dim">“{v.statement}”</p>}
                  <div className="mt-1.5 flex flex-wrap gap-2 text-[11px]">
                    {v.identity_doc_url && <a href={v.identity_doc_url} target="_blank" rel="noopener noreferrer" className="rounded border border-white/12 px-2 py-0.5 text-electric hover:border-electric/40">Open identity document</a>}
                    {v.ownership_doc_url && <a href={v.ownership_doc_url} target="_blank" rel="noopener noreferrer" className="rounded border border-white/12 px-2 py-0.5 text-electric hover:border-electric/40">Open ownership evidence</a>}
                    {v.extra_doc_url && <a href={v.extra_doc_url} target="_blank" rel="noopener noreferrer" className="rounded border border-white/12 px-2 py-0.5 text-electric hover:border-electric/40">Extra document</a>}
                  </div>
                  {v.reviewer_note && <p className="mt-1.5 rounded border border-white/10 bg-white/3 px-2 py-1 text-[11.5px] text-ink-dim">Previous reviewer note: {v.reviewer_note}</p>}
                </div>
                <VerifiedBadge status={v.status === "approved" ? "verified" : "pending"} />
              </div>
              {["pending", "more_info"].includes(v.status) && (
                <div className="mt-3 border-t border-white/8 pt-3">
                  <VerificationReview requestId={v.id} />
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {unsubmitted.length > 0 && (
        <Card className="mt-5 p-4">
          <h2 className="text-[13.5px] font-semibold text-ink">Providers who haven&apos;t submitted yet</h2>
          <p className="text-[11.5px] text-ink-faint">These providers are not verified — no badge is shown for them.</p>
          <ul className="mt-2 space-y-1 text-[12px]">
            {unsubmitted.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 border-b border-white/6 pb-1">
                <span className="text-ink">{p.display_name}</span>
                <span className="text-ink-faint">{p.email}</span>
                <span className="ml-auto text-[10.5px] text-ink-faint">joined {fmtDateTime(p.created_at)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
