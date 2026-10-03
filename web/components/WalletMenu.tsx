"use client";
import { useEffect, useRef, useState } from "react";
import { useWallet } from "./WalletProvider";
import { Button, Skeleton } from "./ui";
import { useAccountStatus } from "./AccountPanel";
import { CountUp } from "./motion";
import { addTrustline, fundWithFriendbot } from "@/lib/stellar";
import { friendlyError } from "@/lib/errors";
import { formatAmount, shortAddr } from "@/lib/format";
import { config, explorer } from "@/lib/config";
import { GetTestUsdc, openLocalDialog, TestnetBadge } from "./LocalWallet";
import { confirmBeforeSigning, setConfirmBeforeSigning } from "@/lib/localWallet";

/** Header wallet control: one Connect button (opens the kit's picker) or a wallet chip with a small menu. */
export function WalletMenu() {
  const w = useWallet();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { status, error: balErr, refresh } = useAccountStatus();

  // Fresh balances every time the menu opens.
  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!w.ready) return <div aria-hidden className="skeleton h-11 w-[5.5rem] shrink-0 rounded-lg sm:w-32" />;

  if (!w.address) {
    return (
      <Button onClick={w.connect} loading={w.connecting} variant="ink" className="shrink-0 !px-3.5">
        <span className="sm:hidden">Connect</span>
        <span className="hidden sm:inline">Connect wallet</span>
      </Button>
    );
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(w.address!);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {}
  };

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={w.address}
        className="press flex min-h-11 items-center gap-2 rounded-lg border border-line bg-ivory py-1 pl-2.5 pr-2 text-left transition-colors hover:border-line-strong"
      >
        <span
          aria-hidden
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${w.wrongNetwork ? "bg-rust" : "bg-sage-bright"}`}
        />
        <span className="flex flex-col leading-tight">
          <span className="text-xs font-medium text-ink">{w.walletName ?? "Wallet"}</span>
          <span className="font-mono text-xs text-muted">{shortAddr(w.address)}</span>
        </span>
        <svg
          aria-hidden
          viewBox="0 0 12 12"
          className={`h-3 w-3 text-muted transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        >
          <path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          className="pop-in absolute right-0 top-[calc(100%+0.5rem)] z-[var(--z-overlay)] w-60 max-w-[calc(100vw-2rem)] origin-top-right rounded-xl border border-line bg-ivory p-1.5 shadow-[var(--shadow-overlay)]"
        >
          <div className="border-b border-line px-3 pb-2.5 pt-2">
            <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
              Connected with {w.walletName ?? "your wallet"} {w.isLocal && <TestnetBadge />}
            </p>
            <p className="mt-1 break-all font-mono text-xs text-ink">{w.address}</p>
            {!w.networkPassphrase && (
              <p className="mt-1.5 text-xs text-muted">Make sure your wallet is set to Testnet.</p>
            )}
          </div>
          <Balances status={status} error={balErr} address={w.address} />
          {w.isLocal && <LocalItems close={() => setOpen(false)} />}
          <MenuItem onClick={copy}>{copied ? "Copied ✓" : "Copy address"}</MenuItem>
          <a
            role="menuitem"
            href={explorer.account(w.address)}
            target="_blank"
            rel="noreferrer"
            className="flex min-h-11 items-center rounded-lg px-3 text-sm text-ink-soft transition-colors hover:bg-sand/70"
          >
            View on stellar.expert ↗
          </a>
          <MenuItem
            onClick={() => {
              setOpen(false);
              w.connect();
            }}
          >
            Switch wallet
          </MenuItem>
          <MenuItem
            danger
            onClick={() => {
              setOpen(false);
              w.disconnect();
            }}
          >
            Disconnect
          </MenuItem>
        </div>
      )}
    </div>
  );
}

function LocalItems({ close }: { close: () => void }) {
  const w = useWallet();
  const [ask, setAsk] = useState(false);
  useEffect(() => setAsk(confirmBeforeSigning()), []);
  return (
    <div className="border-b border-line py-1">
      <MenuItem
        onClick={() => {
          close();
          openLocalDialog("backup");
        }}
      >
        {w.localWallet?.backedUp ? "Show secret key" : "Back up secret key"}
        {!w.localWallet?.backedUp && <span aria-hidden className="ml-auto h-2 w-2 rounded-full bg-ochre-bright" />}
      </MenuItem>
      <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-lg px-3 text-sm text-ink-soft hover:bg-sand/70">
        Ask before signing
        <input
          type="checkbox"
          role="switch"
          checked={ask}
          onChange={(e) => {
            setAsk(e.target.checked);
            setConfirmBeforeSigning(e.target.checked);
          }}
          className="size-4 accent-[var(--color-clay-strong)]"
        />
      </label>
      <MenuItem
        danger
        onClick={() => {
          close();
          openLocalDialog("forget");
        }}
      >
        Forget this wallet…
      </MenuItem>
    </div>
  );
}

function MenuItem({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      role="menuitem"
      type="button"
      onClick={onClick}
      className={`flex min-h-11 w-full items-center rounded-lg px-3 text-left text-sm transition-colors hover:bg-sand/70 ${
        danger ? "text-rust" : "text-ink-soft"
      }`}
    >
      {children}
    </button>
  );
}

type Status = ReturnType<typeof useAccountStatus>["status"];

function Balances({ status, error, address }: { status: Status; error: string | null; address: string }) {
  const [busy, setBusy] = useState<"fb" | "tl" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const act = async (key: "fb" | "tl", fn: () => Promise<unknown>) => {
    setBusy(key);
    setErr(null);
    try {
      await fn(); // helpers broadcast a balances refresh on success
    } catch (e) {
      setErr(friendlyError(e, "trustline"));
    } finally {
      setBusy(null);
    }
  };
  const xlm = (v: bigint) => <CountUp value={v} />;

  return (
    <div className="border-b border-line px-3 py-2.5" aria-live="polite">
      <p className="font-mono text-xs uppercase tracking-[0.14em] text-muted">Balances</p>
      {error && <p className="mt-1.5 text-xs text-rust">{error}</p>}
      {!status && !error && (
        <div className="mt-2 grid grid-cols-2 gap-2" aria-label="Loading balances">
          {[0, 1].map((i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-3 w-12" />
              <Skeleton className="h-5 w-16" />
            </div>
          ))}
        </div>
      )}
      {status && !status.exists && (
        <div className="content-in mt-1.5 space-y-2">
          <p className="text-xs leading-relaxed text-ochre">Not funded on testnet yet — it needs a little XLM for fees.</p>
          <Button variant="secondary" className="w-full !py-2 !text-sm" loading={busy === "fb"} onClick={() => act("fb", () => fundWithFriendbot(address))}>
            Fund with Friendbot
          </Button>
        </div>
      )}
      {status && status.exists && (
        <div className="content-in">
          <dl className="mt-2 grid grid-cols-2 gap-2">
            <div className="min-w-0">
              <dt className="text-xs text-muted">{config.tokenCode} · test</dt>
              <dd className={`mt-0.5 ${status.hasTrustline ? "font-numeral text-lg leading-tight text-ink" : "text-xs text-ochre"}`}>
                {status.hasTrustline ? <CountUp value={status.tokenBalance} /> : "No trustline"}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted">XLM</dt>
              <dd className="font-numeral mt-0.5 text-lg leading-tight text-ink">{xlm(status.xlmStroops)}</dd>
            </div>
          </dl>
          <p className="mt-1 text-xs leading-snug text-muted">
            <span className="tnum text-ink-soft">{formatXlm(status.xlmSpendable)}</span> spendable ·{" "}
            <span className="tnum">{formatXlm(status.xlmReserved)}</span> reserve
          </p>
          {!status.hasTrustline && (
            <Button variant="secondary" className="mt-2 w-full !py-2 !text-sm" loading={busy === "tl"} onClick={() => act("tl", () => addTrustline(address))}>
              Add {config.tokenCode} trustline
            </Button>
          )}
          {status.hasTrustline && <GetTestUsdc address={address} className="mt-2" />}
        </div>
      )}
      {err && <p className="alert-in mt-1.5 text-xs text-rust">{err}</p>}
    </div>
  );
}

function formatXlm(v: bigint) {
  return formatAmount(v);
}
