"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { config } from "@/lib/config";
import { getAccountStatus } from "@/lib/stellar";
import {
  inFreighterMobile,
  kitError,
  loadWalletKit,
  WALLET_NAMES,
  preparePicker,
  walletBrowser,
  walletConnectProjectId,
  type WalletBrowser,
  type WalletKit,
} from "@/lib/walletKit";
import { beginWcFlow, CANCELLED, dismissWcSheet, endWcFlow, testnetSession, waitSignClient, withDeadline } from "@/lib/wcSession";
import { WcConnectSheet } from "./WcConnectSheet";
import { LocalWalletLayer } from "./LocalWallet";
import {
  consumeFreshLocalWallet,
  createLocalWallet,
  forgetLocalWallet,
  importLocalWallet,
  LOCAL_WALLET_ID,
  localWalletInfo,
  onLocalWalletChange,
  runLocalSetup,
  type LocalWalletInfo,
} from "@/lib/localWallet";

interface WalletState {
  /** true once we know whether a previous session exists (avoids header flicker). */
  ready: boolean;
  address: string | null;
  walletId: string | null;
  walletName: string | null;
  /** Network reported by the wallet; null when the wallet doesn't expose it. */
  networkPassphrase: string | null;
  network: string | null;
  wrongNetwork: boolean;
  connecting: boolean;
  error: string | null;
  connect: () => Promise<void>;
  /** Connect a specific kit module directly (e.g. "albedo"), bypassing the picker. */
  connectWith: (id: string) => Promise<void>;
  disconnect: () => Promise<void>;
  /** Set when the page runs inside a wallet's in-app browser (e.g. Freighter mobile). */
  inAppBrowser: WalletBrowser | null;
  /** Freighter mobile's browser only connects via WalletConnect, which isn't configured here. */
  needsWalletConnect: boolean;
  /** Built-in testnet wallet stored in this browser (null when none). */
  localWallet: LocalWalletInfo | null;
  isLocal: boolean;
  /** Create (or reuse) the built-in testnet wallet, connect it and run auto-setup. */
  startTestnetWallet: () => Promise<void>;
  importTestnetWallet: (secret: string) => Promise<void>;
  forgetTestnetWallet: () => Promise<void>;
}

const WalletContext = createContext<WalletState | null>(null);

// The kit persists the chosen wallet + address under these localStorage keys.
const KIT_MODULE_KEY = "@StellarWalletsKit/selectedModuleId";

function selectedId(kit: WalletKit): string | null {
  try {
    return kit.selectedModule.productId;
  } catch {
    return null;
  }
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [walletId, setWalletId] = useState<string | null>(null);
  const [network, setNetwork] = useState<string | null>(null);
  const [networkPassphrase, setPassphrase] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const kitRef = useRef<WalletKit | null>(null);
  const [localWallet, setLocalWallet] = useState<LocalWalletInfo | null>(null);
  useEffect(() => {
    const sync = () => setLocalWallet(localWalletInfo());
    sync();
    return onLocalWalletChange(sync);
  }, []);
  const [inAppBrowser, setInAppBrowser] = useState<WalletBrowser | null>(null);
  const needsWalletConnect = !!inAppBrowser && inAppBrowser.provider === "freighter" && !walletConnectProjectId;

  // Detect wallet in-app browsers on the client (the marker is injected before page scripts run).
  useEffect(() => {
    const b = walletBrowser();
    setInAppBrowser(b);
    // Inside a wallet browser the user is here to connect: start WalletConnect's relay
    // handshake now so the first tap pairs immediately.
    // Mobile browsers load it too, so the picker usually has the WalletConnect entry ready.
    if (walletConnectProjectId && (b || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent))) {
      loadWalletKit().catch(() => {});
    }
  }, []);

  /** Ask the wallet which network it is on. Most wallets (all but Freighter) don't say: degrade to null. */
  const refreshNetwork = useCallback(async (kit: WalletKit) => {
    try {
      const n = await withDeadline(kit.getNetwork(), 4000, "getNetwork timeout");
      setNetwork(n.network);
      setPassphrase(n.networkPassphrase);
    } catch {
      setNetwork(null);
      setPassphrase(null);
    }
  }, []);

  // Restore a remembered wallet on reload. The kit is only loaded if one was saved.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let saved: string | null = null;
      try {
        saved = window.localStorage.getItem(KIT_MODULE_KEY);
      } catch {}
      if (!saved) return setReady(true);
      try {
        const kit = await withDeadline(loadWalletKit(), 12000, "wallet kit load timeout");
        if (cancelled) return;
        kitRef.current = kit;
        const { address: a } = await kit.getAddress();
        if (cancelled) return;
        if (saved === LOCAL_WALLET_ID) {
          if (localWalletInfo()?.publicKey !== a) {
            kit.disconnect().catch(() => {});
            return;
          }
          // Setup interrupted (page closed mid-way)? Finish funding/trustline quietly.
          getAccountStatus(a)
            .then((st) => {
              if (!st.exists || !st.hasTrustline) runLocalSetup(a);
            })
            .catch(() => {});
        }
        if (saved === "wallet_connect") {
          // The kit remembers the address; the WalletConnect session itself lives in the SignClient.
          // Only treat the wallet as connected if that session is still alive on Testnet.
          const client = await waitSignClient(8000).catch(() => null);
          if (cancelled) return;
          const live = client ? testnetSession(client) : null;
          if (!live) {
            if (client) kit.disconnect().catch(() => {});
            return;
          }
          await preparePicker(kit, 0); // make sure the WalletConnect module is the kit's active one
          kit.setWallet("wallet_connect");
          setAddress(live.address);
          setWalletId("wallet_connect");
          return;
        }
        setAddress(a);
        setWalletId(selectedId(kit));
        await refreshNetwork(kit);
      } catch {
        // No stored address / wallet unavailable: stay disconnected.
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshNetwork]);

  // Freighter can report account/network switches; poll it like the old watcher did.
  useEffect(() => {
    if (walletId !== "freighter" || !address) return;
    const id = window.setInterval(async () => {
      const kit = kitRef.current;
      if (!kit) return;
      try {
        const { address: a } = await kit.selectedModule.getAddress({ skipRequestAccess: true });
        if (a && a !== address) setAddress(a);
      } catch {}
      await refreshNetwork(kit);
    }, 3000);
    return () => window.clearInterval(id);
  }, [walletId, address, refreshNetwork]);

  const connect = useCallback(async () => {
    setError(null);
    if (inFreighterMobile() && !walletConnectProjectId) {
      // The kit would list Freighter as "not installed" here; explain instead (see Banners).
      setError("Freighter mobile connects through WalletConnect, which isn't enabled on this site yet.");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    // Every await below has a deadline: the button never spins for more than ~12 s.
    const inApp = inFreighterMobile();
    // In Freighter's browser show the progress sheet right away, before any network work.
    const f = inApp ? beginWcFlow("freighter") : null;
    setConnecting(!inApp);
    try {
      const kit = await withDeadline(
        loadWalletKit(),
        9500,
        "Couldn't load the wallet code. Check the connection and try again.",
        f,
      );
      kitRef.current = kit;
      let a: string;
      if (inApp) {
        // Freighter's in-app browser: nothing to pick. Skip the kit picker and the AppKit modal and
        // hand the WalletConnect pairing link straight to Freighter (lib/wcSession.ts; the sheet
        // shows progress, its own deadlines and fallbacks).
        kit.setWallet("wallet_connect");
        ({ address: a } = await kit.fetchAddress());
      } else {
        // Don't hold the picker hostage to WalletConnect: wait briefly, else open without it.
        if (walletConnectProjectId) await preparePicker(kit, 2500);
        const picked = kit.authModal();
        setConnecting(false); // the picker (or the wallet's own prompt) is on screen now
        ({ address: a } = await picked);
        // Picked the built-in wallet and it was just created: fund + trustline + test USDC.
        if (selectedId(kit) === LOCAL_WALLET_ID && consumeFreshLocalWallet()) runLocalSetup(a);
      }
      setAddress(a);
      setWalletId(selectedId(kit));
      await refreshNetwork(kit);
    } catch (e) {
      const err = kitError(e);
      if (f) endWcFlow(err);
      // Closing the picker / sheet is not an error.
      if (!/closed the modal/i.test(err.message) && !err.message.includes(CANCELLED)) setError(err.message);
    } finally {
      setConnecting(false);
    }
  }, [refreshNetwork]);

  const connectWith = useCallback(
    async (id: string) => {
      setError(null);
      setConnecting(true);
      try {
        const kit = await loadWalletKit();
        kitRef.current = kit;
        kit.setWallet(id);
        const { address: a } = await kit.fetchAddress();
        setAddress(a);
        setWalletId(selectedId(kit));
        await refreshNetwork(kit);
      } catch (e) {
        setError(kitError(e).message);
      } finally {
        setConnecting(false);
      }
    },
    [refreshNetwork],
  );

  /** Connect the built-in testnet wallet through the kit (so every signing flow routes to it). */
  const connectLocal = useCallback(
    async (setupAfter: boolean) => {
      setError(null);
      setConnecting(true);
      try {
        const kit = await withDeadline(loadWalletKit(), 9500, "Couldn't load the wallet code. Check the connection and try again.");
        kitRef.current = kit;
        dismissWcSheet();
        kit.setWallet(LOCAL_WALLET_ID);
        const { address: a } = await kit.fetchAddress();
        consumeFreshLocalWallet();
        setAddress(a);
        setWalletId(LOCAL_WALLET_ID);
        await refreshNetwork(kit);
        if (setupAfter) runLocalSetup(a);
      } catch (e) {
        setError(kitError(e).message);
        throw e;
      } finally {
        setConnecting(false);
      }
    },
    [refreshNetwork],
  );

  const startTestnetWallet = useCallback(async () => {
    if (!localWalletInfo()) createLocalWallet();
    // New wallets get the full setup; existing ones only fill in what's missing.
    await connectLocal(true).catch(() => {});
  }, [connectLocal]);

  const importTestnetWallet = useCallback(
    async (secret: string) => {
      importLocalWallet(secret); // throws on an invalid key (shown by the dialog)
      await connectLocal(true);
    },
    [connectLocal],
  );

  const disconnect = useCallback(async () => {
    try {
      await (kitRef.current ?? (await loadWalletKit())).disconnect();
    } catch {}
    setAddress(null);
    setWalletId(null);
    setNetwork(null);
    setPassphrase(null);
    setError(null);
  }, []);

  const forgetTestnetWallet = useCallback(async () => {
    if (walletId === LOCAL_WALLET_ID) await disconnect();
    forgetLocalWallet();
  }, [walletId, disconnect]);

  const value = useMemo<WalletState>(
    () => ({
      ready,
      address,
      walletId,
      walletName: walletId
        ? walletId === "wallet_connect" && inAppBrowser?.provider === "freighter"
          ? "Freighter"
          : (WALLET_NAMES[walletId] ?? walletId)
        : null,
      network,
      networkPassphrase,
      wrongNetwork: !!networkPassphrase && networkPassphrase !== config.networkPassphrase,
      connecting,
      error,
      connect,
      connectWith,
      disconnect,
      inAppBrowser,
      needsWalletConnect,
      localWallet,
      isLocal: walletId === LOCAL_WALLET_ID,
      startTestnetWallet,
      importTestnetWallet,
      forgetTestnetWallet,
    }),
    [
      ready,
      address,
      walletId,
      network,
      networkPassphrase,
      connecting,
      error,
      connect,
      connectWith,
      disconnect,
      inAppBrowser,
      needsWalletConnect,
      localWallet,
      startTestnetWallet,
      importTestnetWallet,
      forgetTestnetWallet,
    ],
  );

  return (
    <WalletContext.Provider value={value}>
      {children}
      <WcConnectSheet />
      <LocalWalletLayer />
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside <WalletProvider>");
  return ctx;
}
