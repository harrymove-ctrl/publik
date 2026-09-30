import Decimal from "decimal.js";
import { compareBase, isZero } from "./money";

export type RequestStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "blocked"
  | "completed"
  | "failed";

export interface SpendRequest {
  id: string;
  agentId: string;
  token: "SOL" | "USDC";
  amountBase: string;
  decimals: number;
  recipient: string;
  recipientLabel: string;
  memo: string;
  createdAt: string;
  status: RequestStatus;
  reason: string;
  signature: string | null;
  cluster: "devnet" | "demo";
  feePayer: string | null;
  feeLamports: string | null;
}

export interface Permissions {
  /** Daily USDC cap in base units (6 decimals). */
  dailyUsdcBase: string;
  allowedRecipients: { address: string; label: string }[];
  askBeforeNewRecipient: boolean;
  /** Simulated in this prototype. Not wallet-level enforcement. */
  enforcement: "simulated";
}

export interface PolicyInput {
  permissions: Permissions;
  paused: boolean;
  request: Pick<SpendRequest, "token" | "amountBase" | "recipient">;
  /** Other in-flight USDC spends, in base units, that still count against today. */
  reservedUsdcBase: string;
  /** USDC already completed today, in base units. */
  spentUsdcBase: string;
}

export type PolicyDecision =
  | { outcome: "allow"; reason: string }
  | { outcome: "needs-approval"; reason: string }
  | { outcome: "block"; reason: string };

const USDC_DAY = "USDC";

export function evaluateRequest(input: PolicyInput): PolicyDecision {
  if (input.paused) {
    return {
      outcome: "block",
      reason: "This agent is paused. New payments stay here until you resume it.",
    };
  }

  if (input.request.token !== USDC_DAY) {
    return {
      outcome: "needs-approval",
      reason: "This request is not in Test USDC, so it needs your approval.",
    };
  }

  const amount = new Decimal(input.request.amountBase);
  if (!amount.isFinite() || amount.isNegative() || isZero(amount)) {
    return { outcome: "block", reason: "The amount is not a valid payment." };
  }

  const known = input.permissions.allowedRecipients.some(
    (recipient) => recipient.address === input.request.recipient,
  );

  const committed = new Decimal(input.spentUsdcBase).plus(input.reservedUsdcBase);
  const next = committed.plus(amount);
  if (compareBase(next, input.permissions.dailyUsdcBase) > 0) {
    return {
      outcome: "block",
      reason: "This would go over today's spending limit, including other payments still waiting.",
    };
  }

  if (!known && input.permissions.askBeforeNewRecipient) {
    return {
      outcome: "needs-approval",
      reason: "Needs your approval — this recipient is new.",
    };
  }

  if (!known) {
    return {
      outcome: "block",
      reason: "Blocked — this recipient is not allowed.",
    };
  }

  return { outcome: "allow", reason: "Within today's limit and an allowed recipient." };
}

/** Owner approval covers a request that only needed a yes. Hard blocks are checked again. */
export function recheckBeforeExecute(input: PolicyInput): PolicyDecision {
  const decision = evaluateRequest(input);
  if (decision.outcome === "block") return decision;
  return { outcome: "allow", reason: "Approved for this token, amount, and recipient." };
}
