"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ajo, Circle, MemberState, openDebt } from "@/lib/ajo";
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
  record: MemberState;
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
      const recs = await Promise.all(mine.map((c) => ajo.getMemberState(c.id, w.address!)));
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
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
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
              Connect your wallet to see what you’ve contributed, what you can claim, any open debts and
              any rounds you missed — read straight from the contract.
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
      claimable: a.claimable + BigInt(r.record.claimable),
      claimed: a.claimed + BigInt(r.record.total_claimed),
      debts: a.debts + openDebt(r.record),
    }),
    { paid: 0, missed: 0, claimable: BigInt(0), claimed: BigInt(0), debts: BigInt(0) },
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
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3">
            {rows
              ? [
                  ["Rounds paid", String(totals.paid), undefined],
                  ["Rounds missed", String(totals.missed), undefined],
                  ["Claimable now", formatAmount(totals.claimable), config.tokenCode],
                  ["Claimed", formatAmount(totals.claimed), config.tokenCode],
                  ["Open debts", formatAmount(totals.debts), config.tokenCode],
                ].map(([k, v, u]) => (
                  <Stat key={k} label={k!} value={v} unit={u} className="bg-ivory p-4 min-[360px]:p-5" />
                ))
              : [0, 1, 2, 3, 4].map((i) => (
                  <div key={i} className="space-y-2 bg-ivory p-5">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-7 w-14" />
                  </div>
                ))}
          </div>

          {rows && rows.length === 0 && (
            <Card className="text-center">
              <p className="font-display text-2xl text-ink">You’re not in a circle yet</p>
              <p className="mt-2 text-sm text-muted">Start one with people you trust, or ask someone to add your address — you&apos;ll then accept your slot.</p>
              <LinkButton href="/create" className="mt-5">
                Start a circle
              </LinkButton>
            </Card>
          )}

          <div className="space-y-4">
            {rows?.map(({ circle: c, record: r, position }) => {
              const done = c.status === "Completed";
              const got = r.received;
              const debts = r.debts.filter((d) => BigInt(d.amount) > BigInt(0));
              return (
                <Link
                  key={c.id}
                  href={`/circle/${c.id}`}
                  className="lift group block animate-rise rounded-xl border border-line bg-ivory p-5 hover:border-line-strong sm:p-6"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-mono text-xs uppercase tracking-[0.16em] text-muted">Circle №{c.id}</p>
                    {done ? (
                      <Pill tone="sage" dot>Completed</Pill>
                    ) : c.status === "Forming" ? (
                      <Pill tone="ochre" dot>{r.accepted ? "Accepted · waiting for others" : "Accept your slot"}</Pill>
                    ) : c.status === "Cancelled" ? (
                      <Pill>Cancelled</Pill>
                    ) : (
                      <Pill>Round {c.round + 1} of {c.members.length}</Pill>
                    )}
                  </div>
                  <p className="mt-3 text-ink-soft">
                    Your turn: <span className="font-numeral text-lg text-ink">round {position + 1}</span>
                    {got ? (
                      <span className="ml-2 text-sm text-sage">✓ pot of {formatAmount(r.received_gross)} {config.tokenCode} settled to you</span>
                    ) : (
                      <span className="ml-2 text-sm text-muted">· {formatAmount(c.contribution)} {config.tokenCode} per round</span>
                    )}
                  </p>
                  <div className="mt-4">
                    <RoundsBar total={c.members.length} current={c.status === "Active" ? c.round : -1} done={done} />
                  </div>
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    <Pill tone="sage">paid {r.paid}</Pill>
                    <Pill tone={r.missed ? "rust" : "neutral"}>missed {r.missed}</Pill>
                    {r.missed_rounds.length > 0 && (
                      <Pill tone="rust">missed round{r.missed_rounds.length > 1 ? "s" : ""} {r.missed_rounds.map((x) => x + 1).join(", ")}</Pill>
                    )}
                    <Pill tone="indigo">collateral {formatAmount(r.collateral)}</Pill>
                    {r.claimable > BigInt(0) && <Pill tone="clay">claimable {formatAmount(r.claimable)}</Pill>}
                    {r.total_claimed > BigInt(0) && <Pill tone="neutral">claimed {formatAmount(r.total_claimed)}</Pill>}
                  </div>
                  {debts.length > 0 && (
                    <ul className="mt-3 space-y-0.5 text-xs text-rust">
                      {debts.map((d, k) => (
                        <li key={k}>
                          Open debt: {formatAmount(d.amount)} {config.tokenCode} to {d.creditor.slice(0, 4)}…{d.creditor.slice(-4)} (round {d.round + 1})
                        </li>
                      ))}
                    </ul>
                  )}
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
