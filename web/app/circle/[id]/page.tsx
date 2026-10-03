"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ajo, Circle, MemberState, RoundStatus, slotTarget } from "@/lib/ajo";
import { formatAmount, formatDuration, parseAmount, shortAddr } from "@/lib/format";
import { friendlyError, type ErrorContext } from "@/lib/errors";
import { config, explorer } from "@/lib/config";
import { getAccountStatus } from "@/lib/stellar";
import { isKnownToken } from "@/lib/token";
import { Address, Alert, Button, Card, Eyebrow, Pill, Skeleton, TxLink } from "@/components/ui";
import { Countdown } from "@/components/Countdown";
import { useWallet } from "@/components/WalletProvider";
import { AccountPanel } from "@/components/AccountPanel";
import { RingLegend, RotationRing } from "@/components/RotationRing";
import { CountUp, SuccessCheck } from "@/components/motion";
import { TokenLabel } from "@/components/TokenLabel";

const ZERO = BigInt(0);
const sum = (xs: bigint[]) => xs.reduce((a, b) => a + BigInt(b), ZERO);
const amt = (v: bigint) => `${formatAmount(v)} ${config.tokenCode}`;

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

type Busy = "contribute" | "settle" | "accept" | "collateral" | "claim" | "cancel" | "unwind";

export default function CirclePage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const w = useWallet();

  const [circle, setCircle] = useState<Circle | null>(null);
  const [current, setCurrent] = useState<RoundStatus | null>(null);
  const [history, setHistory] = useState<RoundStatus[]>([]);
  const [states, setStates] = useState<Record<string, MemberState>>({});
  const [required, setRequired] = useState<Record<string, bigint>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy | null>(null);
  const [txMsg, setTxMsg] = useState<React.ReactNode>(null);
  const [txErr, setTxErr] = useState<string | null>(null);
  const [collInput, setCollInput] = useState<string>("");
  const [now, setNow] = useState(0);

  const load = useCallback(async () => {
    if (!Number.isInteger(id) || id < 0) return setLoadError("Invalid circle id");
    try {
      const c = await ajo.getCircle(id);
      const rounds = Array.from({ length: c.round }, (_, i) => i);
      const [cur, past, sts, req] = await Promise.all([
        c.status === "Active" ? ajo.getRoundStatus(id, c.round) : Promise.resolve(null),
        Promise.all(rounds.map((r) => ajo.getRoundStatus(id, r))),
        Promise.all(c.members.map((m) => ajo.getMemberState(id, m))),
        Promise.all(c.members.map((m) => ajo.requiredCollateral(id, m))),
      ]);
      setCircle(c);
      setCurrent(cur);
      setHistory(past.reverse());
      setStates(Object.fromEntries(c.members.map((m, i) => [m, sts[i]])));
      setRequired(Object.fromEntries(c.members.map((m, i) => [m, req[i]])));
      setLoadError(null);
    } catch (e) {
      setLoadError(friendlyError(e));
    }
  }, [id]);

  useEffect(() => {
    const tick = () => setNow(Math.floor(Date.now() / 1000));
    const first = setTimeout(() => {
      tick();
      void load();
    }, 0);
    const t = setInterval(() => void load(), 15000); // keep the dashboard live
    const clock = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
      clearInterval(clock);
    };
  }, [load]);

  if (loadError)
    return (
      <div className="mx-auto max-w-lg py-10 text-center">
        <p className="font-display text-3xl text-ink">We couldn’t open this circle</p>
        <div className="mt-5 text-left">
          <Alert tone="error">{loadError}</Alert>
        </div>
        <Link href="/" className="mt-6 inline-flex min-h-11 items-center text-sm text-clay-deep underline underline-offset-4">
          ← Back to all circles
        </Link>
      </div>
    );
  if (!circle) return <DashboardSkeleton />;

  const c = circle.contribution;
  const n = circle.members.length;
  const me = w.address;
  const status = circle.status;
  const forming = status === "Forming";
  const active = status === "Active";
  const done = status === "Completed";
  const cancelled = status === "Cancelled";
  const knownToken = isKnownToken(circle.token);
  const isMember = !!me && circle.members.includes(me);
  const mine = me ? states[me] : undefined;
  const iPaid = !!me && circle.paid.includes(me);
  const nextRecipient = active && circle.round + 1 < n ? circle.members[circle.round + 1] : null;
  const fullPot = c * BigInt(n);
  const deadline = current ? Number(current.deadline) : 0;
  const deadlinePassed = !!current && now >= deadline;
  const unwindAt = current ? deadline + 2 * Number(circle.period_secs) : 0;
  const canUnwind = active && !!current && now > 0 && now >= unwindAt;
  const joinDeadline = Number(circle.join_deadline);
  const joinClosed = now > joinDeadline;
  const canCancel = forming && now > 0 && joinClosed && circle.accepted < n;
  const myTarget = mine ? slotTarget(c, n, mine.slot) : ZERO;
  const myRequired = me ? (required[me] ?? ZERO) : ZERO;

  let collAmount: bigint | null = null;
  let collErr: string | null = null;
  if (collInput.trim()) {
    try {
      collAmount = parseAmount(collInput);
      if (collAmount < ZERO) collErr = "Can't be negative";
      else if (collAmount % c !== ZERO) collErr = `Must be a whole number of contributions (steps of ${formatAmount(c)})`;
    } catch (e) {
      collErr = (e as Error).message;
    }
  } else collAmount = ZERO;

  async function run(kind: Busy, ctx: ErrorContext, fn: (me: string) => Promise<React.ReactNode>) {
    if (!me) return w.connect();
    if (w.wrongNetwork) return setTxErr("Switch your wallet to Testnet first.");
    setBusy(kind);
    setTxErr(null);
    setTxMsg(null);
    try {
      setTxMsg(await fn(me));
      setCollInput("");
      await load();
    } catch (e) {
      setTxErr(friendlyError(e, ctx));
    } finally {
      setBusy(null);
    }
  }

  async function preflight(addr: string, need: bigint) {
    // Pre-flight checks give clearer errors than a failed simulation.
    if (need <= ZERO) return;
    const s = await getAccountStatus(addr);
    if (!s.exists) throw new Error("Account not found");
    if (!s.hasTrustline) throw new Error(`Missing trustline: add the ${config.tokenCode} trustline first (see wallet panel).`);
    if (s.tokenBalance < need)
      throw new Error(`Low balance: you have ${amt(s.tokenBalance)}, need ${amt(need)}.`);
  }

  const contribute = () =>
    run("contribute", "contribute", async (addr) => {
      await preflight(addr, c);
      const r = await ajo.contribute(addr, id);
      return (
        <>
          Contribution received. <TxLink hash={r.hash} />
        </>
      );
    });

  const settle = () =>
    run("settle", "payout", async (addr) => {
      const r = await ajo.settle(addr, id);
      const gross = BigInt((r.returnValue as bigint | undefined) ?? 0);
      return (
        <>
          Round settled: {amt(gross)} credited to {shortAddr(current!.recipient)} (they claim it themselves). <TxLink hash={r.hash} />
        </>
      );
    });

  const accept = () =>
    run("accept", "accept", async (addr) => {
      const x = collAmount ?? ZERO;
      await preflight(addr, x);
      const r = await ajo.accept(addr, id, x);
      return (
        <>
          You accepted slot {mine!.slot + 1}
          {x > ZERO ? ` and posted ${amt(x)} collateral` : ""}. <TxLink hash={r.hash} />
        </>
      );
    });

  const postCollateral = () =>
    run("collateral", "collateral", async (addr) => {
      const x = collAmount ?? ZERO;
      await preflight(addr, x);
      const r = await ajo.postCollateral(addr, id, x);
      return (
        <>
          Posted {amt(x)} collateral. <TxLink hash={r.hash} />
        </>
      );
    });

  const claim = () =>
    run("claim", "claim", async (addr) => {
      const r = await ajo.claim(addr, id);
      return (
        <>
          Claimed {amt(BigInt((r.returnValue as bigint | undefined) ?? 0))} to your wallet. <TxLink hash={r.hash} />
        </>
      );
    });

  const cancel = () =>
    run("cancel", "read", async (addr) => {
      const r = await ajo.cancel(addr, id);
      return (
        <>
          Circle cancelled. Posted collateral is now claimable. <TxLink hash={r.hash} />
        </>
      );
    });

  const unwind = () =>
    run("unwind", "read", async (addr) => {
      const r = await ajo.unwind(addr, id);
      return (
        <>
          Circle unwound. Each member&apos;s refund is now claimable. <TxLink hash={r.hash} />
        </>
      );
    });

  const ringMembers = circle.members.map((m) => ({
    address: m,
    paid: active && circle.paid.includes(m),
    defaulted: (states[m]?.missed ?? 0) > 0,
    received: !!states[m]?.received,
  }));

  const collateralInput = (max: bigint, label: string) => (
    <div>
      <label className="block text-sm text-ink-soft">
        {label}
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 basis-40">
            <input
              inputMode="decimal"
              value={collInput}
              onChange={(e) => setCollInput(e.target.value)}
              placeholder="0"
              aria-invalid={!!collErr}
              className="min-h-11 w-full rounded-lg border border-line-strong bg-white/70 px-3 py-2 pr-16 font-numeral text-lg text-ink focus:border-clay focus:outline-none"
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center font-mono text-xs text-muted">
              {config.tokenCode}
            </span>
          </div>
          <Button type="button" variant="secondary" className="!px-3 !py-2" onClick={() => setCollInput("0")}>
            0
          </Button>
          <Button type="button" variant="secondary" className="!px-3 !py-2" onClick={() => setCollInput(formatAmount(max, 7).replace(/,/g, ""))} disabled={max <= ZERO}>
            Full ({formatAmount(max)})
          </Button>
        </div>
      </label>
      {collErr && <p className="mt-1 text-xs text-rust">{collErr}</p>}
      {!collErr && collAmount !== null && collAmount > max && (
        <p className="mt-1 text-xs text-rust">At most {amt(max)}.</p>
      )}
    </div>
  );
  const collOk = (max: bigint, allowZero: boolean) =>
    !collErr && collAmount !== null && collAmount <= max && (allowZero || collAmount > ZERO);

  const debtsOf = (m: string) => (states[m]?.debts ?? []).filter((d) => BigInt(d.amount) > ZERO);

  const settled = (cls: string) => (
    <Card className={`rise ${cls}`} style={{ "--d": "260ms" } as React.CSSProperties}>
      <h2 className="font-display text-xl text-ink">Settled rounds</h2>
      {history.length === 0 ? (
        <p className="mt-4 text-sm text-muted">No rounds settled yet. Each settled round will appear here.</p>
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
                  <span className="font-numeral text-base text-ink">{formatAmount(r.pot)}</span> {config.tokenCode} gross →{" "}
                  <Address value={r.recipient} />
                </p>
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted min-[420px]:grid-cols-3">
                {(
                  [
                    ["From collateral", r.covered_from_collateral],
                    ["New debts", r.debts_created],
                    ["Repaid debts", r.to_debts],
                    ["Withheld", r.withheld],
                    ["To claimable", r.to_claimable],
                  ] as [string, bigint][]
                ).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2 min-[420px]:block">
                    <dt>{k}</dt>
                    <dd className="tnum text-ink">{formatAmount(v)}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Pill tone="sage">{r.paid.length} paid</Pill>
                {r.defaulted.length > 0 ? (
                  r.defaulted.map((d) => (
                    <Pill key={d} tone="rust">
                      missed · {shortAddr(d)}
                    </Pill>
                  ))
                ) : (
                  <Pill tone="neutral">no misses</Pill>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );

  const statusPill = forming ? (
    <Pill tone="ochre" dot className="!px-3 !py-1.5 !text-sm">
      Waiting for members · {circle.accepted}/{n} accepted
    </Pill>
  ) : active ? (
    <Pill tone="clay" dot className="!px-3 !py-1.5 !text-sm">
      Round {circle.round + 1} of {n}
    </Pill>
  ) : done ? (
    <Pill tone="sage" dot className="!px-3 !py-1.5 !text-sm">
      Completed · all {n} rounds settled
    </Pill>
  ) : (
    <Pill tone="neutral" dot className="!px-3 !py-1.5 !text-sm">
      Cancelled
    </Pill>
  );

  return (
    <div className="content-in space-y-10">
      {/* ---------------------------------------------------- heading */}
      <div className="rise flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <Link href="/" className="-ml-1 inline-flex min-h-11 items-center px-1 text-sm text-muted transition-colors hover:text-ink">
            ← All circles
          </Link>
          <h1 className="font-display mt-1 text-[2.6rem] leading-none text-ink sm:text-[3.2rem]">Circle №{circle.id}</h1>
          <p className="mt-3 text-[0.98rem] text-ink-soft">
            <span className="whitespace-nowrap">
              <span className="font-numeral text-lg text-ink">{formatAmount(c)}</span> {config.tokenCode} per member
            </span>{" "}
            · <span className="whitespace-nowrap">{n} members</span> ·{" "}
            <span className="whitespace-nowrap">rounds of {formatDuration(Number(circle.period_secs))}</span>
          </p>
          <p className="mt-1 text-xs text-muted">
            Token: <TokenLabel /> · the project&apos;s own test asset, not Circle&apos;s USDC
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {!knownToken && (
            <Pill tone="rust" className="!px-3 !py-1.5 !text-sm">
              Unknown token
            </Pill>
          )}
          {statusPill}
        </div>
      </div>

      {!knownToken && (
        <Alert tone="error" title="Unknown token">
          This circle uses <code className="break-all font-mono text-xs">{circle.token}</code>, not the configured test USDC.
          Contribute, accept and collateral are disabled.
        </Alert>
      )}

      {/* ---------------------------------------------------- claim (everywhere) */}
      {isMember && mine && mine.claimable > ZERO && (
        <Card className="rise flex flex-col gap-3 border-sage/40 bg-sage-wash/40 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Eyebrow>Ready to claim</Eyebrow>
            <p className="mt-1 text-sm text-ink-soft">
              Settling never sends tokens; your share waits here until you claim it.
              {mine.total_claimed > ZERO && ` Claimed so far: ${amt(mine.total_claimed)}.`}
            </p>
          </div>
          <Button onClick={claim} loading={busy === "claim"} className="!py-3 sm:min-w-[200px]">
            Claim {amt(mine.claimable)}
          </Button>
        </Card>
      )}

      {/* ---------------------------------------------------- ring + round */}
      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[1.05fr_1fr]">
        <Card className="rise order-2 flex flex-col !p-4 sm:!p-6 lg:order-none" style={{ "--d": "140ms" } as React.CSSProperties}>
          <div className="flex items-center justify-between px-1">
            <Eyebrow>Rotation</Eyebrow>
            <span className="text-xs text-muted">clockwise from the top</span>
          </div>
          <RotationRing members={ringMembers} current={active ? circle.round : -1} me={me} className="mt-2 max-w-[520px]">
            {done ? (
              <>
                <p className="font-mono text-xs uppercase tracking-[0.16em] text-sage">Complete</p>
                <p className="font-numeral mt-1 text-4xl leading-none text-ink sm:text-5xl">{n}/{n}</p>
                <p className="mt-1.5 text-xs text-muted">rounds settled</p>
              </>
            ) : forming ? (
              <>
                <p className="font-mono text-xs uppercase tracking-[0.16em] text-muted">Accepted</p>
                <p className="font-numeral mt-1 text-4xl leading-none text-ink sm:text-5xl">
                  {circle.accepted}/{n}
                </p>
                <p className="mt-1.5 text-xs text-muted">members</p>
              </>
            ) : cancelled ? (
              <>
                <p className="font-mono text-xs uppercase tracking-[0.16em] text-muted">Cancelled</p>
                <p className="mt-1.5 text-xs text-muted">refunds are claimable</p>
              </>
            ) : (
              <>
                <p className="font-mono text-xs uppercase tracking-[0.16em] text-muted">
                  Round {circle.round + 1} of {n}
                </p>
                <p className="font-numeral mt-1 text-4xl leading-none text-ink sm:text-5xl">
                  <CountUp value={circle.pot} />
                </p>
                <p className="mt-1.5 text-xs text-muted">
                  of {formatAmount(fullPot)} {config.tokenCode}
                </p>
              </>
            )}
          </RotationRing>
          <RingLegend className="mt-auto justify-center border-t border-line px-1 pt-4" />
        </Card>

        <div className="contents lg:flex lg:flex-col lg:gap-6">
          {forming && (
            <Card className="rise order-1 space-y-5 lg:order-none" style={{ "--d": "60ms" } as React.CSSProperties}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <Eyebrow>Waiting for members</Eyebrow>
                  <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                    The circle starts when all {n} members accept their slot. Nobody is enrolled without signing.
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <Eyebrow>Join closes</Eyebrow>
                  <p className="font-numeral mt-2 text-xl text-ink">
                    <Countdown deadline={joinDeadline} onElapsed={load} className="text-[1.15rem]" />
                  </p>
                </div>
              </div>
              <ul className="space-y-1.5">
                {circle.members.map((m, i) => (
                  <li key={m} className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="font-numeral w-5 text-muted">{i + 1}</span>
                      <Address value={m} chars={5} />
                      {m === me && <span className="text-xs font-medium text-clay-deep">you</span>}
                    </span>
                    {states[m]?.accepted ? (
                      <Pill tone="sage" dot>
                        Accepted{states[m].collateral > ZERO ? ` · ${formatAmount(states[m].collateral)}` : ""}
                      </Pill>
                    ) : (
                      <Pill tone="ochre" dot>Pending</Pill>
                    )}
                  </li>
                ))}
              </ul>
              {isMember && mine && !mine.accepted && !joinClosed && (
                <div className="space-y-3 rounded-lg border border-line bg-white/60 p-3.5">
                  <p className="text-sm text-ink-soft">
                    You&apos;re slot <b>{mine.slot + 1}</b> (pot in round {mine.slot + 1}). Collateral target for your slot:{" "}
                    <b>{amt(myTarget)}</b>. Early slots post more collateral; anything you don&apos;t post is held back from your payout.
                  </p>
                  {collateralInput(myTarget, "Collateral to post now (optional)")}
                  <Button
                    onClick={accept}
                    loading={busy === "accept"}
                    disabled={!knownToken || !collOk(myTarget, true)}
                    className="w-full !py-3"
                  >
                    Accept slot {mine.slot + 1}
                    {collAmount && collAmount > ZERO ? ` + post ${amt(collAmount)}` : ""}
                  </Button>
                </div>
              )}
              {isMember && mine?.accepted && (
                <div className="flex items-center gap-2 rounded-lg bg-sage-wash px-4 py-3 text-sm font-medium text-sage">
                  <SuccessCheck className="h-[1.1rem] w-[1.1rem]" /> You accepted your slot
                </div>
              )}
              {!me && (
                <Button onClick={w.connect} variant="ink" className="w-full !py-3">
                  Connect wallet to accept
                </Button>
              )}
              {canCancel && (
                <div className="space-y-2 border-t border-line pt-4">
                  <p className="text-sm text-muted">
                    The join window closed before everyone accepted. Anyone can cancel; posted collateral becomes claimable.
                  </p>
                  <Button variant="secondary" onClick={cancel} loading={busy === "cancel"} disabled={!me} className="w-full !py-3">
                    Cancel circle
                  </Button>
                </div>
              )}
              {txMsg && <Alert tone="success">{txMsg}</Alert>}
              {txErr && <Alert tone="error">{txErr}</Alert>}
            </Card>
          )}

          {active && current && (
            <Card className="rise order-1 space-y-6 lg:order-none" style={{ "--d": "60ms" } as React.CSSProperties}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <Eyebrow>
                    <span className="sm:hidden">Pot goes to</span>
                    <span className="hidden sm:inline">This round’s pot goes to</span>
                  </Eyebrow>
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
                    <Countdown deadline={deadline} onElapsed={load} className="text-[1.15rem]" />
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
                  <Button onClick={contribute} loading={busy === "contribute"} disabled={!knownToken} className="flex-1 !py-3">
                    Contribute {amt(c)}
                  </Button>
                )}
                {isMember && iPaid && (
                  <div className="alert-in flex flex-1 items-center justify-center gap-2 rounded-lg bg-sage-wash px-4 py-3 text-sm font-medium text-sage">
                    <SuccessCheck className="h-[1.1rem] w-[1.1rem]" /> You’ve paid this round
                  </div>
                )}
                {!me && (
                  <Button onClick={w.connect} variant="ink" className="flex-1 !py-3">
                    Connect wallet to contribute
                  </Button>
                )}
                <Button
                  variant={current.payout_ready && me ? (isMember && !iPaid ? "ink" : "primary") : "secondary"}
                  onClick={settle}
                  loading={busy === "settle"}
                  disabled={!current.payout_ready || !me}
                  className="flex-1 !py-3"
                  title={current.payout_ready ? "Anyone can settle the round" : "Waiting for all members or the deadline"}
                >
                  {current.payout_ready ? "Settle round" : "Settle locked"}
                </Button>
              </div>
              <p className="text-xs leading-relaxed text-muted">
                {current.payout_ready
                  ? "Anyone can settle now. Misses are covered from the defaulter’s collateral, the rest becomes a debt to this round’s recipient. Settling moves no tokens: each member claims their own balance."
                  : `Settling unlocks when all ${n} members have paid or the deadline passes. Anyone can do it.`}
                {me && !isMember && " You’re viewing as a non-member."}
              </p>
              {isMember && mine && myRequired > ZERO && (
                <div className="space-y-3 rounded-lg border border-line bg-white/60 p-3.5">
                  <p className="text-sm text-ink-soft">
                    Collateral still missing for your slot: <b>{amt(myRequired)}</b>. You can post it now; otherwise it is
                    withheld from your {mine.received ? "next incoming funds" : "payout"}.
                  </p>
                  {collateralInput(myRequired, "Post collateral")}
                  <Button
                    variant="secondary"
                    onClick={postCollateral}
                    loading={busy === "collateral"}
                    disabled={!knownToken || !collOk(myRequired, false)}
                    className="w-full !py-3"
                  >
                    Post collateral
                  </Button>
                </div>
              )}
              {canUnwind && (
                <div className="space-y-2 rounded-lg border border-rust/30 bg-rust-wash/40 p-3.5">
                  <p className="text-sm text-ink-soft">
                    This round has gone 2 periods past its deadline without being settled. Anyone can unwind the circle:
                    everything it holds (this round&apos;s pot and all collateral) is refunded pro rata to what each member
                    put in and hasn&apos;t got back. Open debts are cancelled. Settling is still possible until someone unwinds.
                  </p>
                  <Button variant="secondary" onClick={unwind} loading={busy === "unwind"} disabled={!me} className="w-full !py-3">
                    Unwind circle
                  </Button>
                </div>
              )}
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
          )}

          {(done || cancelled) && (
            <Card className="rise order-1 space-y-3 lg:order-none">
              <Eyebrow>{done ? "Circle complete" : "Circle cancelled"}</Eyebrow>
              <p className="font-display text-2xl leading-snug text-ink">
                {done
                  ? `Every member has had their turn. ${amt(sum(history.map((r) => r.pot)))} moved through this circle.`
                  : circle.round === 0 && history.length === 0
                    ? "This circle never started, or was unwound in its first round."
                    : `This circle was unwound after ${history.length} settled round${history.length === 1 ? "" : "s"}.`}
              </p>
              <p className="text-sm text-muted">
                {done
                  ? "All collateral has been released. Anything still owed to you shows as claimable."
                  : "Refunds were credited to members' claimable balances."}{" "}
                Open debts at the end are recorded on-chain but no longer enforced.
              </p>
              {txMsg && <Alert tone="success">{txMsg}</Alert>}
              {txErr && <Alert tone="error">{txErr}</Alert>}
            </Card>
          )}
          {isMember && (forming || active) && (
            <div className="rise order-3 lg:order-none" style={{ "--d": "200ms" } as React.CSSProperties}>
              <AccountPanel need={forming ? (collAmount ?? ZERO) : c} />
            </div>
          )}
          {settled("hidden lg:block")}
          <div className="order-4 flex flex-wrap items-center gap-x-5 px-1 text-xs text-muted lg:order-none">
            <span>
              Contract{" "}
              <a className="inline-flex min-h-11 items-center font-mono underline decoration-line-strong underline-offset-2 hover:text-ink" href={explorer.contract(config.contractId)} target="_blank" rel="noreferrer">
                {shortAddr(config.contractId, 5)}
              </a>
            </span>
            <span>
              Creator <Address value={circle.admin} chars={5} /> (no special powers)
            </span>
            <span>Refreshes every 15 s</span>
          </div>
        </div>
      </div>

      {/* ---------------------------------------------------- members + history */}
      <div className="space-y-6">
        <Card className="rise !p-0" style={{ "--d": "260ms" } as React.CSSProperties}>
          <div className="flex items-baseline justify-between px-5 pb-3 pt-5 sm:px-6">
            <h2 className="font-display text-xl text-ink">Members</h2>
            <span className="text-xs text-muted">in payout order · amounts in {config.tokenCode}</span>
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-y border-line text-left text-xs uppercase tracking-[0.12em] text-muted">
                  <th className="py-2.5 pl-5 font-medium sm:pl-6">Slot</th>
                  <th className="font-medium">Member</th>
                  <th className="font-medium">This round</th>
                  <th className="text-right font-medium">Paid / missed</th>
                  <th className="text-right font-medium">Collateral</th>
                  <th className="text-right font-medium">Still needed</th>
                  <th className="pl-3 font-medium">Open debts</th>
                  <th className="pr-5 text-right font-medium sm:pr-6">Claimable</th>
                </tr>
              </thead>
              <tbody>
                {circle.members.map((m, i) => {
                  const st = states[m];
                  const debts = debtsOf(m);
                  return (
                    <tr key={m} className={`border-b border-line/70 align-top last:border-0 ${m === me ? "bg-clay-wash/40" : ""}`}>
                      <td className="font-numeral py-3 pl-5 text-base text-muted sm:pl-6">{i + 1}</td>
                      <td>
                        <a className="inline-flex min-h-11 items-center text-ink hover:underline" href={explorer.account(m)} target="_blank" rel="noreferrer">
                          <Address value={m} chars={5} />
                        </a>
                        {m === me && <span className="ml-2 text-xs font-medium text-clay-deep">you</span>}
                        {st?.received && <span className="ml-2 text-xs text-muted">· had pot {i + 1}</span>}
                      </td>
                      <td className="py-3">
                        <MemberRoundPill status={status} accepted={!!st?.accepted} paid={circle.paid.includes(m)} late={deadlinePassed} />
                      </td>
                      <td className="tnum py-3 text-right text-ink">
                        {st ? (
                          <>
                            {st.paid} / <span className={st.missed ? "font-semibold text-rust" : ""}>{st.missed}</span>
                          </>
                        ) : (
                          "…"
                        )}
                      </td>
                      <td className="tnum py-3 text-right text-ink">{st ? formatAmount(st.collateral) : "…"}</td>
                      <td className="tnum py-3 text-right text-ink">{required[m] !== undefined ? formatAmount(required[m]) : "…"}</td>
                      <td className="py-3 pl-3 text-xs">
                        {debts.length === 0 ? (
                          <span className="text-faint">—</span>
                        ) : (
                          debts.map((d, k) => (
                            <span key={k} className="block whitespace-nowrap text-rust">
                              owes {shortAddr(d.creditor)} {formatAmount(d.amount)} (r{d.round + 1})
                            </span>
                          ))
                        )}
                      </td>
                      <td className="tnum py-3 pr-5 text-right text-ink sm:pr-6">{st ? formatAmount(st.claimable) : "…"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <ul className="border-t border-line md:hidden">
            {circle.members.map((m, i) => {
              const st = states[m];
              const debts = debtsOf(m);
              return (
                <li key={m} className={`flex items-start gap-3 border-b border-line/70 px-4 py-3.5 last:border-0 min-[360px]:px-5 ${m === me ? "bg-clay-wash/40" : ""}`}>
                  <span className="font-numeral w-5 pt-0.5 text-lg leading-none text-muted">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                      <a className="-my-2.5 inline-flex min-h-11 items-center text-ink" href={explorer.account(m)} target="_blank" rel="noreferrer">
                        <Address value={m} chars={4} />
                        {m === me && <span className="ml-2 text-xs font-medium text-clay-deep">you</span>}
                      </a>
                      <MemberRoundPill status={status} accepted={!!st?.accepted} paid={circle.paid.includes(m)} late={deadlinePassed} />
                    </div>
                    <dl className="tnum mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-muted">
                      <dt>Paid / missed</dt>
                      <dd className="text-right text-ink">
                        {st ? `${st.paid} / ${st.missed}` : "…"}
                      </dd>
                      <dt>Collateral</dt>
                      <dd className="text-right text-ink">{st ? formatAmount(st.collateral) : "…"}</dd>
                      <dt>Still needed</dt>
                      <dd className="text-right text-ink">{required[m] !== undefined ? formatAmount(required[m]) : "…"}</dd>
                      <dt>Claimable</dt>
                      <dd className="text-right text-ink">{st ? formatAmount(st.claimable) : "…"}</dd>
                    </dl>
                    {debts.map((d, k) => (
                      <p key={k} className="mt-1 break-words text-xs text-rust">
                        owes {shortAddr(d.creditor)} {formatAmount(d.amount)} (round {d.round + 1})
                      </p>
                    ))}
                    {st?.received && <p className="mt-1 text-xs text-muted">had pot {i + 1}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
        {settled("lg:hidden")}
      </div>
    </div>
  );
}

function MemberRoundPill({
  status,
  accepted,
  paid,
  late,
}: {
  status: Circle["status"];
  accepted: boolean;
  paid: boolean;
  late: boolean;
}) {
  if (status === "Forming")
    return accepted ? (
      <Pill tone="sage" dot>Accepted</Pill>
    ) : (
      <Pill tone="ochre" dot>Pending</Pill>
    );
  if (status !== "Active") return <span className="text-faint">—</span>;
  if (paid) return <Pill tone="sage" dot>Paid</Pill>;
  if (late) return <Pill tone="rust" dot>Late</Pill>;
  return <Pill tone="ochre" dot>Pending</Pill>;
}
