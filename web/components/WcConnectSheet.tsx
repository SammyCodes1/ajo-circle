"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useWallet } from "./WalletProvider";
import { LOCAL_WALLET_SUPPORTED } from "@/lib/localWallet";
import {
  dismissWcSheet,
  retryHandoff,
  subscribeWcPending,
  wcPendingSnapshot,
  WC_APPROVAL_TIMEOUT_MS,
} from "@/lib/wcSession";

/**
 * WalletConnect progress sheet. In Freighter's in-app browser it appears the moment Connect is
 * tapped (preparing → waiting for approval) with manual fallbacks; in other browsers it covers
 * the gap until the AppKit window opens, and reports errors.
 */
export function WcConnectSheet() {
  const w = useWallet();
  const pending = useSyncExternalStore(subscribeWcPending, wcPendingSnapshot, () => null);
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!pending || pending.phase === "error") return;
    setCopied(false);
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [pending]);
  if (!pending) return null;
  // The AppKit window is the UI while waiting in regular browsers.
  if (pending.mode === "modal" && pending.phase === "waiting") return null;
  const inApp = pending.mode === "freighter";
  const left = Math.max(0, Math.round((pending.startedAt + WC_APPROVAL_TIMEOUT_MS - now) / 1000));
  const copy = async () => {
    if (!pending.uri) return;
    try {
      await navigator.clipboard.writeText(pending.uri);
      setCopied(true);
    } catch {
      window.prompt("Copy this connection link", pending.uri);
    }
  };
  const btn = "press inline-flex min-h-11 items-center rounded-lg px-4 text-sm font-medium";
  const title =
    pending.phase === "error"
      ? "Couldn't connect"
      : pending.phase === "preparing"
        ? inApp
          ? "Preparing the Freighter connection…"
          : "Starting WalletConnect…"
        : "Approve the connection in Freighter";
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-[2147483000] p-3 sm:p-4"
      role="dialog"
      aria-live="polite"
      aria-label="Connecting to Freighter"
    >
      <div className="mx-auto max-w-md rounded-2xl border border-line bg-ivory p-4 shadow-xl">
        <p className="flex items-center gap-2 font-medium text-ink">
          {pending.phase === "preparing" && (
            <span className="inline-block size-4 animate-spin rounded-full border-2 border-clay border-t-transparent" aria-hidden />
          )}
          {title}
        </p>
        {pending.phase === "error" ? (
          <p className="mt-1 text-sm text-rust">{pending.error}</p>
        ) : pending.phase === "preparing" ? (
          <p className="mt-1 text-sm text-ink-soft">
            Creating a secure WalletConnect link{inApp ? " for Freighter" : ""}. This takes a few seconds.
          </p>
        ) : (
          <p className="mt-1 text-sm text-ink-soft">
            Freighter should show a connection request for Ajo Circle. Ajo Circle runs on <b>Testnet</b> — if
            Freighter is on Mainnet, switch it in Settings → Network first. Waiting… {Math.floor(left / 60)}:
            {String(left % 60).padStart(2, "0")}
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {pending.phase === "waiting" && inApp && (
            <>
              <button type="button" onClick={retryHandoff} className={`${btn} bg-clay text-white hover:bg-clay-deep`}>
                Open request in Freighter
              </button>
              <button type="button" onClick={copy} className={`${btn} border border-line-strong bg-white text-ink`}>
                {copied ? "Copied" : "Copy connection link"}
              </button>
            </>
          )}
          {pending.phase !== "error" && LOCAL_WALLET_SUPPORTED && (
            <button
              type="button"
              onClick={() => {
                dismissWcSheet();
                w.startTestnetWallet();
              }}
              className={`${btn} border border-line-strong bg-white text-ink`}
            >
              Use built-in testnet wallet
            </button>
          )}
          {pending.phase === "error" && (
            <>
              <button
                type="button"
                onClick={() => {
                  dismissWcSheet();
                  w.connect();
                }}
                className={`${btn} bg-clay text-white hover:bg-clay-deep`}
              >
                Try again
              </button>
              {LOCAL_WALLET_SUPPORTED && (
                <button
                  type="button"
                  onClick={() => {
                    dismissWcSheet();
                    w.startTestnetWallet();
                  }}
                  className={`${btn} border border-line-strong bg-white text-ink`}
                >
                  Use built-in testnet wallet
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  dismissWcSheet();
                  w.connectWith("albedo");
                }}
                className={`${btn} text-ink-soft underline underline-offset-2`}
              >
                Albedo
              </button>
            </>
          )}
          <button
            type="button"
            onClick={dismissWcSheet}
            className="press inline-flex min-h-11 items-center rounded-lg px-3 text-sm text-muted underline underline-offset-2"
          >
            {pending.phase === "error" ? "Close" : "Cancel"}
          </button>
        </div>
        {copied && (
          <p className="mt-2 text-xs text-muted">
            Nothing showed up? In Freighter tap the scan (QR) button, choose to enter the link manually and paste it.
          </p>
        )}
      </div>
    </div>
  );
}
