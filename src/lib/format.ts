/**
 * Pure formatting helpers. Deliberately NOT a "use client" module so that both
 * server components and client components can import them.
 */
export const fmtDate = (d?: string | null) => {
  if (!d) return "—";
  const date = new Date(d.length > 10 ? d : d + "T00:00:00Z");
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
};
export const fmtDateTime = (d?: string | null) => {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
};
export const money = (n?: number | null) =>
  n == null ? "—" : `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
export const todayStr = () => new Date().toISOString().slice(0, 10);
export const addDays = (base: string, days: number) => {
  const d = new Date(base + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
