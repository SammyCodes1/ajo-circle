"use client";
import {
  Account,
  Address,
  Asset,
  BASE_FEE,
  Contract,
  Horizon,
  Operation,
  TransactionBuilder,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { signTransaction } from "@stellar/freighter-api";
import { config } from "./config";

export const rpcServer = new rpc.Server(config.rpcUrl);
export const horizon = new Horizon.Server(config.horizonUrl);

/** Simulate a read-only contract call and decode the result to native JS. */
export async function simulateRead<T = unknown>(
  contractId: string,
  method: string,
  args: xdr.ScVal[] = [],
): Promise<T> {
  // Simulation does not need a real sequence number; any funded account works.
  const source = new Account(config.readAccount, "0");
  const tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(30)
    .build();
  const sim = await rpcServer.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error);
  if (!sim.result) throw new Error(`No result from ${method}`);
  return scValToNative(sim.result.retval) as T;
}

export interface TxResult {
  hash: string;
  returnValue?: unknown;
}

async function signAndSend(built: ReturnType<TransactionBuilder["build"]>, address: string) {
  const signed = await signTransaction(built.toXDR(), {
    networkPassphrase: config.networkPassphrase,
    address,
  });
  if (signed.error) throw new Error(signed.error.message ?? String(signed.error));
  return TransactionBuilder.fromXDR(signed.signedTxXdr, config.networkPassphrase);
}

/** Build, simulate/prepare, sign with Freighter, submit and wait for a contract call. */
export async function invokeWrite(
  address: string,
  contractId: string,
  method: string,
  args: xdr.ScVal[],
): Promise<TxResult> {
  const account = await rpcServer.getAccount(address);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(120)
    .build();

  // prepareTransaction simulates and throws with the contract error on failure.
  const prepared = await rpcServer.prepareTransaction(tx);
  const signedTx = await signAndSend(prepared, address);
  const sent = await rpcServer.sendTransaction(signedTx);
  if (sent.status === "ERROR") {
    throw new Error(`Transaction rejected by the network (${sent.hash}). Check your XLM balance and retry.`);
  }
  const final = await rpcServer.pollTransaction(sent.hash, {
    attempts: 30,
    sleepStrategy: () => 1500,
  });
  if (final.status === rpc.Api.GetTransactionStatus.SUCCESS) {
    return {
      hash: sent.hash,
      returnValue: final.returnValue ? scValToNative(final.returnValue) : undefined,
    };
  }
  if (final.status === rpc.Api.GetTransactionStatus.FAILED) {
    throw new Error(`Transaction failed on-chain (${sent.hash})`);
  }
  throw new Error(`Transaction not confirmed yet — check the explorer for ${sent.hash}`);
}

export const usdcAsset = () => new Asset(config.tokenCode, config.tokenIssuer);

export interface AccountStatus {
  exists: boolean;
  xlm: string;
  hasTrustline: boolean;
  tokenBalance: bigint; // in stroops (7 decimals)
}

/** Look up XLM balance and the test-USDC trustline/balance via Horizon. */
export async function getAccountStatus(address: string): Promise<AccountStatus> {
  try {
    const acc = await horizon.loadAccount(address);
    let xlm = "0";
    let hasTrustline = false;
    let tokenBalance = BigInt(0);
    for (const b of acc.balances) {
      if (b.asset_type === "native") xlm = b.balance;
      else if (
        (b.asset_type === "credit_alphanum4" || b.asset_type === "credit_alphanum12") &&
        b.asset_code === config.tokenCode &&
        b.asset_issuer === config.tokenIssuer
      ) {
        hasTrustline = true;
        const [w, f = ""] = b.balance.split(".");
        tokenBalance = BigInt(w) * BigInt(10_000_000) + BigInt(f.padEnd(7, "0").slice(0, 7));
      }
    }
    return { exists: true, xlm, hasTrustline, tokenBalance };
  } catch (e: unknown) {
    const status = (e as { response?: { status?: number } })?.response?.status;
    if (status === 404 || (e instanceof Error && /not found/i.test(e.message))) {
      return { exists: false, xlm: "0", hasTrustline: false, tokenBalance: BigInt(0) };
    }
    throw e;
  }
}

/** Add a trustline for the test USDC asset (classic changeTrust op, signed in Freighter). */
export async function addTrustline(address: string): Promise<string> {
  const acc = await horizon.loadAccount(address);
  const tx = new TransactionBuilder(acc, {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(Operation.changeTrust({ asset: usdcAsset() }))
    .setTimeout(120)
    .build();
  const signed = await signAndSend(tx, address);
  const res = await horizon.submitTransaction(signed);
  return res.hash;
}

export async function fundWithFriendbot(address: string): Promise<void> {
  const r = await fetch(`https://friendbot.stellar.org/?addr=${encodeURIComponent(address)}`);
  if (!r.ok) throw new Error(`Friendbot failed (${r.status}). The account may already be funded.`);
}

export const addr = (a: string) => new Address(a).toScVal();
export const isValidAddress = (a: string) => {
  try {
    new Address(a.trim());
    return true;
  } catch {
    return false;
  }
};
