import { z } from "zod";
import { guard, ok, fail, parseBody } from "@/lib/http";
import { getSessionUser } from "@/lib/auth";
import { recommend } from "@/lib/recommend";
import { rateLimit } from "@/lib/audit";

const schema = z.object({
  query: z.string().min(3).max(600),
  city: z.string().max(80).nullable().optional(),
  maxBudget: z.number().min(0).max(1e7).nullable().optional(),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

export const POST = guard(async (req: Request) => {
  const user = await getSessionUser();
  const ip = req.headers.get("x-forwarded-for") || "local";
  const rl = await rateLimit(`recommend:${user?.id ?? ip}`, 30, 3600);
  if (!rl.ok) return fail(`Too many recommendation requests. Try again in ${rl.retryAfter}s.`, 429);

  const parsed = await parseBody(req, schema);
  if (!parsed.ok) return parsed.res;
  const d = parsed.data;
  if (d.start && d.end && d.end < d.start) return fail("End date must be on or after the start date", 422);

  const result = await recommend({
    query: d.query, userId: user?.id ?? null, city: d.city ?? user?.city ?? null,
    maxBudget: d.maxBudget ?? null, start: d.start ?? null, end: d.end ?? null,
  });
  return ok(result);
});
