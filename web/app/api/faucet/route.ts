// Test-USDC faucet for the built-in testnet wallet.
//
// TESTNET ONLY. Sends a small amount of the demo "USDC" asset from a dedicated testnet
// distributor account whose secret lives in the server-only env var FAUCET_SECRET
// (never NEXT_PUBLIC_*, never sent to the browser). Only ever receives public keys.
import { NextResponse } from "next/server";
import { Asset, BASE_FEE, Horizon, Keypair, Memo, Networks, Operation, StrKey, TransactionBuilder } from "@stellar/stellar-sdk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PASSPHRASE = process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ?? Networks.TESTNET;
const HORIZON = process.env.NEXT_PUBLIC_HORIZON_URL ?? "https://horizon-testnet.stellar.org";
const CODE = process.env.NEXT_PUBLIC_TOKEN_CODE ?? "USDC";
const ISSUER = process.env.NEXT_PUBLIC_TOKEN_ISSUER ?? "";
const AMOUNT = /^\d{1,6}(\.\d{1,7})?$/.test(process.env.FAUCET_AMOUNT ?? "") ? process.env.FAUCET_AMOUNT! : "100";
/** Don't top up accounts that already hold plenty. */
const MAX_BALANCE = 1000;

const ADDRESS_WINDOW_MS = 10 * 60 * 1000; // once per address per 10 min
const IP_WINDOW_MS = 10 * 60 * 1000;
const IP_MAX = 3; // per IP per window
const GLOBAL_WINDOW_MS = 60 * 60 * 1000;
const GLOBAL_MAX = 120; // per server instance per hour

// In-memory guards: per server instance (best effort on serverless; resets on cold start).
const lastByAddress = new Map<string, number>();
const hitsByIp = new Map<string, number[]>();
let globalHits: number[] = [];

function faucetKeypair(): Keypair | null {
  const s = process.env.FAUCET_SECRET?.trim();
  if (!s || !StrKey.isValidEd25519SecretSeed(s)) return null;
  return Keypair.fromSecret(s);
}
const enabled = () => PASSPHRASE === Networks.TESTNET && !!ISSUER && !!faucetKeypair();

function clientIp(req: Request): string {
  const xf = req.headers.get("x-forwarded-for");
  return (xf ? xf.split(",")[0] : req.headers.get("x-real-ip"))?.trim() || "unknown";
}
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

export async function GET() {
  return json({ enabled: enabled(), amount: enabled() ? AMOUNT : undefined, code: CODE, network: "testnet" });
}

export async function POST(req: Request) {
  if (PASSPHRASE !== Networks.TESTNET) return json({ error: "The faucet only runs on Stellar Testnet." }, 403);
  const kp = faucetKeypair();
  if (!kp || !ISSUER) return json({ error: "The test USDC faucet isn't configured here. Ask the admin to fund you." }, 503);

  let address = "";
  try {
    address = String(((await req.json()) as { address?: unknown }).address ?? "").trim();
  } catch {}
  if (!StrKey.isValidEd25519PublicKey(address)) return json({ error: "Send a valid Stellar public key (G…)." }, 400);
  if (address === kp.publicKey()) return json({ error: "That's the faucet itself." }, 400);

  const now = Date.now();
  const last = lastByAddress.get(address);
  if (last && now - last < ADDRESS_WINDOW_MS) {
    const mins = Math.ceil((ADDRESS_WINDOW_MS - (now - last)) / 60000);
    return json({ error: `This address got test ${CODE} recently. Try again in ${mins} min.` }, 429);
  }
  const ip = clientIp(req);
  const ipHits = (hitsByIp.get(ip) ?? []).filter((t) => now - t < IP_WINDOW_MS);
  if (ipHits.length >= IP_MAX) return json({ error: "Too many faucet requests from your network. Try again in a few minutes." }, 429);
  globalHits = globalHits.filter((t) => now - t < GLOBAL_WINDOW_MS);
  if (globalHits.length >= GLOBAL_MAX) return json({ error: "The faucet is busy. Try again later." }, 429);

  // Reserve the slot before any await so parallel requests can't double-spend it.
  lastByAddress.set(address, now);
  hitsByIp.set(ip, [...ipHits, now]);
  globalHits.push(now);
  const release = () => {
    lastByAddress.delete(address);
    hitsByIp.set(ip, (hitsByIp.get(ip) ?? []).filter((t) => t !== now));
    globalHits = globalHits.filter((t) => t !== now);
  };

  const horizon = new Horizon.Server(HORIZON);
  try {
    let dest: Horizon.AccountResponse;
    try {
      dest = await horizon.loadAccount(address);
    } catch {
      release();
      return json({ error: "That account doesn't exist on testnet yet. Fund it with Friendbot first." }, 400);
    }
    const line = dest.balances.find(
      (b) => "asset_code" in b && b.asset_code === CODE && "asset_issuer" in b && b.asset_issuer === ISSUER,
    );
    if (!line) {
      release();
      return json({ error: `Add the ${CODE} trustline first.` }, 400);
    }
    if (Number(line.balance) >= MAX_BALANCE) {
      release();
      return json({ error: `You already have ${Number(line.balance).toLocaleString("en-US")} test ${CODE}.` }, 400);
    }
    const src = await horizon.loadAccount(kp.publicKey());
    const tx = new TransactionBuilder(src, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
      .addOperation(Operation.payment({ destination: address, asset: new Asset(CODE, ISSUER), amount: AMOUNT }))
      .addMemo(Memo.text("Ajo test USDC faucet"))
      .setTimeout(60)
      .build();
    tx.sign(kp);
    const res = await horizon.submitTransaction(tx);
    return json({ hash: res.hash, amount: AMOUNT, code: CODE });
  } catch (e) {
    release();
    const codes = (e as { response?: { data?: { extras?: { result_codes?: unknown } } } })?.response?.data?.extras?.result_codes;
    console.error("faucet error", codes ?? (e as Error)?.message);
    const underfunded = JSON.stringify(codes ?? "").includes("underfunded");
    return json({ error: underfunded ? "The faucet is empty. Ask the admin to refill it." : "Faucet transaction failed. Try again shortly." }, 502);
  }
}
