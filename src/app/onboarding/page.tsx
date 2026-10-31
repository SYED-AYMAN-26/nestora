import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { Card } from "@/components/ui";
import { OnboardingSteps } from "./OnboardingSteps";

export const metadata = { title: "Getting started — RentLink 3D" };

export default async function OnboardingPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-electric">Account setup</p>
      <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-ink">
        {user.full_name.split(" ")[0]}, let&apos;s get you set up
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-ink-dim">
        You&apos;re registered as <strong className="text-ink">{user.account_type.replace(/_/g, " ")}</strong>
        {user.org_name ? ` (${user.org_name})` : ""}. Finish these steps to unlock the full experience —
        you can revisit any of them from your dashboard.
      </p>

      <Card className="mt-6 p-5 sm:p-6">
        <OnboardingSteps
          hasProvider={Boolean(user.provider)}
          verificationStatus={user.provider?.verification_status ?? null}
          providerSlug={user.provider?.storefront_slug ?? null}
        />
      </Card>

      <p className="mt-5 text-center text-[12.5px] text-ink-dim">
        Want to skip ahead? <Link href="/marketplace" className="text-electric hover:underline">Browse the marketplace</Link>
      </p>
    </div>
  );
}
