"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, money } from "@/lib/client";
import { Alert, Button, Field, Input, Select, Textarea } from "@/components/form";

export function DisputeDecision({ disputeId, claimAmount, deposit }: { disputeId: number; claimAmount: number; deposit: number }) {
  const router = useRouter();
  const [decision, setDecision] = useState("resolved");
  const [note, setNote] = useState("");
  const [deduction, setDeduction] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  const submit = async () => {
    if (note.trim().length < 5) { setMsg({ kind: "error", text: "A decision note is required." }); return; }
    setBusy(true);
    setMsg(null);
    const res = await api<{ message: string }>("/api/admin/disputes", {
      body: { disputeId, decision, decision_note: note, deduction_amount: Number(deduction) || 0 },
    });
    setBusy(false);
    if (!res.ok) { setMsg({ kind: "error", text: res.error }); return; }
    setMsg({ kind: "success", text: res.data.message });
    router.refresh();
  };

  return (
    <div>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Decision" htmlFor={`dec-${disputeId}`}>
          <Select id={`dec-${disputeId}`} value={decision} onChange={(e) => setDecision(e.target.value)}>
            <option value="resolved">Resolved (claim upheld)</option>
            <option value="rejected">Rejected (claim not upheld)</option>
            <option value="evidence_requested">Request more evidence</option>
            <option value="under_review">Keep under review</option>
            <option value="closed">Close without decision</option>
          </Select>
        </Field>
        <Field label={`Deduction from deposit (max ${money(Math.min(claimAmount, deposit))})`} htmlFor={`ded-${disputeId}`}>
          <Input id={`ded-${disputeId}`} type="number" min={0} max={Math.min(claimAmount, deposit)} value={deduction} onChange={(e) => setDeduction(Number(e.target.value))} />
        </Field>
      </div>
      <Field label="Decision note (recorded in the audit log and shown to both parties)" htmlFor={`note-${disputeId}`}>
        <Textarea id={`note-${disputeId}`} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Explain how the evidence supports this outcome." />
      </Field>
      <Button onClick={submit} loading={busy}>Record decision</Button>
      <p className="mt-1.5 text-[10.5px] text-ink-faint">
        Choosing &quot;resolved&quot; with a deduction above zero partially releases the deposit; zero releases it in full.
        Rejecting or closing releases the deposit in full.
      </p>
    </div>
  );
}
