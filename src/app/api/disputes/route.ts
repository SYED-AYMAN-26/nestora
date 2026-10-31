import { z } from "zod";
import { guard, ok, fail, parseBody } from "@/lib/http";
import { getSessionUser } from "@/lib/auth";
import { loadBookingForUser } from "@/lib/access";
import { all, one, run, jsonParse } from "@/lib/db";
import { audit, notify } from "@/lib/audit";

const createSchema = z.object({
  bookingId: z.number().int(),
  kind: z.enum(["damage", "missing", "late_return", "other"]),
  claim_amount: z.number().min(0).max(1e7).default(0),
  description: z.string().min(10).max(3000),
  evidence: z.array(z.string().max(300)).max(8).default([]),
});

export const GET = guard(async (req: Request) => {
  const user = await getSessionUser();
  if (!user) return fail("Authentication required", 401);
  const url = new URL(req.url);
  const mine = url.searchParams.get("scope") === "all" && user.role === "admin";
  const rows = mine
    ? await all(`SELECT d.*, b.code, r.title AS resource_title, u.full_name AS raised_by_name
             FROM disputes d JOIN bookings b ON b.id = d.booking_id JOIN resources r ON r.id = b.resource_id
             JOIN users u ON u.id = d.raised_by ORDER BY d.created_at DESC LIMIT 200`)
    : await all(
        `SELECT d.*, b.code, r.title AS resource_title, u.full_name AS raised_by_name
           FROM disputes d JOIN bookings b ON b.id = d.booking_id JOIN resources r ON r.id = b.resource_id
           JOIN users u ON u.id = d.raised_by
          WHERE b.buyer_id = ? OR b.provider_id = ? OR ? = 1
          ORDER BY d.created_at DESC LIMIT 200`,
        user.id, user.provider?.id ?? -1, user.role === "admin" ? 1 : 0
      );
  return ok({ items: rows.map((r) => ({ ...r, evidence: jsonParse(r.evidence, []) })) });
});

/** Raising a dispute NEVER auto-deducts the deposit. It opens a review. */
export const POST = guard(async (req: Request) => {
  const user = await getSessionUser();
  if (!user) return fail("Authentication required", 401);
  const parsed = await parseBody(req, createSchema);
  if (!parsed.ok) return parsed.res;
  const d = parsed.data;

  const access = await loadBookingForUser(d.bookingId, user);
  if (!access) return fail("Booking not found", 404);
  if (access.role === "admin") return fail("Admins decide disputes; they do not raise them", 403);
  if (access.role === "provider" && !["damage", "missing", "late_return"].includes(d.kind)) {
    return fail("Providers may report damage, missing equipment or late returns", 422);
  }
  if (!["active", "return_requested", "completed", "disputed", "paid", "ready_for_handover"].includes(access.booking.status)) {
    return fail(`A dispute cannot be opened while the booking is "${access.booking.status}"`, 409);
  }
  if (!d.evidence.length) return fail("At least one piece of evidence (photo or document) is required", 422);

  const existing = await one(`SELECT * FROM disputes WHERE booking_id = ? AND status IN ('open','evidence_requested','under_review')`, d.bookingId);
  if (existing) return fail("An open dispute already exists for this booking", 409);

  const against = access.role === "buyer"
    ? (await one<{ user_id: number }>(`SELECT user_id FROM provider_profiles WHERE id = ?`, access.booking.provider_id))?.user_id ?? null
    : access.booking.buyer_id;

  const r = await run(
    `INSERT INTO disputes (booking_id, raised_by, against, kind, claim_amount, description, evidence, status)
     VALUES (?,?,?,?,?,?,?, 'open')`,
    d.bookingId, user.id, against, d.kind, d.claim_amount, d.description, JSON.stringify(d.evidence)
  );
  const disputeId = Number(r.lastInsertRowid);
  await run(`UPDATE bookings SET status = 'disputed', updated_at = ? WHERE id = ?`, new Date().toISOString(), d.bookingId);
  await run(`UPDATE deposits SET status = 'disputed', note = ?, updated_at = ? WHERE booking_id = ?`,
    "Deposit frozen pending admin review — no automatic deduction.", new Date().toISOString(), d.bookingId);

  if (against) await notify(against, "dispute", "Dispute opened", `A ${d.kind} dispute was raised on booking ${access.booking.code}.`, `/disputes/${disputeId}`);
  const admin = await one<{ id: number }>(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`);
  if (admin) await notify(admin.id, "dispute", "Dispute needs review", `Booking ${access.booking.code}: ${d.kind} dispute opened.`, `/admin/disputes`);
  await audit({ actorId: user.id, actorEmail: user.email, action: "dispute.create", entity: "dispute", entityId: disputeId, detail: { bookingId: d.bookingId, kind: d.kind, claim: d.claim_amount } });

  return ok({ disputeId, message: "Dispute opened. The security deposit is frozen, not deducted — an admin will review the evidence." });
});
