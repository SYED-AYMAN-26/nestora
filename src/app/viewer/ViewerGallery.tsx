"use client";

import { useState } from "react";
import Link from "next/link";
import { ModelViewer } from "@/components/three/ModelViewer";
import { Card } from "@/components/ui";

export function ViewerGallery({ resources }: { resources: { id: number; title: string; model_3d: string }[] }) {
  const keys = Array.from(new Set(resources.map((r) => r.model_3d)));
  const [active, setActive] = useState(keys[0] ?? "camera");
  const sample = resources.find((r) => r.model_3d === active);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
      <Card className="min-w-0 p-3">
        <p className="mb-2 text-[11px] uppercase tracking-wider text-ink-faint">Choose a model</p>
        {/* Horizontal strip on small screens (scrolls inside its own container), stacked list on desktop. */}
        <div className="-mx-1 flex snap-x gap-1.5 overflow-x-auto px-1 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0">
          {keys.map((k) => {
            const r = resources.find((x) => x.model_3d === k);
            return (
              <button
                key={`m-${k}`}
                type="button"
                onClick={() => setActive(k)}
                aria-pressed={active === k}
                className={`w-36 shrink-0 snap-start rounded-lg border px-2.5 py-1.5 text-left text-[12px] transition lg:w-auto ${active === k ? "border-electric/50 bg-electric/12 text-electric" : "border-white/10 text-ink-dim hover:border-white/25"}`}
              >
                <span className="block capitalize">{k}</span>
                <span className="block truncate text-[10px] text-ink-faint">{r?.title}</span>
              </button>
            );
          })}
        </div>
      </Card>
      <div className="min-w-0">
        <ModelViewer modelKey={active} title={sample?.title ?? active} imageUrl={`/img/${active === "chip" ? "chip" : active}.svg`} height={420} />
        {sample && (
          <p className="mt-2 text-[12px] text-ink-faint">
            Example listing: <Link href={`/resources/${sample.id}`} className="text-electric hover:underline">{sample.title}</Link>
          </p>
        )}
      </div>
    </div>
  );
}
