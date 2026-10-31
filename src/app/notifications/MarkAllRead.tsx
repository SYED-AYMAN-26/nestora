"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client";
import { Button } from "@/components/form";

export function MarkAllRead({ disabled }: { disabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="outline"
      disabled={disabled}
      loading={busy}
      onClick={async () => {
        setBusy(true);
        await api("/api/notifications", { body: {} });
        setBusy(false);
        router.refresh();
      }}
    >
      Mark all read
    </Button>
  );
}
