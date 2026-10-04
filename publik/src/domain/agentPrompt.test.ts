import { describe, expect, test } from "bun:test";
import { toBase } from "./money";
import { buildSetupPrompt, parsePastedRequest } from "./agentPrompt";

const agent = {
  id: "alice",
  name: "Alice",
  address: "Addr11111111111111111111111111111111111111",
  permissions: {
    dailyUsdcBase: toBase("20", 6).toFixed(0),
    allowedRecipients: [{ label: "Design API", address: "CBNwBPJcYiBCuAPbzHsVDervgaiEim8rgzZBPowhdA8P" }],
    askBeforeNewRecipient: true,
    enforcement: "simulated" as const,
  },
};

describe("agent prompt", () => {
  test("includes the daily limit and changes when it changes", () => {
    expect(buildSetupPrompt(agent)).toContain("20.00 Test USDC");
    expect(buildSetupPrompt({ ...agent, permissions: { ...agent.permissions, dailyUsdcBase: toBase("5", 6).toFixed(0) } })).toContain("5.00 Test USDC");
  });

  test("rejects a bad paste", () => {
    const block = (extra: string) => `PUBLIK_REQUEST {"agent":"alice","token":"USDC","amount":"4.00","recipient":"CBNwBPJcYiBCuAPbzHsVDervgaiEim8rgzZBPowhdA8P","reason":"invoice"${extra}}`;
    expect("error" in parsePastedRequest(block("").replace('"alice"', '"other"'), "alice")).toBe(true);
    expect("error" in parsePastedRequest(block("").replace("CBNwBPJcYiBCuAPbzHsVDervgaiEim8rgzZBPowhdA8P", "nope"), "alice")).toBe(true);
    expect("error" in parsePastedRequest(block("").replace("4.00", "1.0000001"), "alice")).toBe(true);
    expect("error" in parsePastedRequest(block("").replace("CBNwBPJcYiBCuAPbzHsVDervgaiEim8rgzZBPowhdA8P", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"), "alice")).toBe(true);
    expect("error" in parsePastedRequest(block("").replace('"invoice"', '""'), "alice")).toBe(true);
  });
});
