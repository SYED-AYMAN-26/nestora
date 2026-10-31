"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client";
import { Alert, Button, Textarea } from "@/components/form";

export function VerificationReview({ requestId }: { requestId: number }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  const decide = async (decision: "approved" | "rejected" | "more_info") => {
    setBusy(decision);
    setMsg(null);
    const res = await api<{ message: string }>("/api/admin/verifications", { body: { requestId, decision, note } });
    setBusy(null);
    if (!res.ok) { setMsg({ kind: "error", text: res.error }); return; }
    setMsg({ kind: "success", text: res.data.message });
    router.refresh();
  };

  return (
    <div>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <label htmlFor={`note-${requestId}`} className="mb-1 block text-[11.5px] text-ink-dim">
        Reviewer note (required for reject / more info — shown to the provider)
      </label>
      <Textarea id={`note-${requestId}`} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Ownership invoice does not cover the listed PA systems." />
      <div className="mt-2 flex flex-wrap gap-2">
        <Button variant="success" loading={busy === "approved"} onClick={() => decide("approved")}>Approve &amp; verify</Button>
        <Button variant="outline" loading={busy === "more_info"} onClick={() => decide("more_info")}>Request more information</Button>
        <Button variant="danger" loading={busy === "rejected"} onClick={() => decide("rejected")}>Reject</Button>
      </div>
      <p className="mt-1.5 text-[10.5px] text-ink-faint">Document access and this decision are both written to the audit log.</p>
    </div>
  );
}
