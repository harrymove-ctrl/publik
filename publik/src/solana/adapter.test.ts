import { describe, expect, test } from "bun:test";
import { devnetExplorerTx, resolveDevnetRpc, submitRuntimePayment } from "./adapter";

describe("devnet adapter", () => {
  test("refuses a mainnet endpoint", () => {
    const resolved = resolveDevnetRpc("https://api.mainnet-beta.solana.com");
    expect(resolved.rejectedMainnet).toBe(true);
    expect(resolved.endpoint).not.toContain("mainnet");
  });

  test("does not invent an explorer link or a signature", () => {
    expect(devnetExplorerTx("not a signature")).toBeNull();
    expect(submitRuntimePayment({
      id: "1",
      agentId: "alice",
      mint: null,
      amountBase: "1",
      destination: "CBNwBPJcYiBCuAPbzHsVDervgaiEim8rgzZBPowhdA8P",
    })).toEqual({
      mode: "simulated",
      signature: null,
      message: "No signing service is configured. Publik did not send this payment.",
    });
  });
});
