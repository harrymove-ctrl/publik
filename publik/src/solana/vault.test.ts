import { describe, expect, test } from "bun:test";
import { Keypair } from "@solana/web3.js";
import { assertExecutePayment, buildExecutePayment, VAULT_PROGRAM_ID } from "./vault";

const mint = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

describe("vault execute builder", () => {
  test("the agent pays the fee and only the vault program is invoked", () => {
    const agent = Keypair.generate().publicKey.toBase58();
    const tx = buildExecutePayment({
      agent,
      owner: Keypair.generate().publicKey.toBase58(),
      vaultId: new Uint8Array(32).fill(1),
      executionId: new Uint8Array(32).fill(2),
      mint,
      recipient: Keypair.generate().publicKey.toBase58(),
      amountBase: 1_000_000n,
      policyVersion: 1n,
      blockhash: "11111111111111111111111111111111",
    });
    expect(tx.feePayer?.toBase58()).toBe(agent);
    expect(tx.instructions).toHaveLength(1);
    expect(tx.instructions[0]?.programId.toBase58()).toBe(VAULT_PROGRAM_ID.toBase58());
    expect(tx.instructions[0]?.data[0]).toBe(5);
    expect(tx.instructions[0]?.keys[6]?.pubkey.toBase58()).toBe("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
  });

  test("a substituted destination is rejected before signing", () => {
    const input = {
      agent: Keypair.generate().publicKey.toBase58(),
      owner: Keypair.generate().publicKey.toBase58(),
      vaultId: new Uint8Array(32).fill(1),
      executionId: new Uint8Array(32).fill(2),
      mint,
      recipient: Keypair.generate().publicKey.toBase58(),
      amountBase: 1_000_000n,
      policyVersion: 1n,
      blockhash: "11111111111111111111111111111111",
    };
    const tx = buildExecutePayment(input);
    assertExecutePayment(tx, input);
    tx.instructions[0]!.keys[4] = { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true };
    expect(() => assertExecutePayment(tx, input)).toThrow("substituted account");
  });
});
