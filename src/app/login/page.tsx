import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { LoginForm } from "./LoginForm";
import { Card, DemoTag } from "@/components/ui";

export const metadata = { title: "Sign in — RentLink 3D" };

const DEMO_LOGINS = [
  { role: "Buyer (college student)", email: "buyer@student.demo", note: "Bookings, handover, return, disputes" },
  { role: "Individual buyer", email: "buyer@individual.demo", note: "Active rental + damage dispute" },
  { role: "Provider (verified college)", email: "provider@anna.demo", note: "Approve requests, inspections, utilisation" },
  { role: "Provider (verified university)", email: "provider@bharat.demo", note: "Studio capacity, counteroffers" },
  { role: "Provider (pending verification)", email: "provider@creators.demo", note: "Verification flow" },
  { role: "Admin", email: "admin@rentlink.demo", note: "Reviews, disputes, audit log" },
];

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect(user.role === "admin" ? "/admin" : "/dashboard");

  return (
    <div className="mx-auto grid max-w-5xl gap-8 px-4 py-12 sm:px-6 lg:grid-cols-2 lg:py-20">
      <Card className="order-2 p-6 lg:order-1">
        <LoginForm />
      </Card>
      <div className="order-1 lg:order-2">
        <h1 className="text-3xl font-semibold tracking-tight text-ink">Welcome back</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-dim">
          Sign in to manage bookings, approve requests, record handovers or review verifications.
        </p>

        <div className="glass mt-6 rounded-xl p-4">
          <p className="mb-1 flex items-center gap-2 text-[11px] uppercase tracking-wider text-ink-faint">
            Demo accounts <DemoTag label="DEMO DATA" />
          </p>
          <p className="mb-3 text-[11.5px] leading-relaxed text-ink-faint">
            Seeded fictional accounts. Password for every account below:{" "}
            <code className="rounded bg-white/8 px-1.5 py-0.5 text-electric">Demo@1234</code>
          </p>
          <div className="space-y-1.5">
            {DEMO_LOGINS.map((d) => (
              <div key={d.email} className="rounded-lg border border-white/8 bg-white/2 px-2.5 py-2">
                <div className="flex flex-wrap items-baseline justify-between gap-1">
                  <span className="text-[12px] font-medium text-ink">{d.role}</span>
                  <code className="text-[11px] text-electric">{d.email}</code>
                </div>
                <p className="text-[10.5px] text-ink-faint">{d.note}</p>
              </div>
            ))}
          </div>
        </div>

        <p className="mt-5 text-[12.5px] text-ink-dim">
          No account yet? <Link href="/register" className="text-electric hover:underline">Register here</Link>
        </p>
      </div>
    </div>
  );
}
