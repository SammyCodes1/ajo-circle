"use client";
import {
  getAddress,
  getNetworkDetails,
  isAllowed,
  isConnected,
  requestAccess,
  WatchWalletChanges,
} from "@stellar/freighter-api";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { config } from "@/lib/config";

interface WalletState {
  installed: boolean | null; // null = still checking
  address: string | null;
  networkPassphrase: string | null;
  network: string | null;
  wrongNetwork: boolean;
  connecting: boolean;
  error: string | null;
  connect: () => Promise<void>;
}

const WalletContext = createContext<WalletState | null>(null);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [network, setNetwork] = useState<string | null>(null);
  const [networkPassphrase, setPassphrase] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshNetwork = useCallback(async () => {
    const n = await getNetworkDetails();
    if (!n.error) {
      setNetwork(n.network);
      setPassphrase(n.networkPassphrase);
    }
  }, []);

  // Detect Freighter and restore a previous connection silently.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const c = await isConnected();
      if (cancelled) return;
      const ok = !c.error && c.isConnected;
      setInstalled(ok);
      if (!ok) return;
      const allowed = await isAllowed();
      if (allowed.isAllowed) {
        const a = await getAddress();
        if (!cancelled && a.address) setAddress(a.address);
      }
      await refreshNetwork();
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshNetwork]);

  // React to account / network switches inside Freighter.
  useEffect(() => {
    if (!installed || !address) return;
    const watcher = new WatchWalletChanges(2000);
    watcher.watch(({ address: a, network: n, networkPassphrase: p }) => {
      if (a) setAddress(a);
      setNetwork(n);
      setPassphrase(p);
    });
    return () => watcher.stop();
  }, [installed, address]);

  const connect = useCallback(async () => {
    setError(null);
    setConnecting(true);
    try {
      const c = await isConnected();
      if (c.error || !c.isConnected) {
        setInstalled(false);
        throw new Error("Freighter wallet not detected. Install it from freighter.app and reload.");
      }
      setInstalled(true);
      const res = await requestAccess();
      if (res.error) throw new Error(res.error.message ?? "Connection rejected");
      setAddress(res.address);
      await refreshNetwork();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setConnecting(false);
    }
  }, [refreshNetwork]);

  const value = useMemo<WalletState>(
    () => ({
      installed,
      address,
      network,
      networkPassphrase,
      wrongNetwork: !!networkPassphrase && networkPassphrase !== config.networkPassphrase,
      connecting,
      error,
      connect,
    }),
    [installed, address, network, networkPassphrase, connecting, error, connect],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside <WalletProvider>");
  return ctx;
}
