# Nestora

**Discover Your Space. Experience It in 3D.**

A property-tech and peer-to-peer **and** institutional resource-sharing marketplace: colleges, companies,
community organisations and individuals list equipment and spaces they already own but
aren't fully using, and other verified people rent them — with a full booking lifecycle,
condition handover, deposits, disputes and impact analytics.

Built with Next.js 15 (App Router) + TypeScript + Tailwind v4 + SQLite/PostgreSQL. The interface is
fully 2D — photographic, no WebGL and no 3D runtime.

> **Renamed from "RentLink 3D" to "Nestora".** Only the user-facing brand changed.
> Technical identifiers — the `rl_session` cookie, `data/rentlink.db`, the
> `RENTLINK_ALLOW_INSECURE_PROD` flag, `/api/*` routes, table names, storage
> prefixes and migration filenames — are deliberately unchanged.

> **Everything in the seed is fictional demonstration data** — providers, listings,
> bookings, reviews and verification records are all flagged `is_demo = 1`. Impact
> numbers are computed correctly *from those fictional rows*, and are not real-world
> claims. Payments run in a clearly labelled **demo mode** unless Razorpay test keys
> are configured. There is no escrow and no card data is ever stored.

---

## Quick start

```bash
npm install
npm run db:reset         # seed the demo database (in place — safe while a server runs)
npm run build
npm run start:demo       # http://localhost:3000
```

`start:demo` sets `ALLOW_DEMO_SEED=1`, which is what lets the seeded demo accounts
sign in. On a **production** deployment plain `npm start` refuses those logins and
`npm run db:reset` refuses to seed at all, until you opt in explicitly:

```bash
ALLOW_DEMO_SEED=1 DEMO_PASSWORD='a-real-password' npm run db:reset
ALLOW_DEMO_SEED=1 DEMO_PASSWORD='a-real-password' npm start
```

Development: `npm run dev`

## Demo logins

Password for every account: **`Demo@1234`**

| Role | Email |
|---|---|
| Admin | `admin@rentlink.demo` |
| Buyer (college) | `buyer@student.demo` |
| Provider — verified college | `provider@anna.demo` |
| Provider — pending verification | `provider@creators.demo` |
| Provider — more info needed | `provider@sunrise.demo` |

Full list, plus what to look at for each, is on `/help` inside the app.

---

## Verifying it

With the server running:

```bash
npm run verify:full           # EVERYTHING: tsc, eslint, build, payment unit +
                              # integration, e2e, 2D UI, links  (~6 min, self-contained)
npm test                      # e2e only: 173 functional checks
npm run test:payments         # payment unit tests on an isolated database
npm run verify:2d             # 36 real-browser 2D interface checks
npm run verify:links          # crawl: broken links / unwired buttons
```

`npm test` needs `ALLOW_TEST_FIXTURES=1` in the server environment so it can create
throwaway accounts (the public registration endpoint is rate-limited on purpose).

See **[RENTLINK_FINAL_VERIFICATION.md](./RENTLINK_FINAL_VERIFICATION.md)** for the
full PASS / PARTIAL / NOT IMPLEMENTED breakdown and the list of known limitations.

---

## What's here

| Area | Routes |
|---|---|
| Discovery | `/marketplace`, `/resources/[id]`, `/resources/[id]/passport`, `/compare`, `/recommend`, `/viewer`, `/storefront/[slug]` |
| Buyer | `/dashboard`, `/bookings`, `/bookings/[id]`, `/bookings/[id]/payment`, `/favourites`, `/notifications`, `/disputes` |
| Provider | `/provider`, `/provider/bookings`, `/provider/resources`, `/provider/new`, `/provider/utilisation`, `/provider/verification` |
| Admin | `/admin`, `/admin/verifications`, `/admin/disputes`, `/admin/resources`, `/admin/users`, `/admin/audit` |
| Other | `/impact`, `/settings`, `/help`, `/verification-report`, `/onboarding`, `/login`, `/register` |

## Optional configuration

All integrations are off by default and the UI says so rather than pretending.

```env
RAZORPAY_KEY_ID=              # Razorpay TEST keys → payment mode flips to razorpay_test
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=
OPENAI_API_KEY=               # optional LLM intent parser (rule-based engine is the default)
SMTP_*                        # email delivery
WHATSAPP_*                    # WhatsApp delivery
```

## Tech notes

- `better-sqlite3` is pinned to **exactly 11.10.0** — do not upgrade, newer builds
  segfault on this Node version.
- **`.gitignore` covers** `.env*` (except `.env.example`), `data/.session-secret`,
  `data/*.db{,-wal,-shm}`, `uploads/`, `node_modules/`, `.next/`, and test artifacts.
  Nothing secret or user-uploaded is ever meant to be committed.
- Payments: a gateway signature alone never settles a booking. See
  `RENTLINK_PAYMENT_SECURITY_VERIFICATION.md` for the full model.
- Passwords: scrypt with a per-user salt. Sessions: HMAC-hashed tokens in httpOnly cookies.
- Seeding is always in-place truncation. Never delete `data/rentlink.db` while a
  server is running — WAL keeps the old inode open and the two processes stop seeing
  the same database.
- Listing images: a provider's uploaded photo is always shown first. Seeded demo
  listings fall back to category photography via `src/lib/photos.ts` — the stored
  `/img/*.svg` placeholders are never rendered as if they were photographs.
- The interface is 2D only. `model_3d` remains a column on `resources` for API and
  record compatibility, but no page offers, renders or advertises a 3D model.
