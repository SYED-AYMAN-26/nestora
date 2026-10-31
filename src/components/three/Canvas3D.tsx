"use client";

import { Suspense, lazy, useEffect, useState, type ReactNode } from "react";
import { usePrefersReducedMotion } from "../motion";

const Scene = lazy(() => import("./Scene"));

/**
 * Guards every 3D surface:
 *  - WebGL support check → 2D fallback if unavailable
 *  - respects prefers-reduced-motion (renders a still frame, no auto-rotation)
 *  - lazy-loads three.js so it never blocks first paint or essential UI
 *  - DPR capped for mobile GPUs
 */
export function Canvas3D({
  children,
  fallback,
  height = 420,
  className = "",
  label,
}: {
  children: ReactNode;
  fallback: ReactNode;
  height?: number;
  className?: string;
  label: string;
}) {
  const [status, setStatus] = useState<"loading" | "ready" | "unsupported">("loading");
  const [inView, setInView] = useState(false);
  const reduced = usePrefersReducedMotion();
  const [mount, setMount] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    // WebGL capability probe before we even load three.js.
    try {
      const c = document.createElement("canvas");
      const gl = c.getContext("webgl2") || c.getContext("webgl");
      if (!gl) return setStatus("unsupported");
      setStatus("ready");
    } catch {
      setStatus("unsupported");
    }
  }, []);

  useEffect(() => {
    if (!mount) return;
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && (setInView(true), io.disconnect())),
      { rootMargin: "200px" }
    );
    io.observe(mount);
    return () => io.disconnect();
  }, [mount]);

  const show3D = status === "ready" && inView;

  return (
    <div
      ref={setMount}
      className={`relative overflow-hidden ${className}`}
      style={{ minHeight: height }}
      role="img"
      aria-label={label}
    >
      {show3D ? (
        <Suspense fallback={<div className="absolute inset-0 skeleton rounded-2xl" />}>
          <Scene reducedMotion={reduced} height={height}>
            {children}
          </Scene>
        </Suspense>
      ) : status === "unsupported" ? (
        <div className="absolute inset-0">{fallback}</div>
      ) : (
        <div className="absolute inset-0 skeleton rounded-2xl" />
      )}
      {show3D && !reduced && (
        <p className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full border border-white/10 bg-navy-950/70 px-3 py-1 text-[10px] uppercase tracking-[0.15em] text-ink-faint backdrop-blur">
          Live 3D · drag to rotate
        </p>
      )}
    </div>
  );
}

export { Scene };
