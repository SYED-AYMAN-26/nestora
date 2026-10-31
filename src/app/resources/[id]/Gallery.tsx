"use client";

import { useState } from "react";
import { ModelViewer } from "@/components/three/ModelViewer";

/**
 * Photo gallery with an optional "3D" tab. The 3D tab exists only when the
 * listing actually has a model; otherwise the UI plainly states there isn't one.
 */
export function Gallery({ images, title, modelKey }: { images: string[]; title: string; modelKey?: string | null }) {
  const hasModel = Boolean(modelKey);
  const [tab, setTab] = useState<"photos" | "3d">(hasModel ? "3d" : "photos");
  const [active, setActive] = useState(0);

  return (
    <div>
      <div className="mb-2.5 flex gap-1.5" role="tablist" aria-label="Media">
        <button
          role="tab"
          aria-selected={tab === "photos"}
          onClick={() => setTab("photos")}
          className={`rounded-lg border px-3 py-1.5 text-[12px] ${tab === "photos" ? "border-electric/50 bg-electric/12 text-electric" : "border-white/12 text-ink-dim hover:border-white/25"}`}
        >
          Photos ({images.length})
        </button>
        <button
          role="tab"
          aria-selected={tab === "3d"}
          onClick={() => setTab("3d")}
          className={`rounded-lg border px-3 py-1.5 text-[12px] ${tab === "3d" ? "border-electric/50 bg-electric/12 text-electric" : "border-white/12 text-ink-dim hover:border-white/25"}`}
        >
          3D viewer {hasModel ? "" : "(unavailable)"}
        </button>
      </div>

      {!hasModel && (
        <p className="mb-2 rounded-lg border border-amber-400/25 bg-amber-400/8 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-200/90">
          <span className="font-semibold">Photo only — no 3D model for this listing.</span>{" "}
          We show photos instead of passing a flat image off as interactive 3D.
        </p>
      )}

      {tab === "photos" ? (
        <div>
          <div className="relative aspect-[16/10] overflow-hidden rounded-2xl border border-white/10 bg-navy-900">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={images[active] || "/img/camera.svg"} alt={`${title} — photo ${active + 1}`} className="h-full w-full object-cover" />
          </div>
          {images.length > 1 && (
            <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
              {images.map((src, i) => (
                <button
                  key={src + i}
                  onClick={() => setActive(i)}
                  aria-label={`Show photo ${i + 1}`}
                  aria-current={i === active}
                  className={`h-14 w-20 shrink-0 overflow-hidden rounded-lg border transition ${i === active ? "border-electric" : "border-white/12 opacity-70 hover:opacity-100"}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <ModelViewer modelKey={modelKey} title={title} imageUrl={images[0]} height={420} />
      )}
    </div>
  );
}
