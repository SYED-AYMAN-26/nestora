import Link from "next/link";
import { notFound } from "next/navigation";
import { all, one, Row } from "@/lib/db";
import { searchResources } from "@/lib/resources";
import { ResourceCard } from "@/components/ResourceCard";
import { Card, DemoTag, EmptyState, InfoNote, Stars, VerifiedBadge } from "@/components/ui";
import { accountTypeLabel } from "@/lib/constants";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = await one<Row>(`SELECT display_name FROM provider_profiles WHERE storefront_slug = ?`, slug);
  return { title: p ? `${p.display_name} — RentLink 3D storefront` : "Storefront — RentLink 3D" };
}

export default async function StorefrontPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = await one<Row>(
    `SELECT p.*, u.city AS user_city, u.state AS user_state, u.account_type, u.is_demo, u.created_at AS joined
       FROM provider_profiles p JOIN users u ON u.id = p.user_id WHERE p.storefront_slug = ?`, slug
  );
  if (!p) notFound();

  const { items: resources } = await searchResources({ providerId: p.id, limit: 100, includeNonActive: false });
  const reviews = await all<Row>(
    `SELECT rv.rating, rv.body, rv.created_at, rv.condition_accuracy, u.full_name AS buyer_name, r.title AS resource_title
       FROM reviews rv JOIN users u ON u.id = rv.buyer_id JOIN resources r ON r.id = rv.resource_id
      WHERE rv.provider_id = ? ORDER BY rv.created_at DESC LIMIT 12`, p.id
  );
  const allResources = await all<{ status: string }>(`SELECT status FROM resources WHERE provider_id = ?`, p.id);
  const user = await getSessionUser();
  const isOwner = user?.provider?.id === p.id;

  const priority = (() => {
    try { return JSON.parse(p.priority_policy || "{}"); } catch { return {}; }
  })();

  return (
    <div>
      <div className="relative overflow-hidden border-b border-white/8">
        <div className="grid-fade pointer-events-none absolute inset-0 opacity-50" aria-hidden="true" />
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
          <div className="flex flex-wrap items-start gap-4">
            <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl border border-white/12 bg-gradient-to-br from-navy-800 to-navy-900 text-xl font-semibold text-electric">
              {p.display_name.slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight text-ink">{p.display_name}</h1>
                {p.is_demo ? <DemoTag /> : null}
                <VerifiedBadge status={p.verification_status} />
              </div>
              <p className="mt-1 text-[12.5px] text-ink-dim">
                {accountTypeLabel(p.org_type)} · {p.user_city ?? "—"}{p.user_state ? `, ${p.user_state}` : ""} ·{" "}
                {resources.length} active listing{resources.length === 1 ? "" : "s"}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[12px]">
                <Stars rating={Number(p.rating_cached || 0)} count={Number(p.rating_count || 0)} />
                {p.website && <a href={p.website} target="_blank" rel="noopener noreferrer" className="text-electric hover:underline">Website ↗</a>}
                {p.contact_email && <a href={`mailto:${p.contact_email}`} className="text-ink-dim hover:text-electric">{p.contact_email}</a>}
                {p.contact_phone && <span className="text-ink-dim">{p.contact_phone}</span>}
              </div>
            </div>
            {isOwner && (
              <Link href="/provider" className="rounded-lg border border-electric/35 bg-electric/10 px-3 py-1.5 text-[12.5px] text-electric">
                Manage storefront
              </Link>
            )}
          </div>
        </div>
      </div>

      <div className="mx-auto grid grid-cols-1 max-w-7xl gap-6 px-4 py-7 sm:px-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div>
          <Card className="p-5">
            <h2 className="text-[14px] font-semibold text-ink">About this provider</h2>
            <p className="mt-2 whitespace-pre-line text-[13px] leading-relaxed text-ink-dim">
              {p.description || "This provider has not written a description yet."}
            </p>
            {p.verification_status !== "verified" && (
              <div className="mt-3">
                <InfoNote tone="warn">
                  This provider has not completed verification. RentLink shows the badge only after an administrator
                  reviews identity and ownership evidence — treat an unverified listing with extra caution and inspect
                  the equipment at handover.
                </InfoNote>
              </div>
            )}
          </Card>

          <h2 className="mb-3 mt-6 text-[16px] font-semibold text-ink">Listings</h2>
          {resources.length === 0 ? (
            <EmptyState title="No active listings" body="This provider has no bookable resources right now." />
          ) : (
            <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
              {resources.map((r) => <ResourceCard key={r.id} r={r} showCompare compareHref={`/compare?ids=${r.id}`} />)}
            </div>
          )}

          <h2 className="mb-3 mt-7 text-[16px] font-semibold text-ink">Reviews</h2>
          <Card className="p-5">
            {reviews.length === 0 ? (
              <p className="text-[12.5px] text-ink-faint">
                No reviews yet. Only buyers with a completed booking can review a provider — we never generate reviews.
              </p>
            ) : (
              <ul className="space-y-3">
                {reviews.map((rv, i) => (
                  <li key={i} className="border-b border-white/6 pb-3 last:border-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[12.5px] font-medium text-ink">{rv.buyer_name}</span>
                      <Stars rating={rv.rating} />
                      <span className="text-[11px] text-ink-faint">{rv.resource_title}</span>
                      <span className="ml-auto text-[11px] text-ink-faint">{new Date(rv.created_at).toLocaleDateString("en-IN")}</span>
                    </div>
                    {rv.body && <p className="mt-1 text-[12.5px] leading-relaxed text-ink-dim">{rv.body}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <aside className="space-y-4">
          <Card className="p-4">
            <h2 className="text-[13.5px] font-semibold text-ink">Policies</h2>
            <dl className="mt-2 space-y-2 text-[12px] leading-relaxed text-ink-dim">
              <div>
                <dt className="text-[10.5px] uppercase tracking-wider text-ink-faint">Cancellation</dt>
                <dd>{p.cancellation_policy || "Provider default: free cancellation up to 48 hours before the start date."}</dd>
              </div>
              <div>
                <dt className="text-[10.5px] uppercase tracking-wider text-ink-faint">Collection</dt>
                <dd>{p.collection_policy || "Collect from the provider's reception during working hours."}</dd>
              </div>
            </dl>
          </Card>

          <Card className="p-4">
            <h2 className="text-[13.5px] font-semibold text-ink">Allocation policy</h2>
            <p className="text-[11.5px] leading-relaxed text-ink-faint">How this provider prioritises competing requests:</p>
            <ul className="mt-1.5 space-y-1 text-[12px] text-ink-dim">
              <li>{priority.eligible_account_types?.length ? `Prefers: ${priority.eligible_account_types.map(accountTypeLabel).join(", ")}` : "No preferred account types"}</li>
              <li>{priority.boost_academic ? "Academic / project purpose gets a boost" : "No academic-purpose boost"}</li>
              <li>{priority.boost_underserved ? "First-time borrowers get a fair-start boost" : "No first-time-borrower boost"}</li>
              <li>{priority.fair_rotation ? "Fair rotation among recent requesters" : "No rotation rule"}</li>
            </ul>
          </Card>

          <Card className="p-4">
            <h2 className="text-[13.5px] font-semibold text-ink">Storefront facts</h2>
            <ul className="mt-1.5 space-y-1 text-[12px] text-ink-dim">
              <li>Listings: {allResources.length} total · {resources.length} active</li>
              <li>Provider type: {accountTypeLabel(p.org_type)}</li>
              <li>Joined: {new Date(p.joined).toLocaleDateString("en-IN")}</li>
              <li>Verification: {p.verification_status.replace(/_/g, " ")}</li>
            </ul>
            <p className="mt-2 text-[10.5px] leading-relaxed text-ink-faint">
              Ownership: every provider can only manage their own storefront and listings — enforced server-side.
            </p>
          </Card>

          <Card className="p-4">
            <h2 className="text-[13.5px] font-semibold text-ink">Contact &amp; booking</h2>
            <p className="mt-1 text-[11.5px] leading-relaxed text-ink-faint">
              Booking is the preferred channel — it creates a record, an approval step and a condition trail. Direct
              contact details are for practical questions only.
            </p>
            <Link href={`/marketplace?q=${encodeURIComponent(p.display_name)}`} className="mt-2 block rounded-lg border border-electric/30 bg-electric/10 px-3 py-1.5 text-center text-[12.5px] text-electric">
              Browse their availability
            </Link>
          </Card>
        </aside>
      </div>
    </div>
  );
}
