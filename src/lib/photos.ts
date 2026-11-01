/**
 * Category photography for the 2D marketplace UI.
 *
 * The seeded listings carry flat vector placeholders (`/img/<name>.svg`) that
 * were drawn for the dark 3D era. The 2D redesign uses real photographs, but we
 * must not rewrite seeded database rows to achieve that — so the mapping lives
 * here, at the presentation layer, and is applied wherever an image is shown.
 *
 * Resolution order for a listing image:
 *   1. a photo URL stored on the record (resource_images.url), when present
 *   2. the category photograph for the listing's category
 *   3. a neutral fallback photograph
 *
 * `next.config` is not involved: these are plain <img> tags with explicit
 * width/height and lazy loading, so no image CDN or loader config is required.
 */

/** Photographs generated for this deployment, all 1408x768 JPEG. */
export const PHOTOS = {
  hero: "/img/photos/hero.jpg",
  media: "/img/photos/media.jpg",
  studio: "/img/photos/studio.jpg",
  space: "/img/photos/space.jpg",
  lab: "/img/photos/lab.jpg",
  fablab: "/img/photos/fablab.jpg",
  transport: "/img/photos/transport.jpg",
  photoLab: "/img/photos/photo-lab.jpg",
} as const;

export type PhotoKey = keyof typeof PHOTOS;

/**
 * Category slug -> photograph. Slugs come from `src/lib/taxonomy.json`; the
 * mapping is exhaustive for today's ten categories and falls back safely if the
 * taxonomy grows before this file does.
 */
const BY_CATEGORY: Record<string, PhotoKey> = {
  "cameras-photography": "media",
  "audio-visual": "studio",
  "computing": "hero",
  "robotics-electronics": "lab",
  "lab-equipment": "lab",
  "3d-printing": "fablab",
  "spaces-rooms": "space",
  "event-equipment": "studio",
  "vehicles-transport": "transport",
  "tools-workshop": "fablab",
};

const FALLBACK: PhotoKey = "media";

/** Photography shared out across the non-category hero surfaces. */
export const GALLERY: { src: string; alt: string; caption: string; href: string }[] = [
  {
    src: PHOTOS.hero,
    alt: "Shared equipment store with cameras, a projector, a microphone and a 3D printer on a light oak bench",
    caption: "Equipment libraries",
    href: "/marketplace?category=cameras-photography",
  },
  {
    src: PHOTOS.space,
    alt: "Empty bright seminar hall with pale wooden chairs and full-height windows",
    caption: "Rooms, studios & halls",
    href: "/marketplace?category=spaces-rooms",
  },
  {
    src: PHOTOS.lab,
    alt: "Robotics lab bench with a small robotic arm, oscilloscope and laptop",
    caption: "Labs & robotics",
    href: "/marketplace?category=robotics-electronics",
  },
  {
    src: PHOTOS.fablab,
    alt: "Makerspace bench with a 3D printer, filament spools and power tools",
    caption: "Fabrication & tools",
    href: "/marketplace?category=3d-printing",
  },
  {
    src: PHOTOS.studio,
    alt: "Podcast recording studio with a boom-mounted condenser microphone and audio interface",
    caption: "Audio & recording",
    href: "/marketplace?category=audio-visual",
  },
  {
    src: PHOTOS.transport,
    alt: "White passenger van parked outside a modern campus building",
    caption: "Vehicles & transport",
    href: "/marketplace?category=vehicles-transport",
  },
];

export function categoryPhoto(category?: string | null): string {
  const key = (category && BY_CATEGORY[category]) || FALLBACK;
  return PHOTOS[key];
}

/**
 * Seeded rows point at `/img/<slug>.svg` vector placeholders. Those are not
 * photographs, so they are replaced with the category photograph; anything else
 * (an uploaded photo, a Blob URL) is respected as-is.
 */
export function listingPhoto(imageUrl?: string | null, category?: string | null): string {
  if (imageUrl && !imageUrl.endsWith(".svg")) return imageUrl;
  return categoryPhoto(category);
}

/** Alt text that is honest about the substitution. */
export function listingPhotoAlt(title: string, imageUrl?: string | null): string {
  if (imageUrl && !imageUrl.endsWith(".svg")) return title;
  return `${title} — category photograph`;
}
