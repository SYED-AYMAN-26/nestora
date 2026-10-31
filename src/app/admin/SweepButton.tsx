"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client";
import { Button } from "@/components/form";

export function SweepButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="text-right">
      <Button
        variant="outline"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          const res = await api<{ message: string }>("/api/admin/overview", { body: {} });
          setBusy(false);
          setMsg(res.ok ? res.data.message : res.error);
          router.refresh();
        }}
      >
        Run reminder sweep
      </Button>
      {msg && <p className="mt-1 text-[10.5px] text-ink-faint">{msg}</p>}
    </div>
  );
}
