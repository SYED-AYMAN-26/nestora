import { z } from "zod";
import { guard, ok, fail, parseBody } from "@/lib/http";
import { getSessionUser } from "@/lib/auth";
import { run, one } from "@/lib/db";
import { audit, notify } from "@/lib/audit";

const schema = z.object({
  legal_name: z.string().min(2).max(200),
  registration_number: z.string().max(80).nullable().optional(),
  institution_type: z.string().max(60).nullable().optional(),
  contact_role: z.string().max(80).nullable().optional(),
  identity_doc_url: z.string().max(300).optional(),
  ownership_doc_url: z.string().max(300).optional(),
  extra_doc_url: z.string().max(300).nullable().optional(),
  statement: z.string().max(2000).optional(),
});

/**
 * Submit a verification request. Documents go to PRIVATE storage; the status
 * only becomes "verified" after an admin approves it.
 */
export const POST = guard(async (req: Request, ctx: { params: Promise<{ slug: string }> }) => {
  const user = await getSessionUser();
  if (!user) return fail("Authentication required", 401);
  if (!user.provider || user.provider.storefront_slug !== (await ctx.params).slug) {
    return fail("You can only submit verification for your own storefront", 403);
  }
  const parsed = await parseBody(req, schema);
  if (!parsed.ok) return parsed.res;
  const d = parsed.data;
  if (!d.identity_doc_url || !d.ownership_doc_url) {
    return fail("Identity document and ownership / authorisation evidence are both required", 422);
  }
  const openRequest = await one(
    `SELECT * FROM verification_requests WHERE provider_id = ? AND status IN ('pending','more_info')`,
    user.provider.id
  );
  if (openRequest && openRequest.status === "pending") {
    return fail("You already have a verification request pending review", 409);
  }

  await run(
    `INSERT INTO verification_requests (provider_id, legal_name, registration_number, institution_type, contact_role,
      identity_doc_url, ownership_doc_url, extra_doc_url, statement, status)
     VALUES (?,?,?,?,?,?,?,?,?, 'pending')`,
    user.provider.id, d.legal_name, d.registration_number ?? null, d.institution_type ?? user.account_type,
    d.contact_role ?? null, d.identity_doc_url, d.ownership_doc_url, d.extra_doc_url ?? null, d.statement ?? null
  );
  await run(`UPDATE provider_profiles SET verification_status = 'pending', verification_note = NULL WHERE id = ?`, user.provider.id);
  await audit({ actorId: user.id, actorEmail: user.email, action: "verification.submit", entity: "provider_profile", entityId: user.provider.id });
  const admins = await one<{ id: number }>(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`);
  if (admins) await notify(admins.id, "verification", "Verification pending review", `${user.provider.display_name} submitted verification documents.`, "/admin/verifications");
  return ok({ status: "pending" });
});
