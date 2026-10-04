import { describe, expect, test } from "bun:test";
import { Keypair } from "@solana/web3.js";
import { buildDailySpendingLimit, SQUADS_PROGRAM } from "./squadsLimit";

describe("squads daily limit", () => {
  test("the owner pays the fee and Squads is the program", () => {
    const owner = Keypair.generate().publicKey.toBase58();
    const tx = buildDailySpendingLimit({
      owner,
      multisig: Keypair.generate().publicKey.toBase58(),
      agent: Keypair.generate().publicKey.toBase58(),
      mint: Keypair.generate().publicKey.toBase58(),
      amountBase: 20_000_000n,
      destinations: [Keypair.generate().publicKey.toBase58()],
      blockhash: "11111111111111111111111111111111",
      createKey: Keypair.generate().publicKey.toBase58(),
    });
    expect(tx.feePayer?.toBase58()).toBe(owner);
    expect(tx.instructions[0]?.programId.toBase58()).toBe(SQUADS_PROGRAM);
  });
});
