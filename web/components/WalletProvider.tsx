"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { config } from "@/lib/config";
import { kitError, loadWalletKit, WALLET_NAMES, type WalletKit } from "@/lib/walletKit";

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
  disconnect: () => Promise<void>;
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

  /** Ask the wallet which network it is on. Most wallets (all but Freighter) don't say: degrade to null. */
  const refreshNetwork = useCallback(async (kit: WalletKit) => {
    try {
      const n = await kit.getNetwork();
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
        const kit = await loadWalletKit();
        if (cancelled) return;
        kitRef.current = kit;
        const { address: a } = await kit.getAddress();
        if (cancelled) return;
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
    setConnecting(true);
    try {
      const kit = await loadWalletKit();
      kitRef.current = kit;
      const { address: a } = await kit.authModal();
      setAddress(a);
      setWalletId(selectedId(kit));
      await refreshNetwork(kit);
    } catch (e) {
      const err = kitError(e);
      // Closing the picker is not an error.
      if (!/closed the modal/i.test(err.message)) setError(err.message);
    } finally {
      setConnecting(false);
    }
  }, [refreshNetwork]);

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

  const value = useMemo<WalletState>(
    () => ({
      ready,
      address,
      walletId,
      walletName: walletId ? (WALLET_NAMES[walletId] ?? walletId) : null,
      network,
      networkPassphrase,
      wrongNetwork: !!networkPassphrase && networkPassphrase !== config.networkPassphrase,
      connecting,
      error,
      connect,
      disconnect,
    }),
    [ready, address, walletId, network, networkPassphrase, connecting, error, connect, disconnect],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside <WalletProvider>");
  return ctx;
}
