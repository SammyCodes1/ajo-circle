"use client";
// Client-only loader for Stellar Wallets Kit (@creit.tech/stellar-wallets-kit).
// The kit touches window/localStorage at import time, so it is only ever loaded
// through dynamic import() from effects / event handlers — never during SSR.
import type { StellarWalletsKit as Kit } from "@creit.tech/stellar-wallets-kit/sdk";
import type { ModuleInterface, Networks, SwkAppTheme } from "@creit.tech/stellar-wallets-kit/types";
import { config } from "./config";
import { attachWc, setWcDebug, type WcModuleLike } from "./wcSession";

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

/**
 * Wallet in-app (dApp) browsers announce themselves with an injected marker object.
 * Freighter mobile injects exactly `window.stellar = { provider: "freighter", platform: "mobile", version }`
 * and nothing else — no signing API. It talks to dApps only through WalletConnect.
 * (stellar/freighter-mobile: src/components/screens/DiscoveryScreen/components/WebViewContainer.tsx)
 */
export type WalletBrowser = { provider: string; platform: string; version?: string };

export function walletBrowser(): WalletBrowser | null {
  if (typeof window === "undefined") return null;
  const s = (window as unknown as { stellar?: Partial<WalletBrowser> }).stellar;
  if (s && typeof s.provider === "string" && s.platform === "mobile")
    return { provider: s.provider, platform: s.platform, version: s.version };
  // Fallback: Freighter mobile's WebView user agent ends with "FreighterMobile/<version>".
  const ua = /FreighterMobile\/([\w.]+)/.exec(navigator.userAgent);
  return ua ? { provider: "freighter", platform: "mobile", version: ua[1] } : null;
}

export function inFreighterMobile(): boolean {
  return walletBrowser()?.provider === "freighter";
}

let kitPromise: Promise<WalletKit> | null = null;

/** WalletConnect explorer ids of Stellar wallets (same ones the kit features). */
const STELLAR_WC_WALLETS = [
  "997a355c8f682468706a76cff1b004a7115f505fb962dac54b6e9b442dd1c380", // Freighter
  "76a3d548a08cf402f5c7d021f24fd2881d767084b387a5325df88bc3d4b6f21b", // LOBSTR
  "9c78aee7d8a771255942334d06d2cbab89e2178ee49fee4ea3b6c78032fcac76", // Scopuly
];

export { freighterWcDeepLink } from "./wcSession";

type WcModule = ModuleInterface & { isAvailable(): Promise<boolean> };
let wcModule: WcModule | null = null;
let baseModules: ModuleInterface[] = [];
let wcDropped = false;

/**
 * The kit's WalletConnect module initialises its SignClient asynchronously (relay handshake)
 * and reports `isAvailable() === false` until then. The picker treats unavailable wallets as
 * "not installed" and opens their productUrl — https://walletconnect.com/ — when tapped.
 * So wait until it is really ready before opening the picker.
 */
export async function waitForWalletConnect(timeoutMs = 10000): Promise<boolean> {
  if (!walletConnectProjectId) return false;
  const kit = await loadWalletKit();
  if (!wcModule || wcDropped) return false;
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await wcModule.isAvailable().catch(() => false)) return true;
    await new Promise((res) => setTimeout(res, 150));
  }
  // Never let the picker show a WalletConnect entry that would just link to walletconnect.com.
  wcDropped = true;
  kit.init({ modules: baseModules });
  return false;
}

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
    const inApp = walletBrowser();
    setWcDebug(
      {
        inApp: inApp ? `${inApp.provider}/${inApp.platform} v${inApp.version ?? "?"}` : "no",
        marker: JSON.stringify((window as unknown as { stellar?: unknown }).stellar ?? null),
        ua: navigator.userAgent,
        projectId: !!walletConnectProjectId,
      },
      "kit loading",
    );
    // Order = order in the picker (installed wallets first, then the rest).
    // Inside a wallet's in-app browser, browser extensions can never be installed, so only
    // offer wallets that work there (WalletConnect wrapper, Albedo web, xBull PWA) and
    // never show "Install" prompts.
    const modules: ModuleInterface[] = inApp
      ? [new albedo.AlbedoModule(), new xbull.xBullModule()]
      : [
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
      // Inside Freighter mobile the kit treats WalletConnect as the "platform wrapper"
      // and connects through it automatically when the picker opens.
      baseModules = [...modules];
      const mod = new wc.WalletConnectModule({
          projectId: walletConnectProjectId,
          metadata: {
            name: "Ajo Circle",
            description: "Rotating savings circles on Stellar",
            url: window.location.origin,
            icons: [`${window.location.origin}/icon-512.png`, `${window.location.origin}/icon.svg`],
          },
          allowedChains: [wc.WalletConnectTargetChain.TESTNET],
          // Only list wallets that speak Stellar over WalletConnect (the default list is 550+ EVM wallets).
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          appKitOptions: { includeWalletIds: STELLAR_WC_WALLETS, featuredWalletIds: STELLAR_WC_WALLETS } as any,
        }) as unknown as WcModule;
      wcModule = mod;
      // Our own proposal / handoff / timeout / signing on top of the kit's SignClient + AppKit
      // (see lib/wcSession.ts for why the kit's built-in flow can hang with Freighter).
      attachWc(mod as unknown as WcModuleLike, inApp?.provider === "freighter");
      modules[inApp ? "unshift" : "push"](mod);
    }
    StellarWalletsKit.init({
      modules,
      network: config.networkPassphrase as Networks,
      theme: kitTheme,
      authModal: { showInstallLabel: !inApp, hideUnsupportedWallets: !!inApp },
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
