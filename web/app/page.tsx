"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ajo, Circle } from "@/lib/ajo";
import { formatAmount, formatDuration } from "@/lib/format";
import { friendlyError } from "@/lib/errors";
import { config, explorer } from "@/lib/config";
import { Alert, Badge, Card, LinkButton, Spinner } from "@/components/ui";
import { useWallet } from "@/components/WalletProvider";

export default function Home() {
  const { address } = useWallet();
  const [circles, setCircles] = useState<Circle[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const n = await ajo.circleCount();
      const ids = Array.from({ length: n }, (_, i) => n - 1 - i); // newest first
      setCircles(await Promise.all(ids.map((i) => ajo.getCircle(i))));
    } catch (e) {
      setError(friendlyError(e));
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const mine = (c: Circle) => !!address && (c.members.includes(address) || c.admin === address);

  return (
    <div className="space-y-8">
      <section className="overflow-hidden rounded-3xl bg-emerald-800 px-6 py-10 text-white sm:px-10">
        <p className="text-sm font-semibold uppercase tracking-widest text-amber-300">
          Ajo · Esusu · Susu · Chama
        </p>
        <h1 className="mt-2 max-w-2xl text-3xl font-black leading-tight sm:text-4xl">
          Save together in USDC. Get paid in turn. No one holds the pot.
        </h1>
        <p className="mt-3 max-w-2xl text-emerald-100">
          A Soroban smart contract collects each round&apos;s contributions and pays the whole pot to
          the next member in the rotation — with every payment, payout and missed round recorded on
          Stellar.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <LinkButton href="/create" variant="secondary">
            Start a circle
          </LinkButton>
          <a
            className="inline-flex items-center rounded-xl px-4 py-2.5 text-sm font-semibold text-emerald-100 hover:bg-emerald-700"
            href={explorer.contract(config.contractId)}
            target="_blank"
            rel="noreferrer"
          >
            View contract on stellar.expert ↗
          </a>
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-bold">Circles</h2>
          <button onClick={load} className="text-sm font-medium text-emerald-700 hover:underline">
            Refresh
          </button>
        </div>
        {error && <Alert tone="error">{error}</Alert>}
        {!circles && !error && <Spinner label="Loading circles from Soroban…" />}
        {circles && circles.length === 0 && (
          <Card>
            No circles yet. <Link className="font-semibold text-emerald-700 underline" href="/create">Create the first one</Link>.
          </Card>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          {circles?.map((c) => (
            <Link key={c.id} href={`/circle/${c.id}`} className="group">
              <Card className="h-full transition group-hover:border-emerald-400 group-hover:shadow-md">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold uppercase text-stone-500">Circle #{c.id}</p>
                    <p className="mt-1 text-2xl font-black">
                      {formatAmount(c.contribution)} <span className="text-base font-bold text-stone-500">{config.tokenCode}</span>
                    </p>
                    <p className="text-sm text-stone-500">
                      per member · every {formatDuration(Number(c.period_secs))}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {c.status === "Completed" ? (
                      <Badge tone="stone">Completed</Badge>
                    ) : (
                      <Badge tone="emerald">Round {c.round + 1}/{c.members.length}</Badge>
                    )}
                    {mine(c) && <Badge tone="amber">You&apos;re in</Badge>}
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between text-sm">
                  <span className="text-stone-600">{c.members.length} members</span>
                  {c.status === "Active" && (
                    <span className="text-stone-600">
                      {c.paid.length}/{c.members.length} paid · pot {formatAmount(c.pot)}
                    </span>
                  )}
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-stone-100">
                  <div
                    className="h-full rounded-full bg-emerald-600"
                    style={{
                      width: `${(Math.min(c.round, c.members.length) / c.members.length) * 100}%`,
                    }}
                  />
                </div>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {[
          ["1. Form a circle", "Pick members, a USDC amount and a round length. The admin signs once."],
          ["2. Everyone contributes", "Each member pays their share into the contract every round, signed in Freighter."],
          ["3. Pot rotates", "When all have paid — or the deadline passes — anyone triggers the payout to the next member. Missed payments are recorded."],
        ].map(([t, d]) => (
          <Card key={t}>
            <h3 className="font-bold">{t}</h3>
            <p className="mt-1 text-sm text-stone-600">{d}</p>
          </Card>
        ))}
      </section>
    </div>
  );
}
