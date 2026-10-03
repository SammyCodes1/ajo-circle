// Build-time stand-in for "@creit.tech/stellar-wallets-kit/modules/wallet-connect"
// used when NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is not set (see next.config.ts).
// loadWalletKit() never reaches this code path without a project id.
export enum WalletConnectTargetChain {
  PUBLIC = "stellar:pubnet",
  TESTNET = "stellar:testnet",
}
export class WalletConnectModule {
  constructor() {
    throw new Error("WalletConnect is disabled: set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID and rebuild.");
  }
}
