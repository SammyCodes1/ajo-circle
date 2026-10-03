"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ajo, Circle } from "@/lib/ajo";
import { friendlyError } from "@/lib/errors";
import { config, explorer } from "@/lib/config";
import { Alert, Eyebrow, LinkButton } from "@/components/ui";
import { AdirePattern } from "@/components/Brand";
import { RotationRing } from "@/components/RotationRing";
import { CircleCard, CircleCardSkeleton } from "@/components/CircleCard";
import { useWallet } from "@/components/WalletProvider";
import { LocalWalletCta } from "@/components/LocalWallet";

const DEMO = [
  { address: "GADE…", received: true },
  { address: "GBOL…", received: true },
  { address: "GCHI…", paid: true },
  { address: "GDAY…", paid: true },
  { address: "GEMEK…", paid: true, defaulted: true },
  { address: "GFOL…" },
];

const STEPS = [
  {
    n: "01",
    t: "Form the circle",
    d: "Choose members, a USDC amount and a round length. Payout order is fixed on-chain the moment you create it.",
  },
  {
    n: "02",
    t: "Everyone contributes",
    d: "Each round, every member pays their share into the contract — signed in your Stellar wallet, settled in seconds.",
  },
  {
    n: "03",
    t: "The pot rotates",
    d: "Once all have paid, or the deadline passes, anyone can release the pot to that round’s member. Missed payments stay on the record.",
  },
];

export default function Home() {
  const { address } = useWallet();
  const [circles, setCircles] = useState<Circle[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const n = await ajo.circleCount();
      const ids = Array.from({ length: n }, (_, i) => n - 1 - i); // newest first
      setCircles(await Promise.all(ids.map((i) => ajo.getCircle(i))));
      setError(null);
    } catch (e) {
      setError(friendlyError(e));
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const mine = (c: Circle) => !!address && (c.members.includes(address) || c.admin === address);

  return (
    <div className="space-y-16 sm:space-y-24 lg:space-y-28">
      {/* ---------------------------------------------------------- hero */}
      <section className="grid items-center gap-10 lg:grid-cols-[1.08fr_1fr] lg:gap-14">
        <div className="animate-rise">
          <Eyebrow>Ajo · Esusu · Susu · Chama — on Stellar</Eyebrow>
          <h1 className="font-display mt-5 max-w-[14ch] text-[2.75rem] leading-[1.02] text-ink sm:text-[3.6rem] lg:text-[4.1rem]">
            Save together. Take turns. <em className="text-clay-deep [font-variation-settings:'SOFT'_100,'WONK'_1,'opsz'_96]">Trust the circle</em>, not the collector.
          </h1>
          <p className="mt-6 max-w-[46ch] text-[1.05rem] leading-relaxed text-ink-soft">
            Ajo Circle is the rotating savings group you already know, run by a Soroban smart
            contract. Contributions in USDC are held by code, the pot moves in a fixed order, and
            every payment — or missed one — is on the record.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <LinkButton href="/create">Start a circle</LinkButton>
            <LinkButton href="#circles" variant="secondary">
              Browse circles
            </LinkButton>
            <a
              className="ml-1 inline-flex min-h-11 items-center text-sm text-muted underline decoration-line-strong underline-offset-4 transition-colors hover:text-ink"
              href={explorer.contract(config.contractId)}
              target="_blank"
              rel="noreferrer"
            >
              Contract on stellar.expert ↗
            </a>
          </div>
          <div className="mt-6 max-w-[34rem]">
            <LocalWalletCta />
          </div>
        </div>

        <div className="rise relative" style={{ "--d": "120ms" } as React.CSSProperties}>
          <div className="absolute inset-0 overflow-hidden rounded-[28px] border border-line bg-[#efe9df]">
            <AdirePattern className="absolute inset-0" opacity={0.11} />
            <div className="absolute inset-0 bg-[radial-gradient(closest-side,#f5f1ea_55%,transparent)]" />
          </div>
          <div className="relative px-4 py-6 sm:px-8 sm:py-8">
            <RotationRing members={DEMO} current={2} showLabels={false} title="Example circle" className="max-w-[400px]" decorative>
              <p className="font-mono text-xs uppercase tracking-[0.16em] text-muted">Round 3 of 6</p>
              <p className="font-numeral mt-1 text-[2.4rem] leading-none text-ink sm:text-5xl">60</p>
              <p className="mt-1 text-xs text-muted">USDC pot → member 3</p>
            </RotationRing>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------- circles */}
      <section id="circles" className="scroll-mt-24">
        <div className="mb-6 flex items-end justify-between gap-4 border-b border-line pb-4">
          <div>
            <Eyebrow>Live on testnet</Eyebrow>
            <h2 className="font-display mt-2 text-3xl text-ink">Circles</h2>
          </div>
          <button
            onClick={load}
            className="inline-flex min-h-11 items-center px-1 text-sm text-muted underline-offset-4 transition-colors hover:text-ink hover:underline"
          >
            Refresh
          </button>
        </div>
        {error && <Alert tone="error">{error}</Alert>}
        <div className="stagger grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {!circles && !error && [0, 1, 2].map((i) => <CircleCardSkeleton key={i} />)}
          {circles?.map((c) => <CircleCard key={c.id} c={c} mine={mine(c)} />)}
          {circles && (
            <Link
              href="/create"
              className="group flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-line-strong p-6 text-center transition-colors hover:border-clay hover:bg-ivory/60"
            >
              <span className="grid h-11 w-11 place-items-center rounded-full border border-line-strong text-xl text-muted transition-colors group-hover:border-clay group-hover:text-clay-deep">
                +
              </span>
              <span className="font-display text-lg text-ink">
                {circles.length === 0 ? "Start the first circle" : "Start a new circle"}
              </span>
              <span className="max-w-[26ch] text-sm text-muted">
                Invite your people, pick an amount, set the rhythm.
              </span>
            </Link>
          )}
        </div>
      </section>

      {/* ---------------------------------------------------------- how */}
      <section>
        <Eyebrow>How it works</Eyebrow>
        <h2 className="font-display mt-2 max-w-[22ch] text-3xl text-ink">
          The same circle your mother trusted, with the books kept by Stellar.
        </h2>
        <ol className="stagger mt-10 grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3">
          {STEPS.map((s) => (
            <li key={s.n} className="bg-ivory p-6">
              <span className="font-numeral text-3xl text-clay">{s.n}</span>
              <h3 className="mt-4 text-[1.02rem] font-semibold text-ink">{s.t}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{s.d}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
