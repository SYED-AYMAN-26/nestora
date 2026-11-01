import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { all } from "@/lib/db";
import { ResourceCard, type CardResource } from "@/components/ResourceCard";
import { EmptyState, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Favourites" };

export default async function FavouritesPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/favourites");

  const items = await all<CardResource>(
    `SELECT r.id, r.title, r.category, r.condition, r.price_daily, r.price_hourly, r.price_weekly, r.deposit,
            r.location_city, r.is_demo, p.display_name AS provider_name, p.storefront_slug, p.verification_status,
            p.org_type, p.rating_cached, p.rating_count,
            (SELECT url FROM resource_images i WHERE i.resource_id = r.id ORDER BY sort_order LIMIT 1) AS image_url
       FROM favourites f JOIN resources r ON r.id = f.resource_id JOIN provider_profiles p ON p.id = r.provider_id
      WHERE f.user_id = ? ORDER BY f.created_at DESC`, user.id
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <PageHeader title="Favourites" sub="Resources you've saved for later. Availability is re-checked when you open a listing." />
      {items.length === 0 ? (
        <EmptyState title="No favourites yet" body="Tap the heart on any listing to save it here." action={<Link href="/marketplace" className="rounded-lg bg-electric px-3 py-1.5 text-[12.5px] font-medium text-white">Browse marketplace</Link>} />
      ) : (
        <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((r) => <ResourceCard key={r.id} r={r} showCompare compareHref={`/compare?ids=${r.id}`} />)}
        </div>
      )}
    </div>
  );
}
