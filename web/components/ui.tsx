"use client";
import Link from "next/link";
import { explorer } from "@/lib/config";

export function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-2xl border border-stone-200 bg-white p-5 shadow-sm ${className}`}>
      {children}
    </div>
  );
}

type Variant = "primary" | "secondary" | "ghost";
const variants: Record<Variant, string> = {
  primary: "bg-emerald-700 text-white hover:bg-emerald-800 disabled:bg-emerald-700/40",
  secondary:
    "bg-amber-100 text-amber-900 hover:bg-amber-200 disabled:opacity-50 border border-amber-200",
  ghost: "bg-transparent text-stone-700 hover:bg-stone-100 disabled:opacity-50",
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
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed ${variants[variant]} ${className}`}
    >
      {loading && (
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      )}
      {children}
    </button>
  );
}

export function LinkButton({
  href,
  children,
  variant = "primary",
}: {
  href: string;
  children: React.ReactNode;
  variant?: Variant;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold transition ${variants[variant]}`}
    >
      {children}
    </Link>
  );
}

type Tone = "error" | "warn" | "info" | "success";
const tones: Record<Tone, string> = {
  error: "border-red-200 bg-red-50 text-red-800",
  warn: "border-amber-200 bg-amber-50 text-amber-900",
  info: "border-sky-200 bg-sky-50 text-sky-900",
  success: "border-emerald-200 bg-emerald-50 text-emerald-900",
};

export function Alert({ tone = "info", children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-xl border px-4 py-3 text-sm ${tones[tone]}`}>
      {children}
    </div>
  );
}

export function TxLink({ hash, label = "View transaction" }: { hash: string; label?: string }) {
  return (
    <a className="font-medium underline" href={explorer.tx(hash)} target="_blank" rel="noreferrer">
      {label} ↗
    </a>
  );
}

export function Badge({
  children,
  tone = "stone",
}: {
  children: React.ReactNode;
  tone?: "emerald" | "amber" | "red" | "stone" | "sky";
}) {
  const t = {
    emerald: "bg-emerald-100 text-emerald-800",
    amber: "bg-amber-100 text-amber-900",
    red: "bg-red-100 text-red-800",
    stone: "bg-stone-100 text-stone-700",
    sky: "bg-sky-100 text-sky-800",
  }[tone];
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${t}`}>{children}</span>;
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 py-8 text-sm text-stone-500">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-emerald-700 border-t-transparent" />
      {label}
    </div>
  );
}
