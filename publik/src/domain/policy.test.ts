import { describe, expect, test } from "bun:test";
import { appendSample, appendScenario, applyDecision } from "./apply";
import { toBase } from "./money";
import { evaluateRequest, explainRequest, recheckBeforeExecute, type Permissions, type SpendRequest } from "./policy";
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
  test("approving the dataset request spends 4.00 and a second click does nothing", () => {
    const alice = createSeedAgents().find((agent) => agent.id === "alice");
    if (!alice) throw new Error("missing alice");
    const queued = appendScenario(alice, "allowed", "req-demo-1", "2026-09-30T18:00:00.000Z");
    const first = applyDecision(queued, "req-demo-1", "approved");
    expect(first.error).toBeNull();
    expect(first.agent.spentTodayBase).toBe(toBase("4", 6).toFixed(0));
    expect(first.agent.holdings.find((item) => item.symbol === "USDC")?.amountBase).toBe(toBase("96", 6).toFixed(0));
    expect(first.agent.requests.find((item) => item.id === "req-demo-1")?.signature).toBeNull();
    expect(applyDecision(first.agent, "req-demo-1", "approved").error).toBe("That request is no longer waiting.");
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
    const queued = appendScenario(seed, "allowed", "req-demo-1", "2026-09-30T18:00:00.000Z");
    const once = applyDecision(queued, "req-demo-1", "approved");
    expect(applyDecision(once.agent, "req-demo-1", "approved").error).toBe("That request is no longer waiting.");
    expect(applyDecision(seed, "req-archive-fail", "approved").error).toBe("That request does not belong to this agent.");
  });

  test("does not sign a watched wallet or spend more than the balance", () => {
    const seed = appendScenario(createSeedAgents()[0], "allowed", "req-demo-1", "2026-09-30T18:00:00.000Z");
    const watched: Agent = { ...seed, walletMode: "readonly", cluster: "devnet" };
    expect(applyDecision(watched, "req-demo-1", "approved").error).toMatch(/watching|own key/i);
    const poor: Agent = {
      ...seed,
      holdings: seed.holdings.map((holding) => (holding.symbol === "USDC" ? { ...holding, amountBase: "1" } : holding)),
    };
    expect(applyDecision(poor, "req-demo-1", "approved").error).toMatch(/Not enough/);
  });

  test("keeps ledger math in base units", () => {
    expect(toBase("1.42", 9).toFixed(0)).toBe("1420000000");
    expect(() => toBase("0.0000001", 6)).toThrow();
  });

  test("explainRequest matches evaluateRequest and shows the limit arithmetic", () => {
    const input = {
      permissions,
      paused: false,
      request: request("12"),
      reservedUsdcBase: "0",
      spentUsdcBase: toBase("8", 6).toFixed(0),
    };
    const explained = explainRequest(input);
    expect(explained.decision).toEqual(evaluateRequest(input));
    expect(explained.checks.find((check) => check.id === "limit")?.detail).toBe(
      "8.00 spent + 0.00 waiting + 12.00 this payment = 20.00 of 20.00 Test USDC",
    );
  });

  test("a paused agent stops later checks", () => {
    const explained = explainRequest({
      permissions,
      paused: true,
      request: request("1"),
      reservedUsdcBase: "0",
      spentUsdcBase: "0",
    });
    expect(explained.checks[0]?.state).toBe("fail");
    expect(explained.checks.slice(1).every((check) => check.state === "not-reached")).toBe(true);
    expect(explained.decision.outcome).toBe("block");
  });
});
