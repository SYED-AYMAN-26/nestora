import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, ...(data as object) }, init);
}

export function fail(error: string, code = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error, ...(extra ?? {}) }, { status: code });
}

export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<{ ok: true; data: T } | { ok: false; res: NextResponse }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { ok: false, res: fail("Request body must be valid JSON", 400) };
  }
  try {
    return { ok: true, data: schema.parse(raw) };
  } catch (e) {
    if (e instanceof ZodError) {
      const first = e.issues[0];
      return {
        ok: false,
        res: fail(`${first?.path?.join(".") || "input"}: ${first?.message || "invalid"}`, 422, {
          issues: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        }),
      };
    }
    return { ok: false, res: fail("Invalid input", 422) };
  }
}

export function clientIp(req: Request): string {
  const h = req.headers;
  return (
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "local"
  );
}

/** Wraps a handler so unexpected errors never leak stack traces. */
export function guard<T extends unknown[]>(fn: (...args: T) => Promise<Response>) {
  return async (...args: T): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      console.error("[api] unhandled", e);
      return fail("Something went wrong on the server", 500);
    }
  };
}
