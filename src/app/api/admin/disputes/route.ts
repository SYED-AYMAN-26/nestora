import { z } from "zod";
import { guard, ok, fail, parseBody } from "@/lib/http";
import { requireAdmin } from "@/lib/auth";
import { all, jsonParse, one, Row, run } from "@/lib/db";
import { audit, notify } from "@/lib/audit";

export const GET = guard(async (req: Request) => {
  const auth = await requireAdmin();
  if (!auth.ok) return fail(auth.error, auth.code);
  const status = new URL(req.url).searchParams.get("status");
  const rows = await all(
    `SELECT d.*, b.code AS booking_code, b.buyer_id, b.provider_id, r.title AS resource_title,
            u.full_name AS raised_by_name, p.display_name AS provider_name
       FROM disputes d JOIN bookings b ON b.id = d.booking_id JOIN resources r ON r.id = b.resource_id
       JOIN users u ON u.id = d.raised_by JOIN provider_profiles p ON p.id = b.provider_id
       ${status && status !== "all" ? "WHERE d.status = ?" : ""}
       ORDER BY CASE d.status WHEN 'open' THEN 0 WHEN 'evidence_requested' THEN 1 WHEN 'under_review' THEN 2 ELSE 3 END, d.created_at DESC`,
    ...(status && status !== "all" ? [status] : [])
  );
  return ok({ items: rows.map((r) => ({ ...r, evidence: jsonParse(r.evidence, []) })) });
});

const schema = z.object({
  disputeId: z.number().int(),
  decision: z.enum(["resolved", "rejected", "evidence_requested", "under_review", "closed"]),
  decision_note: z.string().min(5).max(2000),
  deduction_amount: z.number().min(0).max(1e7).default(0),
});

/**
 * Admin dispute decision. A deduction only takes effect when the admin
 * explicitly records one, with a documented note.
 */
export const POST = guard(async (req: Request) => {
  const auth = await requireAdmin();
  if (!auth.ok) return fail(auth.error, auth.code);
  const parsed = await parseBody(req, schema);
  if (!parsed.ok) return parsed.res;
  const d = parsed.data;

  const dispute = await one<Row>(
    `SELECT d.*, b.buyer_id, b.provider_id, b.code FROM disputes d JOIN bookings b ON b.id = d.booking_id WHERE d.id = ?`, d.disputeId
  );
  if (!dispute) return fail("Dispute not found", 404);
  if (d.deduction_amount > Number(dispute.claim_amount)) {
    return fail("A deduction cannot exceed the claimed amount", 422);
  }

  await run(`UPDATE disputes SET status = ?, decision = ?, deduction_amount = ?, decided_by = ?, decided_at = ? WHERE id = ?`,
    d.decision, d.decision_note, d.deduction_amount, auth.user.id, new Date().toISOString(), d.disputeId);

  if (d.decision === "resolved") {
    // Deposit rows must exist for every booking; create a zero-deposit record if the
    // booking had no refundable deposit, so the decision is always recorded somewhere.
    const dep = await one<{ id: number; amount: number }>(`SELECT id, amount FROM deposits WHERE booking_id = ?`, dispute.booking_id);
    if (dep) {
      const deduction = Math.min(d.deduction_amount, Number(dep.amount));
      await run(
        // CASE rather than SQLite's two-argument MAX(): identical result, valid on both engines.
        `UPDATE deposits SET status = ?, released_amount = ?, deducted_amount = ?, note = ?, updated_at = ? WHERE id = ?`,
        deduction > 0 ? "partially_released" : "released",
        // Computed in JS rather than SQL: a bound parameter has no type on
        // PostgreSQL, so `? - ?` fails with "operator is not unique". The value
        // is clamped here instead, which is identical arithmetic and portable.
        Math.max(Number(dep.amount) - deduction, 0), deduction,
        `Admin dispute decision: ${d.decision_note}`, new Date().toISOString(), dep.id
      );
    } else if (d.deduction_amount > 0) {
      return fail("This booking has no deposit record, so a deduction cannot be applied", 409);
    }
    if (dispute.status !== "completed") {
      await run(`UPDATE bookings SET status = 'completed', updated_at = ? WHERE id = ?`, new Date().toISOString(), dispute.booking_id);
    }
  } else if (d.decision === "closed" || d.decision === "rejected") {
    await run(`UPDATE deposits SET status = 'released', released_amount = amount, note = ?, updated_at = ? WHERE booking_id = ?`,
      `Deposit released: claim ${d.decision}. No deduction applied.`, new Date().toISOString(), dispute.booking_id);
    await run(`UPDATE bookings SET status = 'completed', updated_at = ? WHERE id = ?`, new Date().toISOString(), dispute.booking_id);
  }

  const providerUser = await one<{ user_id: number }>(`SELECT user_id FROM provider_profiles WHERE id = ?`, dispute.provider_id);
  for (const uid of [dispute.buyer_id, providerUser?.user_id]) {
    if (uid) await notify(uid, "dispute", "Dispute updated", `Dispute #${d.disputeId} is now "${d.decision}": ${d.decision_note}`, `/disputes/${d.disputeId}`);
  }
  await audit({
    actorId: auth.user.id, actorEmail: auth.user.email, action: `admin.dispute_${d.decision}`,
    entity: "dispute", entityId: d.disputeId, detail: { deduction: d.deduction_amount, note: d.decision_note },
  });
  return ok({ message: `Dispute marked as ${d.decision}.` });
});
