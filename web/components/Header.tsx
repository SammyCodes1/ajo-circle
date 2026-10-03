"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { WalletMenu } from "./WalletMenu";
import { LogoMark } from "./Brand";

export const NAV = [
  { href: "/", label: "Circles", icon: "ring" },
  { href: "/create", label: "Start a circle", short: "Start", icon: "plus" },
  { href: "/history", label: "My history", short: "History", icon: "list" },
] as const;

export function isActive(path: string, href: string) {
  return href === "/" ? path === "/" || path.startsWith("/circle") : path.startsWith(href);
}

export function Header() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-[var(--z-sticky)] border-b border-line/80 bg-paper/80 shadow-[var(--shadow-raised)] backdrop-blur-md backdrop-saturate-150">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:h-16 sm:px-8">
        <Link href="/" className="group flex min-h-11 min-w-0 items-center gap-2.5" aria-label="Ajo Circle home">
          <LogoMark className="h-8 w-8 shrink-0 transition-transform duration-500 ease-[var(--ease-calm)] group-hover:rotate-[24deg]" />
          <span className="font-display hidden text-[1.25rem] leading-none text-ink min-[360px]:inline sm:text-[1.3rem]">
            Ajo Circle
          </span>
          <span className="rounded-full border border-ochre-bright/50 bg-ochre-wash/70 px-2 py-1 font-mono text-xs font-medium uppercase leading-none tracking-[0.1em] text-ochre">
            Testnet
          </span>
        </Link>
        <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
          {NAV.map((n) => {
            const active = isActive(path, n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={`relative inline-flex min-h-11 items-center rounded-lg px-3 text-[0.9rem] transition-colors ${
                  active ? "text-ink" : "text-muted hover:text-ink"
                }`}
              >
                {n.label}
                <span
                  className={`absolute inset-x-3 -bottom-[10px] h-[2px] rounded-full bg-clay transition-opacity ${
                    active ? "opacity-100" : "opacity-0"
                  }`}
                />
              </Link>
            );
          })}
        </nav>
        <WalletMenu />
      </div>
    </header>
  );
}

function NavIcon({ kind, active }: { kind: string; active: boolean }) {
  const c = active ? "#B5532F" : "#6B6560";
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden fill="none" stroke={c} strokeWidth="1.6" strokeLinecap="round">
      {kind === "ring" && (
        <>
          <circle cx="12" cy="12" r="7.5" strokeDasharray="2 3.2" />
          <circle cx="12" cy="4.5" r="2.2" fill={c} stroke="none" />
        </>
      )}
      {kind === "plus" && (
        <>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 8.5v7M8.5 12h7" />
        </>
      )}
      {kind === "list" && <path d="M5 7h14M5 12h14M5 17h9" />}
    </svg>
  );
}

/** Bottom tab bar for phones/tablets (< md). */
export function MobileNav() {
  const path = usePathname();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-[var(--z-sticky)] border-t border-line/80 bg-paper/85 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_-18px_rgb(31_30_29/0.3)] backdrop-blur-md backdrop-saturate-150 md:hidden"
    >
      <ul className="mx-auto grid max-w-md grid-cols-3">
        {NAV.map((n) => {
          const active = isActive(path, n.href);
          return (
            <li key={n.href}>
              <Link
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs transition-colors ${
                  active ? "font-medium text-clay-deep" : "text-muted"
                }`}
              >
                <NavIcon kind={n.icon} active={active} />
                {"short" in n ? n.short : n.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
