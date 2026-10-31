import { PageHeader, InfoNote, Card, Badge } from "@/components/ui";
import { RecommendClient } from "./RecommendClient";
import { CAPABILITIES } from "@/lib/constants";

export const dynamic = "force-dynamic";
export const metadata = { title: "Find by need — RentLink 3D" };

export default function RecommendPage() {
  const aiConfigured = Boolean(process.env.OPENAI_API_KEY);
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <PageHeader
        eyebrow="Capability matching"
        title="Describe what you need in plain language"
        sub="RentLink matches on what equipment can do, not just what it's called. Ask for a way to record a short film and you'll see cameras, microphones, lighting, tripods and studios — with the reason each one matched."
        right={<Badge tone={aiConfigured ? "verified" : "info"}>{aiConfigured ? "AI-assisted parsing configured" : "Rule-based engine"}</Badge>}
      />

      <div className="mb-4">
        <InfoNote tone={aiConfigured ? "info" : "warn"} title={aiConfigured ? "AI parsing enabled" : "No AI service is connected — and we say so"}>
          {aiConfigured
            ? "An AI endpoint is configured to help parse your intent. Whatever it returns is still validated against the fixed capability taxonomy and every candidate runs through live availability checks before it is shown as bookable."
            : "Matching runs entirely on a transparent, local capability engine driven by the taxonomy below. No external AI service is configured, and we do not pretend one is."}
        </InfoNote>
      </div>

      <RecommendClient />

      <Card className="mt-6 p-4">
        <h2 className="text-[13.5px] font-semibold text-ink">The capability taxonomy</h2>
        <p className="mt-1 text-[11.5px] leading-relaxed text-ink-faint">
          Providers tag what each resource can do. Buyer requests are mapped onto these same tags, so matching is
          explainable rather than a black box.
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {Object.entries(CAPABILITIES).map(([k, v]) => (
            <span key={k} className="rounded-full border border-white/10 bg-white/3 px-2 py-0.5 text-[10.5px] text-ink-dim" title={v.group}>
              {v.label}
            </span>
          ))}
        </div>
      </Card>
    </div>
  );
}
