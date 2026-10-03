"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ajo, Circle, MemberRecord, RoundStatus } from "@/lib/ajo";
import { formatAmount, formatDuration, shortAddr } from "@/lib/format";
import { friendlyError } from "@/lib/errors";
import { config, explorer } from "@/lib/config";
import { getAccountStatus } from "@/lib/stellar";
import { Alert, Badge, Button, Card, Spinner, TxLink } from "@/components/ui";
import { Countdown } from "@/components/Countdown";
import { useWallet } from "@/components/WalletProvider";
import { AccountPanel } from "@/components/AccountPanel";

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

  if (loadError) return <Alert tone="error">{loadError}</Alert>;
  if (!circle) return <Spinner label={`Loading circle #${params.id}…`} />;

  const n = circle.members.length;
  const me = w.address;
  const isMember = !!me && circle.members.includes(me);
  const iPaid = !!me && circle.paid.includes(me);
  const nextRecipient =
    circle.status === "Active" && circle.round + 1 < n ? circle.members[(circle.round + 1) % n] : null;

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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/" className="text-sm text-stone-500 hover:underline">
            ← All circles
          </Link>
          <h1 className="text-3xl font-black">Circle #{circle.id}</h1>
          <p className="text-stone-600">
            {formatAmount(circle.contribution)} {config.tokenCode} per member · {n} members · rounds of{" "}
            {formatDuration(Number(circle.period_secs))}
          </p>
        </div>
        {circle.status === "Completed" ? (
          <Badge tone="stone">Completed — all {n} rounds paid out</Badge>
        ) : (
          <Badge tone="emerald">
            Round {circle.round + 1} of {n}
          </Badge>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          {current && (
            <Card className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="rounded-xl bg-emerald-50 p-4">
                  <p className="text-xs font-semibold uppercase text-emerald-800">This round&apos;s recipient</p>
                  <p className="mt-1 font-mono text-sm font-bold" title={current.recipient}>
                    {shortAddr(current.recipient, 6)}
                    {current.recipient === me && " (you)"}
                  </p>
                </div>
                <div className="rounded-xl bg-amber-50 p-4">
                  <p className="text-xs font-semibold uppercase text-amber-900">Pot so far</p>
                  <p className="mt-1 text-xl font-black">
                    {formatAmount(current.pot)}{" "}
                    <span className="text-sm text-stone-500">
                      / {formatAmount(circle.contribution * BigInt(n))}
                    </span>
                  </p>
                </div>
                <div className="rounded-xl bg-stone-100 p-4">
                  <p className="text-xs font-semibold uppercase text-stone-600">Deadline in</p>
                  <p className="mt-1 text-xl">
                    <Countdown deadline={Number(current.deadline)} onElapsed={load} />
                  </p>
                </div>
              </div>
              <div>
                <div className="mb-1 flex justify-between text-sm">
                  <span className="font-semibold">
                    {current.paid.length}/{n} paid
                  </span>
                  {nextRecipient && (
                    <span className="text-stone-500">
                      Next up: <span className="font-mono">{shortAddr(nextRecipient)}</span>
                    </span>
                  )}
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-stone-100">
                  <div
                    className="h-full rounded-full bg-emerald-600 transition-all"
                    style={{ width: `${(current.paid.length / n) * 100}%` }}
                  />
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                {isMember && !iPaid && (
                  <Button onClick={contribute} loading={busy === "contribute"} className="flex-1">
                    Contribute {formatAmount(circle.contribution)} {config.tokenCode}
                  </Button>
                )}
                {isMember && iPaid && (
                  <div className="flex-1 rounded-xl bg-emerald-50 px-4 py-2.5 text-center text-sm font-semibold text-emerald-800">
                    ✓ You&apos;ve paid this round
                  </div>
                )}
                {!me && (
                  <Button onClick={w.connect} className="flex-1">
                    Connect Freighter to contribute
                  </Button>
                )}
                <Button
                  variant="secondary"
                  onClick={payout}
                  loading={busy === "payout"}
                  disabled={!current.payout_ready || !me}
                  className="flex-1"
                  title={current.payout_ready ? "Anyone can trigger the payout" : "Waiting for all members or the deadline"}
                >
                  {current.payout_ready ? "Trigger payout" : "Payout locked"}
                </Button>
              </div>
              {!current.payout_ready && (
                <p className="text-xs text-stone-500">
                  Payout unlocks when all {n} members have paid or the deadline passes. Anyone can
                  trigger it — the pot always goes to the round&apos;s recipient.
                </p>
              )}
              {me && !isMember && (
                <p className="text-xs text-stone-500">You&apos;re not a member of this circle (view only).</p>
              )}
              {txMsg && <Alert tone="success">{txMsg}</Alert>}
              {txErr && <Alert tone="error">{txErr}</Alert>}
            </Card>
          )}

          <Card>
            <h2 className="mb-3 text-lg font-bold">Members &amp; history</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-stone-500">
                    <th className="py-2">#</th>
                    <th>Member</th>
                    <th>This round</th>
                    <th className="text-right">Paid</th>
                    <th className="text-right">Missed</th>
                    <th className="text-right">Received</th>
                  </tr>
                </thead>
                <tbody>
                  {circle.members.map((m, i) => {
                    const rec = records[m];
                    const paidNow = circle.paid.includes(m);
                    return (
                      <tr key={m} className={`border-b last:border-0 ${m === me ? "bg-amber-50/60" : ""}`}>
                        <td className="py-2.5 text-stone-500">{i + 1}</td>
                        <td>
                          <a
                            className="font-mono hover:underline"
                            href={explorer.account(m)}
                            target="_blank"
                            rel="noreferrer"
                            title={m}
                          >
                            {shortAddr(m, 5)}
                          </a>
                          {m === me && <span className="ml-1 text-xs font-semibold text-amber-800">you</span>}
                          {i < circle.round && <span className="ml-1 text-xs text-stone-400">· got pot R{i + 1}</span>}
                        </td>
                        <td>
                          {circle.status === "Completed" ? (
                            <span className="text-stone-400">—</span>
                          ) : paidNow ? (
                            <Badge tone="emerald">Paid</Badge>
                          ) : current && Date.now() / 1000 >= Number(current.deadline) ? (
                            <Badge tone="red">Late</Badge>
                          ) : (
                            <Badge tone="amber">Pending</Badge>
                          )}
                        </td>
                        <td className="text-right font-semibold">{rec?.paid ?? "…"}</td>
                        <td className={`text-right font-semibold ${rec?.missed ? "text-red-700" : ""}`}>
                          {rec?.missed ?? "…"}
                        </td>
                        <td className="text-right">{rec ? formatAmount(rec.received) : "…"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {history.length > 0 && (
            <Card>
              <h2 className="mb-3 text-lg font-bold">Settled rounds</h2>
              <ul className="space-y-3">
                {history.map((r) => (
                  <li key={r.round} className="rounded-xl border border-stone-200 p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-bold">Round {r.round + 1}</span>
                      <span>
                        {formatAmount(r.pot)} {config.tokenCode} →{" "}
                        <span className="font-mono">{shortAddr(r.recipient)}</span>
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs">
                      <Badge tone="emerald">{r.paid.length} paid</Badge>
                      {r.defaulted.length > 0 ? (
                        r.defaulted.map((d) => (
                          <Badge key={d} tone="red">
                            defaulted: {shortAddr(d)}
                          </Badge>
                        ))
                      ) : (
                        <Badge tone="stone">no defaults</Badge>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
        <div className="space-y-4">
          {isMember && <AccountPanel need={circle.contribution} />}
          <Card className="text-xs text-stone-500">
            <p>
              Contract{" "}
              <a className="font-mono underline" href={explorer.contract(config.contractId)} target="_blank" rel="noreferrer">
                {shortAddr(config.contractId, 6)}
              </a>
            </p>
            <p className="mt-1">
              Admin <span className="font-mono">{shortAddr(circle.admin, 6)}</span>
            </p>
            <p className="mt-1">Data refreshes every 15 s.</p>
          </Card>
        </div>
      </div>
    </div>
  );
}
