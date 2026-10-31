import Link from "next/link";
import type { ReactNode } from "react";

type Tone = "verified" | "pending" | "rejected" | "neutral" | "info" | "warn" | "danger" | "success";

const TONES: Record<Tone, string> = {
  verified: "bg-emerald-400/12 text-emerald-300 border-emerald-400/35",
  success: "bg-emerald-400/12 text-emerald-300 border-emerald-400/35",
  pending: "bg-amber-400/12 text-amber-300 border-amber-400/35",
  warn: "bg-amber-400/12 text-amber-300 border-amber-400/35",
  rejected: "bg-rose-400/12 text-rose-300 border-rose-400/35",
  danger: "bg-rose-400/12 text-rose-300 border-rose-400/35",
  info: "bg-sky-400/12 text-sky-300 border-sky-400/35",
  neutral: "bg-white/6 text-ink-dim border-white/14",
};

export function Badge({ children, tone = "neutral", className = "" }: { children: ReactNode; tone?: Tone; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium leading-none tracking-wide ${TONES[tone]} ${className}`}>
      {children}
    </span>
  );
}

export type StatusTone = Tone;
export function statusTone(status?: string | null): Tone {
  switch (status) {
    case "verified": case "completed": case "active": case "approved": case "paid":
    case "resolved": case "available": return "success";
    case "pending": case "awaiting_payment": case "under_review": case "more_info":
    case "return_requested": case "ready_for_handover": case "evidence_requested": return "warn";
    case "rejected": case "cancelled": case "disputed": case "failed": return "danger";
    case "open": case "draft": case "paused": return "info";
    default: return "neutral";
  }
}

export function Check({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="currentColor" aria-hidden="true">
      <path d="M10 1.5 12.2 4l3.3-.3.9 3.2 3.1 1.3-1.5 3 1.5 3-3.1 1.3-.9 3.2-3.3-.3L10 21l-2.2-2.5-3.3.3-.9-3.2L.5 14.3 2 11.3.5 8.3l3.1-1.3.9-3.2 3.3.3z" transform="translate(0 -1)" opacity=".18" />
      <path d="M5.6 10.4l2.7 2.7 6-6.1" stroke="currentColor" strokeWidth="2.1" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function VerifiedBadge({ status, small = false }: { status?: string | null; small?: boolean }) {
  if (status === "verified") {
    return <Badge tone="verified"><Check className="h-3 w-3" /> Verified</Badge>;
  }
  if (status === "pending") return <Badge tone="pending">Verification pending</Badge>;
  if (status === "more_info") return <Badge tone="warn">More info required</Badge>;
  if (status === "rejected") return <Badge tone="danger">Verification rejected</Badge>;
  if (small) return null;
  return <Badge tone="neutral">Not verified</Badge>;
}

export function DemoTag({ label = "DEMO" }: { label?: string }) {
  return (
    <span
      title="This record is fictional demonstration data seeded for the hackathon demo."
      className="inline-flex items-center gap-1 rounded-md border border-fuchsia-400/35 bg-fuchsia-400/12 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-fuchsia-300"
    >
      {label}
    </span>
  );
}

export function Card({ children, className = "", as: As = "div" }: { children: ReactNode; className?: string; as?: "div" | "section" | "article" | "li" }) {
  return <As className={`glass rounded-2xl ${className}`}>{children}</As>;
}

export function SectionTitle({ eyebrow, title, sub, right }: { eyebrow?: string; title: string; sub?: string; right?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-electric">{eyebrow}</p>}
        <h2 className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">{title}</h2>
        {sub && <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-dim">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

export function Stat({ label, value, hint, tone = "default" }: { label: string; value: ReactNode; hint?: string; tone?: "default" | "warn" | "good" }) {
  const color = tone === "warn" ? "text-amber-300" : tone === "good" ? "text-emerald-300" : "text-ink";
  return (
    <div className="glass rounded-xl p-4">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-faint">{label}</p>
      <p className={`mt-2 text-2xl font-semibold tabular-nums tracking-tight ${color}`}>{value}</p>
      {hint && <p className="mt-1 text-[11px] leading-snug text-ink-faint">{hint}</p>}
    </div>
  );
}

// Re-exported from the shared (server-safe) format module so both server and client imports work.
export { money } from "@/lib/format";

export function EmptyState({ title, body, action, icon = "◇" }: { title: string; body?: string; action?: ReactNode; icon?: string }) {
  return (
    <div className="glass-soft flex flex-col items-center rounded-2xl px-6 py-12 text-center">
      <div className="mb-3 grid h-12 w-12 place-items-center rounded-xl border border-white/10 bg-white/5 text-xl text-electric">{icon}</div>
      <p className="text-sm font-semibold text-ink">{title}</p>
      {body && <p className="mt-1.5 max-w-md text-xs leading-relaxed text-ink-dim">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Progress({ value, className = "", tone = "electric" }: { value: number; className?: string; tone?: "electric" | "mint" | "amber" | "rose" }) {
  const bg = { electric: "bg-electric", mint: "bg-emerald-400", amber: "bg-amber-400", rose: "bg-rose-400" }[tone];
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full bg-white/8 ${className}`}>
      <div className={`h-full rounded-full ${bg}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function InfoNote({ children, tone = "info", title }: { children: ReactNode; tone?: "info" | "warn" | "danger"; title?: string }) {
  const styles = {
    info: "border-sky-400/25 bg-sky-400/8 text-sky-100",
    warn: "border-amber-400/25 bg-amber-400/8 text-amber-100",
    danger: "border-rose-400/25 bg-rose-400/8 text-rose-100",
  }[tone];
  return (
    <div className={`rounded-xl border px-3.5 py-3 text-[12.5px] leading-relaxed ${styles}`}>
      {title && <p className="mb-1 font-semibold">{title}</p>}
      {children}
    </div>
  );
}

export function PageHeader({ title, sub, right, breadcrumb, eyebrow }: { title: string; sub?: string; right?: ReactNode; breadcrumb?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <header className="mb-7">
      {breadcrumb && <div className="mb-2 text-[12px] text-ink-faint">{breadcrumb}</div>}
      {eyebrow && <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-electric">{eyebrow}</p>}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-[28px]">{title}</h1>
          {sub && <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-ink-dim">{sub}</p>}
        </div>
        {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
      </div>
    </header>
  );
}

export function Stars({ rating, count, size = "sm" }: { rating: number; count?: number; size?: "sm" | "md" }) {
  const full = Math.round(rating);
  return (
    <span className={`inline-flex items-center gap-1 ${size === "sm" ? "text-[12px]" : "text-sm"}`}>
      <span className="text-amber-300" aria-hidden="true">
        {"★".repeat(full)}<span className="text-white/20">{"★".repeat(5 - full)}</span>
      </span>
      <span className="text-ink-faint" aria-label={`${rating} out of 5`}>
        {rating ? rating.toFixed(1) : "New"}{count ? ` (${count})` : ""}
      </span>
    </span>
  );
}

export function LinkButton({
  href, children, variant = "primary", className = "", ...rest
}: { href: string; children: ReactNode; variant?: "primary" | "ghost" | "outline" | "danger" | "success"; className?: string } & Record<string, unknown>) {
  return <Link href={href} className={`${btnClass(variant)} ${className}`} {...rest}>{children}</Link>;
}

export function btnClass(variant: "primary" | "ghost" | "outline" | "danger" | "success" = "primary") {
  const base = "inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50";
  switch (variant) {
    case "primary":
      return `${base} bg-gradient-to-b from-electric to-electric-deep text-[#04121f] shadow-[0_10px_30px_-12px_rgba(56,189,248,0.85)] hover:brightness-110`;
    case "outline":
      return `${base} border border-white/16 bg-white/4 text-ink hover:border-electric/45 hover:bg-white/8`;
    case "ghost":
      return `${base} text-ink-dim hover:bg-white/6 hover:text-ink`;
    case "danger":
      return `${base} border border-rose-400/35 bg-rose-400/12 text-rose-200 hover:bg-rose-400/20`;
    case "success":
      return `${base} border border-emerald-400/35 bg-emerald-400/12 text-emerald-200 hover:bg-emerald-400/20`;
  }
}
