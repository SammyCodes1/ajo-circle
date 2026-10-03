import type { Metadata, Viewport } from "next";
import { Fraunces, Inter_Tight, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { WalletProvider } from "@/components/WalletProvider";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

const fraunces = Fraunces({
  subsets: ["latin"],
  axes: ["SOFT", "WONK", "opsz"],
  variable: "--font-fraunces",
  display: "swap",
});
const interTight = Inter_Tight({
  subsets: ["latin"],
  variable: "--font-inter-tight",
  display: "swap",
});
const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Ajo Circle — rotating savings on Stellar",
  description:
    "Ajo / esusu rotating savings groups on Stellar Soroban, paid in USDC. Transparent rounds, automatic payouts, on-chain records.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#F5F1EA",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${interTight.variable} ${jetbrains.variable}`}>
      <body className="flex min-h-screen flex-col">
        <WalletProvider>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-ink focus:px-3 focus:py-2 focus:text-ivory"
          >
            Skip to content
          </a>
          <Header />
          <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-5 pb-16 pt-8 sm:px-8 sm:pt-12">
            {children}
          </main>
          <Footer />
        </WalletProvider>
      </body>
    </html>
  );
}
