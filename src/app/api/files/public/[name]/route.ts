import { mimeFor } from "@/lib/uploads";
import { getFile } from "@/lib/storage";

/**
 * Public asset serving (resource images only). Private documents are served
 * exclusively through /api/files/private/[name] with an authorisation check.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params;
  const buf = await getFile("public", name);
  if (!buf) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(buf), {
    headers: {
      "content-type": mimeFor(name),
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    },
  });
}
