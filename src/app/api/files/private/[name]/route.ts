import fs from "node:fs";
import { resolveFile, mimeFor } from "@/lib/uploads";
import { getSessionUser } from "@/lib/auth";
import { one } from "@/lib/db";
import { audit } from "@/lib/audit";

/**
 * PRIVATE document access.
 * Allowed: platform admins, and the provider who owns the document, and (for
 * dispute/handover evidence) the counterparty of the specific booking.
 * Every access is written to the audit log.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ name: string }> }) {
  const user = await getSessionUser();
  if (!user) return new Response("Authentication required", { status: 401 });
  const { name } = await ctx.params;
  const file = resolveFile("private", name);
  if (!file) return new Response("Not found", { status: 404 });
  const url = `/api/files/private/${name}`;

  let allowed = user.role === "admin";
  if (!allowed && user.provider) {
    const owned =
      await one(`SELECT 1 FROM verification_requests WHERE provider_id = ? AND (identity_doc_url = ? OR ownership_doc_url = ? OR extra_doc_url = ?)`,
        user.provider.id, url, url, url);
    if (owned) allowed = true;
  }
  if (!allowed) {
    // Evidence attached to a booking the user is party to
    const inHandover = await one(
      `SELECT 1 FROM handovers h JOIN bookings b ON b.id = h.booking_id
        WHERE (instr(h.provider_photos, ?) > 0 OR instr(h.buyer_photos, ?) > 0)
          AND (b.buyer_id = ? OR b.provider_id = ?)`,
      url, url, user.id, user.provider?.id ?? -1
    );
    const inReturn = await one(
      `SELECT 1 FROM returns r JOIN bookings b ON b.id = r.booking_id
        WHERE (instr(r.buyer_photos, ?) > 0 OR instr(r.provider_photos, ?) > 0)
          AND (b.buyer_id = ? OR b.provider_id = ?)`,
      url, url, user.id, user.provider?.id ?? -1
    );
    const inDispute = await one(
      `SELECT 1 FROM dispute_messages dm JOIN disputes d ON d.id = dm.dispute_id JOIN bookings b ON b.id = d.booking_id
        WHERE instr(dm.attachments, ?) > 0 AND (b.buyer_id = ? OR b.provider_id = ?)`,
      url, user.id, user.provider?.id ?? -1
    );
    allowed = Boolean(inHandover || inReturn || inDispute);
  }
  if (!allowed) {
    await audit({ actorId: user.id, actorEmail: user.email, action: "document.access_denied", entity: "file", entityId: name });
    return new Response("Forbidden", { status: 403 });
  }

  await audit({ actorId: user.id, actorEmail: user.email, action: "document.access", entity: "file", entityId: name });
  const buf = fs.readFileSync(file);
  return new Response(new Uint8Array(buf), {
    headers: {
      "content-type": mimeFor(name),
      "cache-control": "private, no-store",
      "content-disposition": `inline; filename="${name}"`,
      "x-content-type-options": "nosniff",
    },
  });
}
