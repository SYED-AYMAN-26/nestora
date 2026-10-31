# RentLink 3D — PostgreSQL & Vercel Readiness Report

**Date:** 2026-10-31
**Repository:** `/home/user/rentlink3d` (Next.js 15.5.28, React 19, better-sqlite3 11.10.0, pg 8.16.3, @vercel/blob 2.8.2)
**Scope:** regression, storage security, session security, migration integrity, production configuration, Vercel compatibility.
**Deployment status: NO DEPLOYMENT WAS PERFORMED.** No Vercel project was created, no Preview or Production URL exists, no real payment was transacted, and no external service (Vercel Blob, Razorpay, SMTP, hosted Postgres) was contacted. Everything below is local evidence.

---

## 0. Verdict

> ### **READY FOR VERCEL PREVIEW — NOT READY FOR PUBLIC PRODUCTION**

Preview is safe to begin **provided** the environment variables in §7 are set in the Vercel project. Preview is *not* the same as production: see the blocking list in §10, of which the first two (no hosted-Postgres run, no real Blob run) are simply untested rather than known-broken.

---

## 1. Exact test results (all rerun on the final source, this session)

Two live production servers, same build, same suite files:

* **SQLite** — `next start` on `:3300`, `DATABASE_PATH=data/rentlink.db`
* **PostgreSQL** — `next start` on `:3200`, `DATABASE_URL=postgresql://…/rentlink_regress` (PostgreSQL 17.11, disposable DB rebuilt from `data/e2e-seed.db` before the run)

| # | Suite | Command | SQLite | PostgreSQL |
|---|-------|---------|--------|------------|
| 1 | Full E2E | `BASE=… node scripts/test-e2e.mjs` | **166 / 166 passed, 0 failed, 0 skipped** | **166 / 166 passed, 0 failed, 0 skipped** |
| 2 | Page/API sweep | `BASE=… node scripts/sweep-pages.mjs` | **58 requests, 58 ok, 0 failed** | **58 requests, 58 ok, 0 failed** |
| 3 | Promise/claim check | `BASE=… node scripts/check-promises.mjs` | **48 passed, 0 failed** | **48 passed, 0 failed** |
| 4 | 3D / WebGL | `BASE=… node scripts/check-3d.mjs` | **22 / 22 passed, 0 failed** | **22 / 22 passed, 0 failed** |
| 5 | Link & button check | `node scripts/check-links.mjs http://…` | **4 / 4 passed** | **4 / 4 passed** |
| 6 | Storage security | `BASE=… node scripts/test-storage-security.mjs` | **47 passed, 0 failed** | **47 passed, 0 failed** |
| 7 | Session security | `BASE=… node scripts/test-session-security.mjs` | **26 passed, 0 failed** | **26 passed, 0 failed** |
| 8 | Payment unit | `node scripts/test-payments.mjs` | **65 passed, 0 failed** | **65 passed, 0 failed** |
| 9 | Payment integration | `DEMO_BASE=… node scripts/test-payments-integration.mjs` | **76 passed, 0 failed** | **76 passed, 0 failed** |
| 10 | DB adapter | `node scripts/test-db-adapter.mjs` | **41 passed, 0 failed** | **41 passed, 0 failed** |
| 11 | Migration integrity | `node scripts/test-migration-integrity.mjs` | **41 passed, 0 failed** (PostgreSQL target, disposable) | same |
| 12 | Production config | `node scripts/test-production-config.mjs` | **65 passed, 0 failed** (static + 8 spawned production servers) | same |

**Quality gates**

| Gate | Command | Result |
|------|---------|--------|
| TypeScript | `npx tsc --noEmit` | **exit 0, no diagnostics** |
| ESLint | `npx eslint src scripts --max-warnings=0` | **exit 0, 0 errors, 0 warnings** |
| Production build | `npx next build` | **exit 0, 36 pages, compiled in 21.3 s** |

Suite totals this session: **583 assertions on SQLite, 583 on PostgreSQL** (suites 1–7, 9), plus 65 + 41 + 41 backend-independent checks. No suite was skipped and no assertion was relaxed to obtain green.

**Databases used (all disposable, none are user data):** `rentlink_regress` (E2E/storage/session on PostgreSQL), `rentlink_paytest` (payment integration), `rentlink_unit` (adapter), `rentlink_migtest` (migration destructive tests), `data/e2e-seed.db`, `data/probe-*.db`, `.paytest/integration.db`. The development database `data/rentlink.db` was copied to `/tmp/rentlink-dev-backup.db` before work, never reset, and is intact.

---

## 2. Production fail-fast — actual behaviour (measured, not claimed)

Previously the app **logged** `[config] FATAL DATABASE_URL` and then kept serving from SQLite. That is logging, not fail-fast, and it has been fixed.

**What changed**

* `src/lib/boot.ts` (new) — `enforceProductionConfig()` throws `InsecureProductionConfigError` when any problem is classified `fatal`. It never interpolates environment *values* into the message, only variable names and reasons.
* `src/instrumentation.ts` (new) — Next.js per-process `register()` hook calls the gate in the Node runtime before the first request.
* `src/app/layout.tsx` — also calls the gate, so the guard works even if instrumentation is not wired into a given build.
* `src/lib/db.ts` — refuses to *open* local SQLite when `NODE_ENV=production` (second line of defence).
* `src/lib/storage.ts` — `assertWritableTarget()` refuses local-disk uploads in production.

**Measured behaviour, per scenario** (each spawned `next start` on its own port with its own disposable database):

| Scenario | Log | Serves traffic? | Verdict |
|---|---|---|---|
| `DATABASE_URL` missing | `FATAL DATABASE_URL` + `Refusing to start` | **No — every page 500, login 500, SQLite file never created** | **fail-closed** |
| `DATABASE_URL` = localhost | `FATAL DATABASE_URL: Points at localhost` | No — 500 | fail-closed |
| `DATABASE_URL` = `file:./data/rentlink.db` | `FATAL DATABASE_URL: Is not a PostgreSQL connection string` | No — 500 | fail-closed |
| `SESSION_SECRET` missing | `FATAL SESSION_SECRET` | No — 500 | fail-closed |
| `SESSION_SECRET` = `short` (<32) | `FATAL SESSION_SECRET: Shorter than 32 characters` | No — 500 | fail-closed |
| `BLOB_READ_WRITE_TOKEN` missing | `FATAL BLOB_READ_WRITE_TOKEN` | No — 500 | fail-closed |
| Fully Vercel-shaped env | no FATAL lines | **Yes — 200** | no false positive |
| `RENTLINK_ALLOW_INSECURE_PROD=1` + unsafe env | problems still logged FATAL + explicit override notice | Yes (deliberate escape hatch) | never silent |

**Honest limitation:** with `next start` the *process* stays resident and serves `500` for every request instead of exiting. Requests never succeed and the database is never opened, so the deployment is fail-**closed**; on Vercel each request is a fresh invocation whose module-load throws, so the function fails rather than serving degraded output. The override variable `RENTLINK_ALLOW_INSECURE_PROD` exists for local/demo runs and is documented in `.env.example` as never-to-be-set on Vercel.

---

## 3. Session security (26 checks, both backends)

Verified against real cookies over HTTP:

* `Set-Cookie: rl_session=…; Path=/; Expires=…; Max-Age=1209600; **Secure; HttpOnly; SameSite=lax**`.
* Login creates a session that `/api/me` accepts and resolves to the correct user; two users' tokens never cross over.
* **Logout invalidates server-side**: replaying the captured pre-logout cookie returns **401** (not merely a cleared cookie).
* Rejected with **401**: modified token, empty token, fabricated token, and — importantly — the **stored hash itself used as a token** (the hash is not the credential).
* Expired session row → **401**.
* The database stores a **64-hex-char hash**, never the 43-char raw token; the raw value appears in no session column.

---

## 4. Storage security (47 checks, both backends)

**Private verification documents**

| Actor | Result |
|---|---|
| anonymous | **401** |
| unrelated signed-in buyer | **403** |
| different provider | **403** |
| **owning provider** | **200** |
| admin | **200** |

Responses carry `cache-control: private, no-store` and `x-content-type-options: nosniff`. Every authorised read and every denial is written to the audit log (`document.access` / `document.access_denied`).

**Public images** — 200 with the sniffed `Content-Type`, `public, max-age=31536000, immutable`, byte-identical body.

**Validation** — non-image bytes, SVG and empty files **422**; a client filename of `photo.php` is stored as a server-generated `.png`; >6 files per request **422**; a file one byte over 5 MB **422** with `File too large (max 5 MB).`; an over-budget `Content-Length` is refused before buffering.

**Serverless limits** — with `VERCEL=1` the per-file budget becomes 4.38 MB and the per-request budget 4.38 MB, i.e. below the platform's 4.5 MB cap; a 6 MB six-file request that is legal locally would be rejected there. Behaviour differs by deployment exactly as intended.

**Path traversal** — `../../data/rentlink.db`, `..%2f..%2f…`, `%2e%2e%2f…`, `.env`, `x.php`, `....//` all fail (404/308) with no leaked bytes and no stack traces.

**Private documents are never public** — `putFile` uses `access: 'private'` for the `private/` scope and reads go through the SDK with the read-write token; the app never hands out a public URL for them. `@vercel/blob@2.8.2` types `access` as required `'public' | 'private'` on both `put()` and `get()`, so the options used are supported by the installed SDK.

**Blob itself was NOT exercised** — no Blob store or token exists in this environment. All local runs used the disk backend. The Blob code path is verified by types and by source review only (see §10).

**Failed uploads** leave no misleading rows (image count unchanged); rejected uploads create no record.

---

## 5. Migration integrity (41 checks, disposable databases only)

Target: `rentlink_migtest`, dropped and recreated by the suite. Source: `data/_migtest-source.db`, generated from the shipped schema and deleted afterwards. Guards in the script refuse to run against any other target.

* Dry run writes nothing.
* `--apply` preserves every row, every id and every value: `Verified: all 30 tables match row-for-row AND value-for-value (135 rows)` on the real 135-row demo dataset.
* A populated target is **refused** without `--replace`, before any write.
* `--replace` clears **only in-scope tables**, in reverse dependency order, with **no `TRUNCATE … CASCADE`** (verified: the string does not appear in executable code). An unrelated table keeps its data.
* An FK from an out-of-scope table makes the clear **fail loudly** and roll back; nothing is silently cascaded.
* A mid-load failure (missing target table) rolls back completely — **0 rows left behind**.
* Identity sequences are advanced: `MAX(id)=3` → next insert gets `4`.
* The verification hashes **every row and every column**: proven directly against the extracted `scripts/lib/migration-digest.mjs` — mutating any one of 15 sampled columns changes the digest, column order and row order do not, `1` vs `"1"` differ, `null` vs `undefined` do not. A same-row-count corruption is therefore caught.

**Limitations of this verification.** The digest compares values after normalisation (`Date`→ISO, `bigint`→number, `boolean`→0/1, `JSON` round-trip). It does **not** compare binary/blob columns byte-for-byte (`Uint8Array` is JSON-serialised), does not verify cross-engine *collation* differences (SQLite `COLLATE NOCASE` on `users.email` vs plain `TEXT UNIQUE` in PostgreSQL), and does not measure performance or lock behaviour on a large dataset — the largest dataset tested is 135 rows. A real cutover should be rehearsed against a restored copy of the production database.

---

## 6. Configuration review (65 checks: 28 static + 37 runtime/live)

* `PG_SSL_MODE` defaults to **`verify-full`**; `require` still verifies; `disable`/`no-verify` are explicit opt-outs only. The only `rejectUnauthorized: false` in the tree is the `no-verify` branch.
* `PG_SKIP_SCHEMA=1` returns **before** any DDL is issued (guard precedes the first `client.query`).
* The schema ships as a **bundled module** (`src/lib/schema.generated.ts`, 34.4 KB, both dialects) — `db.ts` never reads a `.sql` file at runtime, which is what would break in a serverless bundle.
* Cron endpoint: no `CRON_SECRET` → **503 disabled**; wrong or empty bearer → **401**; correct bearer → **200** with a constant-time comparison. Verified live on both servers.
* Demo protection unchanged: production refuses demo logins unless explicitly allowed; `ALLOW_DEMO_SEED=1` with the documented default password is **fatal**.
* No secret values appear in any error, log line or rendered page (payment suite asserts this too).

---

## 7. Required environment variables

**Required in production (all fatal if missing, except where noted)**

| Variable | Purpose | Notes |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | must be `postgresql://…`; localhost is refused. Use the **pooled** endpoint. |
| `SESSION_SECRET` | signs session tokens | ≥ 32 chars — `openssl rand -hex 32` |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob store | without it uploads refuse to start |
| `CRON_SECRET` | authenticates `/api/cron/reminders` | `openssl rand -hex 24` (warning, not fatal, if absent — cron stays 503) |

**Recommended / optional**

| Variable | Purpose | Default behaviour if unset |
|---|---|---|
| `PG_SSL_MODE` | TLS verification mode | `verify-full` (correct for Neon/Supabase) |
| `PGPOOL_MAX` | pool size per instance | `3` |
| `PG_SKIP_SCHEMA` | skip cold-start DDL | **set to `1` in production**, after running the migration |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` | real payments | all three or none; none = labelled DEMO mode, no money moves |
| `RESEND_API_KEY` or `SMTP_URL` | outbound email | notifications stay in-app only |
| `DEMO_PASSWORD` | demo seed password | must be changed if `ALLOW_DEMO_SEED=1` |
| `ALLOW_DEMO_SEED` | allow demo accounts | leave **unset** on Vercel |
| `ALLOW_TEST_FIXTURES` | `/api/dev/fixture-account` | leave **unset** on Vercel (defaults to disabled) |
| `RENTLINK_ALLOW_INSECURE_PROD` | bypass the boot gate | **never set on Vercel** |

---

## 8. PostgreSQL setup and migration commands

```bash
# 1. point at the target (use the pooled host/port from your provider)
export DATABASE_URL='postgresql://user:pass@host/rentlink?sslmode=require'

# 2. create/upgrade the schema (versioned, recorded in schema_migrations)
node scripts/migrate.mjs --status     # what is applied
node scripts/migrate.mjs              # apply everything outstanding

# 3a. NEW deployment: seed demo data (only if you want the demo dataset)
DATABASE_PATH=data/rentlink.db ALLOW_DEMO_SEED=1 node scripts/seed.mjs   # SQLite source of truth
node scripts/migrate-to-postgres.mjs --dry-run                            # inspect table/row counts
node scripts/migrate-to-postgres.mjs --apply                              # refuses a non-empty target

# 3b. EXISTING data replaced deliberately (destructive — scoped, no CASCADE)
node scripts/migrate-to-postgres.mjs --apply --replace

# 4. after the schema exists, stop cold-start DDL
export PG_SKIP_SCHEMA=1
```

Schema bootstrap and migration are separate on purpose: `db.ts` can create missing tables with `CREATE … IF NOT EXISTS` (safe, but not a migration system), while `scripts/migrate.mjs` is the versioned path. Set `PG_SKIP_SCHEMA=1` so a cold start never DDLs a database it does not own.

---

## 9. Vercel Blob, cron and preview steps

**Blob** — Vercel dashboard → Storage → Blob → create a store → connect it to the project; `BLOB_READ_WRITE_TOKEN` is injected automatically (add it manually for Preview if your store is Production-scoped). Public images use `access: 'public'`; verification documents use `access: 'private'` and are only ever read server-side through `/api/files/private/[name]` after an ownership check. **This path was not exercised against a real Blob store.**

**Cron** — `vercel.json` already declares `{ "path": "/api/cron/reminders", "schedule": "0 2 * * *" }`. Vercel sends `Authorization: Bearer $CRON_SECRET`; without `CRON_SECRET` the route answers 503 and does nothing. The sweep is idempotent (it will not duplicate a notification for the same booking+kind).

**Preview deployment**

```bash
# 1. set environment variables for the Preview environment (not just Production)
#    DATABASE_URL (ideally a separate preview database), SESSION_SECRET,
#    BLOB_READ_WRITE_TOKEN, CRON_SECRET, PG_SKIP_SCHEMA=1, PG_SSL_MODE=verify-full
# 2. push the branch and let Vercel build, or:
vercel            # preview
# 3. run migrations against the preview database BEFORE the first request:
DATABASE_URL=<preview-db> node scripts/migrate.mjs
# 4. smoke-test the preview URL:
#    GET /  → 200, GET /login → 200, POST /api/auth/login (demo creds if seeded)
#    GET /api/cron/reminders without a bearer → 503/401
```

Do **not** set `ALLOW_DEMO_SEED`, `ALLOW_TEST_FIXTURES` or `RENTLINK_ALLOW_INSECURE_PROD` on a preview that is reachable by anyone you would not hand an admin login to.

**Function body limit** — Vercel caps a serverless request at 4.5 MB. The app holds its own budgets at 4.38 MB per file *and* per request when `VERCEL` is set, and `next.config.ts` keeps `serverActions.bodySizeLimit` at 4 MB, so the app rejects first with a readable message instead of the platform returning an opaque 413.

---

## 10. Remaining limitations and risks

**Not tested at all (no credentials / no hosted services in this environment)**

1. **No Vercel deployment of any kind.** No preview URL, no build on Vercel's builders, no serverless invocation. A local `next start` is not evidence of deployment.
2. **No real Vercel Blob store.** Private/public blob permissions, `get()` streaming and the token are verified by SDK types and source only; all runtime storage tests used the local disk backend.
3. **No hosted PostgreSQL.** All PostgreSQL runs used a local PG 17.11 with `PG_SSL_MODE=disable`. TLS verification (`verify-full`) is asserted in code and by a resolution matrix, but has never negotiated TLS with a real provider.
4. **No real payment.** No Razorpay account, no live/test key, no webhook from Razorpay's servers. The payment suites use a local stand-in gateway; demo mode is clearly labelled and moves no money.
5. **No email delivery.** No Resend/SMTP credentials; notifications are in-app only.

**Known risks and gaps**

6. **Fail-fast is fail-closed, not process-exit**, under `next start` (§2). Acceptable, but it means a misconfigured long-running process stays resident.
7. **`RENTLINK_ALLOW_INSECURE_PROD` is a real bypass.** It is loud in the log and documented, but it exists; treat any deployment with it set as non-production.
8. **Session secret rotation invalidates every session** — there is no key-id/dual-secret scheme, so rotating `SESSION_SECRET` logs everyone out.
9. **No rate limiting on the session/verification file routes beyond what already exists**, and no per-instance session revocation cache: logout deletes the row, which is correct, but a stolen token remains valid until expiry (14 days) if logout never happens.
10. **Connection pooling** is per-instance (`PGPOOL_MAX=3`); concurrency limits depend entirely on using a pooled endpoint. Untested under load.
11. **Migration verification limits** — see the explicit list in §5 (no binary-byte comparison, no collation equivalence check, 135-row scale).
12. **`better-sqlite3` is pinned to 11.10.0** and remains a dependency for local development even though production runs PostgreSQL.
13. **Cron schedule is daily at 02:00 UTC**; reminder timeliness depends on that single sweep.

**Fixed in this session (previously defects)**

* Missing `DATABASE_URL` produced a fatal *log line* while the app served from SQLite → now refused at boot and at DB-open.
* A non-PostgreSQL / `file:` `DATABASE_URL` silently meant local disk → now fatal.
* Production could write uploads to local disk → `assertWritableTarget()` refuses.
* Repeated per-request FATAL log spam → logged once per process, thrown every time.

---

## 11. Classification

| Level | Status |
|---|---|
| **1. Not ready** | Not applicable — every local gate is green on both backends. |
| **2. Ready for Vercel Preview** | **YES** — with the §7 variables set in the Preview environment, migrations run against the preview database, and no demo/test/fixtures/insecure flags enabled on a publicly reachable preview. |
| **3. Ready for public production** | **NO.** No deployment, no hosted-Postgres run, no real Blob run, no real payment, no email provider, and load/scale behaviour is unmeasured. Reaching level 3 requires: a hosted PostgreSQL run of the full suite with TLS enabled, a real Blob store exercise of upload/private-read, a Razorpay test-mode transaction with a real webhook, and a load test against the pooled endpoint. |

**Stop.** No further features were added; this report is the final artefact.
