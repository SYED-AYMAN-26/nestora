"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client";
import { Alert } from "@/components/form";

export function AdminResourceActions({ resourceId, status }: { resourceId: number; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const act = async (action: "pause" | "activate" | "archive") => {
    setBusy(action);
    setMsg(null);
    const res = await api("/api/admin/resources", { body: { resourceId, action, note: `Admin ${action}` } });
    setBusy(null);
    setMsg(res.ok ? `Listing ${action}d.` : res.error);
    router.refresh();
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap gap-1.5">
        {status !== "active" && (
          <button type="button" disabled={Boolean(busy)} onClick={() => act("activate")} className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-2 py-1 text-[11px] text-emerald-200">Activate</button>
        )}
        {status === "active" && (
          <button type="button" disabled={Boolean(busy)} onClick={() => act("pause")} className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-2 py-1 text-[11px] text-amber-200">Pause</button>
        )}
        {status !== "archived" && (
          <button type="button" disabled={Boolean(busy)} onClick={() => act("archive")} className="rounded-lg border border-rose-400/30 bg-rose-400/10 px-2 py-1 text-[11px] text-rose-200">Archive</button>
        )}
      </div>
      {msg && <Alert kind="info">{msg}</Alert>}
    </div>
  );
}
