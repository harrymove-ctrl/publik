import { describe, expect, test } from "bun:test";
import {
  bytesToHex,
  formatBaseToToken,
  generateRandomVaultIdHex,
  hexToBytes32,
  parseTokenAmountToBase,
  safeParseTokenAmountToBase,
  sleep,
} from "./delegationMath";

describe("delegationMath", () => {
  test("parseTokenAmountToBase exact conversion", () => {
    expect(parseTokenAmountToBase("1")).toBe(1_000_000n);
    expect(parseTokenAmountToBase("1.0")).toBe(1_000_000n);
    expect(parseTokenAmountToBase("0.5")).toBe(500_000n);
    expect(parseTokenAmountToBase("0.000001")).toBe(1n);
    expect(parseTokenAmountToBase("25.50")).toBe(25_500_000n);
    expect(parseTokenAmountToBase("0")).toBe(0n);
    expect(parseTokenAmountToBase("1000")).toBe(1_000_000_000n);

    expect(() => parseTokenAmountToBase("1.0000001")).toThrow(/Maximum 6 decimal places/);
    expect(() => parseTokenAmountToBase("-5")).toThrow(/Invalid token amount/);
    expect(() => parseTokenAmountToBase("abc")).toThrow(/Invalid token amount/);
  });
  test("safeParseTokenAmountToBase returns null on invalid or partial input without throwing", () => {
    expect(safeParseTokenAmountToBase("1")).toBe(1_000_000n);
    expect(safeParseTokenAmountToBase("")).toBeNull();
    expect(safeParseTokenAmountToBase("abc")).toBeNull();
    expect(safeParseTokenAmountToBase("-1")).toBeNull();
    expect(safeParseTokenAmountToBase("1.0000001")).toBeNull();
    expect(safeParseTokenAmountToBase("1.")).toBeNull();
  });


  test("formatBaseToToken exact conversion", () => {
    expect(formatBaseToToken(1_000_000n)).toBe("1");
    expect(formatBaseToToken(500_000n)).toBe("0.5");
    expect(formatBaseToToken(1n)).toBe("0.000001");
    expect(formatBaseToToken("25500000")).toBe("25.5");
    expect(formatBaseToToken(0n)).toBe("0");
  });

  test("hex and byte conversion roundtrips", () => {
    const hex = generateRandomVaultIdHex();
    expect(hex.length).toBe(64);
    const bytes = hexToBytes32(hex);
    expect(bytes.length).toBe(32);
    expect(bytesToHex(bytes)).toBe(hex);
  });

  test("sleep resolves after delay", async () => {
    const start = Date.now();
    await sleep(20);
    expect(Date.now() - start).toBeGreaterThanOrEqual(15);
  });
});
