import fs from "node:fs";
import { resolveFile, mimeFor } from "@/lib/uploads";

/**
 * Public asset serving (resource images only). Private documents are served
 * exclusively through /api/files/private/[name] with an authorisation check.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params;
  const file = resolveFile("public", name);
  if (!file) return new Response("Not found", { status: 404 });
  const buf = fs.readFileSync(file);
  return new Response(new Uint8Array(buf), {
    headers: {
      "content-type": mimeFor(name),
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    },
  });
}
