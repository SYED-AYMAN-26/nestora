import { z } from "zod";
import { guard, ok, fail, parseBody } from "@/lib/http";
import { run, one } from "@/lib/db";
import { getSessionUser, ensureProviderProfile } from "@/lib/auth";
import { audit } from "@/lib/audit";

const schema = z.object({ mode: z.enum(["buyer", "provider"]) });

/** Mode switch never creates a second account — it flips a flag on the user. */
export const POST = guard(async (req: Request) => {
  const user = await getSessionUser();
  if (!user) return fail("Authentication required", 401);
  const parsed = await parseBody(req, schema);
  if (!parsed.ok) return parsed.res;

  if (parsed.data.mode === "provider" && !user.provider) {
    const row = await one(`SELECT * FROM users WHERE id = ?`, user.id)!;
    await ensureProviderProfile(row, user.org_name || user.full_name);
    await audit({ actorId: user.id, actorEmail: user.email, action: "provider.profile_created", entity: "provider_profile", entityId: user.id });
  }
  await run(`UPDATE users SET active_mode = ? WHERE id = ?`, parsed.data.mode, user.id);
  return ok({ mode: parsed.data.mode, redirect: parsed.data.mode === "provider" ? "/provider" : "/marketplace" });
});
