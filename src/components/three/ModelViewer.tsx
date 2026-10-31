"use client";

import { Suspense, useState } from "react";
import { ContactShadows, Html } from "@react-three/drei";
import { StagedModel, requestCameraReset } from "./StagedModel";
import { Canvas3D } from "./Canvas3D";
import { MODELS, MODEL_LABEL } from "./models";
import { usePrefersReducedMotion } from "../motion";

/**
 * Interactive equipment viewer: rotate + zoom with mouse/touch or keyboard.
 * If a resource has no procedural model, we say so plainly and show a photo.
 */
export function ModelViewer({
  modelKey,
  title,
  imageUrl,
  height = 460,
}: {
  modelKey?: string | null;
  title: string;
  imageUrl?: string | null;
  height?: number;
}) {
  const [autoRotate, setAutoRotate] = useState(true);
  const reduced = usePrefersReducedMotion();
  const key = modelKey && MODELS[modelKey] ? modelKey : null;

  if (!key) {
    return (
      <div className="glass overflow-hidden rounded-2xl">
        <div className="relative aspect-[4/3] w-full bg-navy-900">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {imageUrl ? <img src={imageUrl} alt={title} className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-ink-faint">No image</div>}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-navy-950 via-navy-950/70 to-transparent p-3">
            <p className="text-[11px] uppercase tracking-[0.14em] text-amber-300">Photo only — no 3D model</p>
            <p className="mt-0.5 text-xs text-ink-dim">
              This listing has no 3D model attached, so we show a photo. We don&apos;t pass images off as interactive 3D.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const Model = MODELS[key];

  return (
    <div className="glass overflow-hidden rounded-2xl">
      <Canvas3D
        height={height}
        label={`Interactive 3D model of ${title}`}
        fallback={
          <div className="relative h-full w-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {imageUrl && <img src={imageUrl} alt={title} className="h-full w-full object-cover" />}
            <div className="absolute inset-0 grid place-items-center bg-navy-950/80 p-4 text-center">
              <p className="text-xs text-ink-dim">
                3D isn&apos;t available on this device (no WebGL). Showing the listing photo instead.
              </p>
            </div>
          </div>
        }
      >
        <Suspense fallback={null}>
          {/* StagedModel auto-frames and auto-exposes whatever the model's native size. */}
          <StagedModel autoRotate={autoRotate && !reduced}>
            <Model />
          </StagedModel>
          <ContactShadows position={[0, -1.15, 0]} opacity={0.55} scale={8} blur={2.6} far={4} color="#000000" />
          <Html center>
            <span className="sr-only">{MODEL_LABEL[key]} — interactive model</span>
          </Html>
        </Suspense>
      </Canvas3D>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/8 px-3 py-2.5">
        <p className="text-[11px] leading-relaxed text-ink-faint">
          <span className="font-semibold text-ink-dim">Procedural 3D model.</span> Built from primitives as a stylised
          representation — interactive, but not a manufacturer-accurate CAD asset.
        </p>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setAutoRotate((v) => !v)}
            className="rounded-md border border-white/12 px-2 py-1 text-[11px] text-ink-dim hover:border-electric/40 hover:text-ink"
            aria-pressed={autoRotate}
          >
            {autoRotate ? "Pause rotation" : "Auto-rotate"}
          </button>
          <button
            type="button"
            onClick={requestCameraReset}
            className="rounded-md border border-white/12 px-2 py-1 text-[11px] text-ink-dim hover:border-electric/40 hover:text-ink"
          >
            Reset view
          </button>
          <span className="hidden rounded-md border border-white/8 px-2 py-1 text-[11px] text-ink-faint sm:inline">
            drag to rotate · scroll to zoom
          </span>
        </div>
      </div>
    </div>
  );
}


