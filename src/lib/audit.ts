import { all, Bind, one, run } from "./db";
import type { Row } from "./db";

/** Append-only audit trail. Every sensitive action funnels through here. */
export async function audit(opts: {
  actorId?: number | null;
  actorEmail?: string | null;
  action: string;
  entity: string;
  entityId?: string | number | null;
  detail?: unknown;
  ip?: string | null;
}) {
  await run(
    `INSERT INTO audit_logs (actor_id, actor_email, action, entity, entity_id, detail, ip)
     VALUES (?,?,?,?,?,?,?)`,
    opts.actorId ?? null,
    opts.actorEmail ?? null,
    opts.action,
    opts.entity,
    opts.entityId != null ? String(opts.entityId) : null,
    opts.detail != null ? JSON.stringify(opts.detail).slice(0, 4000) : null,
    opts.ip ?? null
  );
}

export async function listAudit(limit = 200, filter?: { entity?: string; action?: string }) {
  const where: string[] = [];
  const params: Bind[] = [];
  if (filter?.entity) { where.push("entity = ?"); params.push(filter.entity); }
  if (filter?.action) { where.push("action LIKE ?"); params.push(`%${filter.action}%`); }
  const sql = `SELECT * FROM audit_logs ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY id DESC LIMIT ?`;
  return await all<Row>(sql, ...params, limit);
}

// --- notification helpers -------------------------------------------------
export async function notify(userId: number, kind: string, title: string, body?: string, link?: string) {
  await run(
    `INSERT INTO notifications (user_id, kind, title, body, link) VALUES (?,?,?,?,?)`,
    userId, kind, title, body ?? null, link ?? null
  );
  // Outbound channels are only used when explicitly configured; otherwise the
  // notification stays in-app (and the UI states external delivery is off).
  void await deliverExternal(userId, title);
}

async function deliverExternal(userId: number, title: string) {
  if (!process.env.SMTP_HOST && !process.env.WHATSAPP_TOKEN) return;
  const user = await one<Row>(`SELECT email, phone FROM users WHERE id = ?`, userId);
  if (!user) return;
  // Real transports would be plugged in here. We deliberately do not pretend
  // delivery happened: the log records that a transport was configured.
  if (process.env.SMTP_HOST) {
    console.log(`[notify:email:queued] ${user.email} :: ${title}`);
  }
  if (process.env.WHATSAPP_TOKEN && user.phone) {
    console.log(`[notify:whatsapp:queued] ${user.phone} :: ${title}`);
  }
}

export function externalChannels() {
  return {
    email: Boolean(process.env.SMTP_HOST),
    whatsapp: Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID),
  };
}

// --- simple fixed-window rate limiter (persisted, server-side) ------------
export async function rateLimit(key: string, limit: number, windowSec: number): Promise<{ ok: boolean; retryAfter: number }> {
  const now = Math.floor(Date.now() / 1000);
  const row = await one<Row>(`SELECT * FROM rate_limits WHERE key = ?`, key);
  if (!row || now - row.window_start >= windowSec) {
    await run(
      `INSERT INTO rate_limits (key, count, window_start) VALUES (?,?,?)
       ON CONFLICT(key) DO UPDATE SET count = 1, window_start = excluded.window_start`,
      key, 1, now
    );
    return { ok: true, retryAfter: 0 };
  }
  if (row.count >= limit) return { ok: false, retryAfter: windowSec - (now - row.window_start) };
  await run(`UPDATE rate_limits SET count = count + 1 WHERE key = ?`, key);
  return { ok: true, retryAfter: 0 };
}
