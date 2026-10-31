import Link from "next/link";
import { notFound } from "next/navigation";
import { resourceDetail } from "@/lib/resources";
import { all, Row } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { Badge, Card, InfoNote, PageHeader, VerifiedBadge } from "@/components/ui";
import { CONDITIONS, categoryName } from "@/lib/constants";

export const dynamic = "force-dynamic";

export default async function PassportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await resourceDetail(id);
  if (!detail) notFound();
  const { resource: r, maintenance } = detail;
  const user = await getSessionUser();
  const isOwner = Boolean(user?.provider && user.provider.id === r.provider_id);
  const isAdmin = user?.role === "admin";

  const completed = await all<Row>(
    `SELECT b.id, b.code, b.start_date, b.end_date, b.units, b.status,
            h.initial_condition, r2.return_condition,
            (SELECT COUNT(*) FROM condition_reports c WHERE c.booking_id = b.id) AS reports
       FROM bookings b
       LEFT JOIN handovers h ON h.booking_id = b.id
       LEFT JOIN returns r2 ON r2.booking_id = b.id
      WHERE b.resource_id = ? AND b.status = 'completed'
      ORDER BY b.end_date DESC LIMIT 25`,
    r.id
  );
  const inspections = await all<Row>(
    `SELECT c.stage, c.condition, c.notes, c.created_at, u.full_name AS reporter
       FROM condition_reports c LEFT JOIN users u ON u.id = c.reported_by
      WHERE c.resource_id = ? ORDER BY c.created_at DESC LIMIT 25`,
    r.id
  );
  const disputes = isOwner || isAdmin
    ? await all<Row>(
        `SELECT d.kind, d.status, d.created_at, d.claim_amount, d.decision FROM disputes d
           JOIN bookings b ON b.id = d.booking_id WHERE b.resource_id = ? ORDER BY d.created_at DESC LIMIT 10`, r.id)
    : [];

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <PageHeader
        breadcrumb={<><Link href={`/resources/${r.id}`} className="hover:text-electric">{r.title}</Link> / Equipment passport</>}
        title="Digital equipment passport"
        sub="The recorded history of this specific resource: identification, condition at every stage, rentals and maintenance. Private documents and transaction details are withheld from the public view."
        right={<VerifiedBadge status={r.verification_status} />}
      />

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-4 md:col-span-2">
          <h2 className="text-[14px] font-semibold text-ink">Identification</h2>
          <dl className="mt-2 grid gap-x-6 gap-y-2 text-[12.5px] sm:grid-cols-2">
            {[
              ["Resource ID", `RL-RES-${String(r.id).padStart(4, "0")}`],
              ["Name", r.title],
              ["Category", `${categoryName(r.category)}${r.subcategory ? ` · ${r.subcategory}` : ""}`],
              ["Brand / model", [r.brand, r.model].filter(Boolean).join(" ") || "—"],
              ["Provider", r.provider_name],
              ["Location", `${r.location_city ?? "—"}${r.location_state ? `, ${r.location_state}` : ""}`],
              ["Original condition (at listing)", CONDITIONS.find((c) => c.value === r.condition)?.label ?? r.condition],
              ["Current condition (last inspection)", inspections[0]?.condition ?? r.condition],
            ].map(([k, v]) => (
              <div key={k} className="border-b border-white/6 pb-1.5">
                <dt className="text-[10.5px] uppercase tracking-wider text-ink-faint">{k}</dt>
                <dd className="text-ink">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
        <Card className="p-4">
          <h2 className="text-[14px] font-semibold text-ink">Authorisation</h2>
          <p className="mt-2 text-[12.5px] leading-relaxed text-ink-dim">
            Ownership or authorisation evidence is reviewed privately during provider verification.
          </p>
          <div className="mt-2"><VerifiedBadge status={r.verification_status} /></div>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
            {r.verification_status === "verified"
              ? "Provider identity and equipment authorisation were reviewed by an administrator."
              : "Not verified. RentLink has not reviewed ownership evidence for this provider."}
          </p>
          <div className="mt-3 space-y-1 text-[12px]">
            <p className="text-ink-faint">Units tracked: <span className="text-ink">{r.quantity_total}</span></p>
            <p className="text-ink-faint">Completed rentals: <span className="text-ink">{completed.length}</span></p>
            <p className="text-ink-faint">Condition records: <span className="text-ink">{inspections.length}</span></p>
          </div>
        </Card>
      </div>

      <Card className="mt-4 p-4">
        <h2 className="text-[14px] font-semibold text-ink">Condition &amp; inspection timeline</h2>
        {inspections.length === 0 ? (
          <p className="mt-2 text-[12.5px] text-ink-faint">No condition records yet — the provider records condition at every handover and return.</p>
        ) : (
          <ol className="mt-3 space-y-2">
            {inspections.map((c, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 border-b border-white/6 pb-2 text-[12.5px] last:border-0">
                <Badge tone={c.stage === "damage" ? "danger" : c.stage === "initial" ? "info" : "success"}>{c.stage}</Badge>
                <span className="text-ink">{CONDITIONS.find((x) => x.value === c.condition)?.label ?? c.condition}</span>
                <span className="text-ink-faint">{c.notes}</span>
                <span className="ml-auto text-[11px] text-ink-faint">
                  {c.reporter ? `${c.reporter} · ` : ""}{new Date(c.created_at).toLocaleDateString("en-IN")}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <Card className="mt-4 p-4">
        <h2 className="text-[14px] font-semibold text-ink">Rental history (completed)</h2>
        {completed.length === 0 ? (
          <p className="mt-2 text-[12.5px] text-ink-faint">No completed rentals recorded for this resource yet.</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-[12px]">
              <thead className="text-[10.5px] uppercase tracking-wider text-ink-faint">
                <tr><th className="py-1.5 pr-3">Booking</th><th className="py-1.5 pr-3">Dates</th><th className="py-1.5 pr-3">Out</th><th className="py-1.5 pr-3">Back</th><th className="py-1.5 pr-3">Reports</th></tr>
              </thead>
              <tbody className="text-ink-dim">
                {completed.map((b) => (
                  <tr key={b.id} className="border-t border-white/6">
                    <td className="py-1.5 pr-3 font-mono text-[11px] text-electric">{b.code}</td>
                    <td className="py-1.5 pr-3">{b.start_date} → {b.end_date}</td>
                    <td className="py-1.5 pr-3">{b.initial_condition ?? "—"}</td>
                    <td className="py-1.5 pr-3">{b.return_condition ?? "—"}</td>
                    <td className="py-1.5 pr-3">{b.reports}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Card className="p-4">
          <h2 className="text-[14px] font-semibold text-ink">Maintenance history</h2>
          {maintenance.length === 0 ? (
            <p className="mt-2 text-[12.5px] text-ink-faint">No maintenance events recorded.</p>
          ) : (
            <ul className="mt-2 space-y-1.5 text-[12.5px] text-ink-dim">
              {maintenance.map((m: Row) => (
                <li key={m.id} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-white/6 pb-1.5">
                  <span className="capitalize text-ink">{m.kind}</span>
                  <span className="text-ink-faint">{m.start_date}{m.end_date ? ` → ${m.end_date}` : ""}</span>
                  {(isOwner || isAdmin) && m.notes && <span className="w-full text-[11px] text-ink-faint">{m.notes}</span>}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="p-4">
          <h2 className="text-[14px] font-semibold text-ink">Disputes &amp; damage reports</h2>
          {isOwner || isAdmin ? (
            disputes.length === 0 ? (
              <p className="mt-2 text-[12.5px] text-ink-faint">No disputes recorded against this resource.</p>
            ) : (
              <ul className="mt-2 space-y-1.5 text-[12.5px]">
                {disputes.map((d, i) => (
                  <li key={i} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-white/6 pb-1.5">
                    <span className="capitalize text-ink">{d.kind}</span>
                    <Badge tone={d.status === "resolved" ? "success" : d.status === "rejected" ? "danger" : "warn"}>{d.status.replace(/_/g, " ")}</Badge>
                    <span className="text-[11px] text-ink-faint">{new Date(d.created_at).toLocaleDateString("en-IN")}</span>
                  </li>
                ))}
              </ul>
            )
          ) : (
            <InfoNote tone="info">
              Dispute records are visible only to the resource owner and platform administrators. The public passport
              shows condition and rental history without exposing sensitive transaction information.
            </InfoNote>
          )}
        </Card>
      </div>
    </div>
  );
}
