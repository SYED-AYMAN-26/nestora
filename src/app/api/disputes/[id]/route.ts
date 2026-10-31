import { z } from "zod";
import { guard, ok, fail, parseBody } from "@/lib/http";
import { getSessionUser } from "@/lib/auth";
import { all, one, run, jsonParse } from "@/lib/db";
import { audit, notify } from "@/lib/audit";

async function loadDispute(id: number) {
  return await one(
    `SELECT d.*, b.buyer_id, b.provider_id, b.code, b.id AS booking_id, r.title AS resource_title,
            p.user_id AS provider_user_id
       FROM disputes d JOIN bookings b ON b.id = d.booking_id JOIN resources r ON r.id = b.resource_id
       JOIN provider_profiles p ON p.id = b.provider_id WHERE d.id = ?`, id
  );
}

export const GET = guard(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await getSessionUser();
  if (!user) return fail("Authentication required", 401);
  const d = await loadDispute(Number((await ctx.params).id));
  if (!d) return fail("Dispute not found", 404);
  const party = user.id === d.buyer_id || user.id === d.raised_by || user.provider?.id === d.provider_id || user.id === d.provider_user_id;
  if (!party && user.role !== "admin") return fail("Dispute not found", 404);
  const messages = await all(
    `SELECT dm.*, u.full_name AS sender_name, u.role AS sender_role FROM dispute_messages dm
       JOIN users u ON u.id = dm.user_id WHERE dm.dispute_id = ? ORDER BY dm.id`, d.id
  );
  return ok({
    dispute: { ...d, evidence: jsonParse(d.evidence, []) },
    messages: messages.map((m) => ({ ...m, attachments: jsonParse(m.attachments, []) })),
    viewerRole: user.role === "admin" ? "admin" : user.id === d.buyer_id ? "buyer" : "provider",
  });
});

const msgSchema = z.object({
  body: z.string().min(1).max(3000).optional(),
  attachments: z.array(z.string().max(300)).max(6).default([]),
});

export const POST = guard(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await getSessionUser();
  if (!user) return fail("Authentication required", 401);
  const d = await loadDispute(Number((await ctx.params).id));
  if (!d) return fail("Dispute not found", 404);
  const party = user.id === d.buyer_id || user.provider?.id === d.provider_id;
  if (!party && user.role !== "admin") return fail("Dispute not found", 404);

  const parsed = await parseBody(req, msgSchema);
  if (!parsed.ok) return parsed.res;
  if (!parsed.data.body && !parsed.data.attachments.length) return fail("Add a message or an attachment", 422);
  if (["resolved", "rejected", "closed"].includes(d.status) && user.role !== "admin") {
    return fail("This dispute is closed. Only an admin can reopen it.", 409);
  }

  await run(`INSERT INTO dispute_messages (dispute_id, user_id, body, attachments) VALUES (?,?,?,?)`,
    d.id, user.id, parsed.data.body ?? "(evidence attached)", JSON.stringify(parsed.data.attachments));
  if (d.status === "open" && parsed.data.attachments.length) {
    await run(`UPDATE disputes SET status = 'under_review' WHERE id = ?`, d.id);
  }
  const others = [d.buyer_id, d.provider_user_id].filter((x) => x && x !== user.id);
  for (const o of others) await notify(Number(o), "dispute", "New dispute message", `${user.full_name} added to dispute #${d.id}.`, `/disputes/${d.id}`);
  await audit({ actorId: user.id, actorEmail: user.email, action: "dispute.message", entity: "dispute", entityId: d.id });
  return ok({ sent: true });
});
