// Human-friendly messages for contract & wallet errors.

export const AJO_ERRORS: Record<number, string> = {
  1: "A circle needs at least 2 members.",
  2: "The member list contains the same address twice.",
  3: "Contribution must be greater than 0.",
  4: "Round length and join window must be at least 60 seconds.",
  5: "Circle not found.",
  6: "This address is not a member of the circle.",
  7: "You already contributed this round.",
  8: "The round can't be settled yet: not everyone has paid and the round deadline hasn't passed.",
  9: "This circle is closed (completed or cancelled).",
  10: "Too many members (max 20).",
  11: "That round doesn't exist yet.",
  12: "This circle is no longer waiting for members to accept.",
  13: "This circle isn't active (it hasn't started or has ended).",
  14: "You already accepted your slot.",
  15: "The join window has closed.",
  16: "Can't cancel: the join window is still open, or everyone accepted.",
  17: "Can't unwind yet: the round must be 2 periods past its deadline.",
  18: "Invalid collateral: it must be a whole number of contributions and not above your slot's target.",
  19: "Nothing to claim.",
  20: "Contribution is too large for this many members.",
  21: "Internal limit reached while settling. Use unwind after the grace period.",
  22: "Contract already initialized.",
};

// Stellar Asset Contract (token) errors that surface through contribute/payout.
const TOKEN_ERRORS: Record<number, string> = {
  10: "Insufficient token balance for this contribution.",
  13: "Missing trustline: add the USDC trustline to your account first.",
};

export type ErrorContext =
  | "contribute"
  | "payout"
  | "create"
  | "read"
  | "trustline"
  | "accept"
  | "collateral"
  | "claim";

export function friendlyError(err: unknown, ctx: ErrorContext = "read"): string {
  const raw =
    err instanceof Error ? err.message : typeof err === "string" ? err : JSON.stringify(err);
  const m = raw.match(/Error\(Contract, #(\d+)\)/);
  if (m) {
    const code = Number(m[1]);
    // contribute calls the token contract; its error codes overlap with ours.
    const moves = ctx === "contribute" || ctx === "accept" || ctx === "collateral";
    if (moves && /transfer|balance|trustline/i.test(raw) && TOKEN_ERRORS[code]) {
      return TOKEN_ERRORS[code];
    }
    if (AJO_ERRORS[code]) return AJO_ERRORS[code];
    if (TOKEN_ERRORS[code]) return TOKEN_ERRORS[code];
    return `Contract error #${code}`;
  }
  if (/trustline entry is missing|TrustlineMissing|op_no_trust/i.test(raw))
    return TOKEN_ERRORS[13];
  if (/resulting balance is not within the allowed range|op_underfunded|insufficient/i.test(raw))
    return "Insufficient balance for this transaction.";
  if (/declined|rejected|denied|cancel/i.test(raw)) return "You rejected the request in your wallet.";
  if (/Account not found|404/i.test(raw))
    return "This account doesn't exist on testnet yet. Fund it with Friendbot first.";
  if (/txBadSeq/i.test(raw)) return "Sequence number mismatch — please retry.";
  if (/non-existent contract function|MissingValue/i.test(raw))
    return "The configured Ajo contract doesn't support this version of the app. It may be the deprecated v1 contract — check NEXT_PUBLIC_AJO_CONTRACT_ID.";
  return raw.length > 300 ? raw.slice(0, 300) + "…" : raw;
}
