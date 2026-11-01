import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto grid max-w-xl place-items-center px-4 py-24 text-center">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-electric">404</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">That page isn&apos;t here</h1>
      <p className="mt-2 text-sm leading-relaxed text-ink-dim">
        The link may be outdated, or the record may belong to another account. Nestora returns the same 404 for
        &ldquo;doesn&apos;t exist&rdquo; and &ldquo;not yours&rdquo; so private records aren&apos;t discoverable.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Link href="/marketplace" className="rounded-lg bg-gradient-to-b from-electric to-electric-deep px-3.5 py-2 text-[13px] font-semibold text-white">Marketplace</Link>
        <Link href="/" className="rounded-lg border border-white/16 px-3.5 py-2 text-[13px] text-ink">Home</Link>
        <Link href="/help" className="rounded-lg border border-white/16 px-3.5 py-2 text-[13px] text-ink">Help</Link>
      </div>
    </div>
  );
}
