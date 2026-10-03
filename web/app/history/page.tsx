"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ajo, Circle, MemberRecord } from "@/lib/ajo";
import { formatAmount } from "@/lib/format";
import { friendlyError } from "@/lib/errors";
import { config } from "@/lib/config";
import { Alert, Badge, Button, Card, Spinner } from "@/components/ui";
import { useWallet } from "@/components/WalletProvider";
import { AccountPanel } from "@/components/AccountPanel";

interface Row {
  circle: Circle;
  record: MemberRecord;
  position: number;
}

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
      <Card className="text-center">
        <h1 className="text-2xl font-black">My history</h1>
        <p className="mt-2 text-stone-600">Connect Freighter to see your contributions, payouts and missed rounds.</p>
        <Button className="mt-4" onClick={w.connect} loading={w.connecting}>
          Connect Freighter
        </Button>
      </Card>
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
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="space-y-4">
        <h1 className="text-2xl font-black">My history</h1>
        {error && <Alert tone="error">{error}</Alert>}
        {!rows && !error && <Spinner />}
        {rows && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Rounds paid", totals.paid],
              ["Rounds missed", totals.missed],
              [`Contributed (${config.tokenCode})`, formatAmount(totals.contributed)],
              [`Received (${config.tokenCode})`, formatAmount(totals.received)],
            ].map(([k, v]) => (
              <Card key={String(k)} className="!p-4">
                <p className="text-xs text-stone-500">{k}</p>
                <p className="text-xl font-black">{v}</p>
              </Card>
            ))}
          </div>
        )}
        {rows && rows.length === 0 && <Card>You&apos;re not a member of any circle yet.</Card>}
        {rows?.map(({ circle: c, record: r, position }) => (
          <Link key={c.id} href={`/circle/${c.id}`}>
            <Card className="mb-3 transition hover:border-emerald-400">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold">Circle #{c.id}</span>
                {c.status === "Completed" ? (
                  <Badge>Completed</Badge>
                ) : (
                  <Badge tone="emerald">Round {c.round + 1}/{c.members.length}</Badge>
                )}
              </div>
              <p className="mt-1 text-sm text-stone-600">
                You receive the pot in round {position + 1}
                {position < c.round ? " ✓ received" : ""} · {formatAmount(c.contribution)} {config.tokenCode} per round
              </p>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                <Badge tone="emerald">paid {r.paid}</Badge>
                <Badge tone={r.missed ? "red" : "stone"}>missed {r.missed}</Badge>
                {r.missed_rounds.length > 0 && (
                  <Badge tone="red">missed rounds: {r.missed_rounds.map((x) => x + 1).join(", ")}</Badge>
                )}
                <Badge tone="sky">received {formatAmount(r.received)}</Badge>
              </div>
            </Card>
          </Link>
        ))}
      </div>
      <div>
        <AccountPanel />
      </div>
    </div>
  );
}
