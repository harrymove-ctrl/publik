import { describe, expect, test } from "bun:test";
import { appendScenario, applyDecision } from "./apply";
import { toBase } from "./money";
import { agentFace, awaitingReview, completedUsdc } from "./product";
import { createSeedAgents } from "./seed";

describe("demo walkthrough", () => {
  test("Alice starts at 100 Test USDC with nothing reserved today", () => {
    const agents = createSeedAgents();
    const alice = agents.find((agent) => agent.id === "alice");
    expect(agents.map((agent) => agent.name).sort()).toEqual(["Alice", "Builder", "Operator"]);
    expect(alice?.permissions.dailyUsdcBase).toBe(toBase("25", 6).toFixed(0));
    expect(alice?.spentTodayBase).toBe("0");
    expect(alice?.holdings.find((item) => item.symbol === "USDC")?.amountBase).toBe(toBase("100", 6).toFixed(0));
    expect(alice?.requests.some((item) => item.status === "pending")).toBe(false);
    expect(agentFace(agents.find((agent) => agent.id === "operator")!)).toBe("Paused");
    expect(completedUsdc(agents).gt(0)).toBe(true);
  });

  test("the over-budget scenario blocks and does not change the balance", () => {
    const alice = createSeedAgents().find((agent) => agent.id === "alice");
    if (!alice) throw new Error("missing alice");
    const blocked = appendScenario(alice, "over-budget", "over-1", "2026-09-30T18:00:00.000Z");
    const request = blocked.requests.find((item) => item.id === "over-1");
    expect(request?.status).toBe("blocked");
    expect(applyDecision(blocked, "over-1", "approved").error).toBe("That request is no longer waiting.");
    expect(blocked.holdings.find((item) => item.symbol === "USDC")?.amountBase).toBe(alice.holdings.find((item) => item.symbol === "USDC")?.amountBase);
  });

  test("a new recipient stays pending and approval does not add them to the list", () => {
    const alice = createSeedAgents().find((agent) => agent.id === "alice");
    if (!alice) throw new Error("missing alice");
    const queued = appendScenario(alice, "new-recipient", "new-1", "2026-09-30T18:00:00.000Z");
    expect(queued.requests.find((item) => item.id === "new-1")?.status).toBe("pending");
    const approved = applyDecision(queued, "new-1", "approved");
    expect(approved.error).toBeNull();
    expect(approved.agent.permissions.allowedRecipients).toEqual(alice.permissions.allowedRecipients);
  });

  test("a paused agent cannot queue a new payment", () => {
    const alice = createSeedAgents().find((agent) => agent.id === "alice");
    if (!alice) throw new Error("missing alice");
    const paused = appendScenario({ ...alice, status: "paused" }, "allowed", "pause-1", "2026-09-30T18:00:00.000Z");
    expect(paused.requests.find((item) => item.id === "pause-1")?.status).toBe("blocked");
    expect(awaitingReview([paused]).some((item) => item.request.id === "pause-1")).toBe(false);
  });
});
