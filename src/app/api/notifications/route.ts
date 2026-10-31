import { guard, ok, fail } from "@/lib/http";
import { getSessionUser } from "@/lib/auth";
import { all, run, one } from "@/lib/db";
import { externalChannels } from "@/lib/audit";

export const GET = guard(async () => {
  const user = await getSessionUser();
  if (!user) return fail("Authentication required", 401);
  const items = await all(
    `SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 100`, user.id
  );
  const unread = (await one<{ c: number }>(`SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read_at IS NULL`, user.id))?.c ?? 0;
  return ok({ items, unread: Number(unread), channels: externalChannels() });
});

export const POST = guard(async (req: Request) => {
  const user = await getSessionUser();
  if (!user) return fail("Authentication required", 401);
  const body = await req.json().catch(() => ({}));
  const id = Number(body?.id);
  if (id) {
    await run(`UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ?`, new Date().toISOString(), id, user.id);
  } else {
    await run(`UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL`, new Date().toISOString(), user.id);
  }
  return ok({ done: true });
});
