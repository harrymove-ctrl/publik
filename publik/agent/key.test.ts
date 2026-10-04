import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { createAgentKey } from "./key";

describe("agent key", () => {
  test("writes a key file and returns only the public key", () => {
    const dir = mkdtempSync(join(tmpdir(), "publik-key-"));
    const created = createAgentKey(dir, "Alice Key");
    expect(created.publicKey).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    expect(created.file.endsWith("alicekey.json")).toBe(true);
    expect(statSync(created.file).mode & 0o777).toBe(0o600);
    const secret = readFileSync(created.file, "utf8");
    expect(created.publicKey.length).toBeLessThan(secret.length);
  });

  test("namespaces the file and refuses to overwrite it", () => {
    const dir = mkdtempSync(join(tmpdir(), "publik-key-"));
    const created = createAgentKey(dir, "agent", { origin: "http://127.0.0.1:5173", network: "solana-devnet" });
    expect(created.file.includes("127-0-0-1-5173")).toBe(true);
    expect(created.file.includes("solana-devnet")).toBe(true);
    expect(() => createAgentKey(dir, "agent", { origin: "http://127.0.0.1:5173", network: "solana-devnet" })).toThrow("already exists");
  });
});
