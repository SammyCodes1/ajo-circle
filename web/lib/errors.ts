// Human-friendly messages for contract & wallet errors.

export const AJO_ERRORS: Record<number, string> = {
  1: "A circle needs at least 2 members.",
  2: "The member list contains the same address twice.",
  3: "Contribution must be greater than 0.",
  4: "Round length must be greater than 0.",
  5: "Circle not found.",
  6: "This address is not a member of the circle.",
  7: "You already contributed this round.",
  8: "Payout isn't ready yet: not everyone has paid and the round deadline hasn't passed.",
  9: "This circle has finished all its rounds.",
  10: "Too many members (max 50).",
  11: "That round doesn't exist yet.",
};

// Stellar Asset Contract (token) errors that surface through contribute/payout.
const TOKEN_ERRORS: Record<number, string> = {
  10: "Insufficient token balance for this contribution.",
  13: "Missing trustline: add the USDC trustline to your account first.",
};

export type ErrorContext = "contribute" | "payout" | "create" | "read" | "trustline";

export function friendlyError(err: unknown, ctx: ErrorContext = "read"): string {
  const raw =
    err instanceof Error ? err.message : typeof err === "string" ? err : JSON.stringify(err);
  const m = raw.match(/Error\(Contract, #(\d+)\)/);
  if (m) {
    const code = Number(m[1]);
    // contribute calls the token contract; its error codes overlap with ours.
    if (ctx === "contribute" && /transfer|balance|trustline/i.test(raw) && TOKEN_ERRORS[code]) {
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
  if (/declined|rejected|User declined/i.test(raw)) return "You rejected the request in Freighter.";
  if (/Account not found|404/i.test(raw))
    return "This account doesn't exist on testnet yet. Fund it with Friendbot first.";
  if (/txBadSeq/i.test(raw)) return "Sequence number mismatch — please retry.";
  return raw.length > 300 ? raw.slice(0, 300) + "…" : raw;
}
