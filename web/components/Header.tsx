"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWallet } from "./WalletProvider";
import { Alert, Button } from "./ui";
import { LogoMark } from "./Brand";
import { shortAddr } from "@/lib/format";
import { explorer, missingConfig } from "@/lib/config";

const nav = [
  { href: "/", label: "Circles" },
  { href: "/create", label: "Start a circle" },
  { href: "/history", label: "My history" },
];

function isActive(path: string, href: string) {
  return href === "/" ? path === "/" || path.startsWith("/circle") : path.startsWith(href);
}

export function Header() {
  const w = useWallet();
  const path = usePathname();
  const missing = missingConfig();
  return (
    <header className="sticky top-0 z-20 border-b border-line/80 bg-paper/85 backdrop-blur-md supports-[backdrop-filter]:bg-paper/75">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
        <Link href="/" className="group flex items-center gap-2.5" aria-label="Ajo Circle home">
          <LogoMark className="h-8 w-8 transition-transform duration-500 ease-[var(--ease-calm)] group-hover:rotate-[24deg]" />
          <span className="font-display text-[1.3rem] leading-none text-ink">Ajo Circle</span>
          <span className="ml-1 rounded-full border border-ochre-bright/50 bg-ochre-wash/70 px-2 py-[3px] font-mono text-[0.62rem] font-medium uppercase leading-none tracking-[0.14em] text-ochre">
            Testnet
          </span>
        </Link>
        <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
          {nav.map((n) => {
            const active = isActive(path, n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={`relative rounded-lg px-3 py-2 text-[0.9rem] transition-colors ${
                  active ? "text-ink" : "text-muted hover:text-ink"
                }`}
              >
                {n.label}
                <span
                  className={`absolute inset-x-3 -bottom-[13px] h-[2px] rounded-full bg-clay transition-opacity ${
                    active ? "opacity-100" : "opacity-0"
                  }`}
                />
              </Link>
            );
          })}
        </nav>
        {w.address ? (
          <a
            href={explorer.account(w.address)}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 rounded-lg border border-line bg-ivory px-3 py-2 font-mono text-xs text-ink-soft transition-colors hover:border-line-strong"
            title={w.address}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${w.wrongNetwork ? "bg-rust" : "bg-sage-bright"}`} />
            {shortAddr(w.address)}
          </a>
        ) : (
          <Button onClick={w.connect} loading={w.connecting} variant="ink" className="!px-3.5 !py-2">
            Connect wallet
          </Button>
        )}
      </div>
      <nav className="mx-auto flex max-w-6xl gap-1 px-3 pb-2 md:hidden" aria-label="Main mobile">
        {nav.map((n) => {
          const active = isActive(path, n.href);
          return (
            <Link
              key={n.href}
              href={n.href}
              aria-current={active ? "page" : undefined}
              className={`flex-1 rounded-lg px-2 py-1.5 text-center text-[0.85rem] transition-colors ${
                active ? "bg-ivory text-ink shadow-[0_0_0_1px_var(--color-line)]" : "text-muted"
              }`}
            >
              {n.label}
            </Link>
          );
        })}
      </nav>
      {(missing.length > 0 || w.installed === false || w.wrongNetwork || w.error) && (
        <div className="mx-auto max-w-6xl space-y-2 px-5 pb-3 sm:px-8">
          {missing.length > 0 && (
            <Alert tone="error" title="App is not configured">
              Set {missing.join(", ")} in <code className="font-mono text-xs">web/.env.local</code> (see
              .env.example) and restart.
            </Alert>
          )}
          {w.installed === false && (
            <Alert tone="info">
              Browsing read-only. To create circles or contribute, add the{" "}
              <a className="font-medium text-clay-deep underline underline-offset-2" href="https://www.freighter.app/" target="_blank" rel="noreferrer">
                Freighter wallet
              </a>{" "}
              and reload.
            </Alert>
          )}
          {w.wrongNetwork && (
            <Alert tone="error" title="Wrong network">
              Freighter is on <b>{w.network}</b>. Ajo Circle runs on Stellar <b>Testnet</b> — switch in
              Freighter → Settings → Network.
            </Alert>
          )}
          {w.error && <Alert tone="error">{w.error}</Alert>}
        </div>
      )}
    </header>
  );
}
