"use client";
import { nativeToScVal } from "@stellar/stellar-sdk";
import { config } from "./config";
import { addr, invokeWrite, simulateRead, TxResult } from "./stellar";

export type CircleStatus = "Active" | "Completed";

export interface Circle {
  id: number;
  admin: string;
  token: string;
  contribution: bigint;
  members: string[];
  period_secs: bigint;
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
}

export interface MemberRecord {
  paid: number;
  missed: number;
  received: bigint;
  missed_rounds: number[];
}

const u32 = (n: number) => nativeToScVal(n, { type: "u32" });
const u64 = (n: bigint | number) => nativeToScVal(BigInt(n), { type: "u64" });
const i128 = (n: bigint) => nativeToScVal(n, { type: "i128" });

// Unit enum variants decode as ["Active"]; normalise to the string.
function normStatus(s: unknown): CircleStatus {
  const v = Array.isArray(s) ? s[0] : s;
  return v === "Completed" ? "Completed" : "Active";
}

function normCircle(raw: Record<string, unknown>): Circle {
  return {
    ...(raw as unknown as Circle),
    id: Number(raw.id),
    round: Number(raw.round),
    status: normStatus(raw.status),
  };
}

export const ajo = {
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
  createCircle(
    admin: string,
    contribution: bigint,
    members: string[],
    periodSecs: number,
  ): Promise<TxResult> {
    return invokeWrite(admin, config.contractId, "create_circle", [
      addr(admin),
      addr(config.tokenId),
      i128(contribution),
      nativeToScVal(members.map(addr)),
      u64(periodSecs),
    ]);
  },
  contribute(member: string, id: number): Promise<TxResult> {
    return invokeWrite(member, config.contractId, "contribute", [u32(id), addr(member)]);
  },
  payout(caller: string, id: number): Promise<TxResult> {
    return invokeWrite(caller, config.contractId, "payout", [u32(id)]);
  },
};
