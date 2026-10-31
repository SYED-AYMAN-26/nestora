"use client";

/** Thin fetch wrapper for client components: uniform JSON + error handling. */
/** Extra fields the API may attach to a failed response. */
export type ApiErrorData = {
  ok?: false;
  error?: string;
  issues?: { path: string; message: string }[];
  canJoinWaitingList?: boolean;
  [key: string]: unknown;
};

export async function api<T = unknown>(
  // NOTE: `unknown` (not `any`) so callers must declare what they expect; error
  // payloads are read through the narrow `ApiErrorData` shape below.
  path: string,
  opts: { method?: string; body?: unknown; formData?: FormData } = {}
): Promise<{ ok: true; data: T } | { ok: false; error: string; data?: ApiErrorData }> {
  try {
    const res = await fetch(path, {
      method: opts.method || (opts.body || opts.formData ? "POST" : "GET"),
      headers: opts.formData ? undefined : { "content-type": "application/json" },
      body: opts.formData ?? (opts.body ? JSON.stringify(opts.body) : undefined),
      credentials: "same-origin",
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok || json.ok === false) {
      return { ok: false, error: json.error || `Request failed (${res.status})`, data: json };
    }
    return { ok: true, data: json as T };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: message || "Network error" };
  }
}

export async function uploadFiles(files: FileList | File[], kind: "image" | "document" = "image") {
  const fd = new FormData();
  fd.set("kind", kind);
  Array.from(files).forEach((f) => fd.append("file", f));
  return api<{ urls: string[] }>("/api/uploads", { formData: fd });
}

// Formatting helpers live in a non-client module so server components can use them too.
export { fmtDate, fmtDateTime, money, todayStr, addDays } from "./format";
