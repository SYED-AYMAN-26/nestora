import Link from "next/link";
import { notFound } from "next/navigation";
import { resourceDetail } from "@/lib/resources";
import { getSessionUser } from "@/lib/auth";
import { all, one, Row } from "@/lib/db";
import { Badge, Card, DemoTag, InfoNote, Stars, VerifiedBadge, money } from "@/components/ui";
import { CAPABILITIES, categoryName, CONDITIONS } from "@/lib/constants";
import { BookingPanel } from "./BookingPanel";
import { ResourceCard, type CardResource } from "@/components/ResourceCard";
import { Gallery } from "./Gallery";
import { TrackView } from "./TrackView";
import { FavouriteButton, ReportButton } from "./ResourceActions";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await resourceDetail(id);
  return { title: d ? `${d.resource.title} — RentLink 3D` : "Resource — RentLink 3D" };
}

export default async function ResourcePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await resourceDetail(id);
  if (!detail) notFound();

  const { resource: r, images, reviews, capabilities, completedBookings, availabilityBlocks, maintenance } = detail;
  const user = await getSessionUser();
  const isOwner = Boolean(user?.provider && user.provider.id === r.provider_id);

  const comparable = await all<CardResource>(
    `SELECT r.id, r.title, r.category, r.condition, r.price_daily, r.price_hourly, r.price_weekly, r.deposit,
            r.location_city, r.quantity_total, r.quantity_active, p.display_name AS provider_name, p.storefront_slug,
            p.verification_status, p.org_type, p.rating_cached, p.rating_count,
            (SELECT url FROM resource_images i WHERE i.resource_id = r.id ORDER BY sort_order LIMIT 1) AS image_url
       FROM resources r JOIN provider_profiles p ON p.id = r.provider_id
      WHERE r.category = ? AND r.id != ? AND r.status = 'active' LIMIT 4`,
    r.category, r.id
  );

  const favRow = user ? await one(`SELECT 1 FROM favourites WHERE user_id = ? AND resource_id = ?`, user.id, r.id) : null;
  const providerUser = await one<Row>(`SELECT u.state, u.city FROM provider_profiles p JOIN users u ON u.id = p.user_id WHERE p.id = ?`, r.provider_id);
  const maintenancePublic = maintenance.map((m) => ({ start_date: m.start_date, end_date: m.end_date, kind: m.kind }));

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <TrackView resourceId={r.id} />

      <nav className="mb-4 flex flex-wrap items-center gap-1.5 text-[12px] text-ink-faint" aria-label="Breadcrumb">
        <Link href="/marketplace" className="hover:text-electric">Marketplace</Link>
        <span>/</span>
        <Link href={`/marketplace?category=${r.category}`} className="hover:text-electric">{categoryName(r.category)}</Link>
        <span>/</span>
        <span className="text-ink-dim">{r.title}</span>
      </nav>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div>
          <Gallery images={images} title={r.title} modelKey={r.model_3d} />

          <div className="mt-5 flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                {r.is_demo ? <DemoTag /> : null}
                <VerifiedBadge status={r.verification_status} />
                <Badge tone="neutral">{CONDITIONS.find((c) => c.value === r.condition)?.label ?? r.condition} condition</Badge>
                {r.status !== "active" && <Badge tone="warn">Listing {r.status}</Badge>}
                {completedBookings > 0 && <Badge tone="info">{completedBookings} completed rental{completedBookings === 1 ? "" : "s"}</Badge>}
              </div>
              <h1 className="text-2xl font-semibold leading-tight tracking-tight text-ink sm:text-[28px]">{r.title}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-[12.5px] text-ink-dim">
                <Link href={`/storefront/${r.storefront_slug}`} className="font-medium text-electric hover:underline">{r.provider_name}</Link>
                <span>· {r.location_city}{r.location_state ? `, ${r.location_state}` : ""}</span>
                <Stars rating={Number(r.rating_cached || 0)} count={Number(r.rating_count || 0)} />
              </div>
            </div>
            <div className="flex gap-2">
              <FavouriteButton resourceId={r.id} initial={Boolean(favRow)} authed={Boolean(user)} />
              <ReportButton resourceId={r.id} authed={Boolean(user)} />
            </div>
          </div>

          {isOwner && (
            <div className="mt-4">
              <InfoNote tone="info" title="This is your listing">
                You&apos;re viewing your own storefront listing.{" "}
                <Link href={`/provider/resources/${r.id}`} className="underline">Edit it in the provider console</Link>{" "}
                or manage availability there.
              </InfoNote>
            </div>
          )}

          {/* price strip */}
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { l: "Hourly", v: money(r.price_hourly) },
              { l: "Daily", v: money(r.price_daily) },
              { l: "Weekly", v: r.price_weekly ? money(r.price_weekly) : "—" },
              { l: "Deposit", v: r.deposit ? money(r.deposit) : "None" },
            ].map((p) => (
              <div key={p.l} className="glass rounded-xl px-3 py-2.5">
                <p className="text-[10.5px] uppercase tracking-wider text-ink-faint">{p.l}</p>
                <p className="text-[15px] font-semibold text-ink">{p.v}</p>
              </div>
            ))}
          </div>

          <Card className="mt-4 p-5">
            <h2 className="text-[15px] font-semibold text-ink">About this resource</h2>
            <p className="mt-2 whitespace-pre-line text-[13.5px] leading-relaxed text-ink-dim">{r.description}</p>
            <dl className="mt-4 grid gap-x-6 gap-y-2.5 text-[12.5px] sm:grid-cols-2">
              {[
                ["Brand / model", [r.brand, r.model].filter(Boolean).join(" ") || "—"],
                ["Category", `${categoryName(r.category)}${r.subcategory ? ` · ${r.subcategory}` : ""}`],
                ["Shareable units", `${Math.max(0, r.quantity_total - r.quantity_active)} of ${r.quantity_total} (provider-declared)`],
                ["Minimum / maximum", `${r.min_hours} day min · ${r.max_days} days max`],
                ["Approval", r.approval_mode === "auto" ? "Instant (still subject to eligibility)" : "Provider reviews each request"],
              ].map(([k, v]) => (
                <div key={k as string} className="flex justify-between gap-3 border-b border-white/6 pb-1.5 sm:block sm:border-0 sm:pb-0">
                  <dt className="text-ink-faint">{k}</dt>
                  <dd className="text-right text-ink sm:mt-0.5 sm:text-left">{v}</dd>
                </div>
              ))}
            </dl>

            {capabilities.length > 0 && (
              <div className="mt-4">
                <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-faint">What it can do (capabilities)</p>
                <div className="flex flex-wrap gap-1.5">
                  {capabilities.map((c) => (
                    <Link key={c} href={`/marketplace?capability=${c}`} className="rounded-full border border-electric/25 bg-electric/8 px-2.5 py-1 text-[11.5px] text-electric hover:bg-electric/15">
                      {CAPABILITIES[c]?.label ?? c}
                    </Link>
                  ))}
                </div>
                <p className="mt-1.5 text-[11px] text-ink-faint">
                  Capability tags are how RentLink matches needs like &ldquo;record a short film&rdquo; to the right equipment — not just exact product names.
                </p>
              </div>
            )}
          </Card>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Card className="p-5">
              <h2 className="text-[15px] font-semibold text-ink">Eligibility &amp; requirements</h2>
              <ul className="mt-2 space-y-2 text-[12.5px] text-ink-dim">
                <li><span className="text-ink-faint">Eligibility:</span> {r.eligibility || "Open to all verified accounts"}</li>
                <li><span className="text-ink-faint">Training:</span> {r.training_required ? "Required before first use" : "None"}</li>
                <li><span className="text-ink-faint">Supervision:</span> {r.supervision_required ? "Provider supervision on site" : "Unsupervised use permitted"}</li>
                <li><span className="text-ink-faint">Usage rules:</span> {r.usage_rules || "—"}</li>
              </ul>
            </Card>
            <Card className="p-5">
              <h2 className="text-[15px] font-semibold text-ink">Policies</h2>
              <ul className="mt-2 space-y-2 text-[12.5px] text-ink-dim">
                <li><span className="text-ink-faint">Cancellation:</span> {r.cancellation_policy || "Provider default policy applies"}</li>
                <li><span className="text-ink-faint">Booking cap:</span> {r.booking_limit_days} future day(s) per buyer, for fair access</li>
                <li><span className="text-ink-faint">Deposit:</span> {r.deposit ? `${money(r.deposit)} refundable, subject to inspection` : "No deposit"}</li>
              </ul>
            </Card>
          </div>

          {/* equipment passport */}
          <Card className="mt-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[15px] font-semibold text-ink">Digital equipment passport</h2>
              <Link href={`/resources/${r.id}/passport`} className="text-[12px] text-electric hover:underline">Full passport →</Link>
            </div>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-dim">
              A public, always-available history of this item: condition at listing, completed rentals, maintenance and
              inspection dates. Private documents and transaction details are never shown here.
            </p>
            <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { l: "Current condition", v: CONDITIONS.find((c) => c.value === r.condition)?.label ?? r.condition },
                { l: "Completed rentals", v: String(completedBookings) },
                { l: "Maintenance events", v: String(maintenancePublic.length) },
                { l: "Owner authorisation", v: r.verification_status === "verified" ? "Verified" : "Not verified" },
              ].map((s) => (
                <div key={s.l} className="glass-soft rounded-lg px-2.5 py-2">
                  <dt className="text-[10px] uppercase tracking-wider text-ink-faint">{s.l}</dt>
                  <dd className="mt-0.5 text-[12.5px] font-medium text-ink">{s.v}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <p className="mb-1 text-[11px] uppercase tracking-wider text-ink-faint">Scheduled maintenance / holds</p>
                {maintenancePublic.length ? (
                  <ul className="space-y-1 text-[12px] text-ink-dim">
                    {maintenancePublic.slice(0, 4).map((m, i) => (
                      <li key={i} className="flex justify-between gap-2 border-b border-white/6 pb-1">
                        <span>{m.kind}</span>
                        <span className="text-ink-faint">{m.start_date}{m.end_date && m.end_date !== m.start_date ? ` → ${m.end_date}` : ""}</span>
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-[12px] text-ink-faint">No maintenance scheduled.</p>}
              </div>
              <div>
                <p className="mb-1 text-[11px] uppercase tracking-wider text-ink-faint">Provider-declared blocked dates</p>
                {availabilityBlocks.length ? (
                  <p className="text-[12px] text-ink-dim">{availabilityBlocks.slice(0, 6).map((b) => b.date).join(", ")}{availabilityBlocks.length > 6 ? ` +${availabilityBlocks.length - 6} more` : ""}</p>
                ) : <p className="text-[12px] text-ink-faint">No provider holds.</p>}
              </div>
            </div>
          </Card>

          {/* reviews */}
          <Card className="mt-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[15px] font-semibold text-ink">Reviews from completed rentals</h2>
              <Stars rating={Number(r.rating_cached || 0)} count={Number(r.rating_count || 0)} />
            </div>
            {reviews.length === 0 ? (
              <p className="mt-2 text-[12.5px] text-ink-faint">
                No reviews yet. Reviews can only be left by buyers whose booking reached the completed state — we never
                seed fake reviews on live listings.
              </p>
            ) : (
              <ul className="mt-3 space-y-3">
                {reviews.map((rv: Row) => (
                  <li key={rv.id} className="border-b border-white/6 pb-3 last:border-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[12.5px] font-medium text-ink">{rv.buyer_name}</span>
                      <Stars rating={rv.rating} />
                      {rv.condition_accuracy && <Badge tone="neutral">Condition matched: {rv.condition_accuracy}/5</Badge>}
                      <span className="ml-auto text-[11px] text-ink-faint">{new Date(rv.created_at).toLocaleDateString("en-IN")}</span>
                    </div>
                    {rv.body && <p className="mt-1 text-[12.5px] leading-relaxed text-ink-dim">{rv.body}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* sidebar */}
        <aside className="space-y-4">
          <div className="lg:sticky lg:top-20">
            <BookingPanel
              resource={{
                id: r.id,
                title: r.title,
                priceHourly: r.price_hourly,
                priceDaily: r.price_daily,
                priceWeekly: r.price_weekly,
                deposit: r.deposit,
                minDays: r.min_hours,
                maxDays: r.max_days,
                capacity: Math.max(0, r.quantity_total - r.quantity_active),
                status: r.status,
                approvalMode: r.approval_mode,
                eligibility: r.eligibility,
                storefrontSlug: r.storefront_slug,
                providerName: r.provider_name,
              }}
              authed={Boolean(user)}
              isOwner={isOwner}
              isAdmin={user?.role === "admin"}
            />

            <Card className="mt-4 p-4">
              <h3 className="text-[13px] font-semibold text-ink">Provider</h3>
              <Link href={`/storefront/${r.storefront_slug}`} className="mt-1.5 flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/3 px-2.5 py-2 hover:border-electric/35">
                <div className="min-w-0">
                  <p className="truncate text-[12.5px] font-medium text-ink">{r.provider_name}</p>
                  <p className="text-[11px] text-ink-faint">{r.org_type.replace(/_/g, " ")} · {providerUser?.city ?? r.location_city}</p>
                </div>
                <span className="text-ink-faint">→</span>
              </Link>
              <div className="mt-2"><VerifiedBadge status={r.verification_status} /></div>
              <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
                {r.verification_status === "verified"
                  ? "Identity and ownership evidence were reviewed and approved by a RentLink administrator."
                  : "This provider has not completed verification. Review details carefully at handover."}
              </p>
            </Card>
          </div>
        </aside>
      </div>

      {comparable.length > 0 && (
        <section className="mt-10">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold text-ink">Compare with other providers</h2>
              <p className="mt-1 text-[12.5px] text-ink-dim">Same category, different providers — prices and condition differ.</p>
            </div>
            <Link href={`/compare?ids=${[r.id, ...comparable.map((c) => c.id)].join(",")}`} className="rounded-lg border border-electric/30 bg-electric/10 px-3 py-1.5 text-[12.5px] text-electric">
              Side-by-side comparison →
            </Link>
          </div>
          <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
            {comparable.map((c) => <ResourceCard key={c.id} r={c} showCompare compareHref={`/compare?ids=${r.id},${c.id}`} />)}
          </div>
        </section>
      )}
    </div>
  );
}
