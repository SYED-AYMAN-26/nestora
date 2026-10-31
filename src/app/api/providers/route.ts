import { z } from "zod";
import { guard, ok, fail, parseBody } from "@/lib/http";
import { getSessionUser, ensureProviderProfile, slugify } from "@/lib/auth";
import { one, Row, run } from "@/lib/db";
import { audit } from "@/lib/audit";

const schema = z.object({
  display_name: z.string().min(2).max(120),
  org_type: z.string().max(60),
  description: z.string().max(3000).optional(),
  contact_email: z.string().email().max(200).optional(),
  contact_phone: z.string().max(30).optional(),
});

/** Become a provider: one account, both roles. Creates the storefront profile. */
export const POST = guard(async (req: Request) => {
  const user = await getSessionUser();
  if (!user) return fail("Authentication required", 401);
  if (user.provider) return ok({ providerId: user.provider.id, storefront: user.provider.storefront_slug, existed: true });

  const parsed = await parseBody(req, schema);
  if (!parsed.ok) return parsed.res;
  const d = parsed.data;
  const row = await one<Row>(`SELECT * FROM users WHERE id = ?`, user.id);
  if (!row) return fail("Account not found", 404);
  const provider = await ensureProviderProfile(row, d.display_name.trim());
  if (!provider) return fail("Could not create provider profile", 500);
  await run(
    `UPDATE provider_profiles SET org_type = ?, description = ?, contact_email = COALESCE(?, contact_email), contact_phone = COALESCE(?, contact_phone) WHERE id = ?`,
    d.org_type, d.description ?? null, d.contact_email ?? null, d.contact_phone ?? null, provider.id
  );
  await run(`UPDATE users SET active_mode = 'provider' WHERE id = ?`, user.id);
  await audit({ actorId: user.id, actorEmail: user.email, action: "provider.become", entity: "provider_profile", entityId: provider.id, detail: { display_name: d.display_name } });
  return ok({ providerId: provider.id, storefront: slugify(d.display_name), message: "Provider profile created. Submit verification to earn a verified badge." });
});
