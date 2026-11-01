import Link from "next/link";
import { PageHeader, Card, InfoNote } from "@/components/ui";
import { ResourceCard, type CardResource } from "@/components/ResourceCard";
import { all } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata = { title: "Equipment showcase" };

/**
 * Formerly the WebGL "3D equipment viewer".
 *
 * The route is kept (bookmarks and any inbound links keep working) but it is now
 * a plain 2D showcase of the equipment library: photographic cards, grouped by
 * category, each linking to the real listing and its booking flow. No canvas, no
 * three.js, no WebGL — nothing on this page needs a GPU.
 */
export default async function ShowcasePage() {
  const items = await all<CardResource & { category: string }>(
    `SELECT r.id, r.title, r.category, r.condition, r.price_daily, r.price_hourly, r.price_weekly, r.deposit,
            r.location_city, r.best_for, p.display_name AS provider_name, p.storefront_slug,
            p.verification_status, p.org_type, p.rating_cached, p.rating_count, r.is_demo,
            (SELECT url FROM resource_images i WHERE i.resource_id = r.id ORDER BY sort_order LIMIT 1) AS image_url
       FROM resources r JOIN provider_profiles p ON p.id = r.provider_id
      WHERE r.status = 'active' ORDER BY p.rating_cached DESC, r.id LIMIT 24`
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <PageHeader
        eyebrow="Showcase"
        title="The equipment library"
        sub="A photographic walk through what providers are sharing right now. Open any card for the full listing, availability calendar and booking flow."
        right={
          <Link href="/marketplace" className="rounded-lg bg-electric px-3.5 py-2 text-[13px] font-semibold text-white transition hover:bg-electric-deep">
            Browse with filters
          </Link>
        }
      />

      <div className="mb-5">
        <InfoNote tone="info" title="Photographs, not renders">
          Every card below shows a real photograph of the category. Providers can upload photos of the exact item on
          their listing — those are shown first wherever they exist.
        </InfoNote>
      </div>

      {items.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-sm text-ink-dim">
            Nothing listed yet.{" "}
            <Link href="/provider/new" className="text-electric hover:underline">
              Create the first listing
            </Link>
            .
          </p>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((r) => (
            <ResourceCard key={r.id} r={r} />
          ))}
        </div>
      )}
    </div>
  );
}
