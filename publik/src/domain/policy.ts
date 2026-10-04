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

export type PolicyCheckState = "pass" | "ask" | "fail" | "not-reached";

export type PolicyCheck = {
  id: "running" | "token" | "amount" | "limit" | "recipient";
  label: string;
  state: PolicyCheckState;
  detail: string;
};

export type PolicyDecision =
  | { outcome: "allow"; reason: string }
  | { outcome: "needs-approval"; reason: string }
  | { outcome: "block"; reason: string };

const USDC_DAY = "USDC";

function usdc(base: string): string {
  return new Decimal(base || "0").div(1_000_000).toFixed(2);
}

export function explainRequest(input: PolicyInput): { checks: PolicyCheck[]; decision: PolicyDecision } {
  const amount = new Decimal(input.request.amountBase);
  const amountOk = amount.isFinite() && !amount.isNegative() && !isZero(amount);
  const known = input.permissions.allowedRecipients.some((recipient) => recipient.address === input.request.recipient);
  const spent = new Decimal(input.spentUsdcBase || "0");
  const waiting = new Decimal(input.reservedUsdcBase || "0");
  const next = amountOk ? spent.plus(waiting).plus(amount) : spent.plus(waiting);
  const over = amountOk && compareBase(next, input.permissions.dailyUsdcBase) > 0;
  const checks: PolicyCheck[] = [
    {
      id: "running",
      label: "Agent is running",
      state: input.paused ? "fail" : "pass",
      detail: input.paused ? "This agent is paused. New payments stay here until you resume it." : "Running.",
    },
    {
      id: "token",
      label: "Payment is in Test USDC",
      state: input.request.token === USDC_DAY ? "pass" : "ask",
      detail: input.request.token === USDC_DAY ? "Test USDC." : "This request is not in Test USDC, so it needs your approval.",
    },
    {
      id: "amount",
      label: "Amount is valid",
      state: amountOk ? "pass" : "fail",
      detail: amountOk ? `${usdc(amount.toFixed(0))} Test USDC.` : "The amount is not a valid payment.",
    },
    {
      id: "limit",
      label: "Today's limit",
      state: over ? "fail" : "pass",
      detail: `${usdc(spent.toFixed(0))} spent + ${usdc(waiting.toFixed(0))} waiting + ${amountOk ? usdc(amount.toFixed(0)) : "0.00"} this payment = ${usdc(next.toFixed(0))} of ${usdc(input.permissions.dailyUsdcBase)} Test USDC`,
    },
    {
      id: "recipient",
      label: "Recipient",
      state: known ? "pass" : input.permissions.askBeforeNewRecipient ? "ask" : "fail",
      detail: known
        ? "On the allowed list."
        : input.permissions.askBeforeNewRecipient
          ? "Needs your approval — this recipient is new."
          : "Blocked — this recipient is not allowed.",
    },
  ];
  const stop = checks.findIndex((check) => check.state === "fail" || (check.id === "token" && check.state === "ask"));
  if (stop >= 0) {
    for (let index = stop + 1; index < checks.length; index += 1) {
      checks[index] = { ...checks[index], state: "not-reached", detail: "Not checked." };
    }
  }
  const decision = decisionFrom(checks, known, input);
  return { checks, decision };
}

function decisionFrom(checks: PolicyCheck[], known: boolean, input: PolicyInput): PolicyDecision {
  if (checks[0]?.state === "fail") {
    return { outcome: "block", reason: "This agent is paused. New payments stay here until you resume it." };
  }
  if (checks[1]?.state === "ask") {
    return { outcome: "needs-approval", reason: "This request is not in Test USDC, so it needs your approval." };
  }
  if (checks[2]?.state === "fail") return { outcome: "block", reason: "The amount is not a valid payment." };
  if (checks[3]?.state === "fail") {
    return { outcome: "block", reason: "This would go over today's spending limit, including other payments still waiting." };
  }
  if (!known && input.permissions.askBeforeNewRecipient) {
    return { outcome: "needs-approval", reason: "Needs your approval — this recipient is new." };
  }
  if (!known) return { outcome: "block", reason: "Blocked — this recipient is not allowed." };
  return { outcome: "allow", reason: "Within today's limit and an allowed recipient." };
}

export function evaluateRequest(input: PolicyInput): PolicyDecision {
  return explainRequest(input).decision;
}

/** Owner approval covers a request that only needed a yes. Hard blocks are checked again. */
export function recheckBeforeExecute(input: PolicyInput): PolicyDecision {
  const decision = evaluateRequest(input);
  if (decision.outcome === "block") return decision;
  return { outcome: "allow", reason: "Approved for this token, amount, and recipient." };
}
