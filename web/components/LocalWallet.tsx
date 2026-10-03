"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useWallet } from "./WalletProvider";
import { Button, TxLink } from "./ui";
import { config, explorer } from "@/lib/config";
import { shortAddr } from "@/lib/format";
import {
  dismissSetup,
  faucetInfo,
  markLocalBackedUp,
  requestTestUsdc,
  revealLocalSecret,
  setupSnapshot,
  signRequestSnapshot,
  subscribeSetup,
  subscribeSignRequest,
  type FaucetInfo,
  type StepState,
} from "@/lib/localWallet";

// ------------------------------------------------------------------ small UI store
type DialogKind = "import" | "backup" | "forget" | null;
let dialog: DialogKind = null;
const dialogListeners = new Set<() => void>();
export function openLocalDialog(kind: DialogKind) {
  dialog = kind;
  dialogListeners.forEach((f) => f());
}
const subscribeDialog = (f: () => void) => {
  dialogListeners.add(f);
  return () => dialogListeners.delete(f);
};

let faucetPromise: Promise<FaucetInfo> | null = null;
/** Is the server's test-USDC faucet configured? (cached per page load) */
export function useFaucetInfo(): FaucetInfo | null {
  const [info, setInfo] = useState<FaucetInfo | null>(null);
  useEffect(() => {
    faucetPromise ??= faucetInfo();
    let live = true;
    faucetPromise.then((i) => live && setInfo(i));
    return () => {
      live = false;
    };
  }, []);
  return info;
}

/** "Get test USDC" — works for any connected account that holds the USDC trustline. */
export function GetTestUsdc({ address, className = "" }: { address: string; className?: string }) {
  const faucet = useFaucetInfo();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<React.ReactNode>(null);
  const [err, setErr] = useState<string | null>(null);
  if (!faucet) return null;
  if (!faucet.enabled)
    return <p className={`text-xs leading-snug text-muted ${className}`}>Need test {config.tokenCode}? Ask the admin to fund you.</p>;
  return (
    <div className={className}>
      <Button
        variant="secondary"
        className="w-full !py-2 !text-sm"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          setErr(null);
          setMsg(null);
          try {
            const r = await requestTestUsdc(address);
            setMsg(
              <>
                +{r.amount} {config.tokenCode}. <TxLink hash={r.hash} label="View" />
              </>,
            );
          } catch (e) {
            setErr((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Get {faucet.amount} test {config.tokenCode}
      </Button>
      {msg && <p className="alert-in mt-1.5 text-xs text-sage">{msg}</p>}
      {err && <p className="alert-in mt-1.5 text-xs text-rust">{err}</p>}
    </div>
  );
}

// ------------------------------------------------------------------ shared dialog shell
function Dialog({
  title,
  onClose,
  children,
  labelledBy,
}: {
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  labelledBy: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLElement>("input,button")?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[2147482000] flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-4" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className="pop-in max-h-[92vh] w-full overflow-auto rounded-t-2xl border border-line bg-ivory p-4 shadow-[var(--shadow-overlay)] min-[360px]:p-5 sm:max-w-md sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id={labelledBy} className="font-display text-xl leading-tight text-ink">
            {title}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="-m-2 inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-sand/70 hover:text-ink">
            <svg viewBox="0 0 12 12" className="size-3" aria-hidden>
              <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function TestnetBadge() {
  return (
    <span className="inline-flex items-center rounded-full bg-ochre-bright/25 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ink">
      Testnet only
    </span>
  );
}

// ------------------------------------------------------------------ dialogs
function ImportDialog({ onClose }: { onClose: () => void }) {
  const w = useWallet();
  const [secret, setSecret] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const replacing = !!w.localWallet;
  return (
    <Dialog title="Import a testnet wallet" onClose={onClose} labelledBy="lw-import">
      <p className="mt-2 text-sm leading-relaxed text-ink-soft">
        Paste the secret key (starts with <span className="font-mono">S</span>) of a <b>Stellar Testnet</b> account. It stays in
        this browser only and is never sent anywhere. Never paste a mainnet key.
      </p>
      {replacing && !w.localWallet?.backedUp && (
        <p className="mt-2 rounded-lg bg-rust-wash p-2.5 text-xs text-rust">
          This replaces the current built-in wallet ({shortAddr(w.localWallet!.publicKey)}), which isn&apos;t backed up yet.
          Back it up first if you want to keep it.
        </p>
      )}
      <form
        className="mt-3 space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr(null);
          try {
            await w.importTestnetWallet(secret);
            setSecret("");
            onClose();
          } catch (x) {
            setErr((x as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="block text-xs font-medium text-ink-soft" htmlFor="lw-secret">
          Testnet secret key
        </label>
        <div className="flex gap-2">
          <input
            id="lw-secret"
            type={show ? "text" : "password"}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="S…"
            className="min-h-11 w-full min-w-0 rounded-lg border border-line-strong bg-white px-3 font-mono text-sm text-ink outline-none focus:border-ink/50"
          />
          <Button type="button" variant="secondary" className="shrink-0 !px-3" onClick={() => setShow((v) => !v)}>
            {show ? "Hide" : "Show"}
          </Button>
        </div>
        {err && <p className="alert-in text-sm text-rust">{err}</p>}
        <Button type="submit" className="w-full" loading={busy} disabled={!secret.trim()}>
          Import and connect
        </Button>
      </form>
    </Dialog>
  );
}

function BackupDialog({ onClose }: { onClose: () => void }) {
  const w = useWallet();
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  return (
    <Dialog title="Back up your testnet key" onClose={onClose} labelledBy="lw-backup">
      <p className="mt-2 text-sm leading-relaxed text-ink-soft">
        This key is the only way to get this wallet back if you clear the browser or switch phones. Anyone who sees it
        controls the wallet. It&apos;s a <b>testnet-only</b> key — never send real funds to it.
      </p>
      {!secret ? (
        <Button className="mt-4 w-full" onClick={() => setSecret(revealLocalSecret())}>
          I understand — reveal the secret key
        </Button>
      ) : (
        <div className="content-in mt-4 space-y-3">
          <p className="break-all rounded-lg border border-line-strong bg-white p-3 font-mono text-sm text-ink select-all" aria-label="Secret key">
            {secret}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(secret);
                  setCopied(true);
                } catch {}
              }}
            >
              {copied ? "Copied ✓" : "Copy"}
            </Button>
            <Button
              onClick={() => {
                markLocalBackedUp();
                setSecret(null);
                onClose();
              }}
            >
              I&apos;ve saved it
            </Button>
          </div>
          <p className="text-xs text-muted">Public address: <span className="break-all font-mono">{w.localWallet?.publicKey}</span></p>
        </div>
      )}
    </Dialog>
  );
}

function ForgetDialog({ onClose }: { onClose: () => void }) {
  const w = useWallet();
  const lw = w.localWallet;
  return (
    <Dialog title="Forget this testnet wallet?" onClose={onClose} labelledBy="lw-forget">
      <p className="mt-2 text-sm leading-relaxed text-ink-soft">
        The secret key for <span className="font-mono">{lw ? shortAddr(lw.publicKey) : "this wallet"}</span> will be deleted from this
        browser. {lw?.backedUp ? "You can import it again from your backup." : <b className="text-rust">It isn&apos;t backed up — the wallet and its test funds will be gone for good.</b>}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {!lw?.backedUp && (
          <Button variant="secondary" onClick={() => openLocalDialog("backup")}>
            Back up first
          </Button>
        )}
        <Button
          className="!bg-rust hover:!bg-rust/90"
          onClick={async () => {
            await w.forgetTestnetWallet();
            onClose();
          }}
        >
          Forget wallet
        </Button>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ auto-setup + signing sheets
const STEP_TEXT: Record<"fund" | "trust" | "usdc", string> = {
  fund: "Fund with testnet XLM (Friendbot)",
  trust: `Add the ${config.tokenCode} trustline`,
  usdc: `Get test ${config.tokenCode}`,
};

function StepIcon({ s }: { s: StepState }) {
  if (s === "run") return <span className="inline-block size-4 animate-spin rounded-full border-2 border-clay border-t-transparent" aria-label="working" />;
  if (s === "done" || s === "skip") return <span className="inline-flex size-4 items-center justify-center rounded-full bg-sage-bright text-[10px] text-white" aria-label="done">✓</span>;
  if (s === "fail") return <span className="inline-flex size-4 items-center justify-center rounded-full bg-rust text-[10px] text-white" aria-label="failed">!</span>;
  return <span className="inline-block size-4 rounded-full border-2 border-line-strong" aria-label="to do" />;
}

function SetupSheet() {
  const w = useWallet();
  const s = useSyncExternalStore(subscribeSetup, setupSnapshot, () => null);
  if (!s) return null;
  const steps = (["fund", "trust", "usdc"] as const).map((k) => ({ k, st: s[k] }));
  return (
    <div className="fixed inset-x-0 bottom-0 z-[2147481000] p-3 sm:p-4" role="status" aria-live="polite" aria-label="Setting up your testnet wallet">
      <div className="pop-in mx-auto max-w-md rounded-2xl border border-line bg-ivory p-4 shadow-[var(--shadow-overlay)]">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium text-ink">{s.done ? (s.error ? "Setup stopped" : "Your testnet wallet is ready") : "Setting up your testnet wallet…"}</p>
          <TestnetBadge />
        </div>
        <p className="mt-0.5 break-all font-mono text-xs text-muted">{s.address}</p>
        <ul className="mt-3 space-y-2">
          {steps.map(({ k, st }) => (
            <li key={k} className="flex items-start gap-2.5 text-sm">
              <span className="mt-0.5">
                <StepIcon s={st} />
              </span>
              <span className={st === "todo" ? "text-muted" : "text-ink-soft"}>
                {STEP_TEXT[k]}
                {st === "skip" && k !== "usdc" && <span className="text-muted"> · already done</span>}
                {k === "usdc" && s.usdcNote && <span className={`block text-xs ${s.usdc === "fail" ? "text-rust" : "text-muted"}`}>{s.usdcNote}</span>}
              </span>
            </li>
          ))}
        </ul>
        {s.error && <p className="alert-in mt-2 text-sm text-rust">{s.error}</p>}
        {s.done && (
          <div className="mt-3 flex flex-wrap gap-2">
            {w.localWallet && !w.localWallet.backedUp && (
              <Button variant="secondary" onClick={() => openLocalDialog("backup")}>
                Back up secret key
              </Button>
            )}
            {s.error && w.address && (
              <Button
                variant="secondary"
                onClick={() => {
                  dismissSetup();
                  w.startTestnetWallet();
                }}
              >
                Try again
              </Button>
            )}
            <Button onClick={dismissSetup}>Done</Button>
          </div>
        )}
        <p className="mt-2 text-[11px] leading-snug text-muted">
          The secret key never leaves this browser. <a className="underline underline-offset-2" href={explorer.account(s.address)} target="_blank" rel="noreferrer">View on stellar.expert ↗</a>
        </p>
      </div>
    </div>
  );
}

function SignSheet() {
  const req = useSyncExternalStore(subscribeSignRequest, signRequestSnapshot, () => null);
  if (!req) return null;
  return (
    <Dialog title="Sign with your testnet wallet?" onClose={() => req.reject(new Error("You cancelled signing."))} labelledBy="lw-sign">
      <ul className="mt-3 space-y-2">
        {req.lines.map((l, i) => (
          <li
            key={i}
            style={{ marginLeft: `${Math.min(l.depth ?? 0, 3) * 0.75}rem` }}
            className={`rounded-lg border p-2.5 ${l.warn ? "border-clay-strong bg-clay/10" : "border-line bg-white"}`}
          >
            <p className="text-sm font-medium text-ink">
              {l.warn && <span className="mr-1 font-semibold text-clay-strong">Warning:</span>}
              {l.label}
            </p>
            {l.detail && <p className="mt-0.5 break-all font-mono text-[11px] text-muted">{l.detail}</p>}
          </li>
        ))}
      </ul>
      {req.lines.some((l) => l.warn) && (
        <p className="mt-2 text-xs font-medium text-clay-strong">
          This transaction touches a contract that isn&apos;t the Ajo contract or the configured test USDC. Don&apos;t sign unless you expected it.
        </p>
      )}
      <p className="mt-2 text-xs text-muted">Network fee up to {req.fee} XLM · Stellar Testnet</p>
      <div className="mt-4 flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={() => req.reject(new Error("You cancelled signing."))}>
          Cancel
        </Button>
        <Button className="flex-1" onClick={req.resolve}>
          Sign
        </Button>
      </div>
    </Dialog>
  );
}

/** Rendered once inside WalletProvider. */
export function LocalWalletLayer() {
  const d = useSyncExternalStore(subscribeDialog, () => dialog, () => null);
  const close = () => openLocalDialog(null);
  return (
    <>
      <SetupSheet />
      <SignSheet />
      {d === "import" && <ImportDialog onClose={close} />}
      {d === "backup" && <BackupDialog onClose={close} />}
      {d === "forget" && <ForgetDialog onClose={close} />}
    </>
  );
}

/** Home-page / empty-state call to action. */
export function LocalWalletCta({ compact = false }: { compact?: boolean }) {
  const w = useWallet();
  if (!w.ready || w.address) return null;
  const has = !!w.localWallet;
  return (
    <div className={`rounded-xl border border-dashed border-line-strong bg-ivory/70 ${compact ? "p-3.5" : "p-4 min-[360px]:p-5"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium text-ink">{has ? "Your testnet wallet is on this device" : "No Stellar wallet on this phone?"}</p>
        <TestnetBadge />
      </div>
      <p className="mt-1 text-sm leading-relaxed text-ink-soft">
        {has ? (
          <>
            Continue with <span className="font-mono">{shortAddr(w.localWallet!.publicKey)}</span> — signs right here, no app or popup.
          </>
        ) : (
          <>Create a built-in testnet wallet in one tap: funded with test XLM and {config.tokenCode}, ready to join a circle. The key stays in this browser.</>
        )}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={() => w.startTestnetWallet()} loading={w.connecting}>
          {has ? "Use testnet wallet" : "Create testnet wallet"}
        </Button>
        <Button variant="ghost" onClick={() => openLocalDialog("import")}>
          Import a testnet key
        </Button>
      </div>
    </div>
  );
}
