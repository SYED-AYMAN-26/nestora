"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client";
import { Alert, Button, Textarea, Uploader } from "@/components/form";

export function DisputeThread({ disputeId, closed }: { disputeId: number; closed: boolean }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (closed) {
    return <p className="rounded-lg border border-white/10 bg-white/3 px-3 py-2 text-[12px] text-ink-faint">This dispute is closed. Only an administrator can reopen it.</p>;
  }

  const send = async () => {
    if (!body.trim() && !attachments.length) { setMsg("Add a message or evidence."); return; }
    setBusy(true);
    setMsg(null);
    const res = await api(`/api/disputes/${disputeId}`, { body: { body, attachments } });
    setBusy(false);
    if (!res.ok) { setMsg(res.error); return; }
    setBody("");
    setAttachments([]);
    router.refresh();
  };

  return (
    <div>
      {msg && <Alert kind="error">{msg}</Alert>}
      <label htmlFor="dt" className="sr-only">Add to the dispute thread</label>
      <Textarea id="dt" rows={3} value={body} onChange={(e) => setBody(e.target.value)} maxLength={3000} placeholder="Add your explanation or respond to the other party…" />
      <Uploader value={attachments} onChange={setAttachments} label="Additional evidence" max={4} />
      <Button onClick={send} loading={busy} variant="outline">Post to thread</Button>
    </div>
  );
}
