"use client";
import { useCallback, useEffect, useState } from "react";
import { addToken } from "@stellar/freighter-api";
import { useWallet } from "./WalletProvider";
import { Alert, Button, Card, TxLink } from "./ui";
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
    <Card className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-stone-900">Your testnet wallet</h3>
        <button onClick={refresh} className="text-xs font-medium text-emerald-700 hover:underline">
          Refresh
        </button>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {status && (
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-xl bg-stone-50 p-3">
            <dt className="text-stone-500">XLM (fees)</dt>
            <dd className="text-lg font-bold">{status.exists ? Number(status.xlm).toFixed(2) : "—"}</dd>
          </div>
          <div className="rounded-xl bg-stone-50 p-3">
            <dt className="text-stone-500">{config.tokenCode} (test)</dt>
            <dd className="text-lg font-bold">
              {status.hasTrustline ? formatAmount(status.tokenBalance) : "no trustline"}
            </dd>
          </div>
        </dl>
      )}
      {status && !status.exists && (
        <Alert tone="warn">
          This account isn&apos;t funded on testnet yet.
          <div className="mt-2">
            <Button
              variant="secondary"
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
        <Alert tone="warn">
          Missing trustline: your account must trust the test {config.tokenCode} asset before it can
          hold or contribute it.
          <div className="mt-2">
            <Button
              variant="secondary"
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
        <Alert tone="warn">
          Low balance: you have {formatAmount(status!.tokenBalance)} {config.tokenCode} but need{" "}
          {formatAmount(need!)}. Ask the demo operator to run{" "}
          <code className="break-all">./scripts/fund-test-usdc.sh {w.address}</code>.
        </Alert>
      )}
      {status?.hasTrustline && (
        <button
          className="text-xs font-medium text-stone-500 hover:underline"
          onClick={() =>
            run("add", async () => {
              const r = await addToken({
                contractId: config.tokenId,
                networkPassphrase: config.networkPassphrase,
              });
              if (r.error) throw new Error(r.error.message);
              return "Token added to Freighter.";
            })
          }
        >
          Show {config.tokenCode} in Freighter
        </button>
      )}
      {msg && <Alert tone="success">{msg}</Alert>}
      {err && <Alert tone="error">{err}</Alert>}
    </Card>
  );
}
