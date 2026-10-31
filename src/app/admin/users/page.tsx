import Link from "next/link";
import { all, Bind, Row } from "@/lib/db";
import { Badge, Card, PageHeader, VerifiedBadge } from "@/components/ui";
import { UserActions } from "./UserActions";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Users admin" };

export default async function AdminUsers({ searchParams }: { searchParams: Promise<{ q?: string; role?: string }> }) {
  const sp = await searchParams;
  const q = sp.q?.trim() || "";
  const role = sp.role || "all";
  const where: string[] = [];
  const params: Bind[] = [];
  if (q) { where.push(`(u.email LIKE ? OR u.full_name LIKE ? OR u.org_name LIKE ?)`); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (role !== "all") { where.push(`u.role = ?`); params.push(role); }

  const items = await all<Row>(
    `SELECT u.id, u.email, u.full_name, u.account_type, u.org_name, u.city, u.role, u.active_mode, u.is_demo, u.created_at,
            (SELECT COUNT(*) FROM bookings b WHERE b.buyer_id = u.id) AS bookings,
            p.id AS provider_id, p.verification_status, p.storefront_slug,
            (SELECT COUNT(*) FROM resources r WHERE r.provider_id = p.id) AS resources
       FROM users u LEFT JOIN provider_profiles p ON p.user_id = u.id
       ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY u.id DESC LIMIT 200`,
    ...params
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-7 sm:px-6">
      <PageHeader title="Users" sub="Search accounts, inspect roles and provider status, and revoke sessions. Role changes are audited." />

      <form action="/admin/users" className="mb-4 flex flex-wrap gap-2">
        <input name="q" defaultValue={q} placeholder="Search name, email or organisation" className="rounded-lg border border-white/12 bg-navy-900/70 px-3 py-1.5 text-[12.5px] text-ink outline-none focus:border-electric/50" />
        <select name="role" defaultValue={role} className="rounded-lg border border-white/12 bg-navy-900/70 px-2.5 py-1.5 text-[12.5px] text-ink">
          <option value="all">All roles</option>
          <option value="user">Users</option>
          <option value="admin">Admins</option>
        </select>
        <button type="submit" className="rounded-lg bg-gradient-to-b from-electric to-electric-deep px-3 py-1.5 text-[12.5px] font-semibold text-navy-950">Search</button>
      </form>

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[860px] text-left text-[12px]">
          <thead className="bg-white/4 text-[10px] uppercase tracking-wider text-ink-faint">
            <tr>
              <th className="p-2.5">User</th><th className="p-2.5">Type</th><th className="p-2.5">Provider</th>
              <th className="p-2.5">Bookings</th><th className="p-2.5">Joined</th><th className="p-2.5">Actions</th>
            </tr>
          </thead>
          <tbody className="text-ink-dim">
            {items.map((u) => (
              <tr key={u.id} className="border-t border-white/6">
                <td className="p-2.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-ink">{u.full_name}</span>
                    {u.role === "admin" && <Badge tone="warn">admin</Badge>}
                    {u.is_demo ? <Badge tone="neutral">demo</Badge> : null}
                  </div>
                  <p className="text-[10.5px] text-ink-faint">{u.email}{u.org_name ? ` · ${u.org_name}` : ""}</p>
                </td>
                <td className="p-2.5">{u.account_type?.replace(/_/g, " ")}<br /><span className="text-[10px] text-ink-faint">{u.city}</span></td>
                <td className="p-2.5">
                  {u.provider_id ? (
                    <div>
                      <VerifiedBadge status={u.verification_status} />
                      <p className="mt-0.5 text-[10.5px] text-ink-faint">
                        <Link href={`/storefront/${u.storefront_slug}`} className="text-electric hover:underline">{u.resources} listing(s)</Link>
                      </p>
                    </div>
                  ) : <span className="text-ink-faint">—</span>}
                </td>
                <td className="p-2.5 tabular-nums">{u.bookings}</td>
                <td className="p-2.5 whitespace-nowrap text-[10.5px]">{fmtDate(u.created_at)}</td>
                <td className="p-2.5"><UserActions userId={u.id} role={u.role} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p className="mt-2 text-[11px] text-ink-faint">Showing {items.length} account(s). Passwords are hashed and cannot be viewed.</p>
    </div>
  );
}
