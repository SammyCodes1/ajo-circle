"use client";
import { useSyncExternalStore } from "react";
import { ajo } from "./ajo";
import { config } from "./config";
import { simulateRead } from "./stellar";
import { shortAddr } from "./format";

// The token the deployed contract actually pins (read on-chain), compared with
// the configured test USDC. It's the project's own testnet asset, not Circle's USDC.

export interface TokenInfo {
  state: "loading" | "ok" | "mismatch" | "error";
  /** Token address pinned by the contract (`token()`). */
  pinned?: string;
  /** SAC name(), e.g. "USDC:GDV2…NDAA". */
  name?: string;
  code: string;
  issuer: string;
  /** e.g. "USDC · issuer GDV2…NDAA (testnet)". */
  label: string;
}

const fallbackLabel = () =>
  `${config.tokenCode} · issuer ${config.tokenIssuer ? shortAddr(config.tokenIssuer) : "?"} (testnet)`;

let info: TokenInfo = {
  state: "loading",
  code: config.tokenCode,
  issuer: config.tokenIssuer,
  label: fallbackLabel(),
};
let started = false;
const listeners = new Set<() => void>();

function set(next: TokenInfo) {
  info = next;
  listeners.forEach((f) => f());
}

async function load() {
  try {
    const [pinned, name] = await Promise.all([
      ajo.token(),
      simulateRead<string>(config.tokenId, "name").catch(() => undefined),
    ]);
    const [code, issuer] = (name ?? "").split(":");
    const c = code || config.tokenCode;
    const iss = issuer || config.tokenIssuer;
    set({
      state: pinned === config.tokenId ? "ok" : "mismatch",
      pinned,
      name,
      code: c,
      issuer: iss,
      label: `${c} · issuer ${iss ? shortAddr(iss) : "?"} (testnet)`,
    });
  } catch {
    set({ ...info, state: "error" });
  }
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  if (!started && typeof window !== "undefined" && config.contractId && config.tokenId) {
    started = true;
    void load();
  }
  return () => listeners.delete(fn);
}

export function useTokenInfo(): TokenInfo {
  return useSyncExternalStore(subscribe, () => info, () => info);
}

/** A circle's token must be the configured test USDC (v2 pins it, but check anyway). */
export const isKnownToken = (token: string) => token === config.tokenId;
