"use client";
import { useEffect, useRef, useState } from "react";
import { useWallet } from "./WalletProvider";
import { Button } from "./ui";
import { shortAddr } from "@/lib/format";
import { explorer } from "@/lib/config";

/** Header wallet control: one Connect button (opens the kit's picker) or a wallet chip with a small menu. */
export function WalletMenu() {
  const w = useWallet();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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
            <p className="text-xs text-muted">Connected with {w.walletName ?? "your wallet"}</p>
            <p className="mt-1 break-all font-mono text-xs text-ink">{w.address}</p>
            {!w.networkPassphrase && (
              <p className="mt-1.5 text-xs text-muted">Make sure your wallet is set to Testnet.</p>
            )}
          </div>
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
