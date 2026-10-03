"use client";
import { useEffect, useRef, useState } from "react";
import { formatAmount } from "@/lib/format";

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduce(mq.matches);
    const on = () => setReduce(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduce;
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * Counts a token amount (in stroops) up from its previous value. The final value is
 * rendered invisibly in the same grid cell so the width never changes (no layout shift).
 */
export function CountUp({ value, duration = 900 }: { value: bigint; duration?: number }) {
  const [shown, setShown] = useState<bigint>(value);
  const from = useRef<bigint | null>(null);
  useEffect(() => {
    const start = from.current ?? BigInt(0);
    from.current = value;
    if (prefersReducedMotion() || start === value) return setShown(value);
    const a = Number(start);
    const b = Number(value);
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / duration);
      setShown(t >= 1 ? value : BigInt(Math.round(a + (b - a) * easeOut(t))));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return (
    <span className="inline-grid tabular-nums">
      <span aria-hidden className="invisible col-start-1 row-start-1">
        {formatAmount(value)}
      </span>
      <span className="col-start-1 row-start-1 text-right">{formatAmount(shown)}</span>
    </span>
  );
}

/** Animated check mark used for transaction success feedback. */
export function SuccessCheck({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`shrink-0 overflow-visible ${className}`} aria-hidden>
      <circle className="check-ripple" cx="12" cy="12" r="10" fill="currentColor" opacity="0.25" />
      <circle className="check-ring" cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1.8" pathLength={1} />
      <path
        className="check-tick"
        d="M7.5 12.5l3 3 6-6.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
      />
    </svg>
  );
}
