"use client";

import { useEffect } from "react";
import { api } from "@/lib/client";

export async function TrackView({ resourceId }: { resourceId: number }) {
  useEffect(() => {
    const t = setTimeout(async () => {
      await api("/api/track", { body: { resourceId } });
    }, 1200);
    return () => clearTimeout(t);
  }, [resourceId]);
  return null;
}
