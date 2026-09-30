import { describe, expect, test } from "bun:test";
import { appendSample, applyDecision } from "./apply";
import { toBase } from "./money";
import { evaluateRequest, recheckBeforeExecute, type Permissions, type SpendRequest } from "./policy";
import { createSeedAgents } from "./seed";
import type { Agent } from "./types";

const permissions: Permissions = {
  dailyUsdcBase: toBase("20", 6).toFixed(0),
  allowedRecipients: [{ label: "Design API", address: "CBNwBPJcYiBCuAPbzHsVDervgaiEim8rgzZBPowhdA8P" }],
  askBeforeNewRecipient: true,
  enforcement: "simulated",
};

function request(amount: string, recipient = permissions.allowedRecipients[0].address): SpendRequest {
  return {
    id: `r-${amount}`,
    agentId: "alice",
    token: "USDC",
    amountBase: toBase(amount, 6).toFixed(0),
    decimals: 6,
    recipient,
    recipientLabel: "Recipient",
    memo: "",
    createdAt: "2026-04-08T00:00:00.000Z",
    status: "pending",
    reason: "",
    signature: null,
    cluster: "demo",
    feePayer: null,
    feeLamports: null,
  };
}

describe("permissions", () => {
  test("allows a known recipient exactly at the daily limit", () => {
    const decision = evaluateRequest({
      permissions,
      paused: false,
      request: request("12"),
      reservedUsdcBase: "0",
      spentUsdcBase: toBase("8", 6).toFixed(0),
    });
    expect(decision.outcome).toBe("allow");
  });

  test("blocks one base unit over the limit, including reserved spends", () => {
    const decision = evaluateRequest({
      permissions,
      paused: false,
      request: request("1"),
      reservedUsdcBase: toBase("12", 6).toFixed(0),
      spentUsdcBase: toBase("8", 6).toFixed(0),
    });
    expect(decision.outcome).toBe("block");
  });

  test("asks before a new recipient and blocks when that ask is off", () => {
    const unknown = "5G46y8WrbfodWUxExHdT9eH6SCYJ5qeeQNGTzDvCApJQ";
    expect(
      evaluateRequest({
        permissions,
        paused: false,
        request: request("1", unknown),
        reservedUsdcBase: "0",
        spentUsdcBase: "0",
      }).outcome,
    ).toBe("needs-approval");
    expect(
      evaluateRequest({
        permissions: { ...permissions, askBeforeNewRecipient: false },
        paused: false,
        request: request("1", unknown),
        reservedUsdcBase: "0",
        spentUsdcBase: "0",
      }).outcome,
    ).toBe("block");
  });

  test("pause blocks, and approval still sends a request that only needed a yes", () => {
    expect(
      evaluateRequest({
        permissions,
        paused: true,
        request: request("1"),
        reservedUsdcBase: "0",
        spentUsdcBase: "0",
      }).outcome,
    ).toBe("block");
    expect(
      recheckBeforeExecute({
        permissions,
        paused: false,
        request: request("1", "5G46y8WrbfodWUxExHdT9eH6SCYJ5qeeQNGTzDvCApJQ"),
        reservedUsdcBase: "0",
        spentUsdcBase: "0",
      }).outcome,
    ).toBe("allow");
  });
});

describe("decisions", () => {
  test("a second payment is blocked once today's limit is spent", () => {
    const seed = createSeedAgents()[0];
    const first = applyDecision(seed, "req-design", "approved");
    expect(first.error).toBeNull();
    expect(first.agent.spentTodayBase).toBe(toBase("20", 6).toFixed(0));
    const extra = appendSample(first.agent, "sample-1", "2026-09-30T16:00:00.000Z");
    expect(extra.requests[0]?.status).toBe("blocked");
  });

  test("chart totals count completed payments only", () => {
    const researcher = createSeedAgents().find((agent) => agent.id === "researcher");
    const completed = researcher?.requests
      .filter((item) => item.status === "completed")
      .reduce((sum, item) => sum + Number(item.amountBase) / 1_000_000, 0);
    const chart = researcher?.spendHistory.reduce((sum, day) => sum + day.usdc, 0);
    expect(chart).toBe(completed);
    expect(researcher?.requests.some((item) => item.status === "failed")).toBe(true);
    expect(researcher?.spendHistory.find((day) => day.label === "Wed")?.usdc).toBe(0);
  });

  test("rejects a repeated approval and a foreign request", () => {
    const seed = createSeedAgents()[0];
    const once = applyDecision(seed, "req-design", "approved");
    expect(applyDecision(once.agent, "req-design", "approved").error).toBe("That request is no longer waiting.");
    expect(applyDecision(seed, "req-archive-fail", "approved").error).toBe("That request does not belong to this agent.");
  });

  test("does not sign a watched wallet or spend more than the balance", () => {
    const seed = createSeedAgents()[0];
    const watched: Agent = { ...seed, walletMode: "readonly", cluster: "devnet" };
    expect(applyDecision(watched, "req-design", "approved").error).toMatch(/watching/i);
    const poor: Agent = {
      ...seed,
      holdings: seed.holdings.map((holding) => (holding.symbol === "USDC" ? { ...holding, amountBase: "1" } : holding)),
    };
    expect(applyDecision(poor, "req-design", "approved").error).toMatch(/Not enough/);
  });

  test("keeps ledger math in base units", () => {
    expect(toBase("1.42", 9).toFixed(0)).toBe("1420000000");
    expect(() => toBase("0.0000001", 6)).toThrow();
  });
});
