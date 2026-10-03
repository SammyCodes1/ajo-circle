"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ajo, Circle, MemberRecord } from "@/lib/ajo";
import { formatAmount } from "@/lib/format";
import { friendlyError } from "@/lib/errors";
import { config } from "@/lib/config";
import { Alert, Button, Card, Eyebrow, LinkButton, Pill, Skeleton, Stat } from "@/components/ui";
import { useWallet } from "@/components/WalletProvider";
import { AccountPanel } from "@/components/AccountPanel";
import { AdirePattern } from "@/components/Brand";
import { RotationRing } from "@/components/RotationRing";
import { RoundsBar } from "@/components/CircleCard";

interface Row {
  circle: Circle;
  record: MemberRecord;
  position: number;
}

const GHOST = Array.from({ length: 5 }, (_, i) => ({ address: `m${i}`, received: i < 2, paid: i === 3 }));

export default function HistoryPage() {
  const w = useWallet();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!w.address) return;
    try {
      const n = await ajo.circleCount();
      const circles = await Promise.all(Array.from({ length: n }, (_, i) => ajo.getCircle(i)));
      const mine = circles.filter((c) => c.members.includes(w.address!));
      const recs = await Promise.all(mine.map((c) => ajo.getMemberRecord(c.id, w.address!)));
      setRows(
        mine
          .map((c, i) => ({ circle: c, record: recs[i], position: c.members.indexOf(w.address!) }))
          .reverse(),
      );
    } catch (e) {
      setError(friendlyError(e));
    }
  }, [w.address]);
  useEffect(() => {
    load();
  }, [load]);

  if (!w.address)
    return (
      <section className="relative mx-auto max-w-3xl overflow-hidden rounded-[28px] border border-line bg-ivory">
        <AdirePattern className="absolute inset-0" opacity={0.07} />
        <div className="relative grid items-center gap-6 p-8 sm:grid-cols-[1fr_220px] sm:p-12">
          <div>
            <Eyebrow>My history</Eyebrow>
            <h1 className="font-display mt-3 text-[2.3rem] leading-[1.05] text-ink sm:text-[2.8rem]">
              Your record, <em className="text-clay-deep">in every circle</em>.
            </h1>
            <p className="mt-4 max-w-[42ch] leading-relaxed text-ink-soft">
              Connect your wallet to see what you’ve contributed, what you’ve received and any rounds
              you missed — read straight from the contract.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Button onClick={w.connect} loading={w.connecting}>
                Connect wallet
              </Button>
              <LinkButton href="/" variant="secondary">
                Browse circles
              </LinkButton>
            </div>
          </div>
          <div className="mx-auto w-48 opacity-90 sm:w-full">
            <RotationRing members={GHOST} current={2} showLabels={false} title="Illustration" decorative />
          </div>
        </div>
      </section>
    );

  const totals = (rows ?? []).reduce(
    (a, r) => ({
      paid: a.paid + r.record.paid,
      missed: a.missed + r.record.missed,
      contributed: a.contributed + r.circle.contribution * BigInt(r.record.paid),
      received: a.received + r.record.received,
    }),
    { paid: 0, missed: 0, contributed: BigInt(0), received: BigInt(0) },
  );

  return (
    <div className="space-y-10">
      <header>
        <Eyebrow>My history</Eyebrow>
        <h1 className="font-display mt-3 text-[2.4rem] leading-none text-ink sm:text-5xl">Your record</h1>
      </header>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          {error && <Alert tone="error">{error}</Alert>}
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-4">
            {rows
              ? [
                  ["Rounds paid", String(totals.paid), undefined],
                  ["Rounds missed", String(totals.missed), undefined],
                  ["Contributed", formatAmount(totals.contributed), config.tokenCode],
                  ["Received", formatAmount(totals.received), config.tokenCode],
                ].map(([k, v, u]) => (
                  <Stat key={k} label={k!} value={v} unit={u} className="bg-ivory p-5" />
                ))
              : [0, 1, 2, 3].map((i) => (
                  <div key={i} className="space-y-2 bg-ivory p-5">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-7 w-14" />
                  </div>
                ))}
          </div>

          {rows && rows.length === 0 && (
            <Card className="text-center">
              <p className="font-display text-2xl text-ink">You’re not in a circle yet</p>
              <p className="mt-2 text-sm text-muted">Start one with people you trust, or ask an admin to add your address.</p>
              <LinkButton href="/create" className="mt-5">
                Start a circle
              </LinkButton>
            </Card>
          )}

          <div className="space-y-4">
            {rows?.map(({ circle: c, record: r, position }) => {
              const done = c.status === "Completed";
              const got = position < c.round;
              return (
                <Link
                  key={c.id}
                  href={`/circle/${c.id}`}
                  className="group block animate-rise rounded-xl border border-line bg-ivory p-5 transition-[border-color,box-shadow] duration-300 hover:border-line-strong hover:shadow-[0_10px_30px_-18px_rgb(31_30_29/0.35)] sm:p-6"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-mono text-xs uppercase tracking-[0.16em] text-muted">Circle №{c.id}</p>
                    {done ? <Pill tone="sage" dot>Completed</Pill> : <Pill>Round {c.round + 1} of {c.members.length}</Pill>}
                  </div>
                  <p className="mt-3 text-ink-soft">
                    Your turn: <span className="font-numeral text-lg text-ink">round {position + 1}</span>
                    {got ? (
                      <span className="ml-2 text-sm text-sage">✓ received {formatAmount(r.received)} {config.tokenCode}</span>
                    ) : (
                      <span className="ml-2 text-sm text-muted">· {formatAmount(c.contribution)} {config.tokenCode} per round</span>
                    )}
                  </p>
                  <div className="mt-4">
                    <RoundsBar total={c.members.length} current={c.round} done={done} />
                  </div>
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    <Pill tone="sage">paid {r.paid}</Pill>
                    <Pill tone={r.missed ? "rust" : "neutral"}>missed {r.missed}</Pill>
                    {r.missed_rounds.length > 0 && (
                      <Pill tone="rust">missed round{r.missed_rounds.length > 1 ? "s" : ""} {r.missed_rounds.map((x) => x + 1).join(", ")}</Pill>
                    )}
                    <Pill tone="indigo">received {formatAmount(r.received)}</Pill>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <AccountPanel />
        </aside>
      </div>
    </div>
  );
}
