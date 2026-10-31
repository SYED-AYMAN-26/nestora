import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { all, Row } from "@/lib/db";
import { Badge, Card, InfoNote, PageHeader, VerifiedBadge } from "@/components/ui";
import { VERIFICATION_LABEL } from "@/lib/constants";
import { VerificationForm } from "./VerificationForm";
import { fmtDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Provider verification" };

export default async function VerificationPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!user.provider) redirect("/provider");
  const p = user.provider;

  const requests = await all<Row>(
    `SELECT * FROM verification_requests WHERE provider_id = ? ORDER BY id DESC`, p.id
  );
  const latest = requests[0];
  const canSubmit = !latest || ["rejected", "more_info"].includes(latest.status) || latest.status === "approved";

  return (
    <div className="mx-auto max-w-4xl px-4 py-7 sm:px-6">
      <PageHeader
        title="Provider verification"
        sub="Verification is how buyers know the provider is a real institution or business with authority over the equipment. A badge appears only after an administrator approves your submission."
        right={<VerifiedBadge status={p.verification_status} />}
      />

      <div className="grid gap-4 md:grid-cols-[1.3fr_1fr]">
        <div className="space-y-4">
          {latest && (
            <Card className="p-4">
              <h2 className="text-[13.5px] font-semibold text-ink">Latest submission</h2>
              <dl className="mt-2 grid gap-x-4 gap-y-1.5 text-[12px] sm:grid-cols-2">
                <div><dt className="text-ink-faint">Status</dt><dd className="text-ink">{VERIFICATION_LABEL[latest.status] ?? latest.status}</dd></div>
                <div><dt className="text-ink-faint">Submitted</dt><dd className="text-ink">{fmtDateTime(latest.created_at)}</dd></div>
                <div><dt className="text-ink-faint">Legal name</dt><dd className="text-ink">{latest.legal_name}</dd></div>
                <div><dt className="text-ink-faint">Registration no.</dt><dd className="text-ink">{latest.registration_number || "—"}</dd></div>
                <div><dt className="text-ink-faint">Reviewed</dt><dd className="text-ink">{latest.reviewed_at ? fmtDateTime(latest.reviewed_at) : "Not yet"}</dd></div>
              </dl>
              {latest.reviewer_note && (
                <div className="mt-2">
                  <InfoNote tone={latest.status === "approved" ? "info" : "warn"} title="Reviewer note">{latest.reviewer_note}</InfoNote>
                </div>
              )}
              <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                {latest.identity_doc_url && <span className="rounded border border-white/12 px-2 py-1 text-ink-dim">Identity document on file (private)</span>}
                {latest.ownership_doc_url && <span className="rounded border border-white/12 px-2 py-1 text-ink-dim">Ownership evidence on file (private)</span>}
              </div>
              <p className="mt-2 text-[10.5px] leading-relaxed text-ink-faint">
                Documents live in private storage served only through an authorisation-checked route. Administrators
                reviewing your request can open them; nobody else can.
              </p>
            </Card>
          )}

          {canSubmit ? (
            <Card className="p-4">
              <h2 className="text-[13.5px] font-semibold text-ink">{latest ? "Submit again" : "Submit verification"}</h2>
              <VerificationForm
                slug={p.storefront_slug}
                defaults={{
                  legal_name: latest?.legal_name ?? p.display_name,
                  registration_number: latest?.registration_number ?? "",
                  institution_type: p.org_type,
                  contact_role: latest?.contact_role ?? "",
                  statement: latest?.statement ?? "",
                }}
              />
            </Card>
          ) : (
            <Card className="p-4">
              <p className="text-[12.5px] text-ink-dim">
                Your submission is under review. You can submit again once an administrator responds.
              </p>
            </Card>
          )}
        </div>

        <aside className="space-y-4">
          <Card className="p-4">
            <h2 className="text-[13.5px] font-semibold text-ink">What we review</h2>
            <ul className="mt-2 space-y-1.5 text-[12px] text-ink-dim">
              <li>• Identity of the responsible person</li>
              <li>• Institution / company registration details</li>
              <li>• Ownership or authorisation evidence for the listed equipment</li>
              <li>• Consistency with what your storefront claims</li>
            </ul>
          </Card>
          <Card className="p-4">
            <h2 className="text-[13.5px] font-semibold text-ink">Statuses</h2>
            <ul className="mt-2 space-y-1 text-[12px] text-ink-dim">
              {["not_submitted", "pending", "verified", "rejected", "more_info"].map((s) => (
                <li key={s} className="flex items-center justify-between gap-2">
                  <span className={p.verification_status === s ? "text-ink" : ""}>{VERIFICATION_LABEL[s]}</span>
                  {p.verification_status === s && <Badge tone="info">current</Badge>}
                </li>
              ))}
            </ul>
          </Card>
          <InfoNote tone="info" title="Honest labelling">
            Registering as a college does not make you verified. Nestora shows the badge only after a human
            administrator reviews the evidence — nothing here is automatic.
          </InfoNote>
          <p className="text-[11px] text-ink-faint">
            Questions? <Link href="/help" className="text-electric hover:underline">Help &amp; support</Link>
          </p>
        </aside>
      </div>

      {requests.length > 1 && (
        <Card className="mt-4 p-4">
          <h2 className="text-[13.5px] font-semibold text-ink">Submission history</h2>
          <ul className="mt-2 space-y-1 text-[12px]">
            {requests.slice(1).map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 border-b border-white/6 pb-1.5">
                <span className="text-ink">{r.legal_name}</span>
                <Badge tone={r.status === "approved" ? "success" : r.status === "pending" ? "warn" : r.status === "rejected" ? "danger" : "neutral"}>{r.status}</Badge>
                <span className="ml-auto text-[11px] text-ink-faint">{fmtDateTime(r.created_at)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
