import { describe, expect, test } from "bun:test";
import { examplePortfolio, portfolioFromBalances } from "./mainnetPortfolio";

describe("mainnet portfolio", () => {
  test("prices known tokens and leaves unknown mints unpriced", () => {
    const portfolio = portfolioFromBalances({
      address: "So11111111111111111111111111111111111111112",
      lamports: 1_000_000_000,
      tokens: [
        { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", amountBase: "25000000", decimals: 6, symbol: "USDC" },
        { mint: "mintunknownmintunknownmintunknownmintunk", amountBase: "1000000", decimals: 6 },
      ],
      prices: {
        So11111111111111111111111111111111111111112: 100,
        EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 1,
        mintunknownmintunknownmintunknownmintunk: null,
      },
      readAt: "2026-10-01T00:00:00.000Z",
    });
    expect(portfolio.example).toBe(false);
    expect(portfolio.totalUsd).toBe("125.00");
    expect(portfolio.lines.find((item) => item.symbol === "USDC")?.usd).toBe("25.00");
    expect(portfolio.lines.find((item) => item.mint === "mintunknownmintunknownmintunknownmintunk")?.usd).toBeNull();
    expect(portfolio.readAt).toBe("2026-10-01T00:00:00.000Z");
  });

  test("example data is labeled as an example", () => {
    expect(examplePortfolio("2026-10-01T00:00:00.000Z").example).toBe(true);
  });
});
