import { z } from "zod";
import { guard, ok, fail, parseBody } from "@/lib/http";
import { requireAdmin } from "@/lib/auth";
import { all, one, Row, run } from "@/lib/db";
import { audit, notify } from "@/lib/audit";

export const GET = guard(async (req: Request) => {
  const auth = await requireAdmin();
  if (!auth.ok) return fail(auth.error, auth.code);
  const status = new URL(req.url).searchParams.get("status");
  const where = status && status !== "all" ? "WHERE v.status = ?" : "";
  const rows = await all(
    `SELECT v.*, p.display_name, p.storefront_slug, p.user_id, u.email, u.account_type, u.city, u.state
       FROM verification_requests v JOIN provider_profiles p ON p.id = v.provider_id JOIN users u ON u.id = p.user_id
       ${where} ORDER BY CASE v.status WHEN 'pending' THEN 0 WHEN 'more_info' THEN 1 ELSE 2 END, v.created_at DESC`,
    ...(where ? [status] : [])
  );
  const pendingProviders = await all(
    `SELECT p.id, p.display_name, p.verification_status, p.created_at FROM provider_profiles p
      WHERE p.verification_status = 'not_submitted' ORDER BY p.created_at DESC`
  );
  return ok({ items: rows, unsubmitted: pendingProviders });
});

const schema = z.object({
  requestId: z.number().int(),
  decision: z.enum(["approved", "rejected", "more_info"]),
  note: z.string().max(1000).optional(),
  verification_note: z.string().max(1000).optional(),
});

export const POST = guard(async (req: Request) => {
  const auth = await requireAdmin();
  if (!auth.ok) return fail(auth.error, auth.code);
  const parsed = await parseBody(req, schema);
  if (!parsed.ok) return parsed.res;
  const d = parsed.data;

  const v = await one<Row>(`SELECT v.*, p.user_id, p.display_name FROM verification_requests v JOIN provider_profiles p ON p.id = v.provider_id WHERE v.id = ?`, d.requestId);
  if (!v) return fail("Verification request not found", 404);
  if (d.decision !== "approved" && !d.note?.trim()) {
    return fail("A reviewer note is required when rejecting or requesting more information", 422);
  }

  await run(`UPDATE verification_requests SET status = ?, reviewer_id = ?, reviewer_note = ?, reviewed_at = ? WHERE id = ?`,
    d.decision, auth.user.id, d.note?.trim() ?? null, new Date().toISOString(), v.id);

  const providerStatus = d.decision === "approved" ? "verified" : d.decision === "rejected" ? "rejected" : "more_info";
  await run(`UPDATE provider_profiles SET verification_status = ?, verification_note = ?, verified_at = ? WHERE id = ?`,
    providerStatus, d.note?.trim() ?? null, d.decision === "approved" ? new Date().toISOString() : null, v.provider_id);

  await notify(
    v.user_id, "verification",
    d.decision === "approved" ? "Storefront verified" : d.decision === "rejected" ? "Verification rejected" : "More information required",
    d.decision === "approved"
      ? "Your storefront now shows a verified badge."
      : d.note ?? "Please review your verification submission.",
    "/provider/verification"
  );
  await audit({
    actorId: auth.user.id, actorEmail: auth.user.email, action: `admin.verification_${d.decision}`,
    entity: "verification_request", entityId: v.id, detail: { provider: v.display_name, note: d.note },
  });
  return ok({ status: providerStatus, message: `Verification ${d.decision}. The provider has been notified.` });
});
