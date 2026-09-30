import Decimal from "decimal.js";
import { spendHistoryFromRequests, spentTodayFromRequests } from "./ledger";
import { compareBase, toBase } from "./money";
import { evaluateRequest, recheckBeforeExecute, type SpendRequest } from "./policy";
import type { Agent } from "./types";

export function reservedUsdcBase(agent: Agent, exceptId = ""): string {
  return agent.requests
    .filter((item) => item.id !== exceptId && item.status === "pending" && item.token === "USDC")
    .reduce((sum, item) => sum.plus(item.amountBase), new Decimal(0))
    .toFixed(0);
}

export function applyDecision(
  agent: Agent,
  requestId: string,
  decision: "approved" | "rejected",
): { agent: Agent; error: string | null } {
  const request = agent.requests.find((item) => item.id === requestId);
  if (!request || request.agentId !== agent.id) {
    return { agent, error: "That request does not belong to this agent." };
  }
  if (request.status !== "pending") {
    return { agent, error: "That request is no longer waiting." };
  }

  if (decision === "rejected") {
    return {
      agent: replaceRequest(agent, requestId, {
        status: "rejected",
        reason: "You rejected this payment. Nothing was sent.",
        signature: null,
      }),
      error: null,
    };
  }

  const check = recheckBeforeExecute({
    permissions: agent.permissions,
    paused: agent.status === "paused",
    request,
    reservedUsdcBase: reservedUsdcBase(agent, requestId),
    spentUsdcBase: agent.spentTodayBase,
  });
  if (check.outcome === "block") {
    return {
      agent: replaceRequest(agent, requestId, { status: "blocked", reason: check.reason, signature: null }),
      error: check.reason,
    };
  }

  if (agent.walletMode !== "demo") {
    const reason = "Publik is only watching this wallet. It cannot sign or send this payment.";
    return {
      agent: replaceRequest(agent, requestId, { status: "failed", reason, signature: null }),
      error: reason,
    };
  }

  const holding = agent.holdings.find((item) => item.symbol === request.token);
  if (!holding || compareBase(holding.amountBase, request.amountBase) < 0) {
    const reason = `Not enough ${request.token === "USDC" ? "Test USDC" : "SOL"} to send this payment.`;
    return {
      agent: replaceRequest(agent, requestId, { status: "failed", reason, signature: null }),
      error: reason,
    };
  }

  const requests = agent.requests.map((item) =>
    item.id === requestId
      ? {
          ...item,
          status: "completed" as const,
          reason: "Approved in the demo. No Solana transaction was broadcast.",
          signature: null,
          feePayer: null,
          feeLamports: null,
        }
      : item,
  );
  return {
    error: null,
    agent: {
      ...agent,
      spentTodayBase: request.token === "USDC" ? spentTodayFromRequests(requests) : agent.spentTodayBase,
      holdings: agent.holdings.map((item) =>
        item.symbol === request.token
          ? { ...item, amountBase: new Decimal(item.amountBase).minus(request.amountBase).toFixed(0) }
          : item,
      ),
      spendHistory: request.token === "USDC" ? spendHistoryFromRequests(requests) : agent.spendHistory,
      requests,
    },
  };
}

export function appendSample(agent: Agent, id: string, createdAt: string): Agent {
  const recipient = agent.permissions.allowedRecipients[0];
  const sample: SpendRequest = {
    id,
    agentId: agent.id,
    token: "USDC",
    amountBase: toBase("4", 6).toFixed(0),
    decimals: 6,
    recipient: recipient?.address ?? "5uRkqsGXWSbfYwuLwc4uQPTmAyPrwaAEvecszam8FjkT",
    recipientLabel: recipient?.label ?? "Sample recipient",
    memo: "Sample payment request",
    createdAt,
    status: "pending",
    reason: "Needs your approval",
    signature: null,
    cluster: "demo",
    feePayer: null,
    feeLamports: null,
  };

  const decision = evaluateRequest({
    permissions: agent.permissions,
    paused: agent.status === "paused",
    request: sample,
    reservedUsdcBase: reservedUsdcBase(agent),
    spentUsdcBase: agent.spentTodayBase,
  });

  if (decision.outcome === "block") {
    sample.status = "blocked";
    sample.reason = decision.reason;
  } else if (decision.outcome === "needs-approval") {
    sample.status = "pending";
    sample.reason = "Needs your approval";
  } else {
    sample.status = "pending";
    sample.reason = "Needs your approval";
  }

  const holding = agent.holdings.find((item) => item.symbol === "USDC");
  if (sample.status === "pending" && (!holding || compareBase(holding.amountBase, sample.amountBase) < 0)) {
    sample.status = "blocked";
    sample.reason = "Not enough Test USDC to send this payment.";
  }

  return { ...agent, requests: [sample, ...agent.requests] };
}

export function reevaluateRequest(agent: Agent, requestId: string): Agent {
  const request = agent.requests.find((item) => item.id === requestId);
  if (!request || request.agentId !== agent.id) return agent;
  if (request.status !== "blocked" && request.status !== "pending") return agent;

  const decision = evaluateRequest({
    permissions: agent.permissions,
    paused: agent.status === "paused",
    request,
    reservedUsdcBase: reservedUsdcBase(agent, requestId),
    spentUsdcBase: agent.spentTodayBase,
  });

  if (decision.outcome === "block") {
    return replaceRequest(agent, requestId, { status: "blocked", reason: decision.reason });
  }
  return replaceRequest(agent, requestId, {
    status: "pending",
    reason: "Needs your approval",
  });
}

function replaceRequest(agent: Agent, requestId: string, patch: Partial<SpendRequest>): Agent {
  return {
    ...agent,
    requests: agent.requests.map((item) => (item.id === requestId ? { ...item, ...patch } : item)),
  };
}

