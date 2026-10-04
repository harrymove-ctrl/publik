import Decimal from "decimal.js";
import { reservedUsdcBase } from "./apply";
import { explainRequest, type SpendRequest } from "./policy";
import type { Agent } from "./types";

export type AgentFace = "Active" | "Paused" | "Needs review" | "Not connected";

export function agentFace(agent: Agent): AgentFace {
  if (agent.walletMode === "unconnected" || !agent.address) return "Not connected";
  if (agent.status === "paused") return "Paused";
  if (agent.requests.some((item) => item.status === "pending" || item.status === "blocked")) return "Needs review";
  return "Active";
}

export function awaitingReview(agents: Agent[]): { agent: Agent; request: SpendRequest }[] {
  return agents.flatMap((agent) =>
    agent.requests.filter((item) => item.status === "pending").map((request) => ({ agent, request })),
  );
}

export function completedUsdc(agents: Agent[]): Decimal {
  return agents.reduce((sum, agent) => {
    return agent.requests.reduce((inner, request) => {
      if (request.status !== "completed" || request.token !== "USDC") return inner;
      return inner.plus(new Decimal(request.amountBase).div(1_000_000));
    }, sum);
  }, new Decimal(0));
}

export function spentTodayUsdc(agents: Agent[]): Decimal {
  return agents.reduce((sum, agent) => sum.plus(new Decimal(agent.spentTodayBase || "0").div(1_000_000)), new Decimal(0));
}

export function dailyLimitUsdc(agents: Agent[]): Decimal {
  return agents.reduce((sum, agent) => sum.plus(new Decimal(agent.permissions.dailyUsdcBase || "0").div(1_000_000)), new Decimal(0));
}

/** Demo holdings only. Mainnet portfolio is a separate read. */
export function demoPortfolioUsd(agents: Agent[]): { usd: string | null; assets: number } {
  const symbols = new Set<string>();
  let usd = new Decimal(0);
  let priced = false;
  for (const agent of agents) {
    if (agent.walletMode !== "demo") continue;
    for (const holding of agent.holdings) {
      symbols.add(holding.symbol);
      if (!holding.priceUsd) continue;
      priced = true;
      const whole = new Decimal(holding.amountBase || "0").div(new Decimal(10).pow(holding.decimals));
      usd = usd.plus(whole.mul(holding.priceUsd));
    }
  }
  return { usd: priced ? usd.toFixed(2) : null, assets: symbols.size };
}

export function withinSpentLimit(agent: Agent): boolean {
  return new Decimal(agent.spentTodayBase || "0").lte(agent.permissions.dailyUsdcBase || "0");
}

export function remainingTodayUsdc(agent: Agent): Decimal {
  const left = new Decimal(agent.permissions.dailyUsdcBase || "0").minus(agent.spentTodayBase || "0");
  return left.isNegative() ? new Decimal(0) : left.div(1_000_000);
}

export type ActivityKind = "requested" | "approved" | "rejected" | "blocked" | "failed" | "paused" | "budget";

export type ActivityRow = {
  id: string;
  at: string;
  agentName: string;
  kind: ActivityKind;
  title: string;
  cluster: "Demo" | "Devnet" | "Mainnet view-only";
  mode?: "owner-signed" | "delegated";
};

export function activityRows(agents: Agent[]): ActivityRow[] {
  const rows: ActivityRow[] = [];
  for (const agent of agents) {
    rows.push({
      id: `${agent.id}-budget`,
      at: agent.createdAt,
      agentName: agent.name,
      kind: "budget",
      title: `Budget granted · ${new Decimal(agent.permissions.dailyUsdcBase || "0").div(1_000_000).toFixed(2)} Test USDC a day`,
      cluster: agent.cluster === "demo" ? "Demo" : "Devnet",
      mode: "owner-signed",
    });
    if (agent.status === "paused") {
      rows.push({
        id: `${agent.id}-paused`,
        at: agent.createdAt,
        agentName: agent.name,
        kind: "paused",
        title: "Agent paused",
        cluster: agent.cluster === "demo" ? "Demo" : "Devnet",
        mode: "owner-signed",
      });
    }
    for (const request of agent.requests) {
      const cluster = request.cluster === "demo" ? "Demo" : "Devnet";
      const amount = new Decimal(request.amountBase).div(request.token === "USDC" ? 1_000_000 : 1_000_000_000).toFixed(2);
      rows.push({
        id: `${request.id}-ask`,
        at: request.createdAt,
        agentName: agent.name,
        kind: "requested",
        title: `Payment requested · ${amount} ${request.token === "USDC" ? "Test USDC" : "SOL"} to ${request.recipientLabel}`,
        cluster,
        mode: "owner-signed",
      });
      if (request.status === "completed" || request.status === "approved") {
        rows.push({
          id: `${request.id}-ok`,
          at: request.createdAt,
          agentName: agent.name,
          kind: "approved",
          title: request.status === "completed" ? "Payment approved in the demo" : "Payment approved",
          cluster,
          mode: "owner-signed",
        });
      } else if (request.status === "rejected") {
        rows.push({
          id: `${request.id}-no`,
          at: request.createdAt,
          agentName: agent.name,
          kind: "rejected",
          title: "Payment rejected",
          cluster,
          mode: "owner-signed",
        });
      } else if (request.status === "blocked") {
        rows.push({
          id: `${request.id}-block`,
          at: request.createdAt,
          agentName: agent.name,
          kind: "blocked",
          title: request.reason || "Blocked by a spending rule",
          cluster,
          mode: "owner-signed",
        });
      } else if (request.status === "failed") {
        rows.push({
          id: `${request.id}-fail`,
          at: request.createdAt,
          agentName: agent.name,
          kind: "failed",
          title: "Payment failed before broadcast",
          cluster,
          mode: "owner-signed",
        });
      }
    }
  }
  return rows.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

export function ruleVerdict(agent: Agent, request: SpendRequest): string {
  const explained = explainRequest({
    permissions: agent.permissions,
    paused: agent.status === "paused",
    request,
    reservedUsdcBase: reservedUsdcBase(agent, request.id),
    spentUsdcBase: agent.spentTodayBase,
  });
  if (explained.decision.outcome === "allow") return "Allowed";
  if (explained.decision.outcome === "needs-approval") return "Needs approval";
  const fail = explained.checks.find((check) => check.state === "fail");
  if (fail?.id === "running") return "Agent paused";
  if (fail?.id === "limit") return "Over daily limit";
  if (fail?.id === "recipient") return "Recipient not allowed";
  return "Invalid request";
}
