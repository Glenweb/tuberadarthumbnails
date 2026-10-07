"use client";

import { useEffect, useState, type ReactNode } from "react";

export function Section({
  title, subtitle, actions, children, className = "",
}: {
  title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={`panel p-5 ${className}`}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-4 mb-4">
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-extrabold tracking-tight">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-[12.5px] text-ink-400 text-balance">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function PageHeader({
  eyebrow, title, subtitle, actions,
}: { eyebrow?: string; title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 mb-6">
      <div className="min-w-0">
        {eyebrow && (
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-accent-500 mb-1.5">{eyebrow}</p>
        )}
        <h1 className="text-[26px] sm:text-[31px] font-extrabold tracking-[-0.025em] leading-none">{title}</h1>
        {subtitle && <p className="mt-2 max-w-2xl text-[13.5px] leading-relaxed text-ink-300 text-balance">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity=".22" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Banner({
  tone = "info", title, children, onDismiss,
}: {
  tone?: "info" | "warn" | "error" | "good";
  title?: string;
  children: ReactNode;
  onDismiss?: () => void;
}) {
  const tones = {
    info: "border-accent-500/35 bg-accent-500/8 text-accent-400",
    warn: "border-warn-500/35 bg-warn-500/8 text-warn-400",
    error: "border-bad-500/40 bg-bad-500/10 text-bad-400",
    good: "border-good-500/35 bg-good-500/8 text-good-400",
  } as const;
  return (
    <div className={`rounded-[11px] border px-3.5 py-3 text-[12.5px] leading-relaxed ${tones[tone]}`} role={tone === "error" ? "alert" : "status"}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {title && <p className="font-bold mb-0.5">{title}</p>}
          <div className="text-ink-200/90">{children}</div>
        </div>
        {onDismiss && (
          <button onClick={onDismiss} className="btn btn-quiet btn-sm -mr-1.5 -mt-1" aria-label="Dismiss">✕</button>
        )}
      </div>
    </div>
  );
}

export function Stat({
  label, value, hint, tone = "default",
}: { label: string; value: ReactNode; hint?: ReactNode; tone?: "default" | "good" | "warn" | "bad" }) {
  const colour = {
    default: "text-ink-100", good: "text-good-400", warn: "text-warn-400", bad: "text-bad-400",
  }[tone];
  return (
    <div className="panel-tight p-3.5">
      <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-ink-400">{label}</p>
      <p className={`mt-1 text-[21px] font-extrabold leading-none tabular ${colour}`}>{value}</p>
      {hint && <p className="mt-1.5 text-[11.5px] leading-snug text-ink-400">{hint}</p>}
    </div>
  );
}

/** Placeholder that holds the real layout while data loads, so the page does
 *  not collapse to a single spinner line and then jump. */
export function Skeleton({ className = "", rounded = "rounded-[13px]" }: { className?: string; rounded?: string }) {
  return <div className={`shimmer ${rounded} ${className}`} aria-hidden />;
}

export function StatSkeleton() {
  return (
    <div className="panel-tight p-3.5">
      <Skeleton className="h-2.5 w-20" rounded="rounded-full" />
      <Skeleton className="mt-2.5 h-5 w-16" rounded="rounded-[5px]" />
      <Skeleton className="mt-2.5 h-2 w-28" rounded="rounded-full" />
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-[13px] border border-dashed border-ink-600 px-6 py-12 text-center">
      <p className="text-[14px] font-bold text-ink-200">{title}</p>
      {children && <p className="mt-1.5 mx-auto max-w-md text-[12.5px] leading-relaxed text-ink-400">{children}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

/** Thumbnail preview with a shelf-size toggle — the size that decides clicks. */
export function ThumbPreview({
  src, alt, title, channel = "Your channel", shelfSize = false, className = "",
}: {
  src: string | null; alt: string; title?: string; channel?: string; shelfSize?: boolean; className?: string;
}) {
  // An asset that 404s (pruned storage, a stale row) degrades to the
  // placeholder rather than a broken-image icon.
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const usable = src && !failed ? src : null;

  if (shelfSize) {
    return (
      <div className={`w-[168px] shrink-0 ${className}`}>
        {usable ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={usable} alt={alt} width={168} height={94} onError={() => setFailed(true)} className="thumb w-[168px] h-[94px] rounded-[7px]" />
        ) : (
          <div className="thumb w-[168px] h-[94px] rounded-[7px] shimmer" />
        )}
        {title !== undefined && (
          <>
            <p className="mt-1.5 text-[12px] font-semibold leading-[1.25] line-clamp-2">{title}</p>
            <p className="mt-0.5 text-[11px] text-ink-400 truncate">{channel}</p>
          </>
        )}
      </div>
    );
  }
  return usable ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={usable} alt={alt} onError={() => setFailed(true)} className={`thumb w-full rounded-[11px] ${className}`} />
  ) : (
    <div className={`thumb w-full rounded-[11px] shimmer ${className}`} />
  );
}

export function Toggle({
  checked, onChange, label,
}: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2 text-[12px] font-semibold text-ink-300 hover:text-ink-100 transition-colors"
    >
      <span className={`relative h-[18px] w-[32px] rounded-full transition-colors ${checked ? "bg-accent-500" : "bg-ink-600"}`}>
        <span className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white transition-all ${checked ? "left-[16px]" : "left-[2px]"}`} />
      </span>
      {label}
    </button>
  );
}

/** Copy-to-clipboard with confirmation, used all over the title surfaces. */
export function CopyButton({ text, className = "" }: { text: string; className?: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1600);
    return () => clearTimeout(t);
  }, [done]);
  return (
    <button
      className={`btn btn-quiet btn-sm ${className}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
        } catch {
          setDone(false);
        }
      }}
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}

export function Field({
  label, hint, children,
}: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {hint && <p className="mt-1.5 text-[11.5px] leading-snug text-ink-400">{hint}</p>}
    </div>
  );
}
