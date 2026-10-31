import Link from "next/link";
import { PageHeader, Card, InfoNote, Badge } from "@/components/ui";
import { ViewerGallery } from "./ViewerGallery";
import { all } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata = { title: "3D equipment viewer" };

export default async function ViewerPage() {
  const withModels = await all<{ model_3d: string; title: string; id: number }>(
    `SELECT id, title, model_3d FROM resources WHERE model_3d IS NOT NULL AND status='active' ORDER BY id LIMIT 12`
  );
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <PageHeader
        eyebrow="3D"
        title="Interactive equipment viewer"
        sub="Rotate and zoom real 3D meshes rendered with three.js. Drag with a pointer, or use arrow keys once focused. Models load lazily and fall back to a photo when WebGL isn't available."
        right={<Badge tone="info">{withModels.length} listings with 3D</Badge>}
      />
      <ViewerGallery resources={withModels} />

      <div className="mb-4">
        <InfoNote tone="warn" title="What these models are">
          These are <strong>procedural meshes</strong> built from primitives at runtime — genuinely interactive 3D, but
          stylised representations rather than manufacturer-accurate CAD files. Listings without a model show a photo and
          say &ldquo;no 3D model&rdquo; rather than pretending otherwise.
        </InfoNote>
      </div>

      <Card className="mt-5 p-4">
        <h2 className="text-[13.5px] font-semibold text-ink">Performance &amp; accessibility</h2>
        <ul className="mt-2 grid gap-1.5 text-[12px] leading-relaxed text-ink-dim sm:grid-cols-2">
          <li>• three.js is lazy-loaded and only mounted when the viewer scrolls into view.</li>
          <li>• Device pixel ratio is capped and adapts down on slower GPUs.</li>
          <li>• <code className="text-electric">prefers-reduced-motion</code> stops auto-rotation and float effects.</li>
          <li>• No WebGL → a labelled photo fallback renders instead.</li>
          <li>• No external models, textures or HDRs are downloaded.</li>
          <li>• Booking and every form remain plain HTML — 3D never blocks them.</li>
        </ul>
      </Card>
      <p className="mt-3 text-[12px] text-ink-faint">
        Open a listing for the full viewer alongside booking: <Link href="/marketplace" className="text-electric hover:underline">marketplace →</Link>
      </p>
    </div>
  );
}
