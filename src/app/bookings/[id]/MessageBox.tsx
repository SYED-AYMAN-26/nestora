"use client";

import { useState } from "react";
import { api } from "@/lib/client";
import { Button } from "@/components/form";

export function MessageBox({ bookingId }: { bookingId: number }) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const send = async () => {
    if (!body.trim()) return;
    setBusy(true);
    const res = await api(`/api/bookings/${bookingId}/messages`, { body: { body } });
    setBusy(false);
    if (!res.ok) { setMsg(res.error); return; }
    setBody("");
    setMsg("Sent.");
    setTimeout(() => setMsg(null), 2500);
  };

  return (
    <div>
      <label htmlFor="msg" className="sr-only">Message</label>
      <textarea
        id="msg"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={2}
        maxLength={2000}
        placeholder="Write to the other party (kept on record with this booking)…"
        className="w-full rounded-lg border border-white/12 bg-navy-900/70 px-2.5 py-2 text-[12.5px] text-ink outline-none focus:border-electric/50"
      />
      <div className="mt-1.5 flex items-center gap-2">
        <Button onClick={send} loading={busy} variant="outline" className="px-2.5 py-1 text-[12px]">Send</Button>
        {msg && <span className="text-[11px] text-ink-faint">{msg}</span>}
      </div>
    </div>
  );
}
