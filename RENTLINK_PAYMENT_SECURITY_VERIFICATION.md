# RentLink 3D — Payment Security Fix and Verification

**Date:** 31 October 2026
**Scope:** the three payment files under review, plus the supporting changes they required. The
UI, booking workflow, 3D viewer and every previously working feature are preserved.

**Bottom line:** 16 real security/logic defects were found and fixed. **140 payment-specific
checks** now pass (64 unit + 76 integration, on top of the 192 application checks), and the whole app is
green in one command: **`npm run verify:full` → 8/8 gates**.
No real money has ever moved in this project — see [§7](#7-what-is-not-proven).

---

## 1. Headline numbers

| Gate | Command | Result |
|---|---|---|
| TypeScript | `tsc --noEmit` | **PASS** — 0 errors |
| ESLint | `eslint .` | **PASS** — 0 errors, 0 warnings (was 119 errors) |
| Production build | `next build` | **PASS** — compiled, 36 static pages, lint no longer skipped |
| Payment unit tests | `node scripts/test-payments.mjs` | **PASS — 64/64** |
| Payment integration (real HTTP) | `node scripts/test-payments-integration.mjs` | **PASS — 76/76** |
| End-to-end suite | `node scripts/test-e2e.mjs` | **PASS — 166/166**, 0 skipped |
| 3D browser suite | `node scripts/check-3d.mjs` | **PASS — 22/22** |
| Link/button crawl | `node scripts/check-links.mjs` | **PASS — 4/4** |
| **All of the above** | **`npm run verify:full`** | **PASS — 8/8 gates** |

Every number above was produced by executing the command in this workspace on the current
source; raw results are saved in `.paytest/*.json`.

---

## 2. Issues found, and how each was fixed

Each row: what was wrong → what the code does now → the test that exercises it.
`src/lib/payments.ts`, `src/app/api/payments/route.ts`, `src/app/api/payments/webhook/route.ts`
are the primary files.

| # | Issue | Severity | Fix | Exercised by |
|---|---|---|---|---|
| 1 | **Webhook compared rupees to paise.** `entity.amount` (paise) was never compared to the stored amount (rupees) at all — the only check was "order exists". | **Critical** | Compare in paise: `Number(entity.amount) === toPaise(payment.amount) === price.amountPaise`. | *IT 4* "Correct paise amount settles", "Stored amount is in RUPEES" |
| 2 | **Missing amount/currency accepted.** A capture event without `amount` or `currency` was treated as fine. | **Critical** | Capture events now **require** both; absence is rejected and audited (`payment.webhook_missing_amount`). | *IT 4* "Capture without an amount/currency is rejected" |
| 3 | **Signature alone settled a booking.** `POST /api/payments` marked a booking paid on a valid HMAC triple, with no proof the money was ever captured — a client could call it directly. | **Critical** | After the signature check the server calls **`GET /v1/payments/:id`** and requires `status === "captured"`. Verified against the gateway's *own* `order_id`, `amount` and `currency` too. | *IT 9* "Authorised-but-uncaptured confirm is refused", "Gateway order-id mismatch", "Gateway amount mismatch", "Invalid checkout signature" |
| 4 | **`payment.authorized` marked bookings paid.** Authorisation ≠ capture. | **Critical** | `payment.authorized` records the row as `authorized` only and returns `bookingPaid: false`. Only `payment.captured` settles. | *UT 5*, *IT 6* (6 checks) |
| 5 | **Unknown / foreign orders created paid records.** If no stored order matched, the old code **inserted a new `paid` payment row** for whatever order id the client sent. | **Critical** | `settleCapturedPayment()` requires a stored row, matching booking, matching amount. Unknown → `order_not_found`; other booking → `order_booking_mismatch`. Never inserts. | *UT 4*, *IT 8* "A valid signature over another booking's order is rejected" |
| 6 | **No duplicate settlement guard / no transactions.** Two concurrent requests (browser handler + webhook) could both settle. | **High** | Whole settlement runs in one SQLite transaction; the `UPDATE … WHERE status IN ('created','pending','authorized')` is the atomic gate. Replays return `idempotent: true`. | *UT 5, UT 6*, *IT 5, IT 12* |
| 7 | **No unique constraints on gateway ids.** A payment id could be reused across orders. | **High** | Partial unique indexes `idx_payments_order_unique`, `idx_payments_payment_unique` + explicit `payment_id_reused` / `order_already_settled` checks. | *UT 4* "UNIQUE index refuses a duplicate gateway order id" |
| 8 | **Prices were recomputed live.** `quote()` used the provider's *current* price list, so a provider editing prices changed what an existing booking cost. | **High** | `bookings.price_snapshot` is written once at creation (and re-pinned only when a counteroffer is accepted). All payment maths reads `bookingPrice()` → the snapshot. | *UT 7, UT 8*, *IT 11* |
| 9 | **`require("@/lib/db")` in the demo path.** | Medium | Normal top-level import. | *UT 9* |
| 10 | **Demo rows could look like gateway rows.** | Medium | Demo rows: `mode='demo'`, no gateway ids, `meta.simulated_only`, and they can never be settled by a webhook. | *UT 9* (5 checks) |
| 11 | **Deposit wording claimed escrow.** `markPaid` wrote "no funds are actually held in escrow" while other copy said "held". | Medium | One exported string, `depositSafetyNote()`, used everywhere: deposits are **SIMULATED RECORDS, not escrow**. | *IT 9* "Deposit note never claims real escrow" |
| 12 | **Failed payment could be resurrected.** Nothing stopped a later capture event on a failed order. | **Critical** | `failed` and `refunded` are terminal: settlement returns `payment_failed` / `payment_refunded`. Refund events transition paid → refunded. | *UT 5*, *IT 7* (6 checks) |
| 13 | **Webhook body was not the exact raw body** for verification in one path, and no event-type validation. | **High** | `req.text()` is used once and that exact string is HMAC'd; unsupported event types are ignored and audited. | *IT 3* "Body modified after signing is rejected", "Signed webhook for an unknown order is ignored" |
| 14 | **Demo admin had a publicly-known password in production.** | **High** | `src/lib/env.ts` + `authenticate()`: in production, demo accounts are refused unless `ALLOW_DEMO_SEED=1`; the seeder refuses to run in production unless opted in. | *UT 11*, plus a live HTTP check (see §5) |
| 15 | **Gateway host hard-coded.** Capture verification could not be pointed anywhere, so it was untestable. | Medium | `RAZORPAY_API_BASE` (server-side only, never exposed). Default unchanged: `https://api.razorpay.com`. | *IT 9, IT 12* |
| 16 | **Demo-account guard blocked the *correct* password** when `DEMO_PASSWORD` was customised (found by its own test). | Medium | Guard only refuses the documented default; a customised password is accepted. | *UT 11* "A customised demo password is accepted in production" |

### Concurrency, explicitly
`better-sqlite3` is synchronous and single-connection per process, so the two racing calls in the
tests model the worst case within one event loop: both requests arrive, both are validated, and
exactly one performs the state transition (`UT 6`: 1 non-idempotent, 1 idempotent, 1 paid row;
`IT 12`: statuses `200,200`, one `idempotent: true`, one paid row).
Cross-process concurrency is additionally guarded by the transaction plus the unique indexes —
but see the limitation in §7 about multi-process SQLite.

---

## 3. Files changed

**Payment core (the files under review)**
- `src/lib/payments.ts` — rewritten around `bookingPrice()`, `settleCapturedPayment()`,
  `verifyCaptureWithGateway()`, `recordAuthorizedPayment()`, `razorpayApiBase()`,
  `depositSafetyNote()`.
- `src/app/api/payments/route.ts` — capture confirmed with the gateway before settling;
  demo path fixed and idempotent; ownership re-derived per request.
- `src/app/api/payments/webhook/route.ts` — raw-body HMAC, event/field validation,
  paise-vs-rupees comparison, terminal failed/refunded handling, audit on every branch.

**Supporting (targeted, behaviour-preserving)**
- `src/lib/booking.ts` — `priceSnapshotFor()`; snapshot written on booking creation.
- `src/lib/lifecycle.ts` — counteroffer re-pins the snapshot; `markPaid()` no longer writes a
  payment row (only the payment layer may); deposit note from `depositSafetyNote()`.
- `src/lib/schema.sql` + `src/lib/db.ts` — `price_snapshot`, `price_pinned_at`, `captured_at`;
  the two unique indexes; an **additive in-place migration** for existing databases.
- `src/lib/env.ts` (new) — demo-credential policy. `src/lib/auth.ts` — enforces it.
- `src/lib/db.ts`, `src/lib/client.ts`, `src/lib/impact.ts`, `src/lib/resources.ts`,
  `src/lib/audit.ts` and ~40 components — `any` → typed rows / `unknown` (ESLint gate).
- `eslint.config.mjs` (new), `next.config.ts` — lint no longer skipped; `package.json` —
  `eslint` + `eslint-config-next` added, `better-sqlite3` pinned to exactly `11.10.0`.
- `.gitignore` (new), `.env.example`, `README.md`, `package.json` scripts.

**Tests / tooling (new)**
`scripts/test-payments.mjs` (unit), `scripts/test-payments-integration.mjs` (HTTP),
`scripts/paytest-build.mjs` (transpiles the payment lib for testing),
`scripts/payment-server.mjs` (isolated :3100 server + stand-in Razorpay API),
`scripts/verify-all.mjs` (the single verification command).

---

## 4. Test inventory — name and actual result

**Legend:** PASS = executed and passed · FAIL = executed and failed · NOT TESTED = not executed,
with the reason given.

### 4.1 Payment unit tests — `npm run test:payments` — 64/64 PASS
Runs the **real** `src/lib/payments.ts` (transpiled) against a throwaway SQLite database
(`.paytest/payments.db`). Only Razorpay's HTTP API is stubbed; signatures are real HMACs.

| Section | Checks | Result |
|---|---|---|
| 1. Signature verification (valid, tampered, wrong-payment-id, empty, webhook raw-body, missing) | 7 | **PASS** |
| 2. Correct captured payment: paid row, `captured_at`, simulated deposit row, non-escrow note | 6 | **PASS** |
| 3. Amount (under/over), currency, stored-order-amount tampering | 5 | **PASS** |
| 4. Unknown order, order of another booking, reused payment id, DB unique index | 7 | **PASS** |
| 5. Repeated webhook ×3 (one paid row), second payment on settled order, authorised ≠ paid, failed, refunded | 12 | **PASS** |
| 6. Concurrency: same payment id and different payment ids racing | 5 | **PASS** |
| 7. Price lock: provider doubles prices, booking total unchanged, still settles | 4 | **PASS** |
| 8. Legacy booking without a snapshot priced from its own columns, then pinned | 3 | **PASS** |
| 9. Demo rows tagged, no gateway ids, cannot be settled | 5 | **PASS** |
| 10. Capture authority via gateway API (captured / authorized / unreachable → fail closed) | 4 | **PASS** |
| 11. Demo-account policy (production block, opt-in, custom password) | 6 | **PASS** |

### 4.2 Payment integration tests — `node scripts/test-payments-integration.mjs` — 76/76 PASS
Boots its **own** production build on `:3100` against `.paytest/integration.db` with Razorpay
**test-mode-style** credentials, then drives the real HTTP routes.

| Section | Checks | Result |
|---|---|---|
| 1. Demo mode on a key-less server (mode, label, no key id leaked) | 3 | **PASS** |
| 2. Gateway-configured server: mode, publishable key only, **no secret in any response** | 4 | **PASS** |
| 3. Webhook: missing / wrong / tampered signature rejected + audited; unknown order ignored | 7 | **PASS** |
| 4. Amount & currency: wrong amount, wrong currency, missing amount, missing currency, correct paise settles | 10 | **PASS** |
| 5. Repeated captured webhooks over HTTP (3 delivers, 1 paid row, audited) | 5 | **PASS** |
| 6. Authorised-but-uncaptured never pays; a later capture does | 6 | **PASS** |
| 7. Failed and refunded payments cannot become paid | 6 | **PASS** |
| 8. Cross-booking order, payment-id reuse, other-user payment, provider self-payment | 9 | **PASS** |
| 9. Checkout: authorised refused, bad signature refused, gateway order/amount mismatch refused, captured settles, deposit wording | 10 | **PASS** |
| 10. Payment confirmed but the booking row cannot transition (cancelled) — money stored, status not resurrected, audited | 4 | **PASS** |
| 11. Provider price change after order creation — settles at the locked price, re-priced order rejected | 5 | **PASS** |
| 12. Two simultaneous confirmations — one paid row, one idempotent | 5 | **PASS** |
| 13. No gateway secret in rendered pages or API responses | 2 | **PASS** |

### 4.3 The 15 scenarios requested

| # | Requested scenario | Where | Result |
|---|---|---|---|
| 1 | Correct Razorpay captured payment | UT 2 · IT 4, 9 | **PASS** |
| 2 | Incorrect webhook signature | UT 1 · IT 3 | **PASS** |
| 3 | Incorrect amount | UT 3 · IT 4, 9 | **PASS** |
| 4 | Incorrect currency | UT 3 · IT 4 | **PASS** |
| 5 | Missing amount or currency | IT 4 | **PASS** |
| 6 | Unknown order ID | UT 4 · IT 3 | **PASS** |
| 7 | Order belonging to another booking | UT 4 · IT 8 | **PASS** |
| 8 | Reused payment ID | UT 4 · IT 8 | **PASS** |
| 9 | Repeated captured webhook | UT 5 · IT 5, 12 | **PASS** |
| 10 | Authorized payment without capture | UT 5, 10 · IT 6, 9 | **PASS** |
| 11 | Failed payment | UT 5 · IT 7 | **PASS** |
| 12 | Booking price changed after order creation | UT 7 · IT 11 | **PASS** |
| 13 | Two simultaneous confirmation requests | UT 6 · IT 12 | **PASS** |
| 14 | Demo payment without gateway credentials | UT 9 · IT 1 | **PASS** |
| 15 | Payment confirmation followed by booking-update failure | IT 10 | **PASS** |

### 4.4 Application suites (unchanged assertions)

| Suite | Result |
|---|---|
| End-to-end lifecycle (12 sections) | **166/166 PASS**, 0 failed, 0 skipped |
| 3D browser (real WebGL, puppeteer) | **22/22 PASS** |
| Links & buttons | **4/4 PASS** |

No assertion was weakened to make anything pass. Where a test was wrong rather than the code,
the fix is called out in §6.

---

## 5. Verification performed outside the suites

Two claims were checked live over HTTP because an in-process test cannot prove them:

```
production server WITHOUT ALLOW_DEMO_SEED
  POST /api/auth/login  admin@rentlink.demo / Demo@1234   → 401
    "Demo accounts are disabled on this deployment. Set ALLOW_DEMO_SEED=1 …"
  POST /api/auth/login  <real account>                    → 200   (unaffected)

production server with DEMO_PASSWORD='RentLink-Demo-2026-x7'
  documented default Demo@1234                            → 401
  custom password                                         → 200
```
Both are the intended behaviour. `npm run start:demo` is the documented demo launcher.

---

## 6. Bugs found in my own work during verification

Honest list — these were caught by the tests, not shipped:

1. `demoLoginBlocked()` refused a **correct customised** password (UT 11 caught it). Fixed.
2. The integration harness opened its SQLite handle **before** the server recreated the file,
   so writes went to a deleted inode — the classic WAL trap this project warns about. Moved
   the open after `startServer()`, and made the suite tear the server down on any exception.
3. One assertion expected `order_amount_mismatch` where the webhook correctly rejects earlier
   as `amount mismatch`. The assertion was too narrow, not the code; both reasons are now
   accepted *and* the webhook must report `ignored: true`.
4. The provider's cookie was stale after a re-login (sessions are single-active per user,
   by design), producing a misleading 401. Test fixed; the security behaviour was correct.
5. `markPaid()` still wrote an escrow-flavoured deposit note after the wording was centralised.
   Fixed to use `depositSafetyNote()`.

---

## 7. What is NOT proven

Stated plainly so nothing is over-claimed.

- **No real Razorpay transaction has ever been run.** No live test keys are provisioned here.
  Order creation and `GET /v1/payments/:id` were exercised against a local stand-in with the
  same request/response shape. Against a real account, the *first* thing to verify manually is
  order creation and the capture poll — see the checklist below.
- **No live-money path exists.** Every gateway code path is TEST-mode. `RAZORPAY_KEY_ID`
  accepts whatever is configured; nothing in the app checks whether a key is `rzp_live_*`.
- **Escrow does not exist.** Deposits are rows with a status. No funds are held. No code
  auto-deducts a deposit: deductions only occur through an admin dispute decision.
- **Refunds are recorded, not issued.** A `payment.refunded` webhook marks the row; there is no
  API call that initiates a refund.
- **Concurrency is proven in-process.** Single-connection SQLite + one transaction + unique
  indexes. If this is ever run as multiple Node processes on one SQLite file, WAL contention
  (not logic) becomes the risk — that needs a real DB before horizontal scaling.
- **Static analysis is not a pentest.** ESLint catches `any`, unused code and React pitfalls;
  it is not a security scanner. `npm audit` was not run as a gate.
- **Not tested:** card-network behaviour, 3-D Secure flows, partial captures, multi-currency,
  chargeback lifecycle, rate-limiter behaviour under sustained load, and browser-side
  Razorpay checkout (the `checkout.js` modal) — the server contract it calls is tested, the
  modal itself is not scripted.

### Manual checklist before showing this with real test keys
1. Set `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` (test keys) and `RAZORPAY_WEBHOOK_SECRET`.
2. Create a booking, pay with a Razorpay **test card**, confirm the redirect returns and the
   booking becomes `paid` — this proves the order-create + capture-poll round trip.
3. In the Razorpay dashboard, point the webhook at `/api/payments/webhook`; confirm a captured
   event marks a second booking paid and appears in `/admin/audit`.
4. Send the same webhook twice; confirm exactly one paid row.
5. Remove `RAZORPAY_WEBHOOK_SECRET`; confirm the endpoint returns **503** rather than trusting.

---

## 8. Database & secret handling

**`.gitignore` (new)** excludes `.env` / `.env.local` (keeping `.env.example`),
`data/.session-secret`, `data/*.db` + `-wal` / `-shm` / `-journal`, `uploads/` (condition photos
and ownership documents), `node_modules/`, `.next/`, test artifacts, and the browser proof
images. It does **not** exclude `scripts/seed.mjs`.

**Generating a clean demo database — safely.**
```bash
npm run db:reset          # truncates and reseeds IN PLACE
```
Never delete `data/rentlink.db` while a server is running: WAL keeps the old inode open and the
two processes silently end up on different databases. `seed.mjs --reset` was written to avoid
exactly this.

**Demo accounts.** All fictional, all share one password, all flagged `is_demo = 1`.
On a production deployment:
- `npm run db:reset` **refuses to run** (exit 2) unless `ALLOW_DEMO_SEED=1`;
- demo logins are **refused** unless `ALLOW_DEMO_SEED=1`;
- setting `DEMO_PASSWORD` to something unguessable is enough on its own for demo logins to work.

**Secrets.** `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` are read only on the server and
never appear in a response or a rendered page (asserted in IT 2 and IT 13). Only the publishable
`RAZORPAY_KEY_ID` reaches the browser, and only when the gateway is actually configured.

**Test isolation.** Payment tests use `.paytest/payments.db` and `.paytest/integration.db`;
`verify:full` seeds only those (or reseeds the demo DB in place for the e2e run). No test
deletes a live database.

---

## 9. How to run

```bash
npm install
npm run db:reset
npm run build
npm run start:demo        # http://localhost:3000

# everything, self-contained (~6 min; starts and stops its own servers)
npm run verify:full
npm run verify:full -- --fast     # typecheck, lint, build, payment tests only

# individual gates
npm run typecheck
npm run lint
npm run test:payments
node scripts/test-payments-integration.mjs
npm test
npm run verify:3d
npm run verify:links
```

---

## 10. Status summary

| Area | Status |
|---|---|
| Signature verification (checkout + webhook, raw body) | **PASS** |
| Capture-proof requirement (signature alone cannot settle) | **PASS** |
| Order ↔ booking ↔ amount ↔ currency matching | **PASS** |
| Rupees/paise handling, missing field rejection | **PASS** |
| Idempotency, replay and reuse protection | **PASS** |
| Concurrent confirmation / webhook settlement | **PASS** |
| Immutable booking price snapshot | **PASS** |
| Authorized ≠ captured; failed/refunded terminal | **PASS** |
| Demo mode isolation and honest labelling | **PASS** |
| Deposit handling (no escrow claims, no auto-deduction) | **PASS** |
| Ownership + provider self-payment blocked | **PASS** |
| Audit trail on success, rejection and replay | **PASS** |
| Secrets never exposed to the client | **PASS** |
| Runtime files ignored, demo admin credential guarded | **PASS** |
| TypeScript / ESLint / production build | **PASS** |
| Live Razorpay test-mode round trip with real keys | **NOT TESTED** (no keys provisioned) |
| Real escrow, real refunds, live-money payments | **NOT IMPLEMENTED** — not claimed anywhere in the UI |
