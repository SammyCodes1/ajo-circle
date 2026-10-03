"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ajo } from "@/lib/ajo";
import { parseAmount, formatAmount, formatDuration } from "@/lib/format";
import { friendlyError } from "@/lib/errors";
import { isValidAddress } from "@/lib/stellar";
import { config } from "@/lib/config";
import { Alert, Button, Card, Eyebrow, TxLink } from "@/components/ui";
import { useWallet } from "@/components/WalletProvider";
import { AccountPanel } from "@/components/AccountPanel";
import { RotationRing } from "@/components/RotationRing";
import { TokenLabel } from "@/components/TokenLabel";

const PERIODS = [
  { label: "3 min", hint: "demo", secs: 180 },
  { label: "1 hour", hint: "", secs: 3600 },
  { label: "1 day", hint: "", secs: 86400 },
  { label: "1 week", hint: "", secs: 604800 },
  { label: "30 days", hint: "monthly", secs: 2592000 },
];

// How long members have to accept their slot before the circle can be cancelled (≥ 60 s).
const JOIN_WINDOWS = [
  { label: "5 min", hint: "demo", secs: 300 },
  { label: "1 hour", hint: "", secs: 3600 },
  { label: "1 day", hint: "", secs: 86400 },
  { label: "3 days", hint: "", secs: 259200 },
  { label: "1 week", hint: "", secs: 604800 },
];
const MAX_MEMBERS = 20;

function SectionLabel({ n, title, hint }: { n: string; title: string; hint?: string }) {
  return (
    <div className="mb-4 flex items-baseline gap-3">
      <span className="font-numeral text-lg text-clay">{n}</span>
      <div>
        <h2 className="text-[1.02rem] font-semibold text-ink">{title}</h2>
        {hint && <p className="mt-0.5 text-sm text-muted">{hint}</p>}
      </div>
    </div>
  );
}

const inputCls =
  "min-h-11 w-full rounded-lg border border-line-strong bg-white/70 px-3.5 py-2.5 text-ink placeholder:text-faint transition-[border-color,box-shadow] focus:border-clay focus:bg-white focus:shadow-[0_0_0_3px_rgb(201_100_66/0.15)] focus:outline-none";

export default function CreatePage() {
  const w = useWallet();
  const router = useRouter();
  const [amount, setAmount] = useState("10");
  const [period, setPeriod] = useState(180);
  const [joinWindow, setJoinWindow] = useState(300);
  const [rows, setRows] = useState<string[]>(["", ""]);
  const [bulk, setBulk] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: number; hash: string } | null>(null);

  // Pre-fill the connected wallet as the first member (adjusting state while rendering,
  // once per newly connected address, instead of in an effect).
  const [prefilledFor, setPrefilledFor] = useState<string | null>(null);
  if (w.address && prefilledFor !== w.address) {
    setPrefilledFor(w.address);
    if (rows.every((r) => !r.trim())) setRows([w.address, ""]);
  }

  const members = rows.map((s) => s.trim()).filter(Boolean);
  const rowInvalid = (s: string) => !!s.trim() && (!isValidAddress(s) || !s.trim().startsWith("G"));
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
    members.length > MAX_MEMBERS ? `Maximum ${MAX_MEMBERS} members` : null,
    invalid.length ? `Invalid Stellar account address: ${invalid[0]}` : null,
    dupes.length ? `Duplicate member: ${dupes[0]}` : null,
  ].filter(Boolean) as string[];

  const setRow = (i: number, v: string) => setRows((r) => r.map((x, j) => (j === i ? v : x)));
  const removeRow = (i: number) => setRows((r) => (r.length <= 2 ? r.map((x, j) => (j === i ? "" : x)) : r.filter((_, j) => j !== i)));
  const move = (i: number, d: -1 | 1) =>
    setRows((r) => {
      const j = i + d;
      if (j < 0 || j >= r.length) return r;
      const c = [...r];
      [c[i], c[j]] = [c[j], c[i]];
      return c;
    });
  const applyBulk = () => {
    const parsed = bulkText.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
    setRows(parsed.length >= 2 ? parsed : [...parsed, ...Array(2 - parsed.length).fill("")]);
    setBulk(false);
  };
  const openBulk = () => {
    setBulkText(members.join("\n"));
    setBulk(true);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!w.address) return w.connect();
    if (w.wrongNetwork) return setError("Switch your wallet to Testnet first.");
    if (problems.length || contribution === null) return;
    setBusy(true);
    setError(null);
    try {
      const res = await ajo.createCircle(w.address, contribution, members, period, joinWindow);
      setDone({ id: Number(res.returnValue), hash: res.hash });
    } catch (err) {
      setError(friendlyError(err, "create"));
    } finally {
      setBusy(false);
    }
  }

  const showSummary = contribution !== null && !amountErr && members.length >= 2;
  const preview = (members.length ? members : ["", ""]).map((m, i) => ({ address: m || `Member ${i + 1}` }));

  return (
    <div>
      <header className="mb-10 max-w-2xl">
        <Eyebrow>New circle</Eyebrow>
        <h1 className="font-display mt-3 text-[2.4rem] leading-[1.05] text-ink sm:text-5xl">Start a circle</h1>
        <p className="mt-4 text-[1.02rem] leading-relaxed text-ink-soft">
          Set the amount, the rhythm and the order. Member 1 takes the pot in round 1, member 2 in
          round 2, and so on. You sign once to create it; you don’t have to be a member and you get no
          special powers. The circle starts only when every member has accepted their slot.
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <form onSubmit={submit} className="space-y-6" noValidate>
          <Card as="section">
            <SectionLabel n="i." title="Contribution" hint="What each member puts in, every round." />
            <label className="block">
              <span className="sr-only">Contribution per member, per round ({config.tokenCode})</span>
              <div className="relative max-w-xs">
                <input
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  aria-invalid={!!amountErr}
                  className={`${inputCls} font-numeral !py-3 !pr-20 text-3xl`}
                />
                <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center font-mono text-sm text-muted">
                  {config.tokenCode}
                </span>
              </div>
            </label>
            {amountErr && amount && <p className="mt-2 text-sm text-rust">{amountErr}</p>}
          </Card>

          <Card as="section">
            <SectionLabel n="ii." title="Round length" hint="How long members have to pay before anyone can settle the round." />
            <div role="radiogroup" aria-label="Round length" className="grid grid-cols-2 gap-2 min-[400px]:grid-cols-3 sm:grid-cols-5">
              {PERIODS.map((p) => {
                const on = period === p.secs;
                return (
                  <button
                    key={p.secs}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setPeriod(p.secs)}
                    className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
                      on
                        ? "border-ink bg-ink text-ivory"
                        : "border-line-strong bg-white/50 text-ink hover:border-ink/40"
                    }`}
                  >
                    <span className="block text-sm font-medium">{p.label}</span>
                    <span className={`block text-xs ${on ? "text-ivory/70" : "text-muted"}`}>
                      {p.hint || "\u00a0"}
                    </span>
                  </button>
                );
              })}
            </div>
          </Card>

          <Card as="section">
            <SectionLabel
              n="iii."
              title="Join window"
              hint="Every member must accept their slot within this time. If someone doesn’t, anyone can cancel the circle and posted collateral is refunded."
            />
            <div role="radiogroup" aria-label="Join window" className="grid grid-cols-2 gap-2 min-[400px]:grid-cols-3 sm:grid-cols-5">
              {JOIN_WINDOWS.map((p) => {
                const on = joinWindow === p.secs;
                return (
                  <button
                    key={p.secs}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setJoinWindow(p.secs)}
                    className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
                      on
                        ? "border-ink bg-ink text-ivory"
                        : "border-line-strong bg-white/50 text-ink hover:border-ink/40"
                    }`}
                  >
                    <span className="block text-sm font-medium">{p.label}</span>
                    <span className={`block text-xs ${on ? "text-ivory/70" : "text-muted"}`}>
                      {p.hint || "\u00a0"}
                    </span>
                  </button>
                );
              })}
            </div>
          </Card>

          <Card as="section">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <SectionLabel n="iv." title="Members, in payout order" hint="Stellar account addresses (G…). Use the arrows to reorder." />
              <button
                type="button"
                onClick={() => (bulk ? applyBulk() : openBulk())}
                className="inline-flex min-h-11 items-center text-sm text-clay-deep underline-offset-4 hover:underline"
              >
                {bulk ? "Apply list" : "Paste a list"}
              </button>
            </div>

            {bulk ? (
              <div>
                <textarea
                  rows={7}
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                  placeholder={"GABC…\nGDEF…\nGHIJ…"}
                  aria-label="Member addresses, one per line"
                  className={`${inputCls} font-mono text-base leading-7 sm:text-xs sm:leading-6`}
                />
                <div className="mt-3 flex gap-2">
                  <Button type="button" variant="ink" onClick={applyBulk} className="!py-2">
                    Use these addresses
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setBulk(false)} className="!py-2">
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <ol className="space-y-2">
                {rows.map((r, i) => {
                  const bad = rowInvalid(r);
                  const dup = !!r.trim() && members.indexOf(r.trim()) !== members.lastIndexOf(r.trim());
                  return (
                    <li key={i} className="group">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 sm:flex-nowrap">
                        <span className="font-numeral w-7 shrink-0 text-right text-lg text-muted">{i + 1}</span>
                        <input
                          value={r}
                          onChange={(e) => setRow(i, e.target.value)}
                          placeholder={i === 0 ? "G… receives the first pot" : "G…"}
                          spellCheck={false}
                          autoComplete="off"
                          aria-label={`Member ${i + 1} address`}
                          aria-invalid={bad || dup}
                          className={`${inputCls} min-w-0 flex-1 basis-[calc(100%-2.25rem)] font-mono text-base sm:basis-auto sm:text-[0.78rem] ${bad || dup ? "!border-rust/60" : ""}`}
                        />
                        <div className="ml-auto flex shrink-0 items-center sm:ml-0">
                          <IconBtn label={`Move member ${i + 1} up`} onClick={() => move(i, -1)} disabled={i === 0}>
                            ↑
                          </IconBtn>
                          <IconBtn label={`Move member ${i + 1} down`} onClick={() => move(i, 1)} disabled={i === rows.length - 1}>
                            ↓
                          </IconBtn>
                          <IconBtn label={`Remove member ${i + 1}`} onClick={() => removeRow(i)}>
                            ×
                          </IconBtn>
                        </div>
                      </div>
                      {(bad || dup) && (
                        <p className="ml-9 mt-1 text-xs text-rust">{dup ? "Duplicate address" : "Not a valid G… account address"}</p>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
            {!bulk && (
              <div className="mt-4 flex flex-wrap gap-2 sm:ml-9">
                <Button type="button" variant="secondary" className="!py-2" onClick={() => setRows((r) => [...r, ""])} disabled={rows.length >= MAX_MEMBERS}>
                  + Add member
                </Button>
                {w.address && !members.includes(w.address) && (
                  <Button type="button" variant="ghost" className="!py-2" onClick={() => setRows((r) => {
                    const i = r.findIndex((x) => !x.trim());
                    return i >= 0 ? r.map((x, j) => (j === i ? w.address! : x)) : [...r, w.address!];
                  })}>
                    Add my address
                  </Button>
                )}
              </div>
            )}
          </Card>

          <Card as="section">
            <SectionLabel
              n="v."
              title="Collateral per slot"
              hint="Early slots post more collateral; anything you don’t post is held back from your payout."
            />
            <CollateralTable contribution={contribution !== null && !amountErr ? contribution : null} n={Math.max(members.length, 2)} />
            <p className="mt-3 text-sm leading-relaxed text-muted">
              Slot <i>k</i> (0-based) owes <i>n−1−k</i> more contributions after receiving its pot, so its target is
              {" "}<span className="font-mono text-xs">R = contribution × (n−1−k)</span>. Members can post it when they accept,
              later, or not at all; whatever is missing is withheld from their own payout and released again as the
              circle winds down. Collateral is paid back in full at the end.
            </p>
          </Card>

          {problems.length > 0 && members.length > 0 && !done && (
            <ul className="space-y-1 text-sm text-rust" aria-live="polite">
              {problems.map((p) => (
                <li key={p} className="break-all">· {p}</li>
              ))}
            </ul>
          )}
          {error && <Alert tone="error">{error}</Alert>}
          {done ? (
            <Alert tone="success" title={`Circle №${done.id} created`}>
              Waiting for every member to accept their slot. Share the circle link with them.
              <TxLink hash={done.hash} />
              <div className="mt-3">
                <Button type="button" onClick={() => router.push(`/circle/${done.id}`)}>
                  Open the circle →
                </Button>
              </div>
            </Alert>
          ) : (
            <Button
              type="submit"
              loading={busy}
              disabled={!!w.address && (problems.length > 0 || w.wrongNetwork)}
              className="w-full !py-3.5 text-base sm:w-auto sm:min-w-[260px]"
            >
              {w.address ? (busy ? "Confirm in your wallet…" : "Create circle") : "Connect wallet to create"}
            </Button>
          )}
        </form>

        <aside className="space-y-5 lg:sticky lg:top-24 lg:self-start">
          <Card className="!p-5">
            <Eyebrow>Preview</Eyebrow>
            <RotationRing members={preview} current={0} me={w.address} showLabels={false} title="Preview" className="mt-2">
              <p className="font-numeral text-3xl leading-none text-ink">
                {showSummary
                  ? formatAmount(contribution! * BigInt(members.length))
                  : contribution !== null && !amountErr
                    ? formatAmount(contribution)
                    : "—"}
              </p>
              <p className="mt-1 text-xs leading-snug text-muted">
                {showSummary ? `${config.tokenCode} pot / round` : `${config.tokenCode} each · add members`}
              </p>
            </RotationRing>
            <dl className="mt-2 grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-line bg-line text-center">
              {[
                ["Members", String(members.length)],
                ["Rounds", String(members.length)],
                ["Total", showSummary ? formatDuration(period * members.length) : "—"],
              ].map(([k, v]) => (
                <div key={k} className="bg-ivory px-2 py-2.5">
                  <dt className="text-xs text-muted">{k}</dt>
                  <dd className="font-numeral mt-0.5 text-base text-ink">{v}</dd>
                </div>
              ))}
            </dl>
          </Card>
          <AccountPanel />
          <div className="px-1 text-sm leading-relaxed text-muted">
            <p className="font-medium text-ink-soft">How the v2 contract handles money</p>
            <ul className="mt-2 space-y-1.5">
              <li>· Each member signs to accept their slot; nobody is enrolled without consent.</li>
              <li>· Token is fixed: the project’s own test USDC (<TokenLabel />), not Circle’s.</li>
              <li>· A missed payment is covered from the defaulter’s collateral; any rest becomes a debt to that round’s recipient, repaid from the defaulter’s next incoming funds.</li>
              <li>· Anyone can settle a round once all paid or the deadline passed. Settling never sends tokens; each member claims their own balance.</li>
              <li>· If a round sits unsettled for 2 periods past its deadline, anyone can unwind the circle and refund what it holds pro rata.</li>
              <li>· Collateral only protects up to what was posted or withheld. This is testnet software, not audited for real money.</li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}

function CollateralTable({ contribution, n }: { contribution: bigint | null; n: number }) {
  const rows = Array.from({ length: n }, (_, k) => (contribution === null ? null : contribution * BigInt(n - 1 - k)));
  const total = rows.reduce<bigint | null>((t, r) => (t === null || r === null ? null : t + r), BigInt(0));
  return (
    <div className="overflow-hidden rounded-lg border border-line">
      <table className="w-full text-sm">
        <thead className="bg-sand/60 text-left text-xs text-muted">
          <tr>
            <th className="px-3 py-2 font-medium">Slot</th>
            <th className="px-3 py-2 font-medium">Gets the pot in</th>
            <th className="px-3 py-2 text-right font-medium">Collateral target</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, k) => (
            <tr key={k} className="border-t border-line">
              <td className="px-3 py-1.5 font-numeral">{k + 1}</td>
              <td className="px-3 py-1.5 text-muted">round {k + 1}</td>
              <td className="px-3 py-1.5 text-right font-numeral">
                {r === null ? "—" : `${formatAmount(r)} ${config.tokenCode}`}
              </td>
            </tr>
          ))}
          <tr className="border-t border-line-strong bg-ivory">
            <td className="px-3 py-2 font-medium" colSpan={2}>
              Total
            </td>
            <td className="px-3 py-2 text-right font-numeral font-medium">
              {total === null ? "—" : `${formatAmount(total)} ${config.tokenCode}`}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function IconBtn({
  children,
  label,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="grid h-11 w-11 place-items-center rounded-lg text-lg text-muted transition-colors hover:bg-sand hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}
