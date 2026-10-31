# Deploying RentLink 3D

Two supported shapes:

| | Backend | Storage | When |
|---|---|---|---|
| **Local** | SQLite (`data/rentlink.db`) | `uploads/` on disk | `npm run dev` |
| **Production** | PostgreSQL | Vercel Blob | Vercel / any Node host |

Nothing about the local workflow changed. Production differs only in the two
environment-driven swaps (`DATABASE_URL`, `BLOB_READ_WRITE_TOKEN`) plus a
required `SESSION_SECRET`.

---

## 1. Local development

```bash
npm install
node scripts/gen-schema-module.mjs      # also runs automatically on dev/build
ALLOW_DEMO_SEED=1 npm run db:reset      # fictional demo data
npm run dev
```

Demo logins (all share `Demo@1234` unless `DEMO_PASSWORD` is set):

```
admin@rentlink.demo | provider@anna.demo | buyer@student.demo
```

---

## 2. Back up before you migrate any data

**Always take a copy first.** The migration tool never modifies its source, but a
backup is what makes a mistake recoverable.

```bash
# SQLite (stop the app first so the WAL is fully checkpointed)
sqlite3 data/rentlink.db ".backup 'backup-$(date +%F).db'"
# or, with no sqlite3 binary:
node -e "const D=require('better-sqlite3');new D('data/rentlink.db').backup('backup-$(date +%F).db').then(()=>console.log('ok'))"

# PostgreSQL
pg_dump --format=custom --no-owner --file=backup-$(date +%F).dump "$DATABASE_URL"
```

Restore:

```bash
# SQLite — replace the file, keeping the same path; never delete it while the app runs
sqlite3 data/rentlink.db ".restore 'backup-2026-10-31.db'"

# PostgreSQL
pg_restore --clean --if-exists --no-owner --dbname="$DATABASE_URL" backup-2026-10-31.dump
```

---

## 3. Migrate existing SQLite data to PostgreSQL

Run against a **disposable** database first, then repeat for the real one.

```bash
export DATABASE_URL="postgresql://…/rentlink"

npm run db:pg:schema            # regenerate schema.pg.sql from schema.sql
npm run db:migrate              # create/upgrade the schema (recorded in schema_migrations)
npm run db:migrate:data         # dry run: row counts per table, writes nothing
npm run db:migrate:data -- --apply
```

The tool (`scripts/migrate-to-postgres.mjs`):

* opens the SQLite file **read-only**;
* inserts in foreign-key dependency order derived from the schema;
* runs the whole load in **one transaction** — any failure rolls back and the
  target is left exactly as it was;
* preserves ids verbatim, then advances every identity sequence past `MAX(id)`;
* **refuses to run** into a target that already contains data unless `--replace`
  is passed, and never uses `TRUNCATE … CASCADE` (it deletes only the tables in
  scope, so nothing unrelated can be emptied);
* verifies the result by comparing a SHA-256 digest of every row of every table
  on both sides — not just row counts — and prints the offending column and
  value for any mismatch.

Exit code 0 means verified. Anything else means **do not cut over**.

---

## 4. Deploy to Vercel

### 4.1 Project settings

| Setting | Value |
|---|---|
| Framework | Next.js (auto-detected) |
| Build command | `npm run build` (regenerates the schema module automatically) |
| Install command | `npm install` |
| Node | 20.x |

### 4.2 Environment variables

Copy every row from `.env.example`. The four that must not be skipped:

```
DATABASE_URL              pooled PostgreSQL connection string
SESSION_SECRET            32+ random characters (openssl rand -hex 32)
BLOB_READ_WRITE_TOKEN     from Vercel → Storage → Blob
CRON_SECRET               16+ random characters
```

### 4.3 Schema migrations are a deploy step, not a cold start

Set `PG_SKIP_SCHEMA=1` in production so a lambda never runs DDL. Apply schema
changes explicitly:

```bash
DATABASE_URL="postgresql://…" npm run db:migrate   # from CI or your machine
```

Baseline is `migrations/postgres/0001_baseline.sql`, generated from
`src/lib/schema.pg.sql`. Applied versions are recorded in `schema_migrations`, so
re-running is a no-op. Add `0002_*.sql` etc. for future changes; SQLite has its
own twin directory `migrations/sqlite/`.

### 4.4 Cron

`vercel.json` schedules `/api/cron/reminders` daily at 02:00 UTC. Vercel sends
`Authorization: Bearer $CRON_SECRET`; without `CRON_SECRET` the route returns 503
rather than becoming an open endpoint. The sweep is idempotent (it only inserts a
notification that does not already exist for that booking), so a retry or an
overlapping run cannot spam users.

### 4.5 Why the schema is a TypeScript module

`src/lib/schema.generated.ts` is produced at build time from the two `.sql`
files. A serverless bundle only contains files Next traced through imports, so
reading `schema.sql` from disk at runtime throws `ENOENT` on Vercel. Importing the
DDL as a module makes its availability a compile-time guarantee. Verified: the
generated bundle contains the DDL (`grep -rl 'CREATE TABLE IF NOT EXISTS users' .next/server`).

---

## 5. Connection pooling on serverless

Every lambda instance is a separate process with its own pool
(`PGPOOL_MAX`, default 3). Concurrency therefore multiplies connections. Use the
provider's pooler:

* **Neon** — connect to the `-pooler` host.
* **Supabase** — port `6543` (transaction mode).
* **RDS Proxy** — use its endpoint.

`allowExitOnIdle` is on so an idle instance releases its sockets, and the pool
has `min: 0`.

---

## 6. Verifying a deployment

```bash
BASE=https://your-deployment.vercel.app node scripts/sweep-pages.mjs   # every page + API, all three roles
BASE=https://your-deployment.vercel.app node scripts/check-promises.mjs # no unserialised Promises
BASE=https://your-deployment.vercel.app node scripts/test-e2e.mjs       # 166 workflow checks
```

Then check the function log for the `[config]` block: any `FATAL` line means the
deployment is misconfigured, and the message says exactly which variable.

---

## 7. What is still not automatic

* **Email / WhatsApp** — no provider is configured, so notifications are in-app
  only. Set `RESEND_API_KEY` and implement delivery in `src/lib/audit.ts`'s
  `deliverExternal()` (currently a labelled no-op).
* **Payments** — without all three Razorpay variables the app runs in
  demo mode and says so in the UI. Real payments additionally need a live-mode
  Razorpay account, an HTTPS webhook endpoint registered in the Razorpay
  dashboard, and a successful end-to-end test transaction.
* **Deposits** — recorded only. No escrow, no automatic deduction. See
  `RENTLINK_PAYMENT_SECURITY_VERIFICATION.md`.
