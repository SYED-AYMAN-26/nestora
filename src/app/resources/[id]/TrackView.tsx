"use client";

import { useEffect } from "react";
import { api } from "@/lib/client";

export function TrackView({ resourceId }: { resourceId: number }) {
  useEffect(() => {
    const t = setTimeout(() => {
      // Fire-and-forget view counter: failures must never surface to the user.
      void api("/api/track", { body: { resourceId } }).catch(() => null);
    }, 1200);
    return () => clearTimeout(t);
  }, [resourceId]);
  return null;
}
