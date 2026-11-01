# Nestora — 2D Conversion Verification

Every number below is the actual summary line printed by the command in the same row, run on
**2026-10-31** against the final build. Where something was not run, it says **NOT TESTED** and why.

---

## 0. Environment used

| Item | Value |
|---|---|
| Node | v20.20.2 |
| App | `next start` (production build, `Compiled successfully in 20.1s`, 36/36 static pages) |
| SQLite server | `:3300`, `RENTLINK_ALLOW_INSECURE_PROD=1 ALLOW_DEMO_SEED=1 DEMO_PASSWORD=… SESSION_SECRET=… CRON_SECRET=…` |
| PostgreSQL server | `:3200`, same env + `DATABASE_URL=postgresql://…/rentlink_regress PG_SSL_MODE=disable PG_SKIP_SCHEMA=1` |
| PostgreSQL | 17, DB `rentlink_regress` rebuilt from `data/e2e-seed.db` via `scripts/pg-regress-reset.mjs` |
| Browser suites | puppeteer (headless shell), `LD_LIBRARY_PATH=/home/user/.local/chromedeps/usr/lib/x86_64-linux-gnu` |
| Real dev data | `data/rentlink.db` **never** used by the stateful suites; they run on disposable files/DBs |

---

## 1. Results

### 1.1 Gate runner — `BASE=http://127.0.0.1:3300 node scripts/verify-all.mjs`

```
VERIFICATION SUMMARY  8 passed, 0 failed
  ✔ TypeScript typecheck — 0 errors
  ✔ ESLint — clean
  ✔ next build — compiled, 36 static pages
  ✔ Payment unit tests — 65 passed, 0 failed (65 checks)
  ✔ Payment integration tests — 76 passed, 0 failed (76 checks)
  ✔ End-to-end tests — 173/173 passed, 0 failed, 0 skipped
  ✔ 2D checks — 37/37 passed, 0 failed
  ✔ Links & buttons — 4/4 passed
```

### 1.2 Per-suite detail

| Suite | Command | SQLite | PostgreSQL |
|---|---|---|---|
| TypeScript | `npm run typecheck` | **0 errors** | — |
| ESLint | `npm run lint` | **clean, 0 warnings** | — |
| Production build | `npm run build` | **PASS** — 36/36 pages | — |
| E2E lifecycle | `BASE=… node scripts/test-e2e.mjs` | **173 / 173 passed, 0 failed, 0 skipped** | **173 / 173 passed, 0 failed, 0 skipped** |
| 2D interface (browser) | `node scripts/check-2d.mjs <base>` | **37 / 37 passed** | **37 / 37 passed** |
| Payment unit | `npm run test:payments` | **65 passed, 0 failed** | — (backend-agnostic, isolated DB) |
| Payment integration | `DEMO_BASE=… node scripts/test-payments-integration.mjs` | **76 passed, 0 failed** | **76 passed, 0 failed** (`INTEGRATION_DATABASE_URL`) |
| Session security | `BASE=… node scripts/test-session-security.mjs` | **26 passed, 0 failed** | **26 passed, 0 failed** |
| Storage security | `BASE=… node scripts/test-storage-security.mjs` | **47 passed, 0 failed** | **47 passed, 0 failed** |
| DB adapter | `node scripts/test-db-adapter.mjs` | **sqlite: 41 passed, 0 failed** | **postgres: 41 passed, 0 failed** |
| Migration integrity | `node scripts/test-migration-integrity.mjs` | **41 passed, 0 failed** | — (covers both dialects' baselines) |
| Production config | `node scripts/test-production-config.mjs` | **65 passed, 0 failed** | (incl. live `:3200` cron checks) |
| Brand integrity | `node scripts/check-brand.mjs <base>` | **30 passed, 0 failed** | **30 passed, 0 failed** |
| Promise/claim check | `BASE=… node scripts/check-promises.mjs` | **48 passed, 0 failed** | **48 passed, 0 failed** |
| Page sweep | `BASE=… node scripts/sweep-pages.mjs` | **58 / 58 ok, 0 failed** | **58 / 58 ok, 0 failed** |
| Links & buttons | `node scripts/check-links.mjs <base>` | **4 / 4 passed** (73 pages crawled, 0 broken links, 0 unwired buttons) | **4 / 4 passed** |

**Totals (SQLite run): 632 individual assertions passed, 0 failed** across the suites above
(173 + 37 + 65 + 76 + 26 + 47 + 41 + 41 + 65 + 30 + 48 + 4 gate checks; page sweep counted as 58/58).

### 1.3 What the 2D suite (`scripts/check-2d.mjs`, 37 checks) actually asserts

No `<canvas>` and no WebGL on the homepage, listing page, `/viewer`, 8 public pages and 6 signed-in
pages; no 3D viewer copy anywhere; single `<h1>`; `role="search"` discovery form; both CTAs present;
all six required homepage sections; skip-link; nav links; **25/25 homepage images decode and are real
JPEGs**; 16 gallery/category tiles link to filtered searches; hero search round-trips
(`/marketplace?q=camera&category=`); listing gallery shows a large photo and has **no 3D tab**;
`/viewer` returns 200 as "Equipment showcase" with 66 cards / 24 photos; card hover is
`transform-style: flat`; no console errors on any page; **no horizontal overflow at 320, 360, 390,
768, 1024 and 1440 px across 7 pages**, none on 10 public + 6 signed-in pages at 390 px.

---

## 2. Failures found and fixed during this verification

| # | Symptom | Root cause | Fix |
|---|---|---|---|
| 1 | Homepage overflowed 390 px viewport by **71 px** | the two cards in the "verified providers" row are grid items whose automatic minimum width was set by long unbreakable content, so the track grew past the container | added `grid-cols-1` + `min-w-0` to the containers (`src/app/page.tsx`). **Not** an `overflow: hidden` mask — verified clean at 6 widths |
| 2 | Demo buyer login returned **401** | **not a defect**: a production build deliberately refuses a seeded account that still uses the documented `Demo@1234` unless `ALLOW_DEMO_SEED=1` (`src/lib/env.ts`). The server was started without it. | started the demo server in its documented demo mode; the 2D harness now *distinguishes* "refused by policy" (correct) from a genuine credential failure, and still fails on the latter. **Authentication was not weakened** |
| 3 | Skip-link assertion failed | the test asserted `links.includes("#main") === false`, which is the opposite of the requirement | assertion corrected to require the skip link. The accessibility requirement is unchanged — the skip link is in `layout.tsx` and now asserted |
| 4 | `verify:full` crashed: "demo server did not start" | the orchestrator booted its own `next start` without `SESSION_SECRET` / `DEMO_PASSWORD`, which a production build now refuses, and it hard-coded `:3000` | `scripts/verify-all.mjs` now supplies a throwaway `SESSION_SECRET`, its own `DEMO_PASSWORD`, and honours `BASE` for every probe and browser suite. Result: **8/8 gates** |
| 5 | PG storage-security: "document … — 0 rows" | the harness read SQLite while the app was on PostgreSQL; the flag is `DATABASE_URL` | reran with `DATABASE_URL` set → **47/47**. Harness/config issue, not product |
| 6 | PG E2E: 3 "Test fixtures are disabled" failures | PG server started without `ALLOW_TEST_FIXTURES=1` | restarted with it → **173/173** |
| 7 | Payment integration: "Demo-mode server reachable on :3000" | harness defaults to `:3000`; this app runs on `:3300` | `DEMO_BASE=http://127.0.0.1:3300` → **76/76** |

No test was deleted, skipped or loosened to get a pass. The only assertions that changed are #3
(was wrong) and the 3D→2D sections (§3), which were **replaced with stricter equivalents**.

---

## 3. Coverage replaced (3D → 2D)

| Old | New | Net |
|---|---|---|
| `scripts/check-3d.mjs` — 22 WebGL checks | `scripts/check-2d.mjs` — 37 checks | +15 |
| E2E §12 "3D & responsive surface" — 5 checks | E2E §12 "2D interface & responsive surface" — 11 checks | +6 |
| E2E total 167 (pre-conversion) | **173** | +6 |

The E2E §12 2D block additionally proves a listing that still stores a `model_3d` value renders
normally — i.e. the data was preserved while the UI went 2D.

---

## 4. Backend preserved — evidence

* All suites that exercise real server behaviour pass on **both** backends: auth/session
  (26), storage/document access control (47), booking lifecycle + handover + returns + disputes +
  waiting list + counteroffers (E2E 173), payments incl. webhook signature/ordering/idempotency
  (65 unit + 76 integration), DB adapter equivalence (41 per backend), migration integrity (41),
  production config fail-closed behaviour incl. 8 spawned servers (65).
* `model_3d` column, both baseline migrations, API schemas and the 41 `/api/*` routes are untouched.
* Identifiers unchanged: `rl_session`, `data/rentlink.db`, `RENTLINK_ALLOW_INSECURE_PROD`,
  `DATABASE_URL`/`PG_*`, table names, storage prefixes, migration filenames,
  `notes.source = "rentlink3d"`, `package.json name: "rentlink-3d"` (brand check 30/30).

---

## 5. NOT TESTED (and why)

| Item | Why |
|---|---|
| Vercel deployment | requires creating a Vercel project — **not authorised** |
| Hosted PostgreSQL over TLS (Neon/Supabase) | no hosted credentials; only local PG 17 with `PG_SSL_MODE=disable` was exercised |
| Real Vercel Blob storage | no `BLOB_READ_WRITE_TOKEN`; uploads used the local-filesystem driver only |
| Real Razorpay (live/test gateway over the internet) | no real keys; the integration suite uses a local stand-in for `api.razorpay.com` and a demo-mode server |
| Email / WhatsApp delivery | no `RESEND_API_KEY` configured |
| Cron/scheduled reminders in a real scheduler | endpoint auth is tested (65 config checks); no scheduler invokes it |
| Load / performance / a11y-audit (Lighthouse) | no load generator or Lighthouse run was performed |
| Cross-browser (Safari/Firefox) | only headless Chromium was driven |

---

## 6. Production readiness

**The 2D conversion is complete and verified locally on both database backends.**
**This is NOT a production-readiness sign-off.** Local gates passing cannot demonstrate the items in
§5. Standing blockers from the earlier readiness review remain exactly as they were
(`NESTORA_READINESS_REPORT.md`): no deployment, no real blob store, no hosted PostgreSQL over TLS,
no real payment gateway, no email delivery, no load test.

One deployment note introduced by this work: the new photography lives in `public/img/photos/`
(1.3 MB, 8 JPEGs) and is served as static assets — it is not part of the upload/storage driver.

---

## 7. Reproducing this verification

```bash
# 1. build once
NODE_OPTIONS=--max-old-space-size=1024 npm run build

# 2. SQLite demo server
RENTLINK_ALLOW_INSECURE_PROD=1 ALLOW_DEMO_SEED=1 DEMO_PASSWORD='Demo@1234' \
SESSION_SECRET='local-verify-secret-0123456789' CRON_SECRET='cron-test-secret-0123456789abcdef' \
ALLOW_TEST_FIXTURES=1 npx next start -p 3300 -H 0.0.0.0

# 3. everything, in one gate run
BASE=http://127.0.0.1:3300 npm run verify:full

# 4. PostgreSQL (disposable)
node scripts/pg-regress-reset.mjs
DATABASE_URL='postgresql://rentlink:rentlink@127.0.0.1:5432/rentlink_regress' PG_SSL_MODE=disable \
PG_SKIP_SCHEMA=1 <same env as above> npx next start -p 3200 -H 0.0.0.0
DATABASE_URL='postgresql://rentlink:rentlink@127.0.0.1:5432/rentlink_regress' PG_SSL_MODE=disable \
  BASE=http://127.0.0.1:3200 node scripts/test-e2e.mjs
```
