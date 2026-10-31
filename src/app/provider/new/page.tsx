import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { PageHeader, InfoNote } from "@/components/ui";
import { ListingForm, type ListingDraft } from "@/components/ListingForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "New listing — RentLink 3D" };

export default async function NewListingPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/provider/new");
  if (!user.provider) redirect("/onboarding");

  const draft: ListingDraft = {
    title: "", category: "cameras-photography", subcategory: null, description: "",
    brand: null, model: null, condition: "good",
    quantity_total: 1, quantity_active: 0, internal_usage_hours_month: 0,
    location_city: user.city ?? "", location_state: user.state ?? "",
    price_hourly: 0, price_daily: 0, price_weekly: 0, deposit: 0,
    eligibility: null, training_required: false, supervision_required: false,
    usage_rules: null, cancellation_policy: null,
    min_hours: 1, max_days: 14, status: "active", model_3d: null,
    capabilities: [], best_for: null, approval_mode: "manual",
    booking_limit_days: 14, images: [], blocked_dates: [],
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-7 sm:px-6">
      <PageHeader
        title="Create a listing"
        sub="Be accurate about condition, quantity and what is genuinely available. Buyers rely on this at handover."
      />
      <div className="mb-4">
        <InfoNote tone="info" title="Why the extra fields matter">
          Quantity and internal-use figures feed the utilisation engine. Capability tags power need-based matching.
          Eligibility and fair-use caps are enforced server-side, not just in the browser.
        </InfoNote>
      </div>
      <ListingForm initial={draft} mode="create" />
    </div>
  );
}
