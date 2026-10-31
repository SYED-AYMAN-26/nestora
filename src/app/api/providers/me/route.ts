import { z } from "zod";
import { guard, ok, fail, parseBody } from "@/lib/http";
import { getSessionUser } from "@/lib/auth";
import { Bind, jsonParse, one, Row, run } from "@/lib/db";
import { audit } from "@/lib/audit";

const schema = z.object({
  display_name: z.string().min(2).max(120).optional(),
  org_type: z.string().max(60).optional(),
  description: z.string().max(3000).nullable().optional(),
  logo_url: z.string().max(300).nullable().optional(),
  website: z.string().max(200).nullable().optional(),
  contact_email: z.string().email().max(200).optional(),
  contact_phone: z.string().max(30).nullable().optional(),
  cancellation_policy: z.string().max(2000).nullable().optional(),
  collection_policy: z.string().max(2000).nullable().optional(),
  priority_policy: z
    .object({
      eligible_account_types: z.array(z.string().max(60)).max(6).optional(),
      boost_academic: z.boolean().optional(),
      boost_underserved: z.boolean().optional(),
      fair_rotation: z.boolean().optional(),
      max_score: z.number().min(10).max(500).optional(),
    })
    .optional(),
});

/** Providers edit ONLY their own storefront (ownership resolved from session). */
export const PATCH = guard(async (req: Request) => {
  const user = await getSessionUser();
  if (!user) return fail("Authentication required", 401);
  if (!user.provider) return fail("You do not have a provider profile yet", 403);
  const parsed = await parseBody(req, schema);
  if (!parsed.ok) return parsed.res;
  const d = parsed.data;

  const sets: string[] = [];
  const vals: Bind[] = [];
  for (const k of ["display_name", "org_type", "description", "logo_url", "website", "contact_email", "contact_phone", "cancellation_policy", "collection_policy"] as const) {
    if (d[k] !== undefined) { sets.push(`${k} = ?`); vals.push(d[k]); }
  }
  if (d.priority_policy) { sets.push(`priority_policy = ?`); vals.push(JSON.stringify(d.priority_policy)); }
  if (!sets.length) return ok({ updated: false });
  await run(`UPDATE provider_profiles SET ${sets.join(", ")} WHERE id = ?`, ...vals, user.provider.id);
  await audit({ actorId: user.id, actorEmail: user.email, action: "provider.storefront_update", entity: "provider_profile", entityId: user.provider.id, detail: Object.keys(d) });
  return ok({ updated: true, priority_policy: jsonParse<Row>((await one<Row>(`SELECT priority_policy FROM provider_profiles WHERE id = ?`, user.provider.id))?.priority_policy, {}) });
});
