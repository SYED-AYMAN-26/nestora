"use client";

import { useState } from "react";
import { listingPhoto, listingPhotoAlt } from "@/lib/photos";

/**
 * Photo gallery for a listing detail page.
 *
 * Previously this component carried a "3D viewer" tab that mounted a WebGL
 * canvas. The conversion removes that tab entirely: the gallery is photographs
 * only, with a large active image and a thumbnail strip. Listings whose stored
 * image is a vector placeholder are shown with their category photograph (see
 * `@/lib/photos`), so every listing has a real image without touching data.
 */
export function Gallery({
  images,
  title,
  category,
}: {
  images: string[];
  title: string;
  category?: string | null;
}) {
  const [active, setActive] = useState(0);
  const sources = images.length ? images : [null];
  const current = sources[Math.min(active, sources.length - 1)];

  return (
    <div>
      <div className="relative aspect-[16/10] overflow-hidden rounded-2xl border border-white/12 bg-navy-850">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={listingPhoto(current, category)}
          alt={listingPhotoAlt(title, current)}
          width={1408}
          height={768}
          className="h-full w-full object-cover"
          fetchPriority="high"
        />
        {sources.length > 1 && (
          <span className="absolute right-3 top-3 rounded-md bg-white/95 px-2 py-0.5 text-[11px] font-medium text-ink-dim shadow-sm">
            {active + 1} / {sources.length}
          </span>
        )}
      </div>

      {sources.length > 1 && (
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label={`${title} photos`}>
          {sources.map((src, i) => (
            <button
              key={`${src ?? "default"}-${i}`}
              type="button"
              role="tab"
              onClick={() => setActive(i)}
              aria-selected={i === active}
              aria-label={`Show photo ${i + 1}`}
              className={`h-14 w-20 shrink-0 overflow-hidden rounded-lg border transition ${
                i === active ? "border-electric ring-1 ring-electric/30" : "border-white/12 opacity-75 hover:opacity-100"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={listingPhoto(src, category)}
                alt=""
                width={1408}
                height={768}
                loading="lazy"
                className="h-full w-full object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
