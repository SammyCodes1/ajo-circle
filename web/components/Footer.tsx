import { AdirePattern, LogoMark } from "./Brand";
import { config, explorer } from "@/lib/config";

export function Footer() {
  return (
    <footer className="relative mt-auto overflow-hidden border-t border-line">
      <AdirePattern className="absolute inset-0" opacity={0.06} />
      <div className="relative mx-auto flex max-w-6xl flex-col gap-4 px-4 pb-24 pt-8 text-sm text-muted md:pb-8 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <div className="flex items-center gap-3">
          <LogoMark className="h-6 w-6" />
          <p>
            <span className="font-display text-base text-ink">Ajo Circle</span> · save together, take turns.
          </p>
        </div>
        <p className="max-w-md text-[0.8rem] leading-relaxed">
          Runs on Stellar <b className="font-medium text-ink-soft">Testnet</b>. The {config.tokenCode} here is a
          test token with no value.{" "}
          <a className="underline decoration-line-strong underline-offset-2 hover:text-ink" href={explorer.contract(config.contractId)} target="_blank" rel="noreferrer">
            Contract ↗
          </a>
        </p>
      </div>
    </footer>
  );
}
