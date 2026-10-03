"use client";
// Our own WalletConnect session handling on top of the kit's WalletConnect module.
//
// Why not just the kit's built-in WalletConnectModule.getAddress():
//  - It requires `stellar:testnet` in requiredNamespaces. Freighter mobile only approves a
//    proposal whose chains include its *active* network; otherwise it shows a "wrong network"
//    toast inside Freighter and returns WITHOUT rejecting (freighter-mobile
//    src/helpers/walletKitUtil.ts approveSessionProposal) — so the dApp waits forever and the
//    WalletConnect modal never closes.
//  - It has no timeout, no visible progress, and in Freighter's in-app browser it can only show
//    the AppKit wallet list.
// Here we propose stellar:testnet + stellar:pubnet as optional chains, so Freighter always
// answers; if it answers on Mainnet we drop that session and say exactly what to change.
// Everything we do is mirrored into a small debug store (shown with ?debug=1).

export const WC_TESTNET = "stellar:testnet";
export const WC_PUBNET = "stellar:pubnet";
const METHODS = ["stellar_signXDR", "stellar_signAndSubmitXDR", "stellar_signAuthEntry", "stellar_signMessage"];
/** Proposals expire after 5 minutes on the relay; give up a little before that. */
export const WC_APPROVAL_TIMEOUT_MS = 3 * 60 * 1000;

/**
 * Freighter mobile's WalletConnect deep link, as registered in the WalletConnect explorer
 * (mobile.native = "freighterwallet://wc-redirect") and formatted the way AppKit's
 * CoreHelperUtil.formatNativeUrl does: `${native}/wc?uri=${encodeURIComponent(uri)}`.
 * The app pairs any incoming URL containing that prefix (useWalletKitEventsManager.onDeepLink).
 */
export const FREIGHTER_NATIVE = "freighterwallet://wc-redirect";
export const freighterWcDeepLink = (uri: string) => `${FREIGHTER_NATIVE}/wc?uri=${encodeURIComponent(uri)}`;

interface WcSessionLike {
  topic: string;
  expiry: number;
  namespaces: Record<string, { accounts: string[] }>;
  peer?: { metadata?: { name?: string; redirect?: { native?: string; universal?: string } } };
}
interface SignClientLike {
  connect(p: unknown): Promise<{ uri?: string; approval: () => Promise<WcSessionLike> }>;
  request<T>(p: { topic: string; chainId: string; request: { method: string; params: unknown } }): Promise<T>;
  disconnect(p: { topic: string; reason: { code: number; message: string } }): Promise<void>;
  session: { getAll(): WcSessionLike[] };
}
interface AppKitLike {
  open(o?: { uri?: string }): unknown;
  close(): unknown;
  subscribeState?(cb: (s: { open?: boolean }) => void): (() => void) | void;
  getState?(): { open?: boolean };
}
export interface WcModuleLike {
  signClient?: SignClientLike;
  modal?: AppKitLike;
  getAddress: (...a: unknown[]) => Promise<{ address: string }>;
  signTransaction: (xdr: string, opts?: { networkPassphrase?: string; address?: string }) => Promise<{ signedTxXdr: string; signerAddress?: string }>;
  disconnect?: () => Promise<void>;
}

// ---------- debug / progress store ----------
export interface WcDebug {
  inApp: string; // detection result
  marker: string; // raw window.stellar
  ua: string;
  projectId: boolean;
  wcReady: boolean;
  uri: string | null;
  handoff: string | null;
  session: string;
  address: string | null;
  error: string | null;
  relay: string;
  initError: string | null;
  log: string[];
}
const dbg: WcDebug = {
  inApp: "?",
  marker: "?",
  ua: "",
  projectId: false,
  wcReady: false,
  uri: null,
  handoff: null,
  session: "idle",
  address: null,
  error: null,
  relay: "—",
  initError: null,
  log: [],
};
const listeners = new Set<() => void>();
let snapshot: WcDebug = { ...dbg };
export function wcDebugSnapshot(): WcDebug {
  return snapshot;
}
export function subscribeWcDebug(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function setWcDebug(p: Partial<WcDebug>, note?: string) {
  Object.assign(dbg, p);
  if (note) {
    const t = new Date().toTimeString().slice(0, 8);
    dbg.log = [...dbg.log.slice(-11), `${t} ${note}`];
  }
  snapshot = { ...dbg };
  listeners.forEach((f) => f());
}

// ---------- connection flow (drives the progress sheet) ----------
export type WcPhase = "preparing" | "waiting" | "error";
export interface WcPending {
  mode: "freighter" | "modal";
  phase: WcPhase;
  uri?: string;
  deepLink?: string;
  startedAt: number;
  error?: string;
  cancel: () => void;
}
let pending: WcPending | null = null;
const pendingListeners = new Set<() => void>();
export const wcPendingSnapshot = () => pending;
export function subscribeWcPending(fn: () => void): () => void {
  pendingListeners.add(fn);
  return () => pendingListeners.delete(fn);
}
function setPending(p: WcPending | null) {
  pending = p;
  pendingListeners.forEach((f) => f());
}
function patchPending(p: Partial<WcPending>) {
  if (pending) setPending({ ...pending, ...p });
}
export function dismissWcSheet() {
  if (pending && pending.phase !== "error") pending.cancel();
  setPending(null);
}

/** Everything before the wallet/modal is on screen must finish within this budget. */
export const WC_PREP_BUDGET_MS = 12000;
export const CANCELLED = "closed the modal";

interface Flow {
  mode: "freighter" | "modal";
  deadline: number;
  cancelled: Promise<never>;
  cancel: (e?: Error) => void;
  done: boolean;
}
let flow: Flow | null = null;

/**
 * Show the progress sheet *now* (before any network work) and start the preparation clock.
 * Called by the Connect handler for Freighter's in-app browser, and by our WalletConnect
 * getAddress for the picker path.
 */
export function beginWcFlow(mode: "freighter" | "modal"): Flow {
  if (flow && !flow.done) return flow;
  let cancel!: (e?: Error) => void;
  const cancelled = new Promise<never>((_, rej) => (cancel = (e) => rej(e ?? new Error(CANCELLED))));
  cancelled.catch(() => {});
  const f: Flow = { mode, deadline: Date.now() + WC_PREP_BUDGET_MS, cancelled, cancel, done: false };
  flow = f;
  setPending({ mode, phase: "preparing", startedAt: Date.now(), cancel: () => f.cancel() });
  setWcDebug({ error: null, uri: null, handoff: null, session: "preparing" }, `flow start (${mode})`);
  return f;
}

/** End the flow; on error keep the sheet up with the message and fallbacks. */
export function endWcFlow(err?: Error) {
  if (flow) flow.done = true;
  flow = null;
  if (err && !err.message.includes(CANCELLED)) {
    if (pending) patchPending({ phase: "error", error: err.message });
    else setPending({ mode: "modal", phase: "error", error: err.message, startedAt: Date.now(), cancel: () => {} });
  } else setPending(null);
}

export class WcTimeoutError extends Error {}
/** Race a promise against a deadline and the flow's cancel signal. */
export function withDeadline<T>(p: Promise<T>, ms: number, msg: string, f?: Flow | null): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const t = new Promise<never>((_, rej) => (timer = setTimeout(() => rej(new WcTimeoutError(msg)), Math.max(0, ms))));
  return Promise.race(f ? [p, t, f.cancelled] : [p, t]).finally(() => clearTimeout(timer));
}
const left = (f: Flow) => f.deadline - Date.now();

// ---------- relay diagnostics ----------
// The SignClient retries a failed relay socket silently (every ~16 s) and never rejects
// connect(); watch the sockets ourselves so we can say *why* (e.g. 3000 "origin not allowed").
let relayState = "not opened";
let relayWatched = false;
export function watchRelay() {
  if (relayWatched || typeof window === "undefined" || !window.WebSocket) return;
  relayWatched = true;
  const Native = window.WebSocket;
  class Watched extends Native {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      const u = String(url);
      if (!/relay\.walletconnect\.(org|com)/.test(u)) return;
      relayState = "connecting";
      setWcDebug({ relay: "connecting" }, "relay socket opening");
      this.addEventListener("open", () => {
        relayState = "open";
        setWcDebug({ relay: "open" }, "relay socket open");
      });
      this.addEventListener("error", () => {
        relayState = "error (blocked or offline)";
        setWcDebug({ relay: relayState }, "relay socket error");
      });
      this.addEventListener("close", (e) => {
        if (e.code === 1000) return;
        relayState = `closed ${e.code}${e.reason ? `: ${e.reason}` : ""}`;
        setWcDebug({ relay: relayState }, `relay ${relayState}`);
      });
    }
  }
  window.WebSocket = Watched as typeof WebSocket;
  window.addEventListener("unhandledrejection", (ev) => {
    const m = String((ev.reason as { message?: string })?.message ?? ev.reason ?? "");
    if (/walletconnect|relay|project|origin|appkit|reown/i.test(m)) setWcDebug({ initError: m.slice(0, 300) }, `WC error: ${m.slice(0, 120)}`);
  });
}
function relayHint(): string {
  const why = dbg.initError || (relayState !== "open" ? relayState : "");
  const allow = /origin|unauthori|allow|403|3000/i.test(why)
    ? " This site's domain may be missing from the Reown project's allowed domains."
    : "";
  return why ? ` (relay: ${why}).${allow}` : ".";
}

// ---------- helpers ----------
let mod: WcModuleLike | null = null;

export async function waitSignClient(timeoutMs = 10000): Promise<SignClientLike> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (mod?.signClient) {
      if (!dbg.wcReady) setWcDebug({ wcReady: true }, "SignClient ready");
      return mod.signClient;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new WcTimeoutError(`WalletConnect didn't start in time${relayHint()}`);
}

function accountOn(s: WcSessionLike, chain: string): string | null {
  const acc = s.namespaces?.stellar?.accounts?.find((a) => a.startsWith(chain + ":"));
  return acc ? acc.split(":")[2] : null;
}

/** Newest live session that holds a Testnet account. */
export function testnetSession(client: SignClientLike | undefined = mod?.signClient): { s: WcSessionLike; address: string } | null {
  if (!client) return null;
  const now = Date.now() / 1000;
  const all = client.session.getAll().filter((s) => s.expiry > now);
  for (let i = all.length - 1; i >= 0; i--) {
    const a = accountOn(all[i], WC_TESTNET);
    if (a) return { s: all[i], address: a };
  }
  return null;
}

const isMobileUA = () => typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

/** Navigate to a custom-scheme deep link. In an RN WebView this goes through
 * onShouldStartLoadWithRequest → (fails http/https originWhitelist) → Linking.openURL(url). */
function openDeepLink(url: string, how: string) {
  setWcDebug({ handoff: `${how} @ ${new Date().toTimeString().slice(0, 8)}` }, `handoff via ${how}`);
  try {
    window.location.href = url;
  } catch (e) {
    setWcDebug({}, `location.href threw: ${String(e)}`);
  }
}

function friendly(e: unknown): Error {
  const m = (e as { message?: string })?.message ?? String(e);
  if (/reject|denied|declin/i.test(m)) return new Error("The connection was declined in the wallet.");
  if (/expired/i.test(m)) return new Error("The connection request expired. Tap Connect to try again.");
  return e instanceof Error ? e : new Error(m);
}

export interface WcConnectOptions {
  /** "freighter": deep-link straight into Freighter (we're inside its in-app browser).
   *  "modal": show the AppKit wallet list / QR code (regular browsers). */
  handoff: "freighter" | "modal";
}

let connecting: Promise<{ address: string }> | null = null;

export function wcConnect(opts: WcConnectOptions): Promise<{ address: string }> {
  connecting ??= doConnect(opts).finally(() => (connecting = null));
  return connecting;
}

async function doConnect({ handoff }: WcConnectOptions): Promise<{ address: string }> {
  const f = beginWcFlow(handoff);
  let unsub: (() => void) | void = undefined;
  const modal = mod?.modal;
  let modalOpened = false;
  try {
    const client = await withDeadline(waitSignClient(left(f)), left(f) + 50, "WalletConnect didn't start in time.", f);
    const existing = testnetSession(client);
    if (existing) {
      setWcDebug({ session: "restored", address: existing.address }, "reusing live session");
      endWcFlow();
      return { address: existing.address };
    }
    setWcDebug({ session: "proposing" }, "signClient.connect()");
    const { uri, approval } = await withDeadline(
      client.connect({
        // Optional only (requiredNamespaces is deprecated in sign-client 2.2x and Freighter checks
        // both lists). Offering both networks means Freighter always approves or rejects instead
        // of silently ignoring a proposal for a network it isn't on.
        optionalNamespaces: { stellar: { methods: METHODS, chains: [WC_TESTNET, WC_PUBNET], events: [] } },
      }),
      left(f),
      "Couldn't reach the WalletConnect relay to create a pairing link",
      f,
    ).catch((e) => {
      throw e instanceof WcTimeoutError ? new Error(`${e.message}${relayHint()} Check the connection and try again.`) : e;
    });
    if (!uri) throw new Error("WalletConnect didn't return a pairing link.");
    setWcDebug({ uri, session: "proposed – waiting for wallet" }, "pairing URI generated");

    if (handoff === "freighter") {
      const deepLink = freighterWcDeepLink(uri);
      patchPending({ phase: "waiting", uri, deepLink, startedAt: Date.now() });
      openDeepLink(deepLink, "location.href (auto)");
    } else if (modal) {
      await withDeadline(Promise.resolve(modal.open({ uri })), Math.max(left(f), 4000), "The WalletConnect window didn't open.", f);
      modalOpened = true;
      patchPending({ phase: "waiting", uri, startedAt: Date.now() });
      setWcDebug({ handoff: "AppKit modal opened" }, "AppKit modal open");
      // User closed the AppKit modal without connecting → stop waiting.
      let seenOpen = !!modal.getState?.().open;
      unsub = modal.subscribeState?.((st) => {
        if (st.open) seenOpen = true;
        else if (seenOpen) f.cancel();
      });
    }

    const session = await withDeadline(
      approval(),
      WC_APPROVAL_TIMEOUT_MS,
      "No answer from the wallet after 3 minutes. In Freighter: make sure you tapped Connect, and that " +
        "Settings → Network is set to Testnet. Then tap Connect here again.",
      f,
    );
    const peer = session.peer?.metadata?.name || "The wallet";
    setWcDebug({}, `session approved by ${peer}`);
    const address = accountOn(session, WC_TESTNET);
    if (!address) {
      const onMain = accountOn(session, WC_PUBNET);
      client.disconnect({ topic: session.topic, reason: { code: 6000, message: "Ajo Circle needs Testnet" } }).catch(() => {});
      throw new Error(
        onMain
          ? `${peer} is on Mainnet. Ajo Circle runs on Stellar Testnet: in ${peer} open Settings → Network, choose Testnet, then tap Connect again.`
          : `${peer} didn't share a Stellar Testnet account.`,
      );
    }
    setWcDebug({ session: "connected", address }, `connected ${address.slice(0, 6)}…`);
    endWcFlow();
    return { address };
  } catch (e) {
    const err = friendly(e);
    const cancelled = err.message.includes(CANCELLED);
    setWcDebug({ session: cancelled ? "cancelled" : "failed", error: cancelled ? null : err.message }, `error: ${err.message}`);
    endWcFlow(err);
    throw err;
  } finally {
    if (typeof unsub === "function") unsub();
    if (modalOpened) {
      try {
        await withDeadline(Promise.resolve(modal?.close()), 2000, "close");
      } catch {}
    }
  }
}

/** Sign with the live Testnet session (stellar_signXDR). */
export async function wcSign(xdr: string): Promise<{ signedTxXdr: string; signerAddress?: string }> {
  const client = await waitSignClient();
  const live = testnetSession(client);
  if (!live) throw new Error("The WalletConnect session ended. Connect your wallet again.");
  setWcDebug({}, "sign request sent");
  const req = client.request<{ signedXDR: string }>({
    topic: live.s.topic,
    chainId: WC_TESTNET,
    request: { method: "stellar_signXDR", params: { xdr } },
  });
  // In a regular mobile browser the wallet is another app: bring it forward once the request
  // has been published (Freighter ignores redirect links without a ?uri=).
  const native = live.s.peer?.metadata?.redirect?.native;
  if (isMobileUA() && !inWalletBrowser() && native) setTimeout(() => openDeepLink(native, "wallet redirect"), 900);
  const { signedXDR } = await req;
  setWcDebug({}, "signed");
  return { signedTxXdr: signedXDR, signerAddress: live.address };
}

export async function wcDisconnect() {
  const client = mod?.signClient;
  if (!client) return;
  await Promise.all(
    client.session
      .getAll()
      .filter((s) => s.namespaces?.stellar)
      .map((s) => client.disconnect({ topic: s.topic, reason: { code: 6000, message: "User disconnected" } }).catch(() => {})),
  );
  setWcDebug({ session: "disconnected", address: null }, "disconnected");
}

function inWalletBrowser(): boolean {
  const s = (window as unknown as { stellar?: { platform?: string } }).stellar;
  return s?.platform === "mobile" || /FreighterMobile\//.test(navigator.userAgent);
}

/** Route the kit's WalletConnect module through the functions above. */
export function attachWc(m: WcModuleLike, freighterInApp: boolean) {
  mod = m;
  m.getAddress = () => wcConnect({ handoff: freighterInApp ? "freighter" : "modal" });
  m.signTransaction = (xdr) => wcSign(xdr);
  m.disconnect = () => wcDisconnect();
  // If something inside the kit/AppKit still tries to show the modal with a URI while we're in
  // Freighter's browser, hand it to Freighter instead.
  if (freighterInApp && m.modal) {
    const open = m.modal.open.bind(m.modal);
    m.modal.open = (o?: { uri?: string }) => {
      if (o?.uri) {
        openDeepLink(freighterWcDeepLink(o.uri), "location.href (modal.open)");
        return Promise.resolve();
      }
      return open(o);
    };
  }
}

/** Manual retry from the in-app sheet (a user tap; some WebViews only follow scheme links on a gesture). */
export function retryHandoff() {
  if (pending?.deepLink) openDeepLink(pending.deepLink, "button tap");
}
