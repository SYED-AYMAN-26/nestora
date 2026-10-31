"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client";
import { Alert, Button, Field, Input, Select, Textarea, Uploader } from "@/components/form";

export function NewDisputeForm({ bookingId, role, claimable }: { bookingId: number; role: string; claimable: number }) {
  const router = useRouter();
  const [kind, setKind] = useState(role === "provider" ? "damage" : "other");
  const [claim, setClaim] = useState(0);
  const [description, setDescription] = useState("");
  const [evidence, setEvidence] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    if (description.trim().length < 10) { setErr("Describe the issue in at least 10 characters."); return; }
    if (!evidence.length) { setErr("Attach at least one photo or document as evidence."); return; }
    setBusy(true);
    const res = await api<{ disputeId: number; message: string }>("/api/disputes", {
      body: { bookingId, kind, claim_amount: Number(claim) || 0, description, evidence },
    });
    setBusy(false);
    if (!res.ok) { setErr(res.error); return; }
    router.push(`/disputes/${res.data.disputeId}`);
    router.refresh();
  };

  return (
    <div>
      {err && <Alert kind="error">{err}</Alert>}
      <Field label="What is the issue?" htmlFor="kind" required>
        <Select id="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
          {role === "provider" ? (
            <>
              <option value="damage">Damage to the equipment</option>
              <option value="missing">Missing equipment or accessories</option>
              <option value="late_return">Late return</option>
              <option value="other">Other</option>
            </>
          ) : (
            <>
              <option value="damage">Item was already damaged / not as described</option>
              <option value="other">Other problem with the rental</option>
            </>
          )}
        </Select>
      </Field>

      <Field label="Amount claimed (₹)" htmlFor="claim" hint={`Cannot exceed the recorded deposit of ₹${claimable}.`}>
        <Input id="claim" type="number" min={0} max={claimable} value={claim} onChange={(e) => setClaim(Number(e.target.value))} />
      </Field>

      <Field label="What happened?" htmlFor="desc" required hint="Be specific and factual — this is the record an admin reviews.">
        <Textarea id="desc" rows={5} maxLength={3000} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe the condition, timestamps and what you are asking for." />
      </Field>

      <Uploader value={evidence} onChange={setEvidence} label="Evidence (photos or documents)" max={4} hint="Required. Stored privately and visible only to the parties and admins." />

      <Button onClick={submit} loading={busy}>Open dispute</Button>
      <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
        Never upload identity documents here. Evidence should show the equipment condition or the rental issue only.
      </p>
    </div>
  );
}
