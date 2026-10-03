"use client";
// Client-only loader for Stellar Wallets Kit (@creit.tech/stellar-wallets-kit).
// The kit touches window/localStorage at import time, so it is only ever loaded
// through dynamic import() from effects / event handlers — never during SSR.
import type { StellarWalletsKit as Kit } from "@creit.tech/stellar-wallets-kit/sdk";
import type { ModuleInterface, Networks, SwkAppTheme } from "@creit.tech/stellar-wallets-kit/types";
import { config } from "./config";

export type WalletKit = typeof Kit;

/** Optional: WalletConnect needs a Reown/WalletConnect Cloud project id. Omitted when unset. */
export const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";

/** Kit theme mapped to the Ajo Circle paper / ink / clay tokens. */
export const kitTheme: SwkAppTheme = {
  background: "#faf9f5",
  "background-secondary": "#f5f1ea",
  "foreground-strong": "#1f1e1d",
  foreground: "#1f1e1d",
  "foreground-secondary": "#3d3a35",
  primary: "#b5532f",
  "primary-foreground": "#ffffff",
  transparent: "rgba(0, 0, 0, 0)",
  lighter: "#faf9f5",
  light: "#f5f1ea",
  "light-gray": "#cfc4b2",
  gray: "#6b6560",
  danger: "#9e3f2c",
  border: "#e2dacc",
  shadow: "0 18px 50px -20px rgb(31 30 29 / 0.45), 0 0 0 1px rgb(31 30 29 / 0.06)",
  "border-radius": "0.75rem",
  "font-family": "var(--font-inter-tight), ui-sans-serif, system-ui, sans-serif",
};

let kitPromise: Promise<WalletKit> | null = null;

export function loadWalletKit(): Promise<WalletKit> {
  if (typeof window === "undefined") return Promise.reject(new Error("Wallet kit is browser-only"));
  kitPromise ??= (async () => {
    const [{ StellarWalletsKit }, freighter, albedo, xbull, lobstr, hana, rabet] = await Promise.all([
      import("@creit.tech/stellar-wallets-kit/sdk"),
      import("@creit.tech/stellar-wallets-kit/modules/freighter"),
      import("@creit.tech/stellar-wallets-kit/modules/albedo"),
      import("@creit.tech/stellar-wallets-kit/modules/xbull"),
      import("@creit.tech/stellar-wallets-kit/modules/lobstr"),
      import("@creit.tech/stellar-wallets-kit/modules/hana"),
      import("@creit.tech/stellar-wallets-kit/modules/rabet"),
    ]);
    // Order = order in the picker (installed wallets first, then the rest).
    const modules: ModuleInterface[] = [
      new freighter.FreighterModule(),
      new albedo.AlbedoModule(),
      new xbull.xBullModule(),
      new lobstr.LobstrModule(),
      new hana.HanaModule(),
      new rabet.RabetModule(),
    ];
    if (walletConnectProjectId) {
      // Aliased to a no-op stub in next.config.ts when no project id is configured,
      // so the (large) WalletConnect/Reown dependency tree is never bundled.
      const wc = await import("@creit.tech/stellar-wallets-kit/modules/wallet-connect");
      modules.push(
        new wc.WalletConnectModule({
          projectId: walletConnectProjectId,
          metadata: {
            name: "Ajo Circle",
            description: "Rotating savings circles on Stellar",
            url: window.location.origin,
            icons: [`${window.location.origin}/icon.svg`],
          },
          allowedChains: [wc.WalletConnectTargetChain.TESTNET],
        }),
      );
    }
    StellarWalletsKit.init({
      modules,
      network: config.networkPassphrase as Networks,
      theme: kitTheme,
      authModal: { showInstallLabel: true, hideUnsupportedWallets: false },
    });
    return StellarWalletsKit;
  })();
  kitPromise.catch(() => (kitPromise = null));
  return kitPromise;
}

/** Kit errors are plain `{ code, message }` objects; turn them into Errors. */
export function kitError(e: unknown): Error {
  if (e instanceof Error) return e;
  const m = (e as { message?: unknown })?.message;
  return new Error(typeof m === "string" && m ? m : typeof e === "string" ? e : "Wallet request failed");
}

export const WALLET_NAMES: Record<string, string> = {
  freighter: "Freighter",
  albedo: "Albedo",
  xbull: "xBull",
  lobstr: "LOBSTR",
  hana: "Hana",
  rabet: "Rabet",
  wallet_connect: "WalletConnect",
};
