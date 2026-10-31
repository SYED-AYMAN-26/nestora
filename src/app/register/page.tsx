import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { RegisterForm } from "./RegisterForm";
import { Card, DemoTag } from "@/components/ui";

export const metadata = { title: "Create your account" };

export default async function RegisterPage() {
  const user = await getSessionUser();
  if (user) redirect("/dashboard");

  return (
    <div className="mx-auto grid grid-cols-1 max-w-6xl gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:py-16">
      <div>
        <Link href="/" className="mb-6 inline-flex items-center gap-2 text-[12.5px] text-ink-faint hover:text-ink">
          ← Back to home
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">
          <span className="gradient-text">One account.</span>{" "}
          <span className="text-ink">Both sides of the sharing economy.</span>
        </h1>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-ink-dim">
          Register as a college, company, organisation, community group or individual. You can borrow resources and
          list your own from the same account — no second login, no separate provider portal.
        </p>

        <div className="mt-7 space-y-3">
          {[
            { t: "Verified providers only show a badge after review", d: "We never claim an organisation is verified just because it registered." },
            { t: "Fair allocation is transparent", d: "Priority scores and booking caps are shown to you, not hidden in a black box." },
            { t: "Every handover is recorded", d: "Condition photos and checklists from both sides, stored against the booking." },
          ].map((i) => (
            <div key={i.t} className="glass-soft rounded-xl px-3.5 py-3">
              <p className="text-[12.5px] font-medium text-ink">{i.t}</p>
              <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink-faint">{i.d}</p>
            </div>
          ))}
        </div>

        <div className="glass mt-6 rounded-xl p-3.5">
          <p className="text-[11px] uppercase tracking-wider text-ink-faint">Demo environment <DemoTag /></p>
          <p className="mt-1 text-[12px] text-ink-dim">
            Prefer to look around first? All seeded demo accounts use the password{" "}
            <code className="rounded bg-white/8 px-1.5 py-0.5 text-electric">Demo@1234</code>.{" "}
            <Link href="/help" className="text-electric hover:underline">See demo logins</Link>
          </p>
        </div>
      </div>

      <Card className="p-5 sm:p-6">
        <RegisterForm />
      </Card>
    </div>
  );
}
