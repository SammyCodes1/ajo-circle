"use client";
import { useCallback, useEffect, useState } from "react";
import { useWallet } from "./WalletProvider";
import { Alert, Button, Card, Skeleton, TxLink } from "./ui";
import { AccountStatus, addTrustline, fundWithFriendbot, getAccountStatus } from "@/lib/stellar";
import { config } from "@/lib/config";
import { formatAmount } from "@/lib/format";
import { friendlyError } from "@/lib/errors";

/** Shows the connected account's testnet readiness: XLM, USDC trustline, USDC balance. */
export function useAccountStatus() {
  const { address } = useWallet();
  const [status, setStatus] = useState<AccountStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    if (!address) return setStatus(null);
    try {
      setStatus(await getAccountStatus(address));
      setError(null);
    } catch (e) {
      setError(friendlyError(e));
    }
  }, [address]);
  useEffect(() => {
    refresh();
  }, [refresh]);
  return { status, error, refresh };
}

export function AccountPanel({ need }: { need?: bigint }) {
  const w = useWallet();
  const { status, error, refresh } = useAccountStatus();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<React.ReactNode>(null);
  const [err, setErr] = useState<string | null>(null);

  if (!w.address) return null;

  const run = async (key: string, fn: () => Promise<React.ReactNode>) => {
    setBusy(key);
    setErr(null);
    setMsg(null);
    try {
      setMsg(await fn());
      await refresh();
    } catch (e) {
      setErr(friendlyError(e, "trustline"));
    } finally {
      setBusy(null);
    }
  };

  const low = status && need !== undefined && status.hasTrustline && status.tokenBalance < need;

  return (
    <Card className="space-y-4 !p-5">
      <div className="flex items-baseline justify-between">
        <h3 className="font-display text-lg text-ink">Your wallet</h3>
        <button
          onClick={refresh}
          className="-my-2 inline-flex min-h-11 items-center px-1 text-xs text-muted underline-offset-2 transition-colors hover:text-ink hover:underline"
        >
          Refresh
        </button>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {!status && !error && (
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line">
          {[0, 1].map((i) => (
            <div key={i} className="space-y-2 bg-ivory p-3">
              <Skeleton className="h-3 w-12" />
              <Skeleton className="h-6 w-16" />
            </div>
          ))}
        </div>
      )}
      {status && (
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line text-sm">
          <div className="bg-ivory p-3">
            <dt className="text-xs text-muted">XLM · for fees</dt>
            <dd className="font-numeral mt-1 text-xl text-ink">
              {status.exists ? Number(status.xlm).toLocaleString("en-US", { maximumFractionDigits: 2 }) : "—"}
            </dd>
          </div>
          <div className="bg-ivory p-3">
            <dt className="text-xs text-muted">{config.tokenCode} · test</dt>
            <dd className={`mt-1 ${status.hasTrustline ? "font-numeral text-xl text-ink" : "pt-1 text-sm text-ochre"}`}>
              {status.hasTrustline ? formatAmount(status.tokenBalance) : "No trustline"}
            </dd>
          </div>
        </dl>
      )}
      {status && !status.exists && (
        <Alert tone="warn" title="Account not funded yet">
          New testnet accounts need a little XLM for fees.
          <div className="mt-2.5">
            <Button
              variant="secondary"
              className="!py-2"
              loading={busy === "fb"}
              onClick={() =>
                run("fb", async () => {
                  await fundWithFriendbot(w.address!);
                  return "Funded with 10,000 testnet XLM.";
                })
              }
            >
              Fund with Friendbot
            </Button>
          </div>
        </Alert>
      )}
      {status && status.exists && !status.hasTrustline && (
        <Alert tone="warn" title="Missing trustline">
          Your account must trust the test {config.tokenCode} asset before it can hold or contribute it.
          <div className="mt-2.5">
            <Button
              variant="secondary"
              className="!py-2"
              loading={busy === "tl"}
              onClick={() =>
                run("tl", async () => {
                  const h = await addTrustline(w.address!);
                  return (
                    <>
                      Trustline added. <TxLink hash={h} />
                    </>
                  );
                })
              }
            >
              Add {config.tokenCode} trustline
            </Button>
          </div>
        </Alert>
      )}
      {low && (
        <Alert tone="warn" title="Low balance">
          You have {formatAmount(status!.tokenBalance)} {config.tokenCode} but need {formatAmount(need!)}. Ask the
          demo operator to run{" "}
          <code className="break-all font-mono text-xs">./scripts/fund-test-usdc.sh {w.address}</code>
        </Alert>
      )}
      {msg && <Alert tone="success">{msg}</Alert>}
      {err && <Alert tone="error">{err}</Alert>}
    </Card>
  );
}
