import { TOKEN_DECIMALS } from "./config";

const SCALE = BigInt(10) ** BigInt(TOKEN_DECIMALS);

/** 1234500000n -> "123.45" */
export function formatAmount(v: bigint | number | string, maxFrac = 2): string {
  const n = BigInt(v);
  const neg = n < BigInt(0);
  const abs = neg ? -n : n;
  const whole = abs / SCALE;
  let frac = (abs % SCALE).toString().padStart(TOKEN_DECIMALS, "0").slice(0, maxFrac);
  frac = frac.replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole.toLocaleString("en-US")}${frac ? "." + frac : ""}`;
}

/** "123.45" -> 1234500000n. Throws on invalid input. */
export function parseAmount(s: string): bigint {
  const t = s.trim();
  if (!/^\d+(\.\d{1,7})?$/.test(t)) throw new Error("Enter a positive amount with up to 7 decimals");
  const [w, f = ""] = t.split(".");
  return BigInt(w) * SCALE + BigInt(f.padEnd(TOKEN_DECIMALS, "0"));
}

export function shortAddr(a: string, n = 4): string {
  return a.length > 2 * n + 3 ? `${a.slice(0, n)}…${a.slice(-n)}` : a;
}

export function formatDuration(totalSecs: number): string {
  const s = Math.max(0, Math.floor(totalSecs));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}
