"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client";
import { Alert } from "@/components/form";

export function FavouriteButton({ resourceId, initial, authed }: { resourceId: number; initial: boolean; authed: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const toggle = async () => {
    if (!authed) { router.push("/login?next=" + encodeURIComponent(`/resources/${resourceId}`)); return; }
    setBusy(true);
    const res = await api<{ favourited: boolean }>("/api/favourites", { body: { resourceId } });
    setBusy(false);
    if (!res.ok) { setMsg(res.error); return; }
    setOn(res.data.favourited);
    router.refresh();
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        aria-pressed={on}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] transition ${on ? "border-rose-400/40 bg-rose-400/12 text-rose-200" : "border-white/14 text-ink-dim hover:border-white/30 hover:text-ink"}`}
      >
        <span aria-hidden="true">{on ? "♥" : "♡"}</span> {on ? "Saved" : "Save"}
      </button>
      {msg && <p className="absolute right-0 top-full mt-1 whitespace-nowrap text-[10.5px] text-rose-300">{msg}</p>}
    </div>
  );
}

export function ReportButton({ resourceId, authed }: { resourceId: number; authed: boolean }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("misleading");
  const [detail, setDetail] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!authed) { setMsg("Sign in to report a listing."); return; }
    setBusy(true);
    const res = await api<{ message: string }>("/api/reports", { body: { resourceId, reason, detail } });
    setBusy(false);
    setMsg(res.ok ? res.data.message : res.error);
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-lg border border-white/14 px-2.5 py-1.5 text-[12px] text-ink-dim hover:border-white/30 hover:text-ink"
        aria-expanded={open}
      >
        Report
      </button>
      {open && (
        <div className="glass absolute right-0 z-20 mt-2 w-72 rounded-xl p-3">
          {msg ? (
            <Alert kind={msg.includes("submitted") ? "success" : "error"}>{msg}</Alert>
          ) : (
            <>
              <label className="mb-1 block text-[11px] uppercase tracking-wider text-ink-faint" htmlFor="reason">Reason</label>
              <select id="reason" value={reason} onChange={(e) => setReason(e.target.value)} className="mb-2 w-full rounded-lg border border-white/12 bg-navy-900 px-2 py-1.5 text-[12.5px] text-ink">
                <option value="misleading">Description is misleading</option>
                <option value="unavailable">Not actually available</option>
                <option value="unsafe">Safety concern</option>
                <option value="inappropriate">Inappropriate content</option>
                <option value="other">Other</option>
              </select>
              <textarea value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="What should we check?" className="mb-2 w-full rounded-lg border border-white/12 bg-navy-900 px-2 py-1.5 text-[12.5px] text-ink" rows={3} />
              <button type="button" onClick={submit} disabled={busy} className="w-full rounded-lg bg-gradient-to-b from-electric to-electric-deep py-1.5 text-[12.5px] font-semibold text-navy-950">
                {busy ? "Sending…" : "Submit report"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
