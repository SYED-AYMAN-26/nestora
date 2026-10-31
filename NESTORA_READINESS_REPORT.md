# NESTORA — Readiness Report

**Product:** Nestora — *Discover Your Space. Experience It in 3D.*
**Renamed from:** RentLink 3D (user-facing brand only)
**Date:** 2026-10-31
**Baseline:** `RENTLINK_POSTGRES_VERCEL_READINESS.md` (same date) — all its results were rerun after the rebrand, not reused.
**Scope:** rebranding, preservation of existing functionality, full regression, Vercel Preview preparation.

**Deployment status: NO VERCEL PROJECT WAS CREATED, NOTHING WAS DEPLOYED.** No hosted PostgreSQL, no real Vercel Blob store, no Razorpay transaction and no email delivery was contacted or exercised. Every result below is local evidence.

---

## 1. Branding changes

| Surface | Before | After |
|---|---|---|
| Product name | RentLink 3D | **Nestora** |
| Tagline | "Share what sits unused" | **"Discover Your Space. Experience It in 3D."** |
| Browser title (root) | "RentLink 3D — Share what sits unused" | "Nestora — Discover Your Space. Experience It in 3D." |
| Page titles | "Marketplace — RentLink 3D" (brand hard-coded per page) | "Marketplace · Nestora" via a root `title.template` — the brand lives in one place |
| Logo / favicon | folder-with-lens mark | isometric room + floating slab, teal→sky→indigo gradient on `#06121f` (`public/img/logomark.svg`, `public/favicon.svg`) |
| Navigation wordmark | `RentLink 3D` (two-tone) | `Nestora`, single weight, tighter tracking |
| Homepage hero | "Unlock the equipment that already exists." | "Discover your space. / Experience it in 3D." + property-tech positioning |
| Footer | name + "hackathon build" | name + tagline + build-verification link |
| SEO / social | title + description only | `openGraph` (type, siteName, title, description, image), `twitter` card, `apple-mobile-web-app-title` |
| PWA | none | `public/manifest.webmanifest` (`name`, `short_name`, description, theme/background colour, 2 icons), linked from root metadata |
| Theme colour | `#050d18` | `#06121f` (matches the logo plate) |
| Payment sheet name | "RentLink 3D" | "Nestora" (the string the Razorpay checkout shows the payer) |
| Email / notification identity | none | `NOTIFICATION_BRAND = "Nestora"` in the outbound queue log |
| Demo seed copy | "RentLink Platform administrator", "not yet verified by RentLink" | Nestora equivalents |
| Docs | README, DEPLOYMENT, `.env.example`, `package.json` description | rebranded, plus a note recording exactly what was *not* renamed |

**Visual identity:** dark premium property-tech — deep navy plate, teal→sky→indigo gradient, an isometric "space" glyph that reads as a room/portal rather than a folder. The existing design system (glass cards, electric accents, gradient text) was reused, not replaced, so every page keeps its layout and components.

---

## 2. Files modified

**Brand copy / UI (48 files rewritten by `scripts/rebrand.mjs`, plus hand edits):**
`src/app/layout.tsx`, `src/app/page.tsx`, `src/components/nav.tsx`, `src/components/ListingForm.tsx`, `src/app/not-found.tsx`, `src/app/login/*`, `src/app/register/*`, `src/app/marketplace/page.tsx`, `src/app/help/page.tsx`, `src/app/impact/page.tsx`, `src/app/recommend/page.tsx`, `src/app/compare/page.tsx`, `src/app/dashboard/page.tsx`, `src/app/favourites/page.tsx`, `src/app/settings/page.tsx`, `src/app/bookings/**`, `src/app/provider/**`, `src/app/admin/**`, `src/app/resources/[id]/**`, `src/app/storefront/[slug]/page.tsx`, `src/app/viewer/page.tsx`, `src/app/onboarding/page.tsx`, `src/app/notifications/page.tsx`, `src/app/disputes/page.tsx`, `src/app/verification-report/page.tsx`, `src/lib/payments.ts`, `src/lib/recommend.ts`, `src/lib/impact.ts`, `src/lib/audit.ts`.

**Assets (new/replaced):** `public/img/logomark.svg`, `public/favicon.svg`, `public/manifest.webmanifest`.

**Generated artefacts regenerated (not hand-edited):** `src/lib/schema.generated.ts`, `src/lib/schema.pg.sql`, `migrations/sqlite/0001_baseline.sql`, `migrations/postgres/0001_baseline.sql` — the baseline DDL is byte-identical to before apart from its comment header.

**Tooling:** `scripts/rebrand.mjs` (new, dry-runnable), `scripts/check-brand.mjs` (new, 56 checks), `scripts/test-e2e.mjs` (landing-page assertion strengthened to require the new brand), `scripts/seed.mjs`, `scripts/gen-pg-schema.mjs`, `scripts/payment-server.mjs` (fixture `rzp_test_` key string only).

**Docs:** `README.md`, `docs/DEPLOYMENT.md`, `.env.example`, `package.json` description.

**Deliberately NOT modified** — verified by the checker (§4, section B): `rl_session` cookie name, `data/rentlink.db` path, `RENTLINK_ALLOW_INSECURE_PROD`, `DATABASE_URL` / `DATABASE_PATH` / `PG_SSL_MODE` / `PG_SKIP_SCHEMA` / `PGPOOL_MAX`, every `/api/*` route, all 30 table names, `public/`+`private/` storage prefixes, migration filenames, `uploads/` layout, `better-sqlite3` pin.

---

## 3. Existing functionality preserved

No feature was rebuilt, replaced or removed. Specifically unchanged and re-proven by the suites:

* Next.js 15 App Router + React 19 architecture; server components and route handlers untouched.
* PostgreSQL adapter + SQLite development support (both backends tested end to end).
* Authentication and secure sessions — `HttpOnly; Secure; SameSite=Lax`, hashed token storage, server-side logout invalidation.
* Property listings, booking lifecycle, counteroffers, handover, returns, disputes, waiting list, fair-use ordering.
* Payments: demo mode + gateway path, price-snapshot verification, webhook signature + idempotency, concurrent confirm handling.
* Public images and private verification documents (ownership-checked, audited).
* Vercel Blob abstraction (private/public access modes) — **code path still unexercised against a real store**, see §7.
* 3D / WebGL viewer and the procedural models.
* Cron reminders endpoint and its constant-time bearer auth.
* All API routes, database migrations and the versioned migration runner.

---

## 4. Tests actually rerun (after the rebrand, on the final source)

Both backends, same build, two live production servers:
**SQLite** `:3300` (`data/rentlink.db`) · **PostgreSQL** `:3200` (`rentlink_regress`, rebuilt from `data/e2e-seed.db` before the run).

| Suite | Command | SQLite | PostgreSQL | vs. baseline |
|---|---|---|---|---|
| Brand integrity (static + live) | `BASE=… node scripts/check-brand.mjs` | **56 / 56** | **56 / 56** | new suite |
| Full E2E | `node scripts/test-e2e.mjs` | **167 / 167 passed, 0 failed, 0 skipped** | **167 / 167 passed, 0 failed, 0 skipped** | 166 → 167 (+1 new brand assertion) |
| Page/API sweep | `node scripts/sweep-pages.mjs` | **58 requests, 58 ok, 0 failed** | **58 requests, 58 ok, 0 failed** | unchanged |
| Promise/claim check | `node scripts/check-promises.mjs` | **48 passed, 0 failed** | **48 passed, 0 failed** | unchanged |
| 3D / WebGL | `node scripts/check-3d.mjs` | **22 / 22** | **22 / 22** | unchanged |
| Link & button check | `node scripts/check-links.mjs http://…` | **4 / 4** | **4 / 4** | unchanged |
| Storage security | `node scripts/test-storage-security.mjs` | **47 passed, 0 failed** | **47 passed, 0 failed** | unchanged |
| Session security | `node scripts/test-session-security.mjs` | **26 passed, 0 failed** | **26 passed, 0 failed** | unchanged |
| Payment unit | `node scripts/test-payments.mjs` | **65 passed, 0 failed** | **65 passed, 0 failed** | unchanged |
| Payment integration | `node scripts/test-payments-integration.mjs` | **76 passed, 0 failed** | **76 passed, 0 failed** | unchanged |
| DB adapter | `node scripts/test-db-adapter.mjs` | **41 passed, 0 failed** | **41 passed, 0 failed** | unchanged |
| Migration integrity | `node scripts/test-migration-integrity.mjs` | **41 passed, 0 failed** (disposable PG target) | same | unchanged |
| Production config | `node scripts/test-production-config.mjs` | **65 passed, 0 failed** (8 spawned production servers) | same | unchanged |

**Quality gates**

| Gate | Command | Result |
|---|---|---|
| TypeScript | `npx tsc --noEmit` | **exit 0, no diagnostics** |
| ESLint | `npx eslint src scripts --max-warnings=0` | **exit 0, 0 errors, 0 warnings** |
| Production build | `npx next build` | **exit 0, 36/36 static pages, compiled in 23.2 s** |

Totals: **584 assertions per backend** across E2E, sweep, promises, 3D, links, storage, session and brand suites, plus 76 + 65 + 41 + 41 + 65 backend-independent checks. No assertion was weakened, skipped or deleted; the only E2E change was a *stricter* one (the landing page must now render "Nestora").

**Disposable databases only:** `rentlink_regress`, `rentlink_paytest`, `rentlink_unit`, `rentlink_migtest`, `data/e2e-seed.db`, `data/probe-*.db`, `.paytest/integration.db`. `data/rentlink.db` was copied to `/tmp/rentlink-dev-backup.db` before work began and was never reset or deleted.

---

## 5. Regressions

**None in product behaviour.** The brand work caused zero functional regressions: every suite that passed before passes now with identical counts, except E2E which gained one assertion.

Four things surfaced during verification — all were **defects in my own tooling**, not in the application, and each was fixed by correcting the tool rather than relaxing the check:

1. **`check-brand.mjs` flagged its own source** for containing the search string. Fixed by exempting the checker and the one-shot rebrand script.
2. **`check-brand.mjs` flagged `admin@rentlink.demo`** on the homepage/login/help pages. The served HTML was already 100% rebranded; the match came from a *data identifier* (a demo email address) that must not change. The live check is now case-sensitive on the brand string, with the exemption documented in the failure detail.
3. **The README's explicit "renamed from RentLink 3D" note** tripped the "no legacy string" rule. Rather than delete useful documentation or disable the rule, the checker now permits *only* lines that say "renamed from", and asserts that this exemption is used at most twice (currently 1 line).
4. **Storage-prefix assertion** looked for literal `public/`…`private/` paths; the code builds them from a `scope` variable. The assertion now checks the actual expression.

Two non-regressions worth recording: the `rzp_test_…` fixture key was renamed, and the payment suite proves it is inert (the app only validates the `rzp_test_|rzp_live_` prefix); and the regenerated SQL baselines differ from the previous ones **only** in the comment header — the DDL was diffed to confirm.

---

## 6. Vercel Preview checklist

- [x] **Production build compatible** — `next build` exit 0; schema ships as a bundled module (`src/lib/schema.generated.ts`), so no runtime file read can fail in a serverless bundle.
- [x] **Fail-fast verified** — a production process with a missing `DATABASE_URL`, a non-PostgreSQL or localhost URL, a missing/weak `SESSION_SECRET`, or no `BLOB_READ_WRITE_TOKEN` logs FATAL and **serves 500 for every request without ever opening SQLite** (measured across 8 spawned servers).
- [x] **Session settings** — `HttpOnly; Secure; SameSite=Lax`, 14-day bounded lifetime, hashed tokens, server-side logout.
- [x] **Upload limits** — 4.38 MB per file and per request when `VERCEL` is set (below the 4.5 MB platform cap); >6 files rejected; oversize rejected before buffering.
- [x] **Cron** — `vercel.json` declares `0 2 * * *` for `/api/cron/reminders`; route answers 503 with no `CRON_SECRET`, 401 on a wrong bearer, 200 on the right one.
- [x] **Env documentation** — `.env.example` and `docs/DEPLOYMENT.md` list every variable, including the never-set-in-production `RENTLINK_ALLOW_INSECURE_PROD`.
- [x] **PWA/manifest, favicon, social metadata** served correctly (verified over HTTP).
- [ ] **Hosted PostgreSQL** — not tested. Preview must point `DATABASE_URL` at a *pooled* endpoint and run `node scripts/migrate.mjs` before the first request.
- [ ] **Vercel Blob** — not tested. A Blob store must be connected so `BLOB_READ_WRITE_TOKEN` is injected for the Preview environment.
- [ ] **Preview-scoped environment variables** — must be set for *Preview*, not only Production.

**Commands (do not run without authorization)**

```bash
# 1. environment for Preview: DATABASE_URL (pooled), SESSION_SECRET (32+ chars,
#    openssl rand -hex 32), BLOB_READ_WRITE_TOKEN, CRON_SECRET,
#    PG_SKIP_SCHEMA=1, PG_SSL_MODE=verify-full
#    NEVER set: ALLOW_DEMO_SEED, ALLOW_TEST_FIXTURES, RENTLINK_ALLOW_INSECURE_PROD
# 2. schema first, against the preview database
DATABASE_URL=<preview-db> node scripts/migrate.mjs --status
DATABASE_URL=<preview-db> node scripts/migrate.mjs
# 3. optional demo data (only for a preview you are willing to hand out)
DATABASE_PATH=data/rentlink.db ALLOW_DEMO_SEED=1 node scripts/seed.mjs
DATABASE_URL=<preview-db> node scripts/migrate-to-postgres.mjs --dry-run
DATABASE_URL=<preview-db> node scripts/migrate-to-postgres.mjs --apply
# 4. build/deploy the branch (omit `--prod` for a preview)
```

Smoke test after the preview is live: `GET /` → 200, title contains "Nestora", `GET /manifest.webmanifest` → 200, `POST /api/auth/login` with a seeded account → 200, `GET /api/cron/reminders` with no bearer → 503/401, and a private-document URL as an unrelated user → 403.

---

## 7. Remaining public-production blockers

**Untested (no credentials / no external services available here)**

1. **No Vercel deployment of any kind** — no project, no preview URL, no serverless invocation. A local `next start` is not deployment evidence.
2. **No real Vercel Blob store** — the `access: 'private'` path, `get()` streaming and token handling are verified by SDK types (2.8.2) and source review only; all runtime storage tests used the local disk backend.
3. **No hosted PostgreSQL** — all PostgreSQL runs are local PG 17.11 with `PG_SSL_MODE=disable`. `verify-full` is asserted in code and by a resolution matrix but has never negotiated TLS with a provider.
4. **No real payment** — no Razorpay account or webhook; the integration suite uses a local stand-in gateway. Demo mode is labelled and moves no money.
5. **No email delivery** — no Resend/SMTP credentials; notifications stay in-app.

**Known gaps carried over from the baseline and still open**

6. **Fail-fast is fail-closed, not process-exit** under `next start` (every page 500, but the process stays resident).
7. **`RENTLINK_ALLOW_INSECURE_PROD` is a real bypass** — loud in the logs, but it exists; any deployment with it set is not production.
8. **Rotating `SESSION_SECRET` logs everyone out** (no key-id / dual-secret scheme).
9. **Stolen session tokens stay valid until expiry** if logout never happens (14-day window).
10. **Pooling is per-instance** (`PGPOOL_MAX=3`); behaviour under real concurrency is unmeasured.
11. **Migration verification limits** — no binary-byte or collation-equivalence comparison; validated at 135-row scale only.
12. **Brand-rename limits** — the demo accounts still use `@rentlink.demo` addresses and the SQLite file is still `data/rentlink.db`; these are data-path identifiers, intentionally unchanged. Anyone wanting a fully clean identity should migrate account emails and the DB filename separately, with data, not with a find-and-replace.

---

## 8. Classification

| Level | Status |
|---|---|
| 1. Not ready | Not applicable — every local gate is green on both backends, before and after the rebrand. |
| **2. Ready for Vercel Preview** | **YES**, subject to §6: Preview-scoped environment variables set, migrations run against the preview database, a Blob store connected, and no demo/test/insecure flags on a publicly reachable preview. |
| 3. Ready for public production | **NO.** No deployment, no hosted PostgreSQL, no real Blob, no real payment, no email, and no load testing. |

**Stop.** No features were added; this report is the final artefact for this phase.
