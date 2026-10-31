import { all, one, run, jsonParse, Row } from "./db";

/**
 * Booking engine: availability, pricing, double-booking prevention,
 * transparent priority scoring and waiting lists.
 */

export const OCCUPYING_STATUSES = [
  "pending", "approved", "awaiting_payment", "paid", "ready_for_handover",
  "active", "return_requested", "disputed",
];
const OCC_SQL = OCCUPYING_STATUSES.map((s) => `'${s}'`).join(",");

export function eachDate(start: string, end: string): string[] {
  const out: string[] = [];
  const s = new Date(start + "T00:00:00Z");
  const e = new Date(end + "T00:00:00Z");
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e < s) return out;
  const cap = 400;
  for (let d = new Date(s), i = 0; d <= e && i < cap; d.setUTCDate(d.getUTCDate() + 1), i++) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export function daysBetween(start: string, end: string): number {
  return eachDate(start, end).length;
}

/** Units already committed on a given date for a resource. */
export async function unitsBookedOn(resourceId: number, date: string, excludeBookingId?: number): Promise<number> {
  const row = await one<Row>(
    `SELECT COALESCE(SUM(units),0) AS u FROM bookings
     WHERE resource_id = ? AND status IN (${OCC_SQL}) AND start_date <= ? AND end_date >= ?
       ${excludeBookingId ? "AND id != ?" : ""}`,
    ...(excludeBookingId ? [resourceId, date, date, excludeBookingId] : [resourceId, date, date])
  );
  return Number(row?.u ?? 0);
}

export type Availability = {
  ok: boolean;
  capacity: number;
  minUnitsAvailable: number;
  blockedDates: string[];
  perDate: { date: string; booked: number; available: number; blocked: boolean }[];
  reason?: string;
};

/** Server-side availability check. Never trust a client-supplied "it's free". */
/**
 * `excludeBookingId` is used when extending an existing rental: the booking being
 * extended must not count against itself, or every extension looks unavailable.
 */
export async function checkAvailability(resourceId: number, start: string, end: string, units = 1, excludeBookingId?: number): Promise<Availability> {
  const res = await one<Row>(`SELECT * FROM resources WHERE id = ?`, resourceId);
  const dates = eachDate(start, end);
  if (!res) return { ok: false, capacity: 0, minUnitsAvailable: 0, blockedDates: [], perDate: [], reason: "Resource not found" };
  if (dates.length === 0) return { ok: false, capacity: 0, minUnitsAvailable: 0, blockedDates: [], perDate: [], reason: "Invalid date range" };
  if (res.status !== "active") return { ok: false, capacity: 0, minUnitsAvailable: 0, blockedDates: dates, perDate: [], reason: "Listing is not active" };

  const maintenance = await all<Row>(
    `SELECT start_date, end_date FROM maintenance_records WHERE resource_id = ?
       AND (end_date IS NULL OR end_date >= ?) AND start_date <= ?`,
    resourceId, start, end
  );
  const blocked = new Set<string>();
  for (const m of maintenance) {
    for (const d of eachDate(m.start_date, m.end_date || m.start_date)) blocked.add(d);
  }
  const explicit = await all<Row>(
    `SELECT date, status FROM resource_availability WHERE resource_id = ? AND date BETWEEN ? AND ? AND status != 'available'`,
    resourceId, start, end
  );
  for (const e of explicit) blocked.add(e.date);

  // Capacity = units the provider says exist, minus units declared as internally in use.
  const capacity = Math.max(0, Number(res.quantity_total) - Number(res.quantity_active));

  const perDate = await Promise.all(dates.map(async (d) => {
    const booked = await unitsBookedOn(resourceId, d, excludeBookingId);
    const blockedHere = blocked.has(d);
    return { date: d, booked, available: blockedHere ? 0 : Math.max(0, capacity - booked), blocked: blockedHere };
  }));
  const minUnitsAvailable = perDate.reduce((m, d) => Math.min(m, d.available), Number.POSITIVE_INFINITY);
  const blockedDates = perDate.filter((p) => p.blocked).map((p) => p.date);
  const reason = blockedDates.length
    ? `Dates blocked for maintenance or provider hold: ${blockedDates.slice(0, 4).join(", ")}${blockedDates.length > 4 ? "…" : ""}`
    : minUnitsAvailable < units
      ? `Not enough capacity on at least one day (requested ${units}, minimum available ${Number.isFinite(minUnitsAvailable) ? minUnitsAvailable : 0})`
      : undefined;

  return {
    ok: blockedDates.length === 0 && minUnitsAvailable >= units,
    capacity,
    minUnitsAvailable: Number.isFinite(minUnitsAvailable) ? minUnitsAvailable : 0,
    blockedDates,
    perDate,
    reason,
  };
}

/** Pricing: hourly / daily / weekly, deposit, platform fee. Deterministic & itemised. */
export function quote(res: Row, start: string, end: string, units = 1, basis: "hourly" | "daily" | "weekly" = "daily") {
  const days = daysBetween(start, end);
  const u = Math.max(1, units);
  let subtotal = 0;
  let rateLabel = "";
  if (basis === "hourly") {
    const hours = days * 8; // 8 rental hours per calendar day
    subtotal = Number(res.price_hourly) * hours * u;
    rateLabel = `₹${res.price_hourly}/hr × ${hours}h × ${u}`;
  } else if (basis === "weekly" && Number(res.price_weekly) > 0) {
    const weeks = Math.ceil(days / 7);
    subtotal = Number(res.price_weekly) * weeks * u;
    rateLabel = `₹${res.price_weekly}/week × ${weeks}w × ${u}`;
  } else {
    subtotal = Number(res.price_daily) * days * u;
    rateLabel = `₹${res.price_daily}/day × ${days}d × ${u}`;
  }
  subtotal = Math.round(subtotal * 100) / 100;
  const fees = Math.round(subtotal * 0.02 * 100) / 100; // 2% platform fee
  const deposit = Math.round(Number(res.deposit) * u * 100) / 100;
  return {
    days, units: u, basis, rateLabel,
    subtotal, fees, deposit,
    total: Math.round((subtotal + fees + deposit) * 100) / 100,
    rentalDue: Math.round((subtotal + fees) * 100) / 100,
  };
}


export type PriceSnapshot = {
  version: 1;
  resource_id: number;
  rate_basis: "hourly" | "daily" | "weekly";
  unit_rate: number;
  days: number;
  units: number;
  subtotal: number;
  fees: number;
  deposit: number;
  total: number;
  currency: "INR";
  pinned_at: string;
};

/**
 * Builds the immutable price snapshot stored on a booking. Used at creation and
 * again (deliberately) if a buyer accepts a provider counteroffer, which is a
 * genuine re-price that both parties agree to in the same moment.
 */
export function priceSnapshotFor(
  res: Row,
  q: ReturnType<typeof quote>,
  pinnedAt = new Date().toISOString()
): PriceSnapshot {
  const unitRate =
    q.basis === "hourly" ? Number(res.price_hourly)
    : q.basis === "weekly" ? Number(res.price_weekly)
    : Number(res.price_daily);
  return {
    version: 1,
    resource_id: Number(res.id),
    rate_basis: q.basis,
    unit_rate: unitRate,
    days: q.days,
    units: q.units,
    subtotal: q.subtotal,
    fees: q.fees,
    deposit: q.deposit,
    total: q.total,
    currency: "INR",
    pinned_at: pinnedAt,
  };
}

export type PriorityInput = {
  providerUserType: string;
  priorityPolicy: Record<string, unknown>;
  buyerAccountType: string;
  purpose: string | null;
  priorCompleted: number;
  buyerId: number;
  resourceId: number;
};

/**
 * Transparent priority score. Every component is explained to the user; there
 * is no hidden ranking. Score is stored on the booking at creation time.
 */
export async function priorityScore(input: PriorityInput): Promise<{ score: number; reasons: string[] }> {
  const policy = input.priorityPolicy || {};
  const reasons: string[] = [];
  let score = 0;

  const eligibleTypes = Array.isArray(policy.eligible_account_types)
    ? (policy.eligible_account_types as string[])
    : [];
  if (eligibleTypes.length && eligibleTypes.includes(input.buyerAccountType)) {
    score += 30;
    reasons.push("+30 eligible institutional member (policy: eligible account types)");
  } else if (eligibleTypes.length) {
    reasons.push("+0 not in the provider's preferred account types");
  }

  const purposeText = (input.purpose || "").toLowerCase();
  const academic = ["project", "academic", "research", "class", "course", "student", "thesis", "assignment", "study", "workshop"];
  if (policy.boost_academic !== false && academic.some((k) => purposeText.includes(k))) {
    score += 25;
    reasons.push("+25 stated academic / project purpose");
  }

  if (policy.boost_underserved !== false && input.priorCompleted === 0) {
    score += 20;
    reasons.push("+20 first-time borrower for this resource (fair start)");
  } else if (input.priorCompleted > 0) {
    reasons.push(`+0 previous completed bookings on this resource: ${input.priorCompleted}`);
  }

  if (policy.fair_rotation !== false) {
    // Fair rotation: fewer prior bookings from this buyer in the last 60 days => higher share.
    const recent = await one<Row>(
      `SELECT COUNT(*) AS c FROM bookings WHERE buyer_id = ? AND resource_id = ?
        AND created_at >= datetime('now','-60 days') AND status NOT IN ('cancelled','rejected')`,
      input.buyerId, input.resourceId
    );
    const c = Number(recent?.c ?? 0);
    const bonus = Math.max(0, 15 - c * 5);
    score += bonus;
    reasons.push(`+${bonus} fair-rotation (${c} requests to this resource in the last 60 days)`);
  }

  const cap = Number(policy.max_score ?? 100);
  return { score: Math.min(score, cap), reasons };
}

/** Creates a booking with server-side validation of every rule. */
export async function createBooking(opts: {
  resourceId: number;
  buyerId: number;
  start: string;
  end: string;
  units: number;
  basis: "hourly" | "daily" | "weekly";
  purpose: string | null;
}): Promise<{ ok: true; bookingId: number; code: string } | { ok: false; error: string; waiting?: boolean }> {
  const res = await one<Row>(
    `SELECT r.*, p.user_id AS provider_user_id, p.verification_status, p.priority_policy
       FROM resources r JOIN provider_profiles p ON p.id = r.provider_id
      WHERE r.id = ?`, opts.resourceId
  );
  if (!res) return { ok: false, error: "Resource not found" };
  if (res.status !== "active") return { ok: false, error: "This listing is not accepting bookings" };
  if (res.provider_user_id === opts.buyerId) return { ok: false, error: "You cannot book your own resource" };

  const days = daysBetween(opts.start, opts.end);
  if (days === 0) return { ok: false, error: "End date must be on or after start date" };
  if (days < Number(res.min_hours ?? 1)) return { ok: false, error: `Minimum booking is ${res.min_hours} day(s)` };
  if (days > Number(res.max_days ?? 30)) return { ok: false, error: `Maximum booking is ${res.max_days} days` };

  // Fair-use cap: how many future days a single buyer may hold on this resource.
  const limit = Number(res.booking_limit_days ?? 14);
  const held = await one<Row>(
    `SELECT COALESCE(SUM(days),0) AS d FROM bookings
      WHERE resource_id = ? AND buyer_id = ? AND end_date >= date('now')
        AND status IN (${OCC_SQL})`,
    opts.resourceId, opts.buyerId
  );
  if (Number(held?.d ?? 0) + days > limit) {
    return {
      ok: false,
      error: `Fair-use limit: you already hold ${held?.d ?? 0} future day(s) on this resource, and the provider's limit is ${limit} day(s) per buyer.`,
    };
  }

  const avail = await checkAvailability(opts.resourceId, opts.start, opts.end, opts.units);
  if (!avail.ok) {
    return { ok: false, error: avail.reason || "Not available for those dates", waiting: true };
  }

  const q = quote(res, opts.start, opts.end, opts.units, opts.basis);
  const prior = await one<Row>(
    `SELECT completed_bookings AS c FROM booking_usage WHERE user_id = ? AND resource_id = ?`,
    opts.buyerId, opts.resourceId
  );
  const pri = await priorityScore({
    providerUserType: res.org_type,
    priorityPolicy: jsonParse<Row>(res.priority_policy, {}),
    buyerAccountType: ((await one<Row>(`SELECT account_type FROM users WHERE id = ?`, opts.buyerId))?.account_type) || "individual",
    purpose: opts.purpose,
    priorCompleted: Number(prior?.c ?? 0),
    buyerId: opts.buyerId,
    resourceId: opts.resourceId,
  });

  const code = `RL-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 90 + 10)}`;
  // Immutable price snapshot. Everything downstream (payment verification, dispute
  // maths, receipts) reads this instead of recomputing from the provider's CURRENT
  // price list — a provider raising prices tomorrow must not change what this
  // booking costs. moneyForBooking() in lib/payments.ts mirrors this shape.
  const snapshot = priceSnapshotFor(res, q);
  const r = await run(
    `INSERT INTO bookings (code, resource_id, buyer_id, provider_id, start_date, end_date, days, purpose, units,
      rate_basis, subtotal, deposit, fees, total, status, priority_score, priority_reason, price_snapshot, price_pinned_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    code, opts.resourceId, opts.buyerId, res.provider_id, opts.start, opts.end, q.days, opts.purpose,
    q.units, q.basis, q.subtotal + q.fees, q.deposit, q.fees, q.total,
    res.approval_mode === "auto" ? "approved" : "pending",
    pri.score, pri.reasons.join(" · "),
    JSON.stringify(snapshot), new Date().toISOString()
  );
  return { ok: true, bookingId: Number(r.lastInsertRowid), code };
}

/** Moves the first eligible waiting-list entry to "offered" when capacity frees up. */
export async function offerWaitingList(resourceId: number) {
  const entries = await all<Row>(
    `SELECT * FROM waiting_list WHERE resource_id = ? AND status = 'waiting' ORDER BY created_at ASC`,
    resourceId
  );
  for (const e of entries) {
    const avail = await checkAvailability(resourceId, e.start_date, e.end_date, e.units);
    if (avail.ok) {
      await run(
        `UPDATE waiting_list SET status = 'offered', offered_until = ? WHERE id = ?`,
        new Date(Date.now() + 48 * 3600e3).toISOString(), e.id
      );
      return e;
    }
  }
  return null;
}

/** Recomputes a resource's utilisation snapshot from actual booking records. */
export async function computeUtilisation(resourceId: number, windowDays = 60) {
  const res = await one<Row>(`SELECT * FROM resources WHERE id = ?`, resourceId);
  if (!res) return null;
  const since = new Date(Date.now() - windowDays * 864e5).toISOString().slice(0, 10);
  const rows = await all<Row>(
    `SELECT start_date, end_date, units, status FROM bookings
      WHERE resource_id = ? AND status IN (${OCC_SQL}) AND end_date >= ?`,
    resourceId, since
  );
  let bookedDays = 0;
  for (const b of rows) {
    const s = b.start_date < since ? since : b.start_date;
    bookedDays += daysBetween(s, b.end_date) * Number(b.units || 1);
  }
  const total = Number(res.quantity_total) || 1;
  const availableDays = total * windowDays;
  const utilisation = availableDays > 0 ? Math.min(100, (bookedDays / availableDays) * 100) : 0;

  // Idle capacity estimate: units the provider declares as unused internally.
  const idleUnits = Math.max(0, total - Number(res.quantity_active || 0));
  const state =
    utilisation >= 55 ? "frequently_used" : utilisation >= 12 ? "shared" : utilisation < 12 && bookedDays === 0 ? "idle" : "underused";

  const snapDate = new Date().toISOString().slice(0, 10);
  await run(
    `INSERT INTO utilisation_snapshots (resource_id, snapshot_date, booked_days, available_days, utilisation_pct, idle_units_estimate, basis)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(resource_id, snapshot_date) DO UPDATE SET
       booked_days=excluded.booked_days, available_days=excluded.available_days,
       utilisation_pct=excluded.utilisation_pct, idle_units_estimate=excluded.idle_units_estimate,
       basis=excluded.basis`,
    resourceId, snapDate, bookedDays, availableDays, Math.round(utilisation * 10) / 10, idleUnits,
    res.is_demo ? "sample_demo" : "records"
  );
  await run(`UPDATE resources SET utilisation_state = ? WHERE id = ?`, state, resourceId);
  return {
    resourceId, totalUnits: total, internallyUsedUnits: Number(res.quantity_active || 0),
    idleUnits, windowDays, bookedDays, availableDays,
    utilisationPct: Math.round(utilisation * 10) / 10,
    state, basis: res.is_demo ? "sample_demo" : "records",
    internalUsageHoursMonth: Number(res.internal_usage_hours_month || 0),
  };
}

export async function recomputeProviderUtilisation(providerId: number) {
  const rows = await all<Row>(`SELECT id FROM resources WHERE provider_id = ?`, providerId);
  const out = await Promise.all(rows.map((r) => computeUtilisation(r.id)));
  return out.filter(Boolean);
}
