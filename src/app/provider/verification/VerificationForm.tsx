"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client";
import { Alert, Button, Field, Input, Select, Textarea, Uploader } from "@/components/form";
import { ACCOUNT_TYPES } from "@/lib/constants";

export function VerificationForm({
  slug, defaults,
}: { slug: string; defaults: { legal_name: string; registration_number: string; institution_type: string; contact_role: string; statement: string } }) {
  const router = useRouter();
  const [legalName, setLegalName] = useState(defaults.legal_name);
  const [regNo, setRegNo] = useState(defaults.registration_number);
  const [type, setType] = useState(defaults.institution_type);
  const [role, setRole] = useState(defaults.contact_role);
  const [statement, setStatement] = useState(defaults.statement);
  const [identity, setIdentity] = useState<string[]>([]);
  const [ownership, setOwnership] = useState<string[]>([]);
  const [extra, setExtra] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  const submit = async () => {
    setMsg(null);
    if (legalName.trim().length < 2) { setMsg({ kind: "error", text: "Legal name is required." }); return; }
    if (!identity.length) { setMsg({ kind: "error", text: "Upload an identity document." }); return; }
    if (!ownership.length) { setMsg({ kind: "error", text: "Upload ownership / authorisation evidence." }); return; }
    setBusy(true);
    const res = await api(`/api/providers/${slug}/verify`, {
      body: {
        legal_name: legalName, registration_number: regNo || null, institution_type: type,
        contact_role: role || null, statement,
        identity_doc_url: identity[0], ownership_doc_url: ownership[0], extra_doc_url: extra[0] ?? null,
      },
    });
    setBusy(false);
    if (!res.ok) { setMsg({ kind: "error", text: res.error }); return; }
    setMsg({ kind: "success", text: "Submitted for review. You'll be notified when an administrator decides." });
    router.refresh();
  };

  return (
    <div className="mt-2">
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Registered legal name" required htmlFor="ln"><Input id="ln" value={legalName} onChange={(e) => setLegalName(e.target.value)} /></Field>
        <Field label="Registration / licence number" htmlFor="rn"><Input id="rn" value={regNo} onChange={(e) => setRegNo(e.target.value)} placeholder="TN-ENG-1998-0421" /></Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Institution type" htmlFor="it">
          <Select id="it" value={type} onChange={(e) => setType(e.target.value)}>
            {ACCOUNT_TYPES.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
          </Select>
        </Field>
        <Field label="Your role" htmlFor="cr"><Input id="cr" value={role} onChange={(e) => setRole(e.target.value)} placeholder="Facility Head" /></Field>
      </div>
      <Field label="Statement of authority" htmlFor="st" hint="Explain your authority to share the listed equipment.">
        <Textarea id="st" rows={3} value={statement} onChange={(e) => setStatement(e.target.value)} />
      </Field>

      <Uploader value={identity} onChange={setIdentity} kind="document" label="Identity document (required)" max={1} hint="PDF or image. Stored privately — visible only to reviewers." />
      <Uploader value={ownership} onChange={setOwnership} kind="document" label="Ownership / authorisation evidence (required)" max={1} hint="Invoice, asset register extract, or a signed authorisation letter." />
      <Uploader value={extra} onChange={setExtra} kind="document" label="Additional document (optional)" max={1} />

      <Button onClick={submit} loading={busy}>Submit for review</Button>
      <p className="mt-2 text-[10.5px] leading-relaxed text-ink-faint">
        By submitting you confirm the documents are genuine and relate to the equipment you list. Submitting false
        evidence leads to removal from the platform.
      </p>
    </div>
  );
}
