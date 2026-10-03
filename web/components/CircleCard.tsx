"use client";
import Link from "next/link";
import { Circle } from "@/lib/ajo";
import { config } from "@/lib/config";
import { formatAmount, formatDuration } from "@/lib/format";
import { Pill, Skeleton } from "./ui";
import { CountUp } from "./motion";

/** Segmented rounds bar: settled = ink, current = clay, upcoming = sand. */
export function RoundsBar({ total, current, done }: { total: number; current: number; done: boolean }) {
  return (
    <div className="flex gap-1" aria-hidden>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={`h-1.5 flex-1 rounded-full transition-colors duration-500 ${
            done || i < current ? "bg-ink" : i === current ? "bg-clay" : "bg-sand"
          }`}
        />
      ))}
    </div>
  );
}

export function CircleCard({ c, mine }: { c: Circle; mine: boolean }) {
  const done = c.status === "Completed";
  const n = c.members.length;
  return (
    <Link
      href={`/circle/${c.id}`}
      className="lift group block rounded-xl border border-line bg-ivory p-5 hover:border-line-strong sm:p-6"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-muted">Circle №{c.id}</p>
        <div className="flex gap-1.5">
          {mine && <Pill tone="clay">You’re in</Pill>}
          {done ? (
            <Pill tone="sage" dot>
              Completed
            </Pill>
          ) : (
            <Pill tone="neutral">
              Round {c.round + 1} of {n}
            </Pill>
          )}
        </div>
      </div>
      <p className="font-numeral mt-5 text-[2.6rem] leading-none text-ink">
        <CountUp value={c.contribution} />
        <span className="ml-2 font-sans text-base font-medium tracking-normal text-muted">{config.tokenCode}</span>
      </p>
      <p className="mt-2 text-sm text-muted">
        per member · every {formatDuration(Number(c.period_secs))} · {n} members
      </p>
      <div className="mt-6">
        <RoundsBar total={n} current={c.round} done={done} />
        <div className="mt-2.5 flex items-center justify-between text-xs text-muted">
          {done ? (
            <span>All {n} pots paid out</span>
          ) : (
            <span className="tnum">
              {c.paid.length}/{n} paid · pot {formatAmount(c.pot)} {config.tokenCode}
            </span>
          )}
          <span className="text-ink-soft transition-transform duration-300 group-hover:translate-x-0.5">Open →</span>
        </div>
      </div>
    </Link>
  );
}

export function CircleCardSkeleton() {
  return (
    <div className="rounded-xl border border-line bg-ivory p-5 sm:p-6">
      <div className="flex justify-between">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-5 w-24 rounded-full" />
      </div>
      <Skeleton className="mt-6 h-10 w-36" />
      <Skeleton className="mt-3 h-3.5 w-52" />
      <Skeleton className="mt-7 h-1.5 w-full" />
      <Skeleton className="mt-3 h-3 w-32" />
    </div>
  );
}
