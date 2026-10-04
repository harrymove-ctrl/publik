import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Keypair, PublicKey, type Connection } from "@solana/web3.js";
import { VAULT_LEN, VAULT_PROGRAM_ID, vaultAddress, vaultAuthority, vaultTokenAccount } from "../src/solana/vault";
import { createAgentKey, resolveKeyPath, savePendingExecution } from "./key";
import { executeDelegatedPayment } from "./execute";

function mockVaultBuffer(input: {
  owner: string;
  mint: string;
  vaultId: Uint8Array;
  executionKey: string;
  recipients: string[];
}): Buffer {
  const buf = Buffer.alloc(VAULT_LEN);
  buf.write("PUBLIKV1", 0, 8, "ascii");
  buf.set(new PublicKey(input.owner).toBytes(), 8);
  buf.set(new PublicKey(input.mint).toBytes(), 40);
  buf.set(input.vaultId, 72);
  buf.set(new PublicKey(input.executionKey).toBytes(), 104);
  buf[136] = 255;
  buf[137] = 0; // paused = false
  buf[138] = 0; // revoked = false
  buf.writeBigUInt64LE(1n, 140); // version
  buf.writeBigUInt64LE(5_000_000n, 148); // perBase
  buf.writeBigUInt64LE(20_000_000n, 156); // dailyBase
  buf.writeBigUInt64LE(100_000_000n, 164); // lifetimeBase
  buf.writeBigUInt64LE(0n, 172);
  buf.writeBigUInt64LE(0n, 180);
  buf.writeBigInt64LE(0n, 188);
  buf.writeBigInt64LE(0n, 196);
  buf.writeBigInt64LE(2_000_000_000n, 204);
  buf[212] = input.recipients.length;
  for (let i = 0; i < input.recipients.length; i++) {
    buf.set(new PublicKey(input.recipients[i]).toBytes(), 216 + i * 32);
  }
  return buf;
}

describe("delegated execution pending state gate", () => {
  test("refuses different intent while pending block height is unexpired, and reuses execution id for same intent", async () => {
    const keyDir = mkdtempSync(join(tmpdir(), "publik-exec-test-"));
    const origin = "http://127.0.0.1:9999";
    const network = "solana-devnet";

    const ownerWallet = Keypair.generate();
    const recip1 = Keypair.generate().publicKey;
    const recip2 = Keypair.generate().publicKey;
    const mint = Keypair.generate().publicKey;
    const vaultId = new Uint8Array(32).fill(1);
    const vaultPubkey = vaultAddress(ownerWallet.publicKey, vaultId);

    // Create execution key
    const agentKey = createAgentKey(keyDir, "agent", { origin, network });
    const { stateFile } = resolveKeyPath(keyDir, "agent", { origin, network });

    const vaultBuf = mockVaultBuffer({
      owner: ownerWallet.publicKey.toBase58(),
      mint: mint.toBase58(),
      vaultId,
      executionKey: agentKey.publicKey,
      recipients: [recip1.toBase58(), recip2.toBase58()],
    });

    // Stub Connection
    let requestedIdempotencyKey: string | null = null;
    const stubConnection = {
      getAccountInfo: async (pubkey: PublicKey) => {
        if (pubkey.equals(VAULT_PROGRAM_ID)) {
          return { data: Buffer.alloc(0), executable: true, owner: new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111") };
        }
        if (pubkey.equals(vaultPubkey)) {
          return { data: vaultBuf, owner: VAULT_PROGRAM_ID };
        }
        // Receipt PDA returns null (not landed yet)
        return null;
      },
      getTokenAccountBalance: async () => ({ value: { amount: "50000000" } }),
      getSlot: async () => 100,
      getBlockTime: async () => 1_700_000_000,
      getBlockHeight: async () => 450, // current height is 450
      getLatestBlockhash: async () => ({ blockhash: "4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM", lastValidBlockHeight: 500 }),
      sendRawTransaction: async () => "stubSignature" + "1".repeat(70),
    } as unknown as Connection;

    // Mock fetch for API routes
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();
      if (urlStr.endsWith("/api/v1/agent/delegation")) {
        return new Response(
          JSON.stringify({
            mode: "delegated",
            deployed: true,
            network,
            vault: {
              address: vaultPubkey.toBase58(),
              owner: ownerWallet.publicKey.toBase58(),
              vault_id_hex: Buffer.from(vaultId).toString("hex"),
              mint: mint.toBase58(),
              execution_key: agentKey.publicKey,
              version: "1",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (urlStr.endsWith("/api/v1/delegated-payment-requests")) {
        const headers = new Headers(init?.headers);
        requestedIdempotencyKey = headers.get("idempotency-key");
        return new Response(
          JSON.stringify({
            request_id: "del_test_123",
            status: "ready",
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        );
      }
      if (urlStr.includes("/attempts")) {
        return new Response(JSON.stringify({ status: "unresolved" }), { status: 201 });
      }
      if (urlStr.includes("/delegated-payment-requests/del_test_123")) {
        return new Response(JSON.stringify({ status: "confirmed" }), { status: 200 });
      }
      return new Response("Not found", { status: 404 });
    }) as typeof fetch;

    try {
      const pendingExecId = Keypair.generate().publicKey.toBase58();
      savePendingExecution(stateFile, {
        executionId: pendingExecId,
        recipient: recip1.toBase58(),
        amountBase: "1000000",
        createdAt: new Date().toISOString(),
        lastValidBlockHeight: 500, // block height 450 < 500 => UNEXPIRED
      });

      // 1. Different intent (different recipient) while unexpired MUST throw
      let threw = false;
      try {
        await executeDelegatedPayment({
          to: recip2.toBase58(), // different recipient!
          amountDecimal: "1.0",
          origin,
          token: "dummy-token",
          keyDir,
          keyName: "agent",
          connection: stubConnection,
          log: () => {},
        });
      } catch (err: unknown) {
        threw = true;
        const msg = err instanceof Error ? err.message : String(err);
        expect(msg).toContain("may still land until block height 500");
      }
      expect(threw).toBe(true);

      // 2. Different intent (different amount) while unexpired MUST throw
      let threwAmount = false;
      try {
        await executeDelegatedPayment({
          to: recip1.toBase58(),
          amountDecimal: "2.0", // different amount (2.0 vs 1.0)!
          origin,
          token: "dummy-token",
          keyDir,
          keyName: "agent",
          connection: stubConnection,
          log: () => {},
        });
      } catch (err: unknown) {
        threwAmount = true;
        const msg = err instanceof Error ? err.message : String(err);
        expect(msg).toContain("may still land until block height 500");
      }
      expect(threwAmount).toBe(true);

      // 3. Same intent (same recipient recip1, same amount 1.0) reuses the pending execution ID
      const result = await executeDelegatedPayment({
        to: recip1.toBase58(),
        amountDecimal: "1.0",
        origin,
        token: "dummy-token",
        keyDir,
        keyName: "agent",
        connection: stubConnection,
        log: () => {},
      });

      expect(result.status).toBe("confirmed");
      if ("executionId" in result) {
        expect(result.executionId).toBe(pendingExecId);
      }
      expect(requestedIdempotencyKey).toBe(`exec_${pendingExecId}`);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
