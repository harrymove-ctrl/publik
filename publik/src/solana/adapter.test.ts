import { describe, expect, test } from "bun:test";
import { assertDevnetCluster, DEVNET_GENESIS_HASH, devnetExplorerTx, MAINNET_GENESIS_HASH, resolveDevnetRpc, submitRuntimePayment } from "./adapter";

describe("devnet adapter", () => {
  test("refuses a mainnet endpoint", () => {
    const resolved = resolveDevnetRpc("https://api.mainnet-beta.solana.com");
    expect(resolved.rejectedMainnet).toBe(true);
    expect(resolved.endpoint).not.toContain("mainnet");
  });
  test("identifies localnet rpc endpoint and labels it Localnet", () => {
    const local1 = resolveDevnetRpc("http://127.0.0.1:8899");
    expect(local1.cluster).toBe("localnet");
    expect(local1.clusterLabel).toBe("Localnet");
    expect(local1.rejectedMainnet).toBe(false);

    const local2 = resolveDevnetRpc("http://localhost:8899");
    expect(local2.cluster).toBe("localnet");
    expect(local2.clusterLabel).toBe("Localnet");

    const remote = resolveDevnetRpc("https://api.devnet.solana.com");
    expect(remote.cluster).toBe("devnet");
    expect(remote.clusterLabel).toBe("Devnet");
  });

  test("allows localnet connection with non-devnet genesis hash, but rejects mainnet", async () => {
    await expect(assertDevnetCluster({ getGenesisHash: async () => "localGenesis123", rpcEndpoint: "http://127.0.0.1:8899" })).resolves.toBeUndefined();
    await expect(assertDevnetCluster({ getGenesisHash: async () => MAINNET_GENESIS_HASH, rpcEndpoint: "http://127.0.0.1:8899" })).rejects.toThrow(/not Solana devnet/);
  });

  test("refuses a connection whose genesis hash is mainnet", async () => {
    await expect(assertDevnetCluster({ getGenesisHash: async () => MAINNET_GENESIS_HASH })).rejects.toThrow(/not Solana devnet/);
    await expect(assertDevnetCluster({ getGenesisHash: async () => DEVNET_GENESIS_HASH })).resolves.toBeUndefined();
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
