"use client";
import { useWallet } from "./WalletProvider";
import { Alert } from "./ui";
import { missingConfig } from "@/lib/config";

/** Status banners live in normal page flow, directly under the sticky header. */
export function Banners() {
  const w = useWallet();
  const missing = missingConfig();
  const readOnly = w.ready && !w.address && !w.needsWalletConnect;
  const wcNote = !w.address && w.needsWalletConnect;
  const showError = w.error && !(wcNote && /WalletConnect/.test(w.error));
  if (!(missing.length > 0 || readOnly || wcNote || w.wrongNetwork || showError)) return null;
  return (
    <div className="mx-auto w-full max-w-6xl space-y-2 px-4 pt-4 sm:px-8">
      {missing.length > 0 && (
        <Alert tone="error" title="App is not configured">
          Set {missing.join(", ")} in <code className="font-mono text-xs">web/.env.local</code> (see .env.example)
          and restart.
        </Alert>
      )}
      {readOnly && (
        <Alert tone="info">
          Browsing read-only. To start a circle or contribute,{" "}
          <button
            type="button"
            onClick={w.connect}
            className="font-medium text-clay-deep underline underline-offset-2 hover:text-clay-strong"
          >
            connect any Stellar wallet
          </button>{" "}
          — Freighter, xBull, LOBSTR and more — or{" "}
          <button
            type="button"
            onClick={() => w.startTestnetWallet()}
            className="font-medium text-clay-deep underline underline-offset-2 hover:text-clay-strong"
          >
            {w.localWallet ? "use your built-in testnet wallet" : "create a built-in testnet wallet"}
          </button>{" "}
          right here, nothing to install.
        </Alert>
      )}
      {wcNote && (
        <Alert tone="info" title="You’re in Freighter’s in-app browser">
          Freighter mobile connects to web apps through WalletConnect, which this deployment hasn’t enabled yet, so
          it can’t sign here. You can still connect with Albedo (works in any browser), or open Ajo Circle on a
          computer with the Freighter extension.
          <span className="mt-2.5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => w.startTestnetWallet()}
              disabled={w.connecting}
              className="press inline-flex min-h-11 items-center rounded-lg bg-ink px-4 text-sm font-medium text-ivory hover:bg-ink-soft disabled:bg-sand disabled:text-muted"
            >
              Use built-in testnet wallet
            </button>
            <button
              type="button"
              onClick={() => w.connectWith("albedo")}
              disabled={w.connecting}
              className="press inline-flex min-h-11 items-center rounded-lg border border-line-strong bg-ivory px-4 text-sm font-medium text-ink hover:bg-white disabled:text-muted"
            >
              {w.connecting ? "Opening Albedo…" : "Connect with Albedo"}
            </button>
          </span>
        </Alert>
      )}
      {w.wrongNetwork && (
        <Alert tone="error" title="Wrong network">
          {w.walletName ?? "Your wallet"} is on <b>{w.network}</b>. Ajo Circle runs on Stellar <b>Testnet</b> — switch
          networks in your wallet&apos;s settings.
        </Alert>
      )}
      {showError && <Alert tone="error">{w.error}</Alert>}
    </div>
  );
}
