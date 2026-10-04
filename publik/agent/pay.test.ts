import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, test } from "bun:test";
import { Keypair } from "@solana/web3.js";
import { delegatePayTransaction, loadAgentKey } from "./pay";
import { DEVNET_USDC_MINT } from "../src/domain/money";

describe("delegate pay", () => {
  test("loadAgentKey parses 64-number JSON array and matches Keypair", () => {
    const dir = mkdtempSync(join(tmpdir(), "publik-test-pay-"));
    const keypair = Keypair.generate();
    const keyFile = join(dir, "agent.json");
    writeFileSync(keyFile, JSON.stringify(Array.from(keypair.secretKey)));

    const loaded = loadAgentKey(keyFile);
    expect(loaded.publicKey).toBe(keypair.publicKey.toBase58());
    expect(loaded.secret).toEqual(keypair.secretKey);
  });

  test("delegatePayTransaction returns fee payer matching delegate key", async () => {
    const dir = mkdtempSync(join(tmpdir(), "publik-test-pay-"));
    const keypair = Keypair.generate();
    const keyFile = join(dir, "agent.json");
    writeFileSync(keyFile, JSON.stringify(Array.from(keypair.secretKey)));

    const sourceOwner = Keypair.generate().publicKey.toBase58();
    const destinationOwner = Keypair.generate().publicKey.toBase58();
    const dummyBlockhash = "11111111111111111111111111111111";

    const result = await delegatePayTransaction({
      keyFile,
      sourceOwner,
      mint: DEVNET_USDC_MINT,
      destinationOwner,
      amountBase: 5000000n,
      blockhash: dummyBlockhash,
    });

    expect(result.publicKey).toBe(keypair.publicKey.toBase58());
    expect(result.transaction.feePayer?.toBase58()).toBe(keypair.publicKey.toBase58());
    expect(result.transaction.recentBlockhash).toBe(dummyBlockhash);
    expect(result.transaction.instructions.length).toBe(1);

    // Verify fee payer and signer authority in the transfer checked instruction
    const ix = result.transaction.instructions[0];
    // In transferChecked: keys are [source, mint, destination, authority]
    const authorityMeta = ix.keys.find((k) => k.pubkey.toBase58() === keypair.publicKey.toBase58());
    expect(authorityMeta).toBeDefined();
    expect(authorityMeta?.isSigner).toBe(true);
  });

  test("CLI prints delegate public key and 'not sent' when env flags are absent", () => {
    const dir = mkdtempSync(join(tmpdir(), "publik-test-pay-"));
    const keypair = Keypair.generate();
    const keyFile = join(dir, "agent.json");
    writeFileSync(keyFile, JSON.stringify(Array.from(keypair.secretKey)));

    const sourceOwner = Keypair.generate().publicKey.toBase58();
    const destinationOwner = Keypair.generate().publicKey.toBase58();

    const proc = spawnSync(
      "bun",
      ["agent/pay.ts", keyFile, sourceOwner, destinationOwner, "5.00"],
      {
        cwd: join(import.meta.dir, ".."),
        env: {
          ...process.env,
          PUBLIK_SEND: "",
          PUBLIK_RPC: "",
        },
        encoding: "utf8",
      }
    );

    expect(proc.status).toBe(0);
    expect(proc.stdout.trim()).toBe(`${keypair.publicKey.toBase58()} not sent`);
  });

  test("CLI also outputs 'not sent' if PUBLIK_SEND=1 but PUBLIK_RPC is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "publik-test-pay-"));
    const keypair = Keypair.generate();
    const keyFile = join(dir, "agent.json");
    writeFileSync(keyFile, JSON.stringify(Array.from(keypair.secretKey)));

    const sourceOwner = Keypair.generate().publicKey.toBase58();
    const destinationOwner = Keypair.generate().publicKey.toBase58();

    const proc = spawnSync(
      "bun",
      ["agent/pay.ts", keyFile, sourceOwner, destinationOwner, "10"],
      {
        cwd: join(import.meta.dir, ".."),
        env: {
          ...process.env,
          PUBLIK_SEND: "1",
          PUBLIK_RPC: "",
        },
        encoding: "utf8",
      }
    );

    expect(proc.status).toBe(0);
    expect(proc.stdout.trim()).toBe(`${keypair.publicKey.toBase58()} not sent`);
  });
});
