"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ajo } from "@/lib/ajo";
import { parseAmount, formatAmount, formatDuration } from "@/lib/format";
import { friendlyError } from "@/lib/errors";
import { isValidAddress } from "@/lib/stellar";
import { config } from "@/lib/config";
import { Alert, Button, Card, TxLink } from "@/components/ui";
import { useWallet } from "@/components/WalletProvider";
import { AccountPanel } from "@/components/AccountPanel";

const PERIODS = [
  { label: "3 minutes (demo)", secs: 180 },
  { label: "1 hour", secs: 3600 },
  { label: "1 day", secs: 86400 },
  { label: "1 week", secs: 604800 },
  { label: "30 days", secs: 2592000 },
];

export default function CreatePage() {
  const w = useWallet();
  const router = useRouter();
  const [amount, setAmount] = useState("10");
  const [period, setPeriod] = useState(180);
  const [membersText, setMembersText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: number; hash: string } | null>(null);

  // Pre-fill the connected wallet as the first member.
  useEffect(() => {
    if (w.address && !membersText) setMembersText(w.address + "\n");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w.address]);

  const members = membersText
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const invalid = members.filter((m) => !isValidAddress(m) || !m.startsWith("G"));
  const dupes = members.filter((m, i) => members.indexOf(m) !== i);

  let contribution: bigint | null = null;
  let amountErr: string | null = null;
  try {
    contribution = parseAmount(amount);
    if (contribution <= BigInt(0)) amountErr = "Contribution must be greater than 0";
  } catch (e) {
    amountErr = (e as Error).message;
  }

  const problems = [
    amountErr,
    members.length < 2 ? "Add at least 2 member addresses" : null,
    members.length > 50 ? "Maximum 50 members" : null,
    invalid.length ? `Invalid Stellar account address: ${invalid[0]}` : null,
    dupes.length ? `Duplicate member: ${dupes[0]}` : null,
  ].filter(Boolean) as string[];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!w.address) return w.connect();
    if (w.wrongNetwork) return setError("Switch Freighter to Testnet first.");
    if (problems.length || contribution === null) return;
    setBusy(true);
    setError(null);
    try {
      const res = await ajo.createCircle(w.address, contribution, members, period);
      setDone({ id: Number(res.returnValue), hash: res.hash });
    } catch (err) {
      setError(friendlyError(err, "create"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <Card>
        <h1 className="text-2xl font-black">Create a circle</h1>
        <p className="mt-1 text-sm text-stone-600">
          Payout order follows the member list: member 1 receives the pot in round 1, member 2 in
          round 2, and so on. You (the admin) sign the creation; you don&apos;t have to be a member.
        </p>
        <form onSubmit={submit} className="mt-6 space-y-5">
          <label className="block">
            <span className="text-sm font-semibold">Contribution per member, per round ({config.tokenCode})</span>
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2.5 text-lg focus:border-emerald-600 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="text-sm font-semibold">Round length</span>
            <select
              value={period}
              onChange={(e) => setPeriod(Number(e.target.value))}
              className="mt-1 w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 focus:border-emerald-600 focus:outline-none"
            >
              {PERIODS.map((p) => (
                <option key={p.secs} value={p.secs}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-semibold">Members in payout order (one G… address per line)</span>
            <textarea
              rows={6}
              value={membersText}
              onChange={(e) => setMembersText(e.target.value)}
              placeholder={"GABC…\nGDEF…\nGHIJ…"}
              className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2.5 font-mono text-xs focus:border-emerald-600 focus:outline-none"
            />
          </label>
          {contribution !== null && !amountErr && members.length >= 2 && (
            <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
              {members.length} members × {formatAmount(contribution)} {config.tokenCode} = pot of{" "}
              <b>{formatAmount(contribution * BigInt(members.length))} {config.tokenCode}</b> each
              round, for {members.length} rounds ({formatDuration(period * members.length)} total).
            </p>
          )}
          {problems.length > 0 && members.length > 0 && (
            <ul className="list-inside list-disc text-sm text-red-700">
              {problems.map((p) => (
                <li key={p} className="break-all">{p}</li>
              ))}
            </ul>
          )}
          {error && <Alert tone="error">{error}</Alert>}
          {done ? (
            <Alert tone="success">
              Circle #{done.id} created! <TxLink hash={done.hash} />
              <div className="mt-2">
                <Button type="button" onClick={() => router.push(`/circle/${done.id}`)}>
                  Open circle dashboard →
                </Button>
              </div>
            </Alert>
          ) : (
            <Button
              type="submit"
              loading={busy}
              disabled={!!w.address && (problems.length > 0 || w.wrongNetwork)}
              className="w-full"
            >
              {w.address ? (busy ? "Confirm in Freighter…" : "Create circle") : "Connect Freighter to create"}
            </Button>
          )}
        </form>
      </Card>
      <div className="space-y-4">
        <AccountPanel />
        <Card className="text-sm text-stone-600">
          <h3 className="font-bold text-stone-900">How rounds work</h3>
          <ul className="mt-2 list-inside list-disc space-y-1">
            <li>Each member contributes once per round.</li>
            <li>Payout unlocks when everyone has paid, or when the round deadline passes.</li>
            <li>Anyone can trigger the payout; funds always go to that round&apos;s recipient.</li>
            <li>Unpaid members are recorded as defaulted for that round — visible to everyone.</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
