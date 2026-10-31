import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { all, Row } from "@/lib/db";
import { Badge, Card, EmptyState, PageHeader, money } from "@/components/ui";
import { categoryName } from "@/lib/constants";
import { ListingActions } from "./ListingActions";

export const dynamic = "force-dynamic";
export const metadata = { title: "My listings — RentLink 3D" };

export default async function ProviderResources() {
  const user = await getSessionUser();
  if (!user?.provider) redirect("/provider");

  const items = await all<Row>(
    `SELECT r.*, (SELECT url FROM resource_images i WHERE i.resource_id = r.id ORDER BY sort_order LIMIT 1) AS image_url,
            (SELECT COUNT(*) FROM bookings b WHERE b.resource_id = r.id AND b.status IN
               ('pending','approved','awaiting_payment','paid','ready_for_handover','active','return_requested','disputed')) AS live_bookings,
            (SELECT COUNT(*) FROM bookings b WHERE b.resource_id = r.id AND b.status = 'completed') AS completed
       FROM resources r WHERE r.provider_id = ? ORDER BY r.status = 'active' DESC, r.updated_at DESC`,
    user.provider.id
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-7 sm:px-6">
      <PageHeader
        title="My listings"
        sub="Create, edit, pause or archive your resources. Listings with live bookings are archived rather than deleted so that history is preserved."
        right={<Link href="/provider/new" className="rounded-lg bg-gradient-to-b from-electric to-electric-deep px-3.5 py-2 text-[13px] font-semibold text-navy-950">+ New listing</Link>}
      />

      {items.length === 0 ? (
        <EmptyState
          title="No listings yet"
          body="Start by listing one thing that sits unused. Your utilisation dashboard will show whether it's actually being shared."
          action={<Link href="/provider/new" className="rounded-lg bg-electric px-3 py-1.5 text-[12.5px] font-medium text-navy-950">Create your first listing</Link>}
        />
      ) : (
        <div className="space-y-2.5">
          {items.map((r) => (
            <Card key={r.id} className="p-3.5">
              <div className="flex flex-wrap items-start gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={r.image_url || "/img/camera.svg"} alt="" className="h-16 w-24 rounded-lg object-cover" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/provider/resources/${r.id}`} className="text-[13.5px] font-semibold text-ink hover:text-electric">{r.title}</Link>
                    <Badge tone={r.status === "active" ? "success" : r.status === "paused" ? "warn" : "neutral"}>{r.status}</Badge>
                    {r.verification_status === "verified" && <Badge tone="verified">Verified provider</Badge>}
                  </div>
                  <p className="mt-0.5 text-[11.5px] text-ink-faint">
                    {categoryName(r.category)} · {r.condition} · {Math.max(0, r.quantity_total - r.quantity_active)}/{r.quantity_total} shareable ·{" "}
                    {money(r.price_daily)}/day · {money(r.deposit)} deposit
                  </p>
                  <p className="mt-0.5 text-[11px] text-ink-faint">
                    {r.live_bookings} live booking(s) · {r.completed} completed · {r.model_3d ? `3D model: ${r.model_3d}` : "no 3D model"}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <div className="flex gap-1.5">
                    <Link href={`/resources/${r.id}`} className="rounded-lg border border-white/14 px-2 py-1 text-[11px] text-ink-dim hover:border-electric/40 hover:text-ink">Public page</Link>
                    <Link href={`/provider/resources/${r.id}`} className="rounded-lg border border-white/14 px-2 py-1 text-[11px] text-ink-dim hover:border-electric/40 hover:text-ink">Edit</Link>
                  </div>
                  <ListingActions resourceId={r.id} status={r.status} hasLiveBookings={r.live_bookings > 0} />
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
