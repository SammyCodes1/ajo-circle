"use client";
import { nativeToScVal } from "@stellar/stellar-sdk";
import { config } from "./config";
import { addr, invokeWrite, simulateRead, TxResult } from "./stellar";

// Bindings for the v2 Ajo contract (collateral, debts, pull-based claims).

export type CircleStatus = "Forming" | "Active" | "Completed" | "Cancelled";

export interface Circle {
  id: number;
  admin: string;
  token: string;
  contribution: bigint;
  members: string[];
  period_secs: bigint;
  join_deadline: bigint;
  accepted: number;
  round: number;
  round_start: bigint;
  created_at: bigint;
  status: CircleStatus;
  paid: string[];
  pot: bigint;
}

export interface RoundStatus {
  circle_id: number;
  round: number;
  recipient: string;
  deadline: bigint;
  paid: string[];
  unpaid: string[];
  defaulted: string[];
  pot: bigint;
  settled: boolean;
  payout_ready: boolean;
  covered_from_collateral: bigint;
  debts_created: bigint;
  to_debts: bigint;
  withheld: bigint;
  to_claimable: bigint;
}

export interface Debt {
  creditor: string;
  amount: bigint;
  round: number;
}

export interface MemberState {
  slot: number;
  accepted: boolean;
  received: boolean;
  collateral: bigint;
  claimable: bigint;
  debts: Debt[];
  total_in: bigint;
  total_credited: bigint;
  total_claimed: bigint;
  paid: number;
  missed: number;
  missed_rounds: number[];
  received_gross: bigint;
}

/** v1-shaped record (derived on-chain from MemberState). */
export interface MemberRecord {
  paid: number;
  missed: number;
  received: bigint;
  missed_rounds: number[];
}

const u32 = (n: number) => nativeToScVal(n, { type: "u32" });
const u64 = (n: bigint | number) => nativeToScVal(BigInt(n), { type: "u64" });
const i128 = (n: bigint) => nativeToScVal(n, { type: "i128" });

const STATUSES: CircleStatus[] = ["Forming", "Active", "Completed", "Cancelled"];
// Unit enum variants decode as ["Active"]; normalise to the string.
function normStatus(s: unknown): CircleStatus {
  const v = Array.isArray(s) ? s[0] : s;
  return STATUSES.includes(v as CircleStatus) ? (v as CircleStatus) : "Active";
}

function normCircle(raw: Record<string, unknown>): Circle {
  return {
    ...(raw as unknown as Circle),
    id: Number(raw.id),
    round: Number(raw.round),
    accepted: Number(raw.accepted ?? 0),
    status: normStatus(raw.status),
  };
}

function normMember(raw: Record<string, unknown>): MemberState {
  const r = raw as unknown as MemberState;
  return {
    ...r,
    slot: Number(r.slot),
    paid: Number(r.paid),
    missed: Number(r.missed),
    missed_rounds: (r.missed_rounds ?? []).map(Number),
    debts: (r.debts ?? []).map((d) => ({ ...d, round: Number(d.round) })),
  };
}

/** Sum of a member's open (unpaid) debts. */
export const openDebt = (m: MemberState) =>
  m.debts.reduce((t, d) => t + BigInt(d.amount), BigInt(0));

/** Slot k's collateral target R_k = c·(n−1−k). */
export const slotTarget = (contribution: bigint, n: number, slot: number) =>
  contribution * BigInt(Math.max(0, n - 1 - slot));

export const ajo = {
  async token(): Promise<string> {
    return String(await simulateRead(config.contractId, "token"));
  },
  async circleCount(): Promise<number> {
    return Number(await simulateRead(config.contractId, "circle_count"));
  },
  async getCircle(id: number): Promise<Circle> {
    return normCircle(await simulateRead(config.contractId, "get_circle", [u32(id)]));
  },
  async getRoundStatus(id: number, round: number): Promise<RoundStatus> {
    const r = await simulateRead<RoundStatus>(config.contractId, "get_round_status", [
      u32(id),
      u32(round),
    ]);
    return { ...r, round: Number(r.round), circle_id: Number(r.circle_id) };
  },
  async getMemberState(id: number, member: string): Promise<MemberState> {
    return normMember(
      await simulateRead(config.contractId, "get_member_state", [u32(id), addr(member)]),
    );
  },
  async requiredCollateral(id: number, member: string): Promise<bigint> {
    return BigInt(
      await simulateRead<bigint>(config.contractId, "required_collateral", [
        u32(id),
        addr(member),
      ]),
    );
  },
  async getMemberRecord(id: number, member: string): Promise<MemberRecord> {
    const r = await simulateRead<MemberRecord>(config.contractId, "get_member_record", [
      u32(id),
      addr(member),
    ]);
    return {
      ...r,
      paid: Number(r.paid),
      missed: Number(r.missed),
      missed_rounds: (r.missed_rounds ?? []).map(Number),
    };
  },
  /** No token argument: the contract pins its token at deploy time. */
  createCircle(
    admin: string,
    contribution: bigint,
    members: string[],
    periodSecs: number,
    joinWindowSecs: number,
  ): Promise<TxResult> {
    return invokeWrite(admin, config.contractId, "create_circle", [
      addr(admin),
      i128(contribution),
      nativeToScVal(members.map(addr)),
      u64(periodSecs),
      u64(joinWindowSecs),
    ]);
  },
  accept(member: string, id: number, collateral: bigint): Promise<TxResult> {
    return invokeWrite(member, config.contractId, "accept", [
      u32(id),
      addr(member),
      i128(collateral),
    ]);
  },
  postCollateral(member: string, id: number, amount: bigint): Promise<TxResult> {
    return invokeWrite(member, config.contractId, "post_collateral", [
      u32(id),
      addr(member),
      i128(amount),
    ]);
  },
  contribute(member: string, id: number): Promise<TxResult> {
    return invokeWrite(member, config.contractId, "contribute", [u32(id), addr(member)]);
  },
  /** Anyone can settle; `caller` only pays the network fee. */
  settle(caller: string, id: number): Promise<TxResult> {
    return invokeWrite(caller, config.contractId, "settle", [u32(id)]);
  },
  cancel(caller: string, id: number): Promise<TxResult> {
    return invokeWrite(caller, config.contractId, "cancel", [u32(id)]);
  },
  unwind(caller: string, id: number): Promise<TxResult> {
    return invokeWrite(caller, config.contractId, "unwind", [u32(id)]);
  },
  claim(member: string, id: number): Promise<TxResult> {
    return invokeWrite(member, config.contractId, "claim", [u32(id), addr(member)]);
  },
};
