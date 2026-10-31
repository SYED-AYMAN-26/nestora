"use client";

import { useId, useState, type ReactNode } from "react";
import { uploadFiles } from "@/lib/client";

export function Field({
  label, hint, error, required, children, htmlFor,
}: { label: string; hint?: string; error?: string; required?: boolean; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="mb-3.5">
      <label htmlFor={htmlFor} className="mb-1.5 block text-[12.5px] font-medium text-ink-dim">
        {label} {required && <span className="text-rose-300">*</span>}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-[11px] leading-snug text-ink-faint">{hint}</p>}
      {error && <p className="mt-1 text-[11px] text-rose-300">{error}</p>}
    </div>
  );
}

const baseInput =
  "w-full rounded-lg border border-white/12 bg-navy-900/70 px-3 py-2 text-[13.5px] text-ink placeholder:text-ink-faint/70 outline-none transition focus:border-electric/55 focus:bg-navy-900";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${baseInput} ${props.className || ""}`} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${baseInput} min-h-[90px] resize-y ${props.className || ""}`} />;
}

export function Select({ children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={`${baseInput} appearance-none bg-[length:14px] ${props.className || ""}`}>
      {children}
    </select>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  const id = useId();
  return (
    <div className="mb-3 flex items-start justify-between gap-3 rounded-lg border border-white/10 bg-white/3 px-3 py-2.5">
      <div>
        <label htmlFor={id} className="cursor-pointer text-[12.5px] font-medium text-ink">{label}</label>
        {hint && <p className="mt-0.5 text-[11px] text-ink-faint">{hint}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full border transition ${checked ? "border-electric/60 bg-electric/70" : "border-white/15 bg-white/10"}`}
      >
        <span className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white transition-all ${checked ? "left-[18px]" : "left-0.5"}`} />
      </button>
    </div>
  );
}

export function Alert({ kind = "error", children }: { kind?: "error" | "success" | "info" | "warn"; children: ReactNode }) {
  if (!children) return null;
  const styles = {
    error: "border-rose-400/30 bg-rose-400/10 text-rose-200",
    success: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
    info: "border-sky-400/30 bg-sky-400/10 text-sky-100",
    warn: "border-amber-400/30 bg-amber-400/10 text-amber-100",
  }[kind];
  return <div role={kind === "error" ? "alert" : "status"} className={`mb-3 rounded-lg border px-3 py-2 text-[12.5px] leading-relaxed ${styles}`}>{children}</div>;
}

export function Button({
  children, variant = "primary", loading, className = "", ...rest
}: { children: ReactNode; variant?: "primary" | "outline" | "ghost" | "danger" | "success"; loading?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const base = "inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-[13.5px] font-medium transition disabled:cursor-not-allowed disabled:opacity-50";
  const v = {
    primary: "bg-gradient-to-b from-electric to-electric-deep text-navy-950 shadow-[0_10px_28px_-14px_rgba(56,189,248,0.9)] hover:brightness-110",
    outline: "border border-white/16 bg-white/4 text-ink hover:border-electric/45 hover:bg-white/8",
    ghost: "text-ink-dim hover:bg-white/6 hover:text-ink",
    danger: "border border-rose-400/35 bg-rose-400/12 text-rose-200 hover:bg-rose-400/20",
    success: "border border-emerald-400/35 bg-emerald-400/12 text-emerald-200 hover:bg-emerald-400/20",
  }[variant];
  return (
    <button {...rest} disabled={rest.disabled || loading} className={`${base} ${v} ${className}`}>
      {loading && <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </button>
  );
}

/** Image / document uploader with server-side validation feedback. */
export function Uploader({
  value, onChange, kind = "image", label = "Photos", max = 4, hint,
}: {
  value: string[];
  onChange: (urls: string[]) => void;
  kind?: "image" | "document";
  label?: string;
  max?: number;
  hint?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handle = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setErr(null);
    const res = await uploadFiles(Array.from(files).slice(0, max - value.length), kind);
    setBusy(false);
    if (!res.ok) { setErr(res.error); return; }
    onChange([...value, ...res.data.urls].slice(0, max));
  };

  return (
    <div className="mb-3.5">
      <p className="mb-1.5 text-[12.5px] font-medium text-ink-dim">
        {label} <span className="text-ink-faint">({value.length}/{max})</span>
      </p>
      {hint && <p className="mb-1.5 text-[11px] text-ink-faint">{hint}</p>}
      <div className="flex flex-wrap gap-2">
        {value.map((url) => (
          <div key={url} className="group relative h-20 w-24 overflow-hidden rounded-lg border border-white/12">
            {kind === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={url} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="grid h-full place-items-center bg-navy-900 text-[10px] text-ink-dim">DOCUMENT</div>
            )}
            <button
              type="button"
              onClick={() => onChange(value.filter((v) => v !== url))}
              className="absolute right-0.5 top-0.5 rounded bg-navy-950/85 px-1.5 text-[11px] text-rose-300 opacity-0 transition group-hover:opacity-100"
              aria-label="Remove file"
            >
              ✕
            </button>
          </div>
        ))}
        {value.length < max && (
          <label className={`grid h-20 w-24 cursor-pointer place-items-center rounded-lg border border-dashed border-white/20 bg-white/3 text-center text-[10.5px] text-ink-faint transition hover:border-electric/45 hover:text-ink ${busy ? "opacity-60" : ""}`}>
            <input
              type="file"
              accept={kind === "image" ? "image/jpeg,image/png,image/webp" : "application/pdf,image/jpeg,image/png,image/webp"}
              multiple={kind === "image"}
              className="sr-only"
              onChange={(e) => handle(e.target.files)}
              disabled={busy}
            />
            {busy ? "Uploading…" : "+ Add"}
          </label>
        )}
      </div>
      {err && <p className="mt-1 text-[11px] text-rose-300">{err}</p>}
    </div>
  );
}

export function CheckboxList({
  items, selected, onChange, label,
}: { items: string[]; selected: string[]; onChange: (v: string[]) => void; label?: string }) {
  const toggle = (i: string) => onChange(selected.includes(i) ? selected.filter((s) => s !== i) : [...selected, i]);
  return (
    <fieldset className="mb-3.5">
      {label && <legend className="mb-1.5 text-[12.5px] font-medium text-ink-dim">{label}</legend>}
      <div className="grid gap-1.5">
        {items.map((i) => (
          <label key={i} className="flex cursor-pointer items-start gap-2 rounded-lg border border-white/8 bg-white/2 px-2.5 py-1.5 text-[12px] text-ink-dim hover:border-white/16">
            <input type="checkbox" checked={selected.includes(i)} onChange={() => toggle(i)} className="mt-0.5 h-3.5 w-3.5 accent-[#38bdf8]" />
            <span>{i}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function ChipSelect({ options, selected, onChange, max = 20 }: {
  options: { value: string; label: string }[]; selected: string[]; onChange: (v: string[]) => void; max?: number;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = selected.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => {
              if (on) onChange(selected.filter((s) => s !== o.value));
              else if (selected.length < max) onChange([...selected, o.value]);
            }}
            className={`rounded-full border px-2.5 py-1 text-[11.5px] transition ${on ? "border-electric/60 bg-electric/15 text-electric" : "border-white/12 bg-white/3 text-ink-dim hover:border-white/25"}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
