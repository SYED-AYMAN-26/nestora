import { guard, ok } from "@/lib/http";
import { destroySession, getSessionUser } from "@/lib/auth";
import { audit } from "@/lib/audit";

export const POST = guard(async () => {
  const user = await getSessionUser();
  await destroySession();
  if (user) await audit({ actorId: user.id, actorEmail: user.email, action: "auth.logout", entity: "user", entityId: user.id });
  return ok({ signedOut: true });
});
