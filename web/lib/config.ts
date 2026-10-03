// All values are public. Next.js inlines NEXT_PUBLIC_* at build time, so each
// variable must be referenced literally (no dynamic process.env[key]).
export const config = {
  contractId: process.env.NEXT_PUBLIC_AJO_CONTRACT_ID ?? "",
  tokenId: process.env.NEXT_PUBLIC_TOKEN_CONTRACT_ID ?? "",
  tokenCode: process.env.NEXT_PUBLIC_TOKEN_CODE ?? "USDC",
  tokenIssuer: process.env.NEXT_PUBLIC_TOKEN_ISSUER ?? "",
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL ?? "https://soroban-testnet.stellar.org",
  horizonUrl: process.env.NEXT_PUBLIC_HORIZON_URL ?? "https://horizon-testnet.stellar.org",
  networkPassphrase:
    process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015",
  readAccount: process.env.NEXT_PUBLIC_READ_ACCOUNT ?? "",
};

export const TOKEN_DECIMALS = 7;

export const explorer = {
  tx: (hash: string) => `https://stellar.expert/explorer/testnet/tx/${hash}`,
  contract: (id: string) => `https://stellar.expert/explorer/testnet/contract/${id}`,
  account: (id: string) => `https://stellar.expert/explorer/testnet/account/${id}`,
};

export function missingConfig(): string[] {
  const missing: string[] = [];
  if (!config.contractId) missing.push("NEXT_PUBLIC_AJO_CONTRACT_ID");
  if (!config.tokenId) missing.push("NEXT_PUBLIC_TOKEN_CONTRACT_ID");
  if (!config.tokenIssuer) missing.push("NEXT_PUBLIC_TOKEN_ISSUER");
  if (!config.readAccount) missing.push("NEXT_PUBLIC_READ_ACCOUNT");
  return missing;
}
