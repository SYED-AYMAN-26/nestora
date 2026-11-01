# Nestora — 2D Conversion Report

**Scope:** convert the existing `rentlink3d` codebase from a 3D/WebGL product into a complete 2D
website, without changing the backend, the database, the API surface or any technical identifier.
**Backup taken before any change:** `backups/nestora-pre-2d-conversion-20261031-133726.tar.gz`
(11 MB, excludes `node_modules`, `.next`, `.git`).
**Base commit at start:** `e249a3b` (brand rebrand complete). All work below is uncommitted working-tree state.

---

## 1. What was removed

### 1.1 Files deleted

| Path | What it was |
|---|---|
| `src/components/three/Canvas3D.tsx` | WebGL canvas wrapper, WebGL capability probe, lazy mount, DPR cap |
| `src/components/three/HeroScene.tsx` | Homepage rotating 3D equipment scene |
| `src/components/three/ModelViewer.tsx` | Interactive model viewer used by the listing page |
| `src/components/three/Scene.tsx` | Shared R3F scene/lights/controls |
| `src/components/three/StagedModel.tsx` | Model staging + "Reset view" channel |
| `src/components/three/models.tsx` | 501-line procedural mesh library (14 model types) |
| `src/app/viewer/ViewerGallery.tsx` | 3D model picker + viewer gallery for `/viewer` |
| `public/img/_3d-canvas-only.png`, `_3d-proof-canvas.png`, `_3d-proof-model2.png`, `_3d-proof-viewer.png` | Screenshots produced by the old 3D checker |
| `scripts/check-3d.mjs` | 22-check WebGL/puppeteer suite (replaced, see §1.4) |

`src/components/three/` no longer exists.

### 1.2 Dependencies removed (`package.json` + `package-lock.json`)

| Package | Was | Why removed |
|---|---|---|
| `three` | `^0.187.0` | no renderer left |
| `@react-three/fiber` | `^9.8.2` | React bindings for three.js |
| `@react-three/drei` | `^10.7.9` | helpers (OrbitControls, contact shadows, environment) |
| `@types/three` | `^0.186.0` | type shim |

Verified after removal: `npm ls three` → `(empty)`; `grep -c '"three"\|@react-three' package-lock.json` → `0`.
Production dependencies now: `@vercel/blob`, `better-sqlite3`, `next`, `pg`, `react`, `react-dom`, `zod`
(the runtime got **smaller**, no new dependency was added for the 2D work).

### 1.3 3D UI surface removed

* `src/app/resources/[id]/Gallery.tsx` — the **"3D viewer" tab** and the "photo only — no 3D model"
  warning are gone. It is now a photo gallery: large image + thumbnail strip with `role="tab"` buttons.
* `src/components/ListingForm.tsx` — the **"3D model (optional)" select** and its `MODEL_KEYS` list are
  removed. The "Best for" field that shared its row is kept, full width.
* `src/app/page.tsx` — the 3D hero (`Canvas3D` + `HeroScene`) and the "Live 3D scene" badge are removed.
* `src/app/viewer/page.tsx` — was the "Interactive equipment viewer"; **the route is kept** so no
  bookmark or inbound link 404s, but it is now a 2D photographic equipment showcase.
* `src/app/provider/resources/page.tsx` — the per-listing "3D model: …" line is replaced with a
  "N photo(s) / no photos uploaded" line (real `resource_images` count).
* `src/app/help/page.tsx` — the "Illustrative: 3D models are procedural meshes…" bullet now explains
  the photo fallback instead.
* `src/app/verification-report/page.tsx` — the "3D & interface" section became "Interface (2D)".
* Homepage disclosure, footer and `layout.tsx` metadata no longer claim any 3D/explorable-in-3D capability.

### 1.4 Test coverage replaced, not deleted

`scripts/check-3d.mjs` (22 WebGL render checks) → **`scripts/check-2d.mjs` (37 checks)**. The new suite
asserts the same class of thing — that the interface really renders and really works in a browser —
against what now ships: no `<canvas>` anywhere, no WebGL context, homepage sections in order, every
image decodes, search round-trips, gallery switches, `/viewer` resolves as 2D, hover is a flat 2D
transform, and a **6-width responsive sweep (320/360/390/768/1024/1440 px)**.
`npm run verify:3d` → `npm run verify:2d`. `scripts/verify-all.mjs` gate 7 now runs `check-2d.mjs`.
The E2E suite's section 12 "3D & responsive surface" became **"2D interface & responsive surface"**
with 11 assertions replacing 5 (it still covers `/viewer`, a listing detail page, and a listing that
*does* still carry a `model_3d` value — proving the data is preserved while the UI stays 2D).

---

## 2. What was deliberately preserved

**`model_3d` is still there.** The column, its comment, both baseline migrations, the API request
schemas (`api/resources/create`, `api/resources/[id]`) and the zod update allow-list are untouched.
11 of the 22 seeded listings still store a `model_3d` value, and a test proves such a listing renders
normally. The column is simply no longer offered or used by the interface.

Untouched and verified working: `rl_session` cookie, `data/rentlink.db`, `RENTLINK_ALLOW_INSECURE_PROD`,
`DATABASE_URL`/`PG_*` handling, all `/api/*` routes (41 route files), all 30+ table names, storage
prefixes, migration filenames, `notes.source = "rentlink3d"`, `package.json name: "rentlink-3d"`,
the `Nestora` name and the "Discover Your Space. Experience It in 3D." brand tagline.

---

## 3. The 2D design system

The app was built dark-first (navy surfaces, translucent-white hairlines). Rewriting every page's
markup was unnecessary risk, so the **tokens** were remapped and the pages inherit a light theme:

* `src/app/globals.css` — new `@theme` block: white/`#f7fafc` surfaces, `#0c1b2a` navy ink,
  `#0f766e` teal accent, `#059669` emerald; `color-scheme: light`; light body gradient; light `.glass`
  card (white + hairline + soft shadow); light scrollbars; a **light-theme compatibility layer** that
  re-maps the dark-era `bg-white/N` / `border-white/N` / `text-*-200|300` utilities to navy-tinted,
  AA-contrast equivalents in one place.
* `.card-3d` keeps its name (used in markup) but is now a flat 2D translate-Y lift — no
  `preserve-3d`, no `perspective`, no `rotateX/rotateY`. Asserted in `check-2d.mjs`.
* `src/components/nav.tsx` — white sticky header, teal active pill, real dropdown menu panel.
* `src/components/ui.tsx`, `form.tsx` — badges/alerts/buttons/inputs re-toned for white surfaces.
* `primary` buttons are now solid teal with white text; every `text-navy-950`-on-accent combination
  was inverted to `text-white` (25 files) after a programmatic contrast audit on 31 pages found no
  remaining low-contrast text except decorative empty stars, which were also fixed.
* `layout.tsx` — `themeColor` `#06121f` → `#ffffff`, light footer, 3D copy removed from the description.

### Photography

8 photographs were generated for this deployment (1408×768 JPEG, 1.3 MB total) in
`public/img/photos/`: `hero`, `media`, `studio`, `space`, `lab`, `fablab`, `transport`, `photo-lab`.

`src/lib/photos.ts` resolves a listing image in this order: **uploaded photo → category photograph →
fallback**. Seeded rows point at `/img/<name>.svg` vector placeholders from the dark era; those are
treated as "no photo" so a real photograph is shown instead of a flat illustration. No database row
was rewritten to achieve this. Applied in `ResourceCard`, the listing detail gallery, `/viewer`,
`/compare`, `/bookings`, `/dashboard`, `/favourites`, `/recommend`, `/admin/resources` and
`/provider/resources`. All images carry explicit `width`/`height`, `loading="lazy"` (except the hero)
and honest alt text.

### Homepage (`src/app/page.tsx`, rewritten)

Nav (existing component) → hero with `<h1>` "Find the space and equipment already near you", discovery
form (`role="search"`, text + category, GET → `/marketplace`) → **Browse marketplace** and
**Create account** CTAs → live impact counters → photographic hero card → 6-tile 2D image gallery
(each linking to a filtered search) → 10 popular-category tiles with photography → 6 featured
top-rated listings from the database → verified-provider storefronts + demo sign-in panel →
how-it-works (4 steps) → trust & safety (4 pillars) → measured-impact stats (confirmed vs. estimate,
labelled) → closing CTA. Demo data is still tagged `DEMO DATA`; the provenance note is preserved.

---

## 4. Pages audited for the 2D design (all render 200)

`/`, `/marketplace`, `/resources/[id]`, `/resources/[id]/passport`, `/compare`, `/recommend`,
`/impact`, `/help`, `/login`, `/register`, `/onboarding`, `/dashboard`, `/bookings`, `/bookings/[id]`,
`/bookings/[id]/payment`, `/favourites`, `/notifications`, `/settings`, `/disputes`, `/disputes/new`,
`/disputes/[id]`, `/provider`, `/provider/new`, `/provider/resources`, `/provider/resources/[id]`,
`/provider/bookings`, `/provider/utilisation`, `/provider/verification`, `/admin`, `/admin/users`,
`/admin/verifications`, `/admin/resources`, `/admin/disputes`, `/admin/audit`,
`/storefront/[slug]`, `/viewer`, `/verification-report`, `/not-found`.

A scripted contrast/dark-surface audit ran across 31 of these (signed in as admin) and reported
**zero** large dark surfaces and zero non-decorative low-contrast text after the fixes.

---

## 5. Backend changes

**None to behaviour.** The only server-side edits are the E2E/verify harnesses and page-level SQL
*additions* needed by the new photography (selecting `r.category` or an image count alongside columns
that were already selected). No route, migration, schema, auth, payment, booking or storage logic was
modified.

---

## 6. Known limitations / honesty notes

* Photographs are **AI-generated stock imagery of the category**, not photographs of the actual
  listed items. Uploaded provider photos always take precedence. The alt text says "category
  photograph" when a substitution was made.
* `model_3d` is retained but unused by the UI — by design, to keep API and record compatibility.
* The brand tagline still reads "Experience It in 3D." as the user directed (brand line kept,
  functional 3D claims removed).
