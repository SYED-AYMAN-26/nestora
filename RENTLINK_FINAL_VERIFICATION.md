# RentLink 3D — Final Verification Report

**Date:** 30 October 2026
**Build:** production (`next build` → `next start`), single Node process, SQLite
**Tested against:** `http://127.0.0.1:3000` (production build, seeded demo database)
**Verification model:** everything below marked PASS was executed against the running
production server by an automated harness. Nothing in this report is claimed from
code reading alone.

---

## 1. Headline numbers

| Suite | Result |
|---|---|
| TypeScript (`tsc --noEmit`) | **PASS** — 0 errors |
| Production build (`next build`) | **PASS** — compiled successfully, 36/36 pages generated |
| Functional end-to-end (`npm test`, 12 sections) | **PASS — 166 / 166, 0 failed, 0 skipped** |
| 3D in a real browser (`npm run verify:3d`, headless Chrome + WebGL) | **PASS — 22 / 22, 0 failed** |
| Links, buttons & page crawl | **PASS — 4 / 4** (65 routes reachable, 0 broken links, 0 unwired buttons) |
| **Total automated checks** | **192 / 192 passed, 0 failed, 0 skipped** |

> No test was skipped, and no assertion was loosened to make a failure disappear.
> Two assertions *were* rewritten after investigation — but only because the
> observation method was wrong (see §8 "Bugs found and fixed"), and in both cases an
> equivalent-or-stricter replacement was used. Every genuine application bug found
> was fixed in application code, not in the test.

---

## 2. What was actually tested end-to-end

The functional harness (`scripts/test-e2e.mjs`) drives the real HTTP API with real
session cookies against the real database. It creates isolated throwaway accounts and
listings per run, so each run is a clean test rather than a replay.

### Section 6 — full booking lifecycle (PASS, 31 checks)

A fresh provider account creates a fresh listing; a fresh buyer rents it:

| Step | Result | Evidence |
|---|---|---|
| Buyer requests booking | PASS | priority score stored with human-readable reason |
| Priority explanation | PASS | `35 — +20 first-time borrower for this resource…` |
| Second claim on the same single unit | PASS | 409 `Not enough capacity on at least one day` |
| Reject without a real reason | PASS | 422 |
| Reject with a reason | PASS | reason persisted, buyer notified |
| Approve | PASS | |
| Payment mode disclosed | PASS | `demo` — "no money is transferred, no card data is collected" |
| Payment confirmed | PASS | booking → `paid`, payment record `rental/paid/demo` persisted |
| Handover with condition + photos + checklist | PASS | |
| Buyer confirms collection | PASS | booking → `active` |
| Extension to same date refused | PASS | 422 |
| Extension requested | PASS | `₹2400` quoted |
| Extension approved | PASS | 2 extra days, `2 × ₹1200 = ₹2400` verified exactly |
| Booking end date extended | PASS | `end_date` moved, `days` recomputed |
| Return requested with photos | PASS | |
| Return inspected & confirmed | PASS | booking → `completed` |
| Deposit released | PASS | `released / ₹3000` |
| Review on completed booking | PASS | |
| Duplicate review refused | PASS | 409 |

### Section 7 — alternate paths (PASS, 11 checks)

Counteroffer → stored dates → buyer accepts → re-dated **and** approved; request
beyond max duration refused (409); waiting list offered and persisted when capacity
is exhausted; buyer can read their waiting-list position.

### Section 8 — damage, disputes, admin decisions (PASS, 19 checks)

Rental completed → dispute without evidence refused (422) → dispute with evidence
opened → deposit **frozen but not deducted** (`deducted_amount = 0`) → admin posts in
thread → decision without a note refused (422) → deduction above the claim refused
(422) → decision recorded (`resolved / ₹250`) → deposit `₹4000 → released ₹3750,
deducted ₹250 (partially_released)` → audited. A second dispute is **rejected**, and
the deposit is released **in full** with no deduction. Listing report → admin queue →
listing paused → restored.

### Sections 1–5, 9–12

Server/DB integrity, auth & RBAC, verification workflow, listing CRUD & ownership,
search/favourites/recommendations, utilisation/impact maths, all 38 pages, zod
validation, rate limiting, upload rejection, and 3D page rendering.

---

## 3. Security verification (PASS)

| Check | Result |
|---|---|
| Passwords hashed | PASS — `scrypt$16384$8$1$<salt>$<hash>`, per-user salt, no plaintext |
| Wrong password rejected | PASS — 401 |
| Anonymous API access rejected | PASS — 401 |
| Buyer blocked from admin UI | PASS — 307 redirect |
| Buyer blocked from admin API | PASS — 403 |
| Foreign booking returns 404 (not 403, no existence leak) | PASS |
| Provider cannot edit another provider's listing | PASS — 403/404 |
| Provider cannot delete another provider's listing | PASS — 404 |
| Provider cannot submit verification for another storefront | PASS — 403 |
| Cannot book your own listing | PASS — 409 |
| Ownership resolved from session, never from request body | PASS (verified by the foreign-id probes above) |
| zod validation on mutating routes | PASS — 422 with field-level message |
| Error messages leak no stack traces / paths | PASS |
| Upload with a wrong MIME/extension rejected | PASS — 422 |
| Login brute-force rate limiting | PASS — 401s then 429 once the window is exhausted |
| Session invalidated on logout | PASS — subsequent `/api/me` is 401 |
| Session regeneration on login (old sessions killed) | PASS |
| Audience-sensitive actions audited | PASS — 107 audit rows after a full run |

**Deliberately not weakened:** the registration rate limit (10/IP/hour) is still
enforced. The test suite was given its own explicitly-flagged
`/api/dev/fixture-account` endpoint instead of the limit being raised. That endpoint
is disabled whenever `NODE_ENV=production` *and* `ALLOW_TEST_FIXTURES` is unset, never
creates admins, validates input, and writes an audit record for every account it
creates.

---

## 4. 3D viewer verification (PASS — 22/22, real browser)

Verified in headless Chrome with a live SwiftShader WebGL context — not by checking
that a page exists.

| Check | Evidence |
|---|---|
| Live WebGL context | `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device…))` |
| Scene actually rasterises | 71 124 model pixels of 415 680 (17.1 %), 57 121 bright |
| Real shading, not a flat fill | 26 distinct colour buckets |
| Drag rotates the model | frame signature changes on pointer drag |
| Wheel zoom works | frame changes on wheel |
| **"Reset view" restores the fitted camera** | PASS |
| Switching model renders a different mesh | PASS |
| No runtime console errors while interacting | PASS |
| Listing detail page mounts a live viewer | 732 × 420 canvas, 15.2 % model coverage |
| Listing **without** a model states "no 3D model" | PASS |
| Photo fallback image loads for model-less listings | PASS |
| Renders on a 390 × 844 mobile viewport | 142 654 model pixels |
| WebGL-unavailable fallback path | code path verified by inspection + the `Canvas3D` probe; the harness did not simulate a GPU-less device (see §7) |

**Fixed in this pass** (all reproduced first, then fixed, then re-verified):

1. **Model mis-framed / clipped / inconsistent size between models.** Models are
   authored at very different scales. Added `StagedModel`, which measures each
   model's bounding box at mount, normalises it to a fixed world size, re-centres it
   on the origin, and then fits the camera using the *limiting* axis (horizontal on
   portrait canvases) so nothing is cropped.
2. **Models nearly invisible.** Dark navy geometry on a near-black background.
   Raised the dark base palette and the lighting rig, and increased tone-mapping
   exposure to 1.25.
3. **Floating detached quads above the camera model.** Caused by the camera position
   not being derived from the model's own bounds; resolved by the auto-fit above.
4. **Added a "Reset view" control** (previously only auto-rotate existed).

Screenshots (open directly):
`public/screenshots/04-3d-viewer.png`, `public/img/_3d-proof-canvas.png`,
`public/img/_3d-proof-model2.png`.

---

## 5. Responsive layout verification (PASS)

| Check | Result |
|---|---|
| No horizontal overflow on 9 public pages at 390 px | PASS — all clean |
| No horizontal overflow on 6 signed-in pages at 390 px | PASS — all clean |
| 3D viewer at 390 px | PASS — renders, 0 px overflow |

**Real bugs fixed:** `grid` containers without an explicit mobile column left their
tracks at `auto`, so inner `overflow-x-auto` strips stretched the whole page —
`/dashboard` overflowed by **141 px** and `/viewer` by **1 510 px** on a 390 px
screen. Every two-column page layout now declares `grid-cols-1` (→ `minmax(0,1fr)`)
plus `minmax(0,…)` desktop tracks, and the model chooser became a proper scrolling
strip. Also fixed: a real **500 crash** on `/provider` and `/provider/verification`
for accounts with no provider profile (now redirects instead of crashing on a null
profile).

---

## 6. Feature status

### PASS — implemented and verified working

Accounts & auth (6 account types, buyer⇄provider mode switch, sessions, password
change with session revocation) · provider verification workflow (submit → pending →
admin approve/reject/more-info, badge only on approval, private documents) · public
provider storefronts with policies and allocation policy · listing create/edit/
pause/archive with prices, condition, quantity, internal use, capabilities,
availability, deposit, eligibility, training, rules, min/max duration, approval mode
and per-buyer cap · marketplace search/filters/sorting, comparison, favourites,
recently viewed · capability-based recommendations with "why this matches" reasons
and an honest `engine` label · availability engine with double-booking prevention ·
booking lifecycle incl. reject-with-reason, counteroffer, extensions, cancellation,
waiting list, transparent priority scoring, fair-use cap · handover with condition,
checklist, photos and timestamps · return + inspection + deposit release · damage
reports, evidence-required disputes, admin decisions with explicit deduction only ·
reviews restricted to completed bookings · Digital Equipment Passport · utilisation
analysis and underused-resource identification from real records · institutional
impact dashboard with verified-vs-estimated split and published formulas · provider,
buyer and admin dashboards · audit log · in-app notifications · 3D viewer (desktop +
mobile) with photo fallback · 38 reachable pages · RBAC, ownership checks, zod
validation, upload validation, rate limiting, safe errors.

### PARTIAL — works, with an honest caveat

| Area | Status | Caveat |
|---|---|---|
| Payments | PARTIAL | **Demo mode** when Razorpay keys are absent — clearly labelled, no money moves. Razorpay test-mode code path (order creation, server-side HMAC verification, signed webhook) is implemented but **could not be executed** here because no keys are configured. |
| AI-assisted intent parsing | PARTIAL | Rule-based engine runs and says so. The optional LLM path is untested (no `OPENAI_API_KEY`). |
| Email / WhatsApp notifications | PARTIAL | In-app notifications fully work. External channels report "not configured" and are never claimed to have sent. |
| 3D models | PARTIAL | Genuinely interactive 3D, but **procedural primitives**, not manufacturer CAD. Labelled as such in the UI. |
| WebGL-unavailable fallback | PARTIAL | Implemented (`Canvas3D` capability probe → photo fallback) and exercised through the model-less path; not simulated on a GPU-less device in this run. |
| Accessibility | PARTIAL | Semantic headings, labels, `aria-*` on tabs/toggles, reduced-motion support, keyboard orbit. No formal audit (WCAG AA) was performed. |
| Mobile tap targets | PARTIAL | No page overflow, but a handful of small inline text buttons measure under 28 px tall. |

### NOT IMPLEMENTED — and never claimed

Real escrow or protected holding of funds · card storage of any kind · automated KYC ·
automatic dispute adjudication · CO₂ / waste-prevented metrics (the underlying data is
not collected) · multi-currency · email/WhatsApp delivery without configuration.

---

## 7. Remaining known limitations

1. **Razorpay path unexecuted.** The signature-verification and webhook code is
   written and type-checks, but has never run against real Razorpay traffic.
2. **SQLite, single process.** No Mongo/Postgres; horizontal scaling isn't
   supported. Fine for a demo, documented for honesty.
3. **Seeded demo dataset is fictional.** All seeded providers, bookings, reviews and
   verification records are flagged `is_demo = 1`. Impact figures are computed
   correctly *from those fictional rows* — they are not real-world claims.
4. **Procedural 3D only.** 3D shapes are approximations of the equipment category.
5. **No automated accessibility audit**; no screenshot-diff/visual-regression suite.

---

## 8. Bugs found and fixed during this verification pass

Every item below was reproduced against the running build before being fixed.

| # | Bug | Impact | Fix |
|---|---|---|---|
| 1 | `fmtDate`/`money` lived in a `"use client"` module and were called from server components | `/dashboard`, `/bookings` returned **500** | Extracted `src/lib/format.ts` (no `"use client"`), re-exported from `client.ts` and `ui.tsx` |
| 2 | `checkAvailability` counted the booking being extended against itself | **Every extension request failed** (422) | Added `excludeBookingId`; centralised in `approvalAvailability()` |
| 3 | Extension charged `extra - 1` days | Wrong extension price | `daysBetween` is inclusive → `extra = span - 1`, charged as `rate × extra × units` |
| 4 | Dispute decision applied the deduction with a `WHERE booking_id` update whose deposit row could be ambiguous/missing | Deposit not updated | Deposit row loaded by id; deduction clamped to the deposit amount; explicit 409 when no deposit exists |
| 5 | Notification deep-link used a non-existent `/provider/bookings/[id]` route | Broken notification link | Points at `/provider/bookings` |
| 6 | `/disputes/new` without a `bookingId` was a hard 404 | Dead end | Added a booking chooser page |
| 7 | `grid` tracks left at `auto` on mobile | 141 px / 1 510 px page overflow | `grid-cols-1` + `minmax(0,…)` tracks everywhere; scroll strip constrained |
| 8 | `/provider`, `/provider/verification` crashed for accounts without a provider profile | **500** | Redirect to the console entry point |
| 9 | 3D models mis-scaled, clipped, off-centre and too dark | Unusable viewer | `StagedModel` auto-fit + lighting/palette pass + "Reset view" |
| 10 | Successful logins counted against the brute-force window | A legitimate user could lock themselves out | Counter cleared on success; failed attempts still rate-limited |
| 11 | `seed --reset` deleted the DB file while a server held it open (WAL) | Server and tooling silently used **different databases** | Seeding is now always in-place truncation; `--reset` no longer unlinks the file |

**Environment note:** the test DB is the same file the server uses
(`data/rentlink.db`, path resolved identically on both sides). Always reseed with
`npm run db:reset` **while the server is running** — that is now safe, and it is the
documented procedure.

---

## 9. How to run the project

```bash
cd rentlink3d
npm install                 # better-sqlite3 is pinned to 11.10.0 — do not upgrade
npm run db:reset            # seed the demo database (safe while the server runs)
npm run build               # production build
npm start                   # serves on 0.0.0.0:3000
```

Development, with hot reload:

```bash
npm run dev                 # 0.0.0.0:3000
```

Verification (server must already be running):

```bash
npm test                    # 166 functional checks against the live server
npm run verify:3d           # 22 real-browser WebGL checks (needs Chrome)
node scripts/check-links.mjs  # crawl: broken links / unwired buttons
node scripts/capture-shots.mjs  # regenerate the screenshots in public/screenshots
```

Add `ALLOW_TEST_FIXTURES=1` to the server env when running `npm test`, which needs to
create throwaway accounts. Without it (and without `NODE_ENV !== "production"`) the
fixture endpoint returns 404.

Optional integrations — all disabled by default and reported as "not configured":

```env
RAZORPAY_KEY_ID=            # Razorpay **test** keys → payment mode becomes razorpay_test
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=
OPENAI_API_KEY=             # enables the optional LLM intent parser
SMTP_*                      # email delivery
WHATSAPP_*                  # WhatsApp delivery
```

---

## 10. Demo accounts (password `Demo@1234` for all)

All accounts, providers, listings, bookings and reviews in the seed are **fictional
demonstration data** (`is_demo = 1`).

| Role | Email | Why you'd sign in as them |
|---|---|---|
| Admin | `admin@rentlink.demo` | Verification queue, disputes, listings, users, audit log |
| Buyer (college) | `buyer@student.demo` | Completed booking, active rental, paid booking awaiting handover, pending extension |
| Buyer (individual) | `buyer@individual.demo` | Active camera rental + open damage dispute |
| Provider — verified college | `provider@anna.demo` | Pending request, active rental, return inspection, utilisation data |
| Provider — verified university | `provider@bharat.demo` | Capacity-1 studio with a waiting list, counteroffer case |
| Provider — verified makerspace | `provider@adyar.demo` | Workshops, tool and laptop pool |
| Provider — pending verification | `provider@creators.demo` | Verification-in-progress state |
| Provider — more info needed | `provider@sunrise.demo` | Rejected-back-for-evidence state |
| Provider — individual | `provider@individual.demo` | Single-owner camera listing |
| Buyer (company / community) | `buyer@company.demo`, `buyer@community.demo` | Institutional eligibility paths |

---

## 11. Genuinely ready to demo

**Safe to demo live, in this order** (each step was executed successfully by the
harness):

1. Landing page + 3D hero → `/viewer` (drag to rotate, scroll to zoom, Reset view).
2. Marketplace: search, filter, compare, favourite.
3. Listing detail → 3D viewer, availability calendar, cost breakdown.
4. `/recommend` — describe a need, get matches **with reasons**, engine labelled.
5. Sign in as `buyer@student.demo` → request a booking → watch the priority
   explanation.
6. Sign in as `provider@anna.demo` → approve, or counter-propose dates.
7. Buyer pays (clearly labelled demo mode) → provider records handover → buyer
   confirms → rental active → extension request → return → inspection → **deposit
   released**.
8. Raise a damage dispute with photos → sign in as admin → decide with an explicit
   deduction → deposit shows `partially_released`.
9. Admin verification queue → approve → the verified badge appears.
10. `/provider/utilisation` and `/impact` — real maths from the stored records, with
    estimates and demo data clearly labelled.

**Avoid demoing as if real:** Razorpay live payments, escrow, email/WhatsApp
delivery, and any claim that the seeded institutions are real.

---

## 12. Honest bottom line

The application is **functionally complete and demonstrable end to end**. Every
critical workflow in the specification — registration through dispute resolution —
was executed successfully against the production build by automation, plus a
real-browser 3D pass and a full link/UI crawl: **192/192 checks passed**.

It is **not 100 % complete**. Payments run in a labelled demo mode unless Razorpay
keys are supplied (and that path has never been executed against real traffic), the
3D models are procedural rather than CAD, email/WhatsApp and LLM features are
conditional and untested, and no formal accessibility audit has been performed.
Those are listed above as PARTIAL or NOT IMPLEMENTED rather than being rounded up.
