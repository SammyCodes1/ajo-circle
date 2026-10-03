"use client";
// Built-in TESTNET-ONLY browser wallet.
//
// The secret key is generated in the browser and stored ONLY in this browser's localStorage.
// It is never sent to any server (the /api/faucet route only ever receives the public key).
// Everything here refuses to sign for any network other than Stellar Testnet.
import {
  Address,
  Asset,
  BASE_FEE,
  Horizon,
  Keypair,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
  scValToNative,
  xdr,
  type Transaction,
  type FeeBumpTransaction,
} from "@stellar/stellar-sdk";
import { config } from "./config";

export const LOCAL_WALLET_ID = "ajo_testnet";
export const LOCAL_WALLET_NAME = "Testnet wallet";
const STORE_KEY = "ajo:testnet-wallet:v1";
const CONFIRM_KEY = "ajo:testnet-wallet:confirm";
const CHANGE_EVENT = "ajo:testnet-wallet-changed";

/** Only ever Stellar Testnet. */
export const LOCAL_WALLET_SUPPORTED = config.networkPassphrase === Networks.TESTNET;

interface Stored {
  /** Human-readable marker for anyone inspecting localStorage. */
  warning: string;
  network: "TESTNET";
  publicKey: string;
  secret: string;
  createdAt: number;
  imported: boolean;
  backedUp: boolean;
}

function read(): Stored | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Stored;
    if (s?.network !== "TESTNET" || !StrKey.isValidEd25519SecretSeed(s.secret)) return null;
    return s;
  } catch {
    return null;
  }
}
function write(s: Stored | null) {
  if (s) window.localStorage.setItem(STORE_KEY, JSON.stringify(s));
  else window.localStorage.removeItem(STORE_KEY);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export interface LocalWalletInfo {
  publicKey: string;
  createdAt: number;
  imported: boolean;
  backedUp: boolean;
}
export function localWalletInfo(): LocalWalletInfo | null {
  const s = read();
  return s ? { publicKey: s.publicKey, createdAt: s.createdAt, imported: s.imported, backedUp: s.backedUp } : null;
}
export function onLocalWalletChange(fn: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, fn);
  window.addEventListener("storage", fn);
  return () => {
    window.removeEventListener(CHANGE_EVENT, fn);
    window.removeEventListener("storage", fn);
  };
}

function save(kp: Keypair, imported: boolean): LocalWalletInfo {
  if (!LOCAL_WALLET_SUPPORTED) throw new Error("The built-in wallet only works on Stellar Testnet.");
  const s: Stored = {
    warning: "STELLAR TESTNET ONLY - Ajo Circle demo wallet. Never put a mainnet key here.",
    network: "TESTNET",
    publicKey: kp.publicKey(),
    secret: kp.secret(),
    createdAt: Date.now(),
    imported,
    backedUp: imported, // an imported key is, by definition, already saved somewhere
  };
  write(s);
  return localWalletInfo()!;
}

export function createLocalWallet(): LocalWalletInfo {
  return save(Keypair.random(), false);
}

export function importLocalWallet(secret: string): LocalWalletInfo {
  const v = secret.trim();
  if (!StrKey.isValidEd25519SecretSeed(v)) throw new Error("That isn't a valid Stellar secret key (it starts with S and is 56 characters).");
  return save(Keypair.fromSecret(v), true);
}

export function forgetLocalWallet() {
  write(null);
}

/** Only for the explicit "Back up secret" flow, after a warning. */
export function revealLocalSecret(): string {
  const s = read();
  if (!s) throw new Error("No testnet wallet in this browser.");
  return s.secret;
}
export function markLocalBackedUp() {
  const s = read();
  if (s) write({ ...s, backedUp: true });
}

/** On by default: only an explicit "0" (the user switched it off) skips the sheet. */
export function confirmBeforeSigning(): boolean {
  try {
    return window.localStorage.getItem(CONFIRM_KEY) !== "0";
  } catch {
    return true;
  }
}
export function setConfirmBeforeSigning(on: boolean) {
  window.localStorage.setItem(CONFIRM_KEY, on ? "1" : "0");
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

// ---------------------------------------------------------------- signing confirmation
export interface SignLine {
  label: string;
  detail?: string;
  /** Nesting depth for authorization sub-invocations (0 = top level). */
  depth?: number;
  /** A contract other than the Ajo contract or the pinned token. */
  warn?: boolean;
}
export interface SignRequest {
  lines: SignLine[];
  fee: string;
  resolve: () => void;
  reject: (e: Error) => void;
}
let pendingSign: SignRequest | null = null;
const signListeners = new Set<() => void>();
export const signRequestSnapshot = () => pendingSign;
export function subscribeSignRequest(fn: () => void) {
  signListeners.add(fn);
  return () => signListeners.delete(fn);
}
function setSign(r: SignRequest | null) {
  pendingSign = r;
  signListeners.forEach((f) => f());
}

const FN_LABEL: Record<string, string> = {
  create_circle: "Create a savings circle",
  accept: "Accept your slot in a circle",
  post_collateral: "Post collateral",
  contribute: "Contribute to a circle",
  settle: "Settle this round",
  payout: "Settle this round",
  claim: "Claim your funds",
  cancel: "Cancel a circle that never started",
  unwind: "Unwind a stalled circle",
  transfer: "Move tokens",
};

function short(v: unknown): string {
  const s = typeof v === "bigint" ? v.toString() : JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x));
  return s && s.length > 60 ? `${s.slice(0, 57)}…` : s ?? "";
}

/** i128 amounts shown with all 7 token decimals. */
function fmt7(v: bigint): string {
  const neg = v < BigInt(0);
  const a = neg ? -v : v;
  const unit = BigInt(10_000_000);
  return `${neg ? "-" : ""}${(a / unit).toString()}.${(a % unit).toString().padStart(7, "0")}`;
}

function argText(a: xdr.ScVal): string {
  try {
    if (a.type === "scvI128") return fmt7(scValToNative(a) as bigint);
    return short(scValToNative(a));
  } catch {
    return "…";
  }
}

function contractName(id: string): { name: string; known: boolean } {
  if (id === config.contractId) return { name: "Ajo contract", known: true };
  if (id === config.tokenId) return { name: `${config.tokenCode} token (project test asset)`, known: true };
  return { name: `UNKNOWN contract ${short(id)}`, known: false };
}

function callLine(contract: string, fnName: string, args: xdr.ScVal[], depth: number): SignLine {
  const c = contractName(contract);
  const label = `${FN_LABEL[fnName] ?? `Call ${fnName}`}${depth > 0 || !c.known ? ` · ${c.name}` : ""}`;
  return { label, detail: `${fnName}(${args.map(argText).join(", ")})`, depth, warn: !c.known };
}

/** Every authorization this transaction asks for, as a tree (root + sub-invocations). */
function authLines(auth: xdr.SorobanAuthorizationEntry[] | undefined): SignLine[] {
  const out: SignLine[] = [];
  const walk = (inv: xdr.SorobanAuthorizedInvocation, depth: number) => {
    const f = inv.function;
    if (f.type === "sorobanAuthorizedFunctionTypeContractFn") {
      const ic = f.contractFn;
      const id = Address.fromScAddress(ic.contractAddress).toString();
      out.push(callLine(id, ic.functionName.toString(), ic.args, depth));
    } else {
      out.push({ label: "Create a contract", depth, warn: true });
    }
    inv.subInvocations.forEach((sub) => walk(sub, depth + 1));
  };
  for (const e of auth ?? []) {
    out.push({ label: "You authorize:", depth: 0 });
    walk(e.rootInvocation, 1);
  }
  return out;
}

/** Human summary of what a transaction does (for the confirm sheet). */
export function describeTx(tx: Transaction | FeeBumpTransaction): SignLine[] {
  const inner = "innerTransaction" in tx ? tx.innerTransaction : tx;
  return inner.operations.flatMap((op): SignLine[] => {
    if (op.type === "changeTrust") {
      const line = (op as Operation.ChangeTrust).line;
      return [{ label: `Add a trustline`, detail: line instanceof Asset ? `${line.getCode()} · ${short(line.getIssuer())}` : undefined }];
    }
    if (op.type === "invokeHostFunction") {
      const o = op as Operation.InvokeHostFunction;
      try {
        if (o.func.type !== "hostFunctionTypeInvokeContract") return [{ label: "Smart-contract call", warn: true }];
        const ic = o.func.invokeContract;
        const id = Address.fromScAddress(ic.contractAddress).toString();
        return [callLine(id, ic.functionName.toString(), ic.args, 0), ...authLines(o.auth)];
      } catch {
        return [{ label: "Smart-contract call", warn: true }];
      }
    }
    if (op.type === "payment") {
      const p = op as Operation.Payment;
      return [{ label: `Send ${p.amount} ${p.asset.isNative() ? "XLM" : p.asset.getCode()}`, detail: `to ${short(p.destination)}` }];
    }
    return [{ label: op.type }];
  });
}

function keypair(): Keypair {
  const s = read();
  if (!s) throw new Error("No testnet wallet in this browser. Create or import one first.");
  return Keypair.fromSecret(s.secret);
}

/**
 * Sign a transaction XDR with the browser wallet. Testnet only; shows the confirm sheet unless
 * the user switched "Ask before signing" off (it is on by default). Returns the signed XDR.
 */
export async function localSignXdr(txXdr: string, opts?: { networkPassphrase?: string; address?: string; skipConfirm?: boolean }) {
  const passphrase = opts?.networkPassphrase ?? config.networkPassphrase;
  if (passphrase !== Networks.TESTNET || !LOCAL_WALLET_SUPPORTED) {
    throw new Error("The built-in wallet only signs Stellar Testnet transactions.");
  }
  const kp = keypair();
  if (opts?.address && opts.address !== kp.publicKey()) {
    throw new Error("This transaction is for a different account than the built-in wallet.");
  }
  const tx = TransactionBuilder.fromXDR(txXdr, passphrase);
  if (!opts?.skipConfirm && confirmBeforeSigning()) {
    const fee = (Number(tx.fee) / 1e7).toLocaleString("en-US", { maximumFractionDigits: 7 });
    await new Promise<void>((resolve, reject) =>
      setSign({
        lines: describeTx(tx),
        fee,
        resolve: () => {
          setSign(null);
          resolve();
        },
        reject: (e) => {
          setSign(null);
          reject(e);
        },
      }),
    );
  }
  tx.sign(kp);
  return { signedTxXdr: tx.toXDR(), signerAddress: kp.publicKey() };
}

// ---------------------------------------------------------------- kit module
let fresh = false;
/** True once after the picker created a brand-new wallet (so the app can run auto-setup). */
export function consumeFreshLocalWallet(): boolean {
  const f = fresh;
  fresh = false;
  return f;
}

/** Stellar Wallets Kit module, so the picker lists it and kit.signTransaction routes here. */
export class LocalWalletModule {
  moduleType = "HOT_WALLET" as const;
  productId = LOCAL_WALLET_ID;
  productName = "Ajo testnet wallet (built-in)";
  productUrl = typeof window !== "undefined" ? window.location.origin : "https://ajo-circle-xi.vercel.app";
  productIcon = typeof window !== "undefined" ? `${window.location.origin}/testnet-wallet.svg` : "/testnet-wallet.svg";
  async isAvailable() {
    return LOCAL_WALLET_SUPPORTED;
  }
  async getAddress() {
    const existing = localWalletInfo();
    if (existing) return { address: existing.publicKey };
    const created = createLocalWallet();
    fresh = true;
    return { address: created.publicKey };
  }
  async signTransaction(txXdr: string, opts?: { networkPassphrase?: string; address?: string }) {
    return localSignXdr(txXdr, opts);
  }
  async signAuthEntry(): Promise<{ signedAuthEntry: string; signerAddress?: string }> {
    throw new Error("The built-in testnet wallet doesn't sign auth entries.");
  }
  async signMessage(): Promise<{ signedMessage: string; signerAddress?: string }> {
    throw new Error("The built-in testnet wallet doesn't sign messages.");
  }
  async getNetwork() {
    return { network: "TESTNET", networkPassphrase: Networks.TESTNET };
  }
  async disconnect() {
    // Keeps the key in this browser; "Forget wallet" deletes it.
  }
}

// ---------------------------------------------------------------- auto-setup
export type StepState = "todo" | "run" | "done" | "skip" | "fail";
export interface SetupState {
  address: string;
  fund: StepState;
  trust: StepState;
  usdc: StepState;
  usdcNote?: string;
  error?: string;
  done: boolean;
}
let setup: SetupState | null = null;
const setupListeners = new Set<() => void>();
export const setupSnapshot = () => setup;
export function subscribeSetup(fn: () => void) {
  setupListeners.add(fn);
  return () => setupListeners.delete(fn);
}
function patchSetup(p: Partial<SetupState>) {
  if (!setup) return;
  setup = { ...setup, ...p };
  setupListeners.forEach((f) => f());
}
export function dismissSetup() {
  setup = null;
  setupListeners.forEach((f) => f());
}

const horizon = new Horizon.Server(config.horizonUrl);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function loadAcc(address: string) {
  try {
    return await horizon.loadAccount(address);
  } catch (e) {
    if ((e as { response?: { status?: number } })?.response?.status === 404) return null;
    throw e;
  }
}
function trusts(acc: Horizon.AccountResponse) {
  return acc.balances.some(
    (b) => "asset_code" in b && b.asset_code === config.tokenCode && "asset_issuer" in b && b.asset_issuer === config.tokenIssuer,
  );
}

export interface FaucetInfo {
  enabled: boolean;
  amount?: string;
  code?: string;
}
export async function faucetInfo(): Promise<FaucetInfo> {
  try {
    const r = await fetch("/api/faucet", { cache: "no-store" });
    return r.ok ? ((await r.json()) as FaucetInfo) : { enabled: false };
  } catch {
    return { enabled: false };
  }
}
export async function requestTestUsdc(address: string): Promise<{ hash: string; amount: string }> {
  const r = await fetch("/api/faucet", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address }),
  });
  const j = (await r.json().catch(() => ({}))) as { hash?: string; amount?: string; error?: string };
  if (!r.ok || !j.hash) throw new Error(j.error || `Faucet failed (${r.status}).`);
  if (typeof window !== "undefined") window.dispatchEvent(new Event("ajo:balances-changed"));
  return { hash: j.hash, amount: j.amount ?? "" };
}

/**
 * Friendbot → USDC trustline (signed here) → test USDC from /api/faucet.
 * Each step is skipped when already done, so it is safe to re-run.
 */
export async function runLocalSetup(address: string): Promise<void> {
  if (setup && setup.address === address && !setup.done) return;
  setup = { address, fund: "todo", trust: "todo", usdc: "todo", done: false };
  setupListeners.forEach((f) => f());
  const changed = () => window.dispatchEvent(new Event("ajo:balances-changed"));
  try {
    let acc = await loadAcc(address);
    if (acc) patchSetup({ fund: "skip" });
    else {
      patchSetup({ fund: "run" });
      const r = await fetch(`https://friendbot.stellar.org/?addr=${encodeURIComponent(address)}`);
      if (!r.ok && r.status !== 400) throw new Error(`Friendbot failed (${r.status}). Try again in a minute.`);
      for (let i = 0; i < 10 && !acc; i++) {
        acc = await loadAcc(address);
        if (!acc) await sleep(1000);
      }
      if (!acc) throw new Error("Friendbot funding didn't show up yet. Try again in a minute.");
      patchSetup({ fund: "done" });
      changed();
    }

    if (trusts(acc)) patchSetup({ trust: "skip" });
    else {
      patchSetup({ trust: "run" });
      const tx = new TransactionBuilder(acc, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
        .addOperation(Operation.changeTrust({ asset: new Asset(config.tokenCode, config.tokenIssuer) }))
        .setTimeout(120)
        .build();
      const { signedTxXdr } = await localSignXdr(tx.toXDR(), { skipConfirm: true, address });
      await horizon.submitTransaction(TransactionBuilder.fromXDR(signedTxXdr, Networks.TESTNET));
      patchSetup({ trust: "done" });
      changed();
    }

    const info = await faucetInfo();
    if (!info.enabled) patchSetup({ usdc: "skip", usdcNote: "Test USDC faucet isn't set up here — ask the admin to fund you." });
    else {
      patchSetup({ usdc: "run" });
      try {
        const { amount } = await requestTestUsdc(address);
        patchSetup({ usdc: "done", usdcNote: `${amount} test ${config.tokenCode} received.` });
      } catch (e) {
        patchSetup({ usdc: "fail", usdcNote: (e as Error).message });
      }
    }
    patchSetup({ done: true });
  } catch (e) {
    const s = setup;
    const failing: Partial<SetupState> = {};
    if (s?.fund === "run") failing.fund = "fail";
    if (s?.trust === "run") failing.trust = "fail";
    patchSetup({ ...failing, error: (e as Error).message ?? String(e), done: true });
  }
}
