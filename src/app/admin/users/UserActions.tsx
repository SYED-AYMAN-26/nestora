"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client";

export function UserActions({ userId, role }: { userId: number; role: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const act = async (action: "suspend_sessions" | "promote_admin" | "set_role_user") => {
    if (action !== "suspend_sessions" && !confirm(`Change this account's role to ${action === "promote_admin" ? "admin" : "user"}?`)) return;
    setBusy(action);
    const res = await api<{ message: string }>("/api/admin/users", { body: { userId, action } });
    setBusy(null);
    setMsg(res.ok ? res.data.message : res.error);
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-1">
        <button type="button" disabled={Boolean(busy)} onClick={() => act("suspend_sessions")} className="rounded border border-white/14 px-1.5 py-0.5 text-[10.5px] text-ink-dim hover:border-electric/40 hover:text-ink">
          Revoke sessions
        </button>
        {role === "admin" ? (
          <button type="button" disabled={Boolean(busy)} onClick={() => act("set_role_user")} className="rounded border border-rose-400/30 px-1.5 py-0.5 text-[10.5px] text-rose-200">Demote</button>
        ) : (
          <button type="button" disabled={Boolean(busy)} onClick={() => act("promote_admin")} className="rounded border border-amber-400/30 px-1.5 py-0.5 text-[10.5px] text-amber-200">Make admin</button>
        )}
      </div>
      {msg && <span className="text-[10px] text-ink-faint">{msg}</span>}
    </div>
  );
}
