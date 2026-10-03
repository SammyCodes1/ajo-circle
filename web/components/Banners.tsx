"use client";
import { useWallet } from "./WalletProvider";
import { Alert } from "./ui";
import { missingConfig } from "@/lib/config";

/** Status banners live in normal page flow, directly under the sticky header. */
export function Banners() {
  const w = useWallet();
  const missing = missingConfig();
  const readOnly = w.ready && !w.address;
  if (!(missing.length > 0 || readOnly || w.wrongNetwork || w.error)) return null;
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
          — Freighter, xBull, LOBSTR and more, or Albedo right in the browser with nothing to install.
        </Alert>
      )}
      {w.wrongNetwork && (
        <Alert tone="error" title="Wrong network">
          {w.walletName ?? "Your wallet"} is on <b>{w.network}</b>. Ajo Circle runs on Stellar <b>Testnet</b> — switch
          networks in your wallet&apos;s settings.
        </Alert>
      )}
      {w.error && <Alert tone="error">{w.error}</Alert>}
    </div>
  );
}
