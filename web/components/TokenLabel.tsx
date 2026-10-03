"use client";
import { useTokenInfo } from "@/lib/token";

/** "USDC · issuer GDV2…NDAA (testnet)", from the token contract's on-chain name(). */
export function TokenLabel({ className = "" }: { className?: string }) {
  const t = useTokenInfo();
  return (
    <span className={className} title={t.name ?? undefined}>
      {t.label}
    </span>
  );
}
