import { describe, expect, test } from "bun:test";
import { DEVNET_USDC_MINT } from "@/domain/money";
import { mintProblem, SPL_TOKEN_PROGRAM, tokenLabel } from "./mintCheck";

describe("devnet mint", () => {
  test("names Circle devnet USDC and a custom mint differently", () => {
    expect(tokenLabel(DEVNET_USDC_MINT)).toBe("Test USDC");
    expect(tokenLabel("mint111111111111111111111111111111111111111")).toBe("Publik Test USD");
  });

  test("rejects a non-token account and the wrong decimals", () => {
    expect(mintProblem("11111111111111111111111111111111", 6)).toMatch(/not an SPL token/);
    expect(mintProblem(SPL_TOKEN_PROGRAM, 9)).toMatch(/9 decimals/);
    expect(mintProblem(SPL_TOKEN_PROGRAM, 6)).toBeNull();
  });
});
