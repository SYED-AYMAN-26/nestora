"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client";
import { Alert } from "@/components/form";

export function ListingActions({ resourceId, status, hasLiveBookings }: { resourceId: number; status: string; hasLiveBookings: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  const patch = async (nextStatus: string) => {
    setBusy(true);
    setMsg(null);
    const res = await api(`/api/resources/${resourceId}`, { method: "PATCH", body: { status: nextStatus } });
    setBusy(false);
    if (!res.ok) { setMsg({ kind: "error", text: res.error }); return; }
    router.refresh();
  };

  const remove = async () => {
    if (!confirm(hasLiveBookings ? "This listing has live bookings, so it will be archived instead of deleted. Continue?" : "Delete this listing permanently? Its history will be removed.")) return;
    setBusy(true);
    const res = await api<{ message?: string }>(`/api/resources/${resourceId}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) { setMsg({ kind: "error", text: res.error }); return; }
    if (res.data.message) setMsg({ kind: "success", text: res.data.message });
    router.refresh();
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1.5">
        {status === "active" ? (
          <button type="button" disabled={busy} onClick={() => patch("paused")} className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-2 py-1 text-[11px] text-amber-200">
            Pause
          </button>
        ) : (
          <button type="button" disabled={busy} onClick={() => patch("active")} className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-2 py-1 text-[11px] text-emerald-200">
            Activate
          </button>
        )}
        <button type="button" disabled={busy} onClick={remove} className="rounded-lg border border-rose-400/30 bg-rose-400/10 px-2 py-1 text-[11px] text-rose-200">
          Delete
        </button>
      </div>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
    </div>
  );
}
