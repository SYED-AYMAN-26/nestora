import { all, jsonParse, one, run, today } from "./db";
import type { Bind } from "./db";
import type { Row } from "./db";
import { OCCUPYING_STATUSES, checkAvailability, daysBetween, offerWaitingList, priceSnapshotFor, quote, recomputeProviderUtilisation } from "./booking";
import { notify } from "./audit";
import { depositSafetyNote } from "./payments";
import type { BookingCtx } from "./access";

export type RateBasis = "hourly" | "daily" | "weekly";

export type ActionResult = { ok: true; message: string; status?: string; data?: unknown } | { ok: false; error: string; code?: number };

const bad = (error: string, code = 422): ActionResult => ({ ok: false, error, code });

/** Server-side guard: the caller must hold the stated role for this booking. */
function requireRole(ctx: BookingCtx, ...roles: Array<"buyer" | "provider" | "admin">): ActionResult | null {
  if (!roles.includes(ctx.role)) {
    return bad(`Only the ${roles.join(" or ")} can perform this action on this booking`, 403);
  }
  return null;
}

function requireStatus(ctx: BookingCtx, ...statuses: string[]): ActionResult | null {
  if (!statuses.includes(ctx.booking.status)) {
    return bad(`This action is not available while the booking is "${ctx.booking.status}"`, 409);
  }
  return null;
}

async function touch(bookingId: number, status: string, extra: Record<string, Bind> = {}) {
  const sets = ["status = ?", "updated_at = ?"];
  const vals: Bind[] = [status, new Date().toISOString()];
  for (const [k, v] of Object.entries(extra)) {
    sets.push(`${k} = ?`);
    vals.push(v);
  }
  await run(`UPDATE bookings SET ${sets.join(", ")} WHERE id = ?`, ...vals, bookingId);
}

// ---------------------------------------------------------------- provider decisions
/**
 * Availability re-check used before a booking may become approved.
 *
 * The booking being approved must not count against itself, so every check here
 * excludes it by id. This is the single place that decides "would approving this
 * create a double booking?" — used by approve, counter-accept and extension.
 */
export async function approvalAvailability(ctx: BookingCtx, start: string, end: string) {
  const b = ctx.booking;
  const avail = await checkAvailability(b.resource_id, start, end, b.units, b.id);
  // Units of *other* bookings that already occupy at least one of these dates.
  const others = await one<Row>(
    `SELECT COUNT(*) AS c, COALESCE(MAX(units),0) AS maxunits FROM bookings WHERE resource_id = ? AND id != ?
       AND status IN (${OCCUPYING_STATUSES.map((s) => `'${s}'`).join(",")})
       AND start_date <= ? AND end_date >= ?`,
    b.resource_id, b.id, end, start
  );
  const perDate = avail.perDate.reduce((m, d) => Math.min(m, d.available), Number.POSITIVE_INFINITY);
  return {
    ok: avail.ok && perDate >= b.units,
    capacity: avail.capacity,
    reason: avail.reason,
    perDate,
    otherBookings: Number(others?.c ?? 0),
  };
}

export async function approveBooking(ctx: BookingCtx): Promise<ActionResult> {
  const g = requireRole(ctx, "provider") ?? requireStatus(ctx, "pending", "counteroffered");
  if (g) return g;
  const b = ctx.booking;
  const check = await approvalAvailability(ctx, b.start_date, b.end_date);
  if (check.capacity <= 0) return bad("This resource has no shareable capacity configured", 409);
  if (!check.ok) {
    return bad(`Cannot approve: the requested dates are no longer available. ${check.reason ?? ""}`.trim(), 409);
  }
  await touch(b.id, "approved", { provider_note: null });
  await notify(b.buyer_id, "booking_update", "Booking approved", `Your booking ${b.code} was approved. Complete the payment to confirm it.`, `/bookings/${b.id}`);
  return { ok: true, message: "Booking approved. The buyer has been asked to complete payment.", status: "approved" };
}

export async function rejectBooking(ctx: BookingCtx, reason: string): Promise<ActionResult> {
  const g = requireRole(ctx, "provider") ?? requireStatus(ctx, "pending", "counteroffered");
  if (g) return g;
  if (!reason || reason.trim().length < 5) return bad("A rejection reason of at least 5 characters is required");
  await touch(ctx.booking.id, "rejected", { provider_note: reason.trim() });
  await notify(ctx.booking.buyer_id, "booking_update", "Booking request declined", `Your request ${ctx.booking.code} was declined: ${reason.trim()}`, `/bookings/${ctx.booking.id}`);
  await offerWaitingList(ctx.booking.resource_id);
  return { ok: true, message: "Request rejected with your reason. The buyer has been notified.", status: "rejected" };
}

export async function counterOffer(ctx: BookingCtx, start: string, end: string, note: string): Promise<ActionResult> {
  const g = requireRole(ctx, "provider") ?? requireStatus(ctx, "pending");
  if (g) return g;
  const days = daysBetween(start, end);
  if (!days) return bad("Counteroffer dates are invalid");
  if (days > Number(ctx.resource.max_days)) return bad(`Maximum booking is ${ctx.resource.max_days} days`);
  // A counteroffer moves the booking to new dates, so its own claim must be excluded.
  const avail = await checkAvailability(ctx.booking.resource_id, start, end, ctx.booking.units, ctx.booking.id);
  if (!avail.ok) return bad(`Proposed dates are not available: ${avail.reason}`);
  await run(
    `UPDATE bookings SET status = 'counteroffered', counter_start = ?, counter_end = ?, counter_note = ?, provider_note = ?, updated_at = ? WHERE id = ?`,
    start, end, note || null, note || null, new Date().toISOString(), ctx.booking.id
  );
  await notify(ctx.booking.buyer_id, "counteroffer", "Counteroffer received", `The provider proposed ${start} → ${end} for booking ${ctx.booking.code}.`, `/bookings/${ctx.booking.id}`);
  return { ok: true, message: "Counteroffer sent to the buyer.", status: "counteroffered" };
}

export async function respondCounter(ctx: BookingCtx, accept: boolean): Promise<ActionResult> {
  const g = requireRole(ctx, "buyer") ?? requireStatus(ctx, "counteroffered");
  if (g) return g;
  const b = ctx.booking;
  if (!accept) {
    await touch(b.id, "cancelled", { provider_note: "Buyer declined the counteroffer." });
    await notify((b.provider_id ? await providerUserId(b.provider_id) : 0) ?? 0, "booking_update", "Counteroffer declined", `The buyer declined your counteroffer on ${b.code}.`, `/provider/bookings/${b.id}`);
    return { ok: true, message: "You declined the counteroffer. The request was cancelled.", status: "cancelled" };
  }
  const avail = await approvalAvailability(ctx, b.counter_start!, b.counter_end!);
  if (!avail.ok) return bad(`Those dates are no longer available: ${avail.reason ?? "insufficient capacity"}`);
  const q = quote(ctx.resource, b.counter_start!, b.counter_end!, b.units, b.rate_basis as RateBasis);
  // An accepted counteroffer is a real re-price agreed by both sides, so the
  // immutable snapshot is re-pinned here — and only here.
  const snap = priceSnapshotFor(ctx.resource, q);
  await run(
    `UPDATE bookings SET status = 'approved', start_date = ?, end_date = ?, days = ?, subtotal = ?, fees = ?, total = ?,
       price_snapshot = ?, price_pinned_at = ?, updated_at = ? WHERE id = ?`,
    b.counter_start, b.counter_end, q.days, q.subtotal + q.fees, q.fees, q.total,
    JSON.stringify(snap), snap.pinned_at, new Date().toISOString(), b.id
  );
  await notify((await providerUserId(b.provider_id)) ?? 0, "booking_update", "Counteroffer accepted", `The buyer accepted your new dates for ${b.code}.`, `/provider/bookings/${b.id}`);
  return { ok: true, message: "Counteroffer accepted. Please complete the payment.", status: "approved" };
}

export async function providerCancel(ctx: BookingCtx, reason: string): Promise<ActionResult> {
  const g = requireRole(ctx, "provider", "admin") ?? requireStatus(ctx, "pending", "approved", "awaiting_payment", "paid", "ready_for_handover", "active");
  if (g) return g;
  if (!reason || reason.trim().length < 5) return bad("A cancellation reason is required");
  await touch(ctx.booking.id, "cancelled", { provider_note: `Provider cancelled: ${reason.trim()}` });
  await run(`UPDATE deposits SET status = 'released', released_amount = amount, note = ?, updated_at = ? WHERE booking_id = ?`,
    "Released because the provider cancelled the booking.", new Date().toISOString(), ctx.booking.id);
  await notify(ctx.booking.buyer_id, "booking_update", "Booking cancelled by provider", `${ctx.booking.code} was cancelled: ${reason.trim()}. Any deposit recorded is released.`, `/bookings/${ctx.booking.id}`);
  await offerWaitingList(ctx.booking.resource_id);
  return { ok: true, message: "Booking cancelled and the buyer notified. Recorded deposits are released.", status: "cancelled" };
}

export async function buyerCancel(ctx: BookingCtx, reason: string): Promise<ActionResult> {
  const g = requireRole(ctx, "buyer") ?? requireStatus(ctx, "pending", "approved", "awaiting_payment", "counteroffered", "paid", "ready_for_handover");
  if (g) return g;
  const b = ctx.booking;
  // Cancellation policy: free cancellation >= 48h before start.
  const hoursToStart = (new Date(b.start_date + "T00:00:00Z").getTime() - Date.now()) / 3600e3;
  const free = hoursToStart >= 48;
  await touch(b.id, "cancelled", { provider_note: reason ? `Buyer cancelled: ${reason.trim()}` : "Buyer cancelled." });
  await run(`UPDATE deposits SET status = 'released', released_amount = amount, note = ?, updated_at = ? WHERE booking_id = ?`,
    free
      ? "Released: cancelled more than 48 hours before the start date."
      : "Recorded as released in demo mode. Under the provider policy, late cancellations may be refunded at 50% — an admin review applies.",
    new Date().toISOString(), b.id);
  await notify((await providerUserId(b.provider_id)) ?? 0, "booking_update", "Booking cancelled by buyer", `${b.code} was cancelled by the buyer.`, `/provider/bookings/${b.id}`);
  await offerWaitingList(b.resource_id);
  return {
    ok: true,
    message: free
      ? "Booking cancelled. More than 48 hours before the start, so no cancellation charge applies."
      : "Booking cancelled. This is inside the 48-hour window — the provider's policy applies (50% refund), and any deduction needs review.",
    status: "cancelled",
  };
}

// ---------------------------------------------------------------- money
/**
 * Transitions a booking to `paid` after the caller has already verified money.
 * Deliberately does NOT insert a payment row: payment records are only ever
 * written by src/lib/payments.ts (checkout / webhook) so a booking can never be
 * marked paid without a matching, validated payment upstream.
 */
export async function markPaid(ctx: BookingCtx): Promise<ActionResult> {
  const g = requireRole(ctx, "buyer", "admin") ?? requireStatus(ctx, "approved", "awaiting_payment");
  if (g) return g;
  const b = ctx.booking;
  const q = quote(ctx.resource, b.start_date, b.end_date, b.units, b.rate_basis as RateBasis);
  await touch(b.id, "paid");
  const existingDeposit = await one(`SELECT * FROM deposits WHERE booking_id = ?`, b.id);
  if (!existingDeposit) {
    await run(`INSERT INTO deposits (booking_id, amount, status, note) VALUES (?,?,?,?)`, b.id, q.deposit,
      "held_demo", depositSafetyNote());
  }
  await notify((await providerUserId(b.provider_id)) ?? 0, "payment", "Payment received", `${b.code} is paid. Prepare the equipment for handover.`, `/provider/bookings/${b.id}`);
  return { ok: true, message: "Payment recorded. The provider will prepare the equipment for handover.", status: "paid" };
}

// ---------------------------------------------------------------- handover
export async function providerReady(ctx: BookingCtx, opts: { initial_condition: string; checklist: string[]; photos: string[]; note?: string }): Promise<ActionResult> {
  const g = requireRole(ctx, "provider") ?? requireStatus(ctx, "paid", "approved");
  if (g) return g;
  if (!opts.photos.length) return bad("At least one initial condition photo is required before handover");
  if (!opts.checklist.length) return bad("Complete the inspection checklist first");
  const b = ctx.booking;
  const existing = await one(`SELECT * FROM handovers WHERE booking_id = ?`, b.id);
  if (existing) {
    await run(`UPDATE handovers SET provider_ready_at = ?, provider_ready_note = ?, initial_condition = ?, checklist = ?, provider_photos = ? WHERE booking_id = ?`,
      new Date().toISOString(), opts.note ?? null, opts.initial_condition, JSON.stringify(opts.checklist), JSON.stringify(opts.photos), b.id);
  } else {
    await run(`INSERT INTO handovers (booking_id, provider_ready_at, provider_ready_note, initial_condition, checklist, provider_photos)
         VALUES (?,?,?,?,?,?)`,
      b.id, new Date().toISOString(), opts.note ?? null, opts.initial_condition, JSON.stringify(opts.checklist), JSON.stringify(opts.photos));
  }
  await run(`INSERT INTO condition_reports (booking_id, resource_id, stage, condition, checklist, photos, notes, reported_by)
       VALUES (?,?,?,?,?,?,?,?)`,
    b.id, b.resource_id, "initial", opts.initial_condition, JSON.stringify(opts.checklist), JSON.stringify(opts.photos),
    opts.note ?? "Provider pre-handover inspection", ctx.role === "provider" ? await providerUserId(b.provider_id) : null);
  await touch(b.id, "ready_for_handover");
  await notify(b.buyer_id, "handover", "Ready for collection", `${b.code}: the provider recorded the initial condition. Review and confirm collection.`, `/bookings/${b.id}/handover`);
  return { ok: true, message: "Initial condition recorded. The buyer has been asked to confirm collection.", status: "ready_for_handover" };
}

export async function buyerConfirmHandover(ctx: BookingCtx, opts: { note?: string; photos: string[]; accepted: boolean }): Promise<ActionResult> {
  const g = requireRole(ctx, "buyer") ?? requireStatus(ctx, "ready_for_handover");
  if (g) return g;
  const b = ctx.booking;
  if (!opts.accepted) {
    await notify((await providerUserId(b.provider_id)) ?? 0, "handover", "Buyer disputed the handover condition", `Buyer did not accept the initial condition for ${b.code}.`, `/provider/bookings/${b.id}`);
    return { ok: true, message: "You reported a problem at collection. The provider must resolve it before the rental starts." };
  }
  const h = await one(`SELECT * FROM handovers WHERE booking_id = ?`, b.id);
  if (!h) return bad("The provider has not recorded the initial condition yet", 409);
  await run(`UPDATE handovers SET buyer_confirmed_at = ?, buyer_note = ?, buyer_photos = ?, completed_at = ? WHERE booking_id = ?`,
    new Date().toISOString(), opts.note ?? null, JSON.stringify(opts.photos), new Date().toISOString(), b.id);
  await touch(b.id, "active");
  await notify((await providerUserId(b.provider_id)) ?? 0, "handover", "Collection confirmed — rental active", `${b.code} is now an active rental until ${b.end_date}.`, `/provider/bookings/${b.id}`);
  return { ok: true, message: "Collection confirmed. The rental is now active.", status: "active" };
}

// ---------------------------------------------------------------- return
export async function buyerRequestReturn(ctx: BookingCtx, opts: { photos: string[]; note?: string; condition: string }): Promise<ActionResult> {
  const g = requireRole(ctx, "buyer") ?? requireStatus(ctx, "active", "disputed");
  if (g) return g;
  if (!opts.photos.length) return bad("Upload at least one return photo");
  const b = ctx.booking;
  const existing = await one(`SELECT * FROM returns WHERE booking_id = ?`, b.id);
  if (existing) {
    await run(`UPDATE returns SET buyer_requested_at = ?, buyer_note = ?, buyer_photos = ? WHERE booking_id = ?`,
      new Date().toISOString(), opts.note ?? null, JSON.stringify(opts.photos), b.id);
  } else {
    await run(`INSERT INTO returns (booking_id, buyer_requested_at, buyer_note, buyer_photos) VALUES (?,?,?,?)`,
      b.id, new Date().toISOString(), opts.note ?? null, JSON.stringify(opts.photos));
  }
  await run(`INSERT INTO condition_reports (booking_id, resource_id, stage, condition, checklist, photos, notes, reported_by)
       VALUES (?,?,?,?,?,?,?,?)`,
    b.id, b.resource_id, "return", opts.condition, JSON.stringify([]), JSON.stringify(opts.photos), opts.note ?? "Buyer return submission", ctx.booking.buyer_id);
  await touch(b.id, "return_requested");
  await notify((await providerUserId(b.provider_id)) ?? 0, "return", "Return submitted", `${b.code}: buyer submitted return photos. Please inspect.`, `/provider/bookings/${b.id}/return`);
  return { ok: true, message: "Return submitted. The provider will inspect the equipment.", status: "return_requested" };
}

export async function providerConfirmReturn(ctx: BookingCtx, opts: {
  condition: string; checklist: string[]; photos: string[]; note?: string; accept: boolean;
}): Promise<ActionResult> {
  const g = requireRole(ctx, "provider") ?? requireStatus(ctx, "return_requested");
  if (g) return g;
  if (!opts.photos.length) return bad("Upload at least one inspection photo");
  const b = ctx.booking;
  await run(`UPDATE returns SET provider_inspected_at = ?, return_condition = ?, checklist = ?, provider_photos = ?, provider_note = ?, confirmed_at = ?
       WHERE booking_id = ?`,
    new Date().toISOString(), opts.condition, JSON.stringify(opts.checklist), JSON.stringify(opts.photos),
    opts.note ?? null, opts.accept ? new Date().toISOString() : null, b.id);
  await run(`INSERT INTO condition_reports (booking_id, resource_id, stage, condition, checklist, photos, notes, reported_by)
       VALUES (?,?,?,?,?,?,?,?)`,
    b.id, b.resource_id, opts.accept ? "return" : "damage", opts.condition, JSON.stringify(opts.checklist),
    JSON.stringify(opts.photos), opts.note ?? "Provider return inspection", await providerUserId(b.provider_id));

  if (!opts.accept) {
    await touch(b.id, "disputed");
    await notify(b.buyer_id, "dispute", "Return condition contested", `${b.code}: the provider flagged a condition issue. You can add your evidence in the dispute.`, `/disputes`);
    return { ok: true, message: "Issue recorded. A dispute is open for admin review — the deposit is NOT deducted automatically.", status: "disputed" };
  }

  await touch(b.id, "completed");
  await run(`UPDATE deposits SET status = 'released', released_amount = amount, note = ?, updated_at = ? WHERE booking_id = ?`,
    "Equipment returned and inspected; deposit released (demo mode — no real funds moved).", new Date().toISOString(), b.id);
  await run(`UPDATE resources SET status = status, updated_at = ? WHERE id = ?`, new Date().toISOString(), b.resource_id);
  await run(`INSERT INTO booking_usage (user_id, resource_id, completed_bookings) VALUES (?,?,1)
       ON CONFLICT(user_id, resource_id) DO UPDATE SET completed_bookings = booking_usage.completed_bookings + 1, updated_at = ?`,
    b.buyer_id, b.resource_id, new Date().toISOString());
  await recomputeProviderUtilisation(b.provider_id);
  await notify(b.buyer_id, "booking_update", "Booking completed", `${b.code} is complete. Leave a review to help other buyers.`, `/bookings/${b.id}`);
  return { ok: true, message: "Return confirmed. The booking is complete and the deposit is released.", status: "completed" };
}

// ---------------------------------------------------------------- extensions
export async function requestExtension(ctx: BookingCtx, newEnd: string, note?: string): Promise<ActionResult> {
  const g = requireRole(ctx, "buyer") ?? requireStatus(ctx, "active");
  if (g) return g;
  const b = ctx.booking;
  // daysBetween is inclusive, so N days from the current end date = N - 1 extra days.
  const span = daysBetween(b.end_date, newEnd);
  const extra = span - 1;
  if (extra < 1) return bad("The new end date must be at least one day after the current return date");
  const avail = await checkAvailability(b.resource_id, b.end_date, newEnd, b.units, b.id);
  const overlapping = await all<Row>(
    `SELECT id FROM bookings WHERE resource_id = ? AND id != ? AND start_date <= ? AND end_date > ?
       AND status IN (${OCCUPYING_STATUSES.map((s) => `'${s}'`).join(",")})`,
    b.resource_id, b.id, newEnd, b.end_date
  );
  if (!avail.ok) return bad(`Extension not possible: ${avail.reason}`);
  if (overlapping.length) return bad("Another booking occupies those dates, so the extension cannot be requested.");
  const extraCost = Math.round(Number(ctx.resource.price_daily) * extra * b.units * 100) / 100;
  const pendingExisting = await one(`SELECT * FROM extensions WHERE booking_id = ? AND status = 'pending'`, b.id);
  if (pendingExisting) return bad("You already have an extension request awaiting a decision", 409);
  await run(`INSERT INTO extensions (booking_id, requested_end, extra_days, extra_cost, status, note) VALUES (?,?,?,?, 'pending', ?)`,
    b.id, newEnd, extra, extraCost, note ?? null);
  await notify((await providerUserId(b.provider_id)) ?? 0, "extension", "Extension requested", `${b.code}: buyer requested an extension to ${newEnd}.`, `/provider/bookings/${b.id}`);
  return { ok: true, message: `Extension request sent. Extra charge if approved: ₹${extraCost}.` };
}

export async function decideExtension(ctx: BookingCtx, extensionId: number, approve: boolean, note?: string): Promise<ActionResult> {
  const g = requireRole(ctx, "provider");
  if (g) return g;
  const ext = await one<Row>(`SELECT * FROM extensions WHERE id = ? AND booking_id = ?`, extensionId, ctx.booking.id);
  if (!ext) return bad("Extension request not found", 404);
  if (ext.status !== "pending") return bad("This extension has already been decided", 409);
  if (ctx.booking.status !== "active") return bad("Extensions can only be decided while the rental is active", 409);
  if (!approve) {
    await run(`UPDATE extensions SET status = 'rejected', note = ?, decided_at = ? WHERE id = ?`, note ?? null, new Date().toISOString(), ext.id);
    await notify(ctx.booking.buyer_id, "extension", "Extension declined", `Your extension request for ${ctx.booking.code} was declined.${note ? " " + note : ""}`, `/bookings/${ctx.booking.id}`);
    return { ok: true, message: "Extension declined and the buyer notified." };
  }
  const avail = await checkAvailability(ctx.booking.resource_id, ctx.booking.end_date, ext.requested_end, ctx.booking.units, ctx.booking.id);
  if (!avail.ok) return bad(`Cannot approve now: ${avail.reason}`);
  await run(`UPDATE extensions SET status = 'approved', note = ?, decided_at = ? WHERE id = ?`, note ?? null, new Date().toISOString(), ext.id);
  const days = daysBetween(ctx.booking.start_date, ext.requested_end);
  await run(`UPDATE bookings SET end_date = ?, days = ?, total = total + ?, updated_at = ? WHERE id = ?`,
    ext.requested_end, days, ext.extra_cost, new Date().toISOString(), ctx.booking.id);
  if (ext.extra_cost > 0) {
    await run(`INSERT INTO payments (booking_id, kind, amount, mode, status, meta)
         VALUES (?, 'extension', ?, 'demo', 'pending', ?)`,
      ctx.booking.id, ext.extra_cost, JSON.stringify({ note: "Extension charge — demo mode, collected separately" }));
  }
  await notify(ctx.booking.buyer_id, "extension", "Extension approved", `Your rental ${ctx.booking.code} now ends on ${ext.requested_end}. Extra charge: ₹${ext.extra_cost}.`, `/bookings/${ctx.booking.id}`);
  return { ok: true, message: `Extension approved to ${ext.requested_end}.` };
}

// ---------------------------------------------------------------- waiting list
export async function joinWaitingList(ctx: { resource: Row; userId: number }, start: string, end: string, units = 1): Promise<ActionResult> {
  if (!daysBetween(start, end)) return bad("Dates are invalid");
  const dup = await one(
    `SELECT 1 FROM waiting_list WHERE resource_id = ? AND user_id = ? AND status = 'waiting' AND start_date = ? AND end_date = ?`,
    ctx.resource.id, ctx.userId, start, end
  );
  if (dup) return bad("You are already on the waiting list for those dates", 409);
  await run(`INSERT INTO waiting_list (resource_id, user_id, start_date, end_date, units) VALUES (?,?,?,?,?)`,
    ctx.resource.id, ctx.userId, start, end, units);
  return { ok: true, message: "Added to the waiting list. You will be offered a slot if capacity frees up.", status: "waiting" };
}

export async function cancelWaiting(ctx: { userId: number }, waitingId: number): Promise<ActionResult> {
  const w = await one<Row>(`SELECT * FROM waiting_list WHERE id = ?`, waitingId);
  if (!w) return bad("Waiting list entry not found", 404);
  if (w.user_id !== ctx.userId) return bad("That waiting-list entry belongs to another user", 403);
  await run(`UPDATE waiting_list SET status = 'cancelled' WHERE id = ?`, waitingId);
  return { ok: true, message: "Removed from the waiting list." };
}

// ---------------------------------------------------------------- helpers
export async function providerUserId(providerId: number): Promise<number | null> {
  const r = await one<{ user_id: number }>(`SELECT user_id FROM provider_profiles WHERE id = ?`, providerId);
  return r?.user_id ?? null;
}

export async function bookingBundle(bookingId: number) {
  const b = await one<Row>(`SELECT * FROM bookings WHERE id = ?`, bookingId);
  if (!b) return null;
  const resource = await one<Row>(
    `SELECT r.*, p.display_name AS provider_name, p.storefront_slug, p.verification_status, p.user_id AS provider_user_id,
            (SELECT url FROM resource_images i WHERE i.resource_id = r.id ORDER BY sort_order LIMIT 1) AS image_url
       FROM resources r JOIN provider_profiles p ON p.id = r.provider_id WHERE r.id = ?`, b.resource_id);
  const buyer = await one<Row>(`SELECT id, full_name, email, phone, account_type, org_name, city FROM users WHERE id = ?`, b.buyer_id);
  const providerUser = resource ? await one<Row>(`SELECT id, full_name, email, phone FROM users WHERE id = ?`, resource.provider_user_id) : null;
  const handover = await one<Row>(`SELECT * FROM handovers WHERE booking_id = ?`, bookingId);
  const ret = await one<Row>(`SELECT * FROM returns WHERE booking_id = ?`, bookingId);
  const payments = await all<Row>(`SELECT * FROM payments WHERE booking_id = ? ORDER BY id`, bookingId);
  const deposits = await one<Row>(`SELECT * FROM deposits WHERE booking_id = ?`, bookingId);
  const extensions = await all<Row>(`SELECT * FROM extensions WHERE booking_id = ? ORDER BY id DESC`, bookingId);
  const dispute = await one<Row>(`SELECT * FROM disputes WHERE booking_id = ? ORDER BY id DESC`, bookingId);
  const review = await one<Row>(`SELECT * FROM reviews WHERE booking_id = ?`, bookingId);
  const conditionReports = await all<Row>(`SELECT * FROM condition_reports WHERE booking_id = ? ORDER BY id`, bookingId);
  const messages = await all<Row>(
    `SELECT m.*, u.full_name AS sender_name, u.role AS sender_role FROM messages m JOIN users u ON u.id = m.sender_id
      WHERE m.booking_id = ? ORDER BY m.id`, bookingId);
  return {
    // `quote` is an added field, so the object is explicitly a Row (callers read arbitrary columns).
    booking: { ...b, quote: quote(resource!, b.start_date, b.end_date, b.units, b.rate_basis as RateBasis) } as Row & { quote: ReturnType<typeof quote> },
    resource, buyer, providerUser,
    handover: handover ? { ...handover, checklist: jsonParse(handover.checklist, []), provider_photos: jsonParse(handover.provider_photos, []), buyer_photos: jsonParse(handover.buyer_photos, []) } : null,
    returnRecord: ret ? { ...ret, checklist: jsonParse(ret.checklist, []), buyer_photos: jsonParse(ret.buyer_photos, []), provider_photos: jsonParse(ret.provider_photos, []) } : null,
    payments, deposit: deposits, extensions, dispute, review,
    conditionReports: conditionReports.map((c) => ({ ...c, checklist: jsonParse(c.checklist, []), photos: jsonParse(c.photos, []) })),
    messages,
    overdue: b.status === "active" && b.end_date < today(),
    daysLeft: Math.round((new Date(b.end_date + "T00:00:00Z").getTime() - Date.now()) / 864e5),
  };
}

/** Nightly-style reminder sweep; also callable from an admin action. */
export async function sweepReminders(): Promise<{ collections: number; returns: number; overdue: number }> {
  let collections = 0, returns = 0, overdue = 0;
  for (const b of await all<Row>(`SELECT * FROM bookings WHERE status IN ('paid','ready_for_handover') AND start_date <= date('now','+1 day')`)) {
    const already = await one(`SELECT 1 FROM notifications WHERE user_id = ? AND kind = 'collection_reminder' AND link = ?`, b.buyer_id, `/bookings/${b.id}`);
    if (!already) {
      await notify(b.buyer_id, "collection_reminder", "Collection reminder", `Your rental ${b.code} starts on ${b.start_date}.`, `/bookings/${b.id}`);
      collections++;
    }
  }
  for (const b of await all<Row>(`SELECT * FROM bookings WHERE status = 'active' AND end_date <= date('now','+2 day')`)) {
    const already = await one(`SELECT 1 FROM notifications WHERE user_id = ? AND kind = 'return_reminder' AND link = ?`, b.buyer_id, `/bookings/${b.id}`);
    if (!already) {
      await notify(b.buyer_id, "return_reminder", "Return reminder", `Your rental ${b.code} is due back on ${b.end_date}.`, `/bookings/${b.id}`);
      returns++;
    }
    if (b.end_date < today()) {
      await notify((await providerUserId(b.provider_id)) ?? 0, "overdue", "Overdue return", `${b.code} was due on ${b.end_date} and is still out.`, `/provider/bookings/${b.id}`);
      overdue++;
    }
  }
  return { collections, returns, overdue };
}
