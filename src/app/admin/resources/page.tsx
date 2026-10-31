import Link from "next/link";
import { all, Row } from "@/lib/db";
import { Badge, Card, EmptyState, PageHeader, money } from "@/components/ui";
import { categoryName } from "@/lib/constants";
import { AdminResourceActions } from "./AdminResourceActions";
import { fmtDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Listings & reports admin" };

export default async function AdminResources({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const sp = await searchParams;
  const status = sp.status || "all";
  const items = await all<Row>(
    `SELECT r.*, p.display_name AS provider_name, p.verification_status, p.user_id AS provider_user_id,
            (SELECT COUNT(*) FROM bookings b WHERE b.resource_id = r.id) AS bookings,
            (SELECT COUNT(*) FROM reports rp WHERE rp.resource_id = r.id AND rp.status = 'open') AS open_reports,
            (SELECT url FROM resource_images i WHERE i.resource_id = r.id ORDER BY sort_order LIMIT 1) AS image_url
       FROM resources r JOIN provider_profiles p ON p.id = r.provider_id
       ${status === "all" ? "" : "WHERE r.status = ?"} ORDER BY r.id DESC LIMIT 200`,
    ...(status === "all" ? [] : [status])
  );
  const reports = await all<Row>(
    `SELECT rp.*, r.title AS resource_title, u.full_name AS reporter_name FROM reports rp
       LEFT JOIN resources r ON r.id = rp.resource_id LEFT JOIN users u ON u.id = rp.reporter_id
      ORDER BY rp.created_at DESC LIMIT 50`
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-7 sm:px-6">
      <PageHeader title="Listings & reported content" sub="Pause or archive a listing, and review buyer reports. Actions notify the provider and are audited." />
      <div className="mb-4 flex flex-wrap gap-1.5">
        {["all", "active", "paused", "draft", "archived"].map((s) => (
          <Link key={s} href={`/admin/resources?status=${s}`} className={`rounded-full border px-3 py-1.5 text-[12px] ${status === s ? "border-electric/50 bg-electric/12 text-electric" : "border-white/12 text-ink-dim hover:border-white/25"}`}>{s}</Link>
        ))}
      </div>

      {reports.length > 0 && (
        <Card className="mb-4 p-4">
          <h2 className="text-[13.5px] font-semibold text-ink">Reported listings ({reports.length})</h2>
          <ul className="mt-2 space-y-1.5 text-[12px]">
            {reports.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 border-b border-white/6 pb-1.5">
                <Badge tone={r.status === "open" ? "warn" : "neutral"}>{r.status}</Badge>
                <Link href={`/resources/${r.resource_id}`} className="text-ink hover:text-electric">{r.resource_title}</Link>
                <span className="text-ink-faint">{r.reason}</span>
                {r.detail && <span className="max-w-md truncate text-ink-faint">“{r.detail}”</span>}
                <span className="ml-auto text-[10.5px] text-ink-faint">{r.reporter_name} · {fmtDateTime(r.created_at)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {items.length === 0 ? (
        <EmptyState title="No listings" body="Nothing matches that filter." />
      ) : (
        <div className="space-y-2.5">
          {items.map((r) => (
            <Card key={r.id} className="p-3.5">
              <div className="flex flex-wrap items-start gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={r.image_url || "/img/camera.svg"} alt="" className="h-14 w-20 rounded-lg object-cover" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/resources/${r.id}`} className="text-[13px] font-semibold text-ink hover:text-electric">{r.title}</Link>
                    <Badge tone={r.status === "active" ? "success" : r.status === "paused" ? "warn" : "neutral"}>{r.status}</Badge>
                    <Badge tone={r.verification_status === "verified" ? "verified" : "neutral"}>{r.verification_status}</Badge>
                    {r.open_reports > 0 && <Badge tone="danger">{r.open_reports} report(s)</Badge>}
                  </div>
                  <p className="mt-0.5 text-[11.5px] text-ink-faint">
                    {r.provider_name} · {categoryName(r.category)} · {money(r.price_daily)}/day · {r.bookings} booking(s) · {r.quantity_total} unit(s)
                  </p>
                </div>
                <AdminResourceActions resourceId={r.id} status={r.status} />
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
