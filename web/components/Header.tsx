"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWallet } from "./WalletProvider";
import { Alert, Button } from "./ui";
import { shortAddr } from "@/lib/format";
import { explorer, missingConfig } from "@/lib/config";

const nav = [
  { href: "/", label: "Circles" },
  { href: "/create", label: "Create" },
  { href: "/history", label: "My history" },
];

export function Header() {
  const w = useWallet();
  const path = usePathname();
  const missing = missingConfig();
  return (
    <header className="sticky top-0 z-10 border-b border-stone-200 bg-stone-50/90 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
        <Link href="/" className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-emerald-700 text-lg font-black text-amber-300">
            ◎
          </span>
          <span className="text-lg font-extrabold tracking-tight text-stone-900">
            Ajo Circle
          </span>
          <span className="hidden rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-900 sm:inline">
            testnet
          </span>
        </Link>
        <nav className="hidden gap-1 md:flex">
          {nav.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`rounded-lg px-3 py-2 text-sm font-medium ${
                path === n.href ? "bg-emerald-50 text-emerald-800" : "text-stone-600 hover:bg-stone-100"
              }`}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        {w.address ? (
          <a
            href={explorer.account(w.address)}
            target="_blank"
            rel="noreferrer"
            className="rounded-xl border border-stone-200 bg-white px-3 py-2 font-mono text-xs text-stone-700"
            title={w.address}
          >
            ● {shortAddr(w.address)}
          </a>
        ) : (
          <Button onClick={w.connect} loading={w.connecting}>
            Connect Freighter
          </Button>
        )}
      </div>
      <nav className="mx-auto flex max-w-5xl gap-1 px-4 pb-2 md:hidden">
        {nav.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className={`flex-1 rounded-lg px-2 py-1.5 text-center text-sm font-medium ${
              path === n.href ? "bg-emerald-50 text-emerald-800" : "text-stone-600"
            }`}
          >
            {n.label}
          </Link>
        ))}
      </nav>
      <div className="mx-auto max-w-5xl space-y-2 px-4 empty:hidden [&>*:last-child]:mb-3">
        {missing.length > 0 && (
          <Alert tone="error">
            App is not configured: set {missing.join(", ")} in <code>web/.env.local</code> (see
            .env.example) and restart.
          </Alert>
        )}
        {w.installed === false && (
          <Alert tone="warn">
            Freighter wallet not detected.{" "}
            <a className="underline" href="https://www.freighter.app/" target="_blank" rel="noreferrer">
              Install Freighter
            </a>{" "}
            to create circles and contribute. You can still browse circles.
          </Alert>
        )}
        {w.wrongNetwork && (
          <Alert tone="error">
            Wrong network: Freighter is on <b>{w.network}</b>. Ajo Circle runs on Stellar{" "}
            <b>Testnet</b> — switch networks in Freighter (Settings → Network → Testnet).
          </Alert>
        )}
        {w.error && <Alert tone="error">{w.error}</Alert>}
      </div>
    </header>
  );
}
