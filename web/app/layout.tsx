import type { Metadata, Viewport } from "next";
import "./globals.css";
import { WalletProvider } from "@/components/WalletProvider";
import { Header } from "@/components/Header";

export const metadata: Metadata = {
  title: "Ajo Circle — rotating savings on Stellar",
  description:
    "Ajo / esusu rotating savings groups on Stellar Soroban, paid in USDC. Transparent rounds, automatic payouts, on-chain records.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#047857",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans">
        <WalletProvider>
          <Header />
          <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
          <footer className="mx-auto max-w-5xl px-4 pb-10 pt-4 text-xs text-stone-500">
            Ajo Circle runs on Stellar Testnet. The USDC used here is a test token with no value.
          </footer>
        </WalletProvider>
      </body>
    </html>
  );
}
