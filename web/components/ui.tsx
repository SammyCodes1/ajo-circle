"use client";
import Link from "next/link";
import { explorer } from "@/lib/config";

export function Card({
  children,
  className = "",
  as: Tag = "div",
}: {
  children: React.ReactNode;
  className?: string;
  as?: "div" | "section" | "article";
}) {
  return (
    <Tag className={`rounded-xl border border-line bg-ivory p-4 shadow-[var(--shadow-card)] min-[360px]:p-5 sm:p-6 ${className}`}>{children}</Tag>
  );
}

type Variant = "primary" | "secondary" | "ghost" | "ink";
const base =
  "inline-flex min-h-11 select-none items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-[0.9rem] font-medium tracking-[-0.005em] transition-[background-color,color,border-color,box-shadow,transform] duration-200 ease-[var(--ease-calm)] active:translate-y-px disabled:cursor-not-allowed disabled:active:translate-y-0";
const variants: Record<Variant, string> = {
  primary:
    "bg-clay-strong text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.18)] hover:bg-clay-deep disabled:bg-sand disabled:text-muted disabled:shadow-none",
  ink: "bg-ink text-ivory hover:bg-ink-soft disabled:bg-sand disabled:text-muted",
  secondary:
    "border border-line-strong bg-ivory text-ink hover:border-ink/40 hover:bg-white disabled:text-muted disabled:hover:border-line-strong disabled:hover:bg-ivory",
  ghost: "text-ink-soft hover:bg-sand/70 disabled:text-muted",
};

export function Button({
  variant = "primary",
  loading,
  className = "",
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      aria-busy={loading || undefined}
      className={`${base} ${variants[variant]} ${className}`}
    >
      {loading && (
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
      )}
      {children}
    </button>
  );
}

export function LinkButton({
  href,
  children,
  variant = "primary",
  className = "",
}: {
  href: string;
  children: React.ReactNode;
  variant?: Variant;
  className?: string;
}) {
  return (
    <Link href={href} className={`${base} ${variants[variant]} ${className}`}>
      {children}
    </Link>
  );
}

type Tone = "error" | "warn" | "info" | "success";
const tones: Record<Tone, { box: string; dot: string }> = {
  error: { box: "border-rust/25 bg-rust-wash/70 text-rust", dot: "bg-rust" },
  warn: { box: "border-ochre-bright/40 bg-ochre-wash/60 text-ochre", dot: "bg-ochre-bright" },
  info: { box: "border-line bg-ivory text-ink-soft", dot: "bg-indigo-soft" },
  success: { box: "border-sage/25 bg-sage-wash/70 text-sage", dot: "bg-sage" },
};

export function Alert({
  tone = "info",
  title,
  children,
}: {
  tone?: Tone;
  title?: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = tones[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`flex gap-3 rounded-lg border px-4 py-3 text-sm leading-relaxed ${t.box}`}
    >
      <span aria-hidden className={`mt-[0.45rem] h-1.5 w-1.5 shrink-0 rounded-full ${t.dot}`} />
      <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
        {title && <p className="font-semibold">{title}</p>}
        {children}
      </div>
    </div>
  );
}

export function TxLink({ hash, label = "View on stellar.expert" }: { hash: string; label?: string }) {
  return (
    <a
      className="font-medium underline decoration-current/30 underline-offset-[3px] hover:decoration-current"
      href={explorer.tx(hash)}
      target="_blank"
      rel="noreferrer"
    >
      {label} ↗
    </a>
  );
}

type PillTone = "sage" | "rust" | "ochre" | "ink" | "indigo" | "clay" | "neutral";
const pillTones: Record<PillTone, string> = {
  sage: "bg-sage-wash text-sage",
  rust: "bg-rust-wash text-rust",
  ochre: "bg-ochre-wash text-ochre",
  ink: "bg-ink text-ivory",
  indigo: "bg-indigo-wash text-indigo",
  clay: "bg-clay-wash text-clay-deep",
  neutral: "bg-sand text-ink-soft",
};
const pillDots: Partial<Record<PillTone, string>> = {
  sage: "bg-sage",
  rust: "bg-rust",
  ochre: "bg-ochre-bright",
  clay: "bg-clay",
  indigo: "bg-indigo-soft",
};

export function Pill({
  children,
  tone = "neutral",
  dot,
  className = "",
}: {
  children: React.ReactNode;
  tone?: PillTone;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-[3px] text-[0.75rem] font-medium leading-none ${pillTones[tone]} ${className}`}
    >
      {dot && pillDots[tone] && <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${pillDots[tone]}`} />}
      {children}
    </span>
  );
}

export function Eyebrow({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={`font-mono text-xs uppercase tracking-[0.16em] text-muted ${className}`}>
      {children}
    </p>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`skeleton ${className}`} />;
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-3 py-8 text-sm text-muted">
      <span className="h-4 w-4 animate-spin rounded-full border-[1.5px] border-clay border-t-transparent" />
      {label}
    </div>
  );
}

export function Address({ value, chars = 4, className = "" }: { value: string; chars?: number; className?: string }) {
  const short = value.length > chars * 2 + 3 ? `${value.slice(0, chars)}…${value.slice(-chars)}` : value;
  return (
    <span title={value} className={`font-mono text-[max(12px,0.82em)] tracking-tight ${className}`}>
      {short}
    </span>
  );
}

export function Stat({
  label,
  value,
  unit,
  hint,
  className = "",
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  hint?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="text-[0.78rem] text-muted">{label}</p>
      <p className="font-numeral mt-1 text-[1.75rem] leading-none text-ink">
        {value}
        {unit && <span className="ml-1.5 font-sans text-sm font-medium text-muted">{unit}</span>}
      </p>
      {hint && <p className="mt-1.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}
