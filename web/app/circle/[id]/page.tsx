"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ajo, Circle, MemberRecord, RoundStatus } from "@/lib/ajo";
import { formatAmount, formatDuration, shortAddr } from "@/lib/format";
import { friendlyError } from "@/lib/errors";
import { config, explorer } from "@/lib/config";
import { getAccountStatus } from "@/lib/stellar";
import { Address, Alert, Button, Card, Eyebrow, Pill, Skeleton, TxLink } from "@/components/ui";
import { Countdown } from "@/components/Countdown";
import { useWallet } from "@/components/WalletProvider";
import { AccountPanel } from "@/components/AccountPanel";
import { RingLegend, RotationRing } from "@/components/RotationRing";

function DashboardSkeleton() {
  return (
    <div aria-busy className="space-y-8">
      <div className="space-y-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[1.05fr_1fr]">
        <div className="rounded-xl border border-line bg-ivory p-8">
          <Skeleton className="mx-auto aspect-square w-3/4 !rounded-full" />
        </div>
        <div className="space-y-4 rounded-xl border border-line bg-ivory p-6">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-2 w-full" />
          <Skeleton className="h-11 w-full" />
        </div>
      </div>
    </div>
  );
}

export default function CirclePage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const w = useWallet();

  const [circle, setCircle] = useState<Circle | null>(null);
  const [current, setCurrent] = useState<RoundStatus | null>(null);
  const [history, setHistory] = useState<RoundStatus[]>([]);
  const [records, setRecords] = useState<Record<string, MemberRecord>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"contribute" | "payout" | null>(null);
  const [txMsg, setTxMsg] = useState<React.ReactNode>(null);
  const [txErr, setTxErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!Number.isInteger(id) || id < 0) return setLoadError("Invalid circle id");
    try {
      const c = await ajo.getCircle(id);
      setCircle(c);
      const rounds = Array.from({ length: c.round }, (_, i) => i);
      const [cur, past, recs] = await Promise.all([
        c.status === "Active" ? ajo.getRoundStatus(id, c.round) : Promise.resolve(null),
        Promise.all(rounds.map((r) => ajo.getRoundStatus(id, r))),
        Promise.all(c.members.map((m) => ajo.getMemberRecord(id, m))),
      ]);
      setCurrent(cur);
      setHistory(past.reverse());
      setRecords(Object.fromEntries(c.members.map((m, i) => [m, recs[i]])));
      setLoadError(null);
    } catch (e) {
      setLoadError(friendlyError(e));
    }
  }, [id]);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000); // keep the dashboard live
    return () => clearInterval(t);
  }, [load]);

  if (loadError)
    return (
      <div className="mx-auto max-w-lg py-10 text-center">
        <p className="font-display text-3xl text-ink">We couldn’t open this circle</p>
        <div className="mt-5 text-left">
          <Alert tone="error">{loadError}</Alert>
        </div>
        <Link href="/" className="mt-6 inline-block text-sm text-clay-deep underline underline-offset-4">
          ← Back to all circles
        </Link>
      </div>
    );
  if (!circle) return <DashboardSkeleton />;

  const n = circle.members.length;
  const me = w.address;
  const done = circle.status === "Completed";
  const isMember = !!me && circle.members.includes(me);
  const iPaid = !!me && circle.paid.includes(me);
  const nextRecipient = circle.status === "Active" && circle.round + 1 < n ? circle.members[(circle.round + 1) % n] : null;
  const fullPot = circle.contribution * BigInt(n);
  const deadlinePassed = !!current && Date.now() / 1000 >= Number(current.deadline);

  async function contribute() {
    if (!me) return w.connect();
    if (w.wrongNetwork) return setTxErr("Switch Freighter to Testnet first.");
    setBusy("contribute");
    setTxErr(null);
    setTxMsg(null);
    try {
      // Pre-flight checks give clearer errors than a failed simulation.
      const s = await getAccountStatus(me);
      if (!s.exists) throw new Error("Account not found");
      if (!s.hasTrustline)
        throw new Error(`Missing trustline: add the ${config.tokenCode} trustline first (see wallet panel).`);
      if (s.tokenBalance < circle!.contribution)
        throw new Error(
          `Low balance: you have ${formatAmount(s.tokenBalance)} ${config.tokenCode}, need ${formatAmount(circle!.contribution)}.`,
        );
      const r = await ajo.contribute(me, id);
      setTxMsg(
        <>
          Contribution received. <TxLink hash={r.hash} />
        </>,
      );
      await load();
    } catch (e) {
      setTxErr(friendlyError(e, "contribute"));
    } finally {
      setBusy(null);
    }
  }

  async function payout() {
    if (!me) return w.connect();
    if (w.wrongNetwork) return setTxErr("Switch Freighter to Testnet first.");
    setBusy("payout");
    setTxErr(null);
    setTxMsg(null);
    try {
      const r = await ajo.payout(me, id);
      setTxMsg(
        <>
          Paid out {formatAmount(BigInt((r.returnValue as bigint | undefined) ?? 0))} {config.tokenCode} to{" "}
          {shortAddr(current!.recipient)}. <TxLink hash={r.hash} />
        </>,
      );
      await load();
    } catch (e) {
      setTxErr(friendlyError(e, "payout"));
    } finally {
      setBusy(null);
    }
  }

  const ringMembers = circle.members.map((m, i) => ({
    address: m,
    paid: !done && circle.paid.includes(m),
    defaulted: (records[m]?.missed ?? 0) > 0,
    received: i < circle.round,
  }));

  return (
    <div className="space-y-10">
      {/* ---------------------------------------------------- heading */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/" className="text-sm text-muted transition-colors hover:text-ink">
            ← All circles
          </Link>
          <h1 className="font-display mt-3 text-[2.6rem] leading-none text-ink sm:text-[3.2rem]">Circle №{circle.id}</h1>
          <p className="mt-3 text-[0.98rem] text-ink-soft">
            <span className="whitespace-nowrap">
              <span className="font-numeral text-lg text-ink">{formatAmount(circle.contribution)}</span> {config.tokenCode} per member
            </span>{" "}
            · <span className="whitespace-nowrap">{n} members</span> ·{" "}
            <span className="whitespace-nowrap">rounds of {formatDuration(Number(circle.period_secs))}</span>
          </p>
        </div>
        {done ? (
          <Pill tone="sage" dot className="!px-3 !py-1.5 !text-sm">
            Completed · all {n} pots paid
          </Pill>
        ) : (
          <Pill tone="clay" dot className="!px-3 !py-1.5 !text-sm">
            Round {circle.round + 1} of {n}
          </Pill>
        )}
      </div>

      {/* ---------------------------------------------------- ring + round */}
      <div className="grid gap-6 lg:grid-cols-[1.05fr_1fr]">
        <Card className="flex flex-col !p-4 sm:!p-6">
          <div className="flex items-center justify-between px-1">
            <Eyebrow>Rotation</Eyebrow>
            <span className="text-xs text-muted">clockwise from the top</span>
          </div>
          <RotationRing members={ringMembers} current={done ? -1 : circle.round} me={me} className="mt-2">
            {done ? (
              <>
                <p className="font-mono text-[0.62rem] uppercase tracking-[0.16em] text-sage">Complete</p>
                <p className="font-numeral mt-1 text-4xl leading-none text-ink sm:text-5xl">{n}/{n}</p>
                <p className="mt-1.5 text-xs text-muted">pots paid out</p>
              </>
            ) : (
              <>
                <p className="font-mono text-[0.62rem] uppercase tracking-[0.16em] text-muted">
                  Round {circle.round + 1} of {n}
                </p>
                <p className="font-numeral mt-1 text-4xl leading-none text-ink sm:text-5xl">{formatAmount(circle.pot)}</p>
                <p className="mt-1.5 text-xs text-muted">
                  of {formatAmount(fullPot)} {config.tokenCode}
                </p>
              </>
            )}
          </RotationRing>
          <RingLegend className="mt-auto justify-center border-t border-line px-1 pt-4" />
        </Card>

        <div className="space-y-6">
          {current ? (
            <Card className="space-y-6">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <Eyebrow>This round’s pot goes to</Eyebrow>
                  <p className="mt-2 flex items-center gap-2 text-lg text-ink">
                    <span className="font-numeral grid h-8 w-8 shrink-0 place-items-center rounded-full bg-clay text-sm text-white">
                      {circle.round + 1}
                    </span>
                    <Address value={current.recipient} chars={6} className="!text-[0.95rem]" />
                    {current.recipient === me && <Pill tone="clay">you</Pill>}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <Eyebrow>Deadline</Eyebrow>
                  <p className="font-numeral mt-2 text-xl text-ink">
                    <Countdown deadline={Number(current.deadline)} onElapsed={load} className="text-[1.15rem]" />
                  </p>
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-baseline justify-between text-sm">
                  <span className="text-ink-soft">
                    <span className="font-numeral text-lg text-ink">{current.paid.length}</span> of {n} paid
                  </span>
                  <span className="tnum text-muted">
                    {formatAmount(current.pot)} / {formatAmount(fullPot)} {config.tokenCode}
                  </span>
                </div>
                <div className="flex gap-1" aria-hidden>
                  {circle.members.map((m) => (
                    <span
                      key={m}
                      className={`h-2 flex-1 rounded-full transition-colors duration-500 ${
                        circle.paid.includes(m) ? "bg-sage" : deadlinePassed ? "bg-rust-wash" : "bg-sand"
                      }`}
                    />
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-2.5 sm:flex-row">
                {isMember && !iPaid && (
                  <Button onClick={contribute} loading={busy === "contribute"} className="flex-1 !py-3">
                    Contribute {formatAmount(circle.contribution)} {config.tokenCode}
                  </Button>
                )}
                {isMember && iPaid && (
                  <div className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-sage-wash px-4 py-3 text-sm font-medium text-sage">
                    <span aria-hidden>✓</span> You’ve paid this round
                  </div>
                )}
                {!me && (
                  <Button onClick={w.connect} variant="ink" className="flex-1 !py-3">
                    Connect wallet to contribute
                  </Button>
                )}
                <Button
                  variant={current.payout_ready && me ? (isMember && !iPaid ? "ink" : "primary") : "secondary"}
                  onClick={payout}
                  loading={busy === "payout"}
                  disabled={!current.payout_ready || !me}
                  className="flex-1 !py-3"
                  title={current.payout_ready ? "Anyone can trigger the payout" : "Waiting for all members or the deadline"}
                >
                  {current.payout_ready ? "Release payout" : "Payout locked"}
                </Button>
              </div>
              <p className="text-xs leading-relaxed text-muted">
                {current.payout_ready
                  ? "Payout is unlocked — anyone can release it. The pot can only go to this round’s member."
                  : `Unlocks when all ${n} members have paid or the deadline passes. Anyone can release it; the pot can only go to this round’s member.`}
                {me && !isMember && " You’re viewing as a non-member."}
              </p>
              {nextRecipient && (
                <p className="flex items-center gap-2 border-t border-line pt-4 text-sm text-muted">
                  Next up <span className="text-faint">→</span>
                  <span className="font-numeral text-ink">{circle.round + 2}</span>
                  <Address value={nextRecipient} className="text-ink-soft" />
                  {nextRecipient === me && <Pill tone="clay">you</Pill>}
                </p>
              )}
              {txMsg && <Alert tone="success">{txMsg}</Alert>}
              {txErr && <Alert tone="error">{txErr}</Alert>}
            </Card>
          ) : (
            <Card className="space-y-3">
              <Eyebrow>Circle complete</Eyebrow>
              <p className="font-display text-2xl leading-snug text-ink">
                Every member has taken their turn. {formatAmount(history.reduce((a, r) => a + BigInt(r.pot), BigInt(0)))}{" "}
                {config.tokenCode} moved through this circle.
              </p>
              <p className="text-sm text-muted">The full record stays on Stellar — see the history below.</p>
            </Card>
          )}
          {isMember && !done && <AccountPanel need={circle.contribution} />}
          <Card>
            <h2 className="font-display text-xl text-ink">Settled rounds</h2>
            {history.length === 0 ? (
              <p className="mt-4 text-sm text-muted">No rounds settled yet. The first payout will appear here.</p>
            ) : (
              <ol className="relative mt-5 space-y-5 border-l border-line pl-6">
                {history.map((r) => (
                  <li key={r.round} className="relative">
                    <span
                      aria-hidden
                      className={`absolute -left-[1.85rem] top-1 h-3 w-3 rounded-full border-2 border-ivory ${
                        r.defaulted.length ? "bg-rust" : "bg-sage"
                      }`}
                    />
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <p className="font-medium text-ink">Round {r.round + 1}</p>
                      <p className="text-sm text-ink-soft">
                        <span className="font-numeral text-base text-ink">{formatAmount(r.pot)}</span> {config.tokenCode} →{" "}
                        <Address value={r.recipient} />
                      </p>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Pill tone="sage">{r.paid.length} paid</Pill>
                      {r.defaulted.length > 0 ? (
                        r.defaulted.map((d) => (
                          <Pill key={d} tone="rust">
                            defaulted · {shortAddr(d)}
                          </Pill>
                        ))
                      ) : (
                        <Pill tone="neutral">no defaults</Pill>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
          <div className="flex flex-wrap gap-x-5 gap-y-1 px-1 text-xs text-muted">
            <span>
              Contract{" "}
              <a className="font-mono underline decoration-line-strong underline-offset-2 hover:text-ink" href={explorer.contract(config.contractId)} target="_blank" rel="noreferrer">
                {shortAddr(config.contractId, 5)}
              </a>
            </span>
            <span>
              Admin <Address value={circle.admin} chars={5} />
            </span>
            <span>Refreshes every 15 s</span>
          </div>
        </div>
      </div>

      {/* ---------------------------------------------------- members + history */}
      <div>
        <Card className="!p-0">
          <div className="flex items-baseline justify-between px-5 pb-3 pt-5 sm:px-6">
            <h2 className="font-display text-xl text-ink">Members</h2>
            <span className="text-xs text-muted">in payout order</span>
          </div>
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-y border-line text-left text-[0.7rem] uppercase tracking-[0.12em] text-muted">
                  <th className="py-2.5 pl-5 font-medium sm:pl-6">#</th>
                  <th className="font-medium">Member</th>
                  <th className="font-medium">This round</th>
                  <th className="text-right font-medium">Paid</th>
                  <th className="text-right font-medium">Missed</th>
                  <th className="pr-5 text-right font-medium sm:pr-6">Received</th>
                </tr>
              </thead>
              <tbody>
                {circle.members.map((m, i) => {
                  const rec = records[m];
                  const paidNow = circle.paid.includes(m);
                  return (
                    <tr key={m} className={`border-b border-line/70 last:border-0 ${m === me ? "bg-clay-wash/40" : ""}`}>
                      <td className="font-numeral py-3 pl-5 text-base text-muted sm:pl-6">{i + 1}</td>
                      <td>
                        <a className="text-ink hover:underline" href={explorer.account(m)} target="_blank" rel="noreferrer">
                          <Address value={m} chars={5} />
                        </a>
                        {m === me && <span className="ml-2 text-xs font-medium text-clay-deep">you</span>}
                        {i < circle.round && <span className="ml-2 text-xs text-muted">· took pot {i + 1}</span>}
                      </td>
                      <td>
                        {done ? (
                          <span className="text-faint">—</span>
                        ) : paidNow ? (
                          <Pill tone="sage" dot>Paid</Pill>
                        ) : deadlinePassed ? (
                          <Pill tone="rust" dot>Late</Pill>
                        ) : (
                          <Pill tone="ochre" dot>Pending</Pill>
                        )}
                      </td>
                      <td className="tnum text-right text-ink">{rec?.paid ?? "…"}</td>
                      <td className={`tnum text-right ${rec?.missed ? "font-semibold text-rust" : "text-ink"}`}>
                        {rec?.missed ?? "…"}
                      </td>
                      <td className="tnum pr-5 text-right text-ink sm:pr-6">{rec ? formatAmount(rec.received) : "…"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <ul className="border-t border-line sm:hidden">
            {circle.members.map((m, i) => {
              const rec = records[m];
              const paidNow = circle.paid.includes(m);
              return (
                <li key={m} className={`flex items-start gap-3 border-b border-line/70 px-5 py-3.5 last:border-0 ${m === me ? "bg-clay-wash/40" : ""}`}>
                  <span className="font-numeral w-5 pt-0.5 text-lg leading-none text-muted">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <a className="text-ink" href={explorer.account(m)} target="_blank" rel="noreferrer">
                        <Address value={m} chars={5} />
                        {m === me && <span className="ml-2 text-xs font-medium text-clay-deep">you</span>}
                      </a>
                      {done ? null : paidNow ? (
                        <Pill tone="sage" dot>Paid</Pill>
                      ) : deadlinePassed ? (
                        <Pill tone="rust" dot>Late</Pill>
                      ) : (
                        <Pill tone="ochre" dot>Pending</Pill>
                      )}
                    </div>
                    <p className="tnum mt-1 text-xs text-muted">
                      paid {rec?.paid ?? "…"} · <span className={rec?.missed ? "font-semibold text-rust" : ""}>missed {rec?.missed ?? "…"}</span> · received{" "}
                      {rec ? formatAmount(rec.received) : "…"}
                      {i < circle.round && " · took pot " + (i + 1)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>

      </div>
    </div>
  );
}
