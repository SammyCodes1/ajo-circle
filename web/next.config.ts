import type { NextConfig } from "next";

// WalletConnect is optional. Without a project id we alias the kit's WalletConnect
// module to a tiny stub so its heavy Reown/WalletConnect dependency tree is not bundled.
const wcEnabled = !!process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
const WC_MODULE = "@creit.tech/stellar-wallets-kit/modules/wallet-connect";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: wcEnabled ? undefined : { resolveAlias: { [WC_MODULE]: "./lib/walletConnectOff.ts" } },
};

export default nextConfig;
