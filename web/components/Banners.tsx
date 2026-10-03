"use client";
import { useWallet } from "./WalletProvider";
import { Alert } from "./ui";
import { missingConfig } from "@/lib/config";

/** Status banners live in normal page flow, directly under the sticky header. */
export function Banners() {
  const w = useWallet();
  const missing = missingConfig();
  if (!(missing.length > 0 || w.installed === false || w.wrongNetwork || w.error)) return null;
  return (
    <div className="mx-auto w-full max-w-6xl space-y-2 px-4 pt-4 sm:px-8">
      {missing.length > 0 && (
        <Alert tone="error" title="App is not configured">
          Set {missing.join(", ")} in <code className="font-mono text-xs">web/.env.local</code> (see .env.example)
          and restart.
        </Alert>
      )}
      {w.installed === false && (
        <Alert tone="info">
          Browsing read-only. To create circles or contribute, add the{" "}
          <a
            className="font-medium text-clay-deep underline underline-offset-2"
            href="https://www.freighter.app/"
            target="_blank"
            rel="noreferrer"
          >
            Freighter wallet
          </a>{" "}
          and reload.
        </Alert>
      )}
      {w.wrongNetwork && (
        <Alert tone="error" title="Wrong network">
          Freighter is on <b>{w.network}</b>. Ajo Circle runs on Stellar <b>Testnet</b> — switch in Freighter →
          Settings → Network.
        </Alert>
      )}
      {w.error && <Alert tone="error">{w.error}</Alert>}
    </div>
  );
}
