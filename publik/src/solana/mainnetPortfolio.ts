import { Connection, PublicKey } from "@solana/web3.js";
import Decimal from "decimal.js";

/** Public mainnet RPC. No provider key. Not used for payments. */
export const MAINNET_RPC = "https://api.mainnet-beta.solana.com";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const SOL_DECIMALS = 9;

export type PortfolioLine = {
  symbol: string;
  label: string;
  mint: string | null;
  amount: string;
  usd: string | null;
};

export type MainnetPortfolio = {
  address: string | null;
  lines: PortfolioLine[];
  totalUsd: string | null;
  readAt: string;
  example: boolean;
};

export type TokenBalance = {
  mint: string;
  amountBase: string;
  decimals: number;
  symbol?: string;
};

export function portfolioFromBalances(input: {
  address: string;
  lamports: number;
  tokens: TokenBalance[];
  prices: Record<string, number | null>;
  readAt: string;
}): MainnetPortfolio {
  const solPrice = input.prices[SOL_MINT] ?? null;
  const sol = line("SOL", "SOL", null, input.lamports, SOL_DECIMALS, solPrice);
  const tokens = input.tokens
    .filter((token) => token.amountBase !== "0")
    .map((token) => line(token.symbol ?? shortMint(token.mint), token.symbol ?? "Token", token.mint, token.amountBase, token.decimals, input.prices[token.mint] ?? null));
  const lines = [sol, ...tokens].sort((a, b) => usdRank(b) - usdRank(a) || a.label.localeCompare(b.label));
  const known = lines.map((item) => item.usd).filter((usd): usd is string => usd !== null);
  const total = known.reduce((sum, usd) => sum.plus(usd.replace(/,/g, "")), new Decimal(0));
  return {
    address: input.address,
    lines: lines.slice(0, 8),
    totalUsd: known.length === 0 ? null : total.toFixed(2),
    readAt: input.readAt,
    example: false,
  };
}

export function examplePortfolio(readAt: string): MainnetPortfolio {
  return {
    address: null,
    lines: [
      { symbol: "SOL", label: "SOL", mint: null, amount: "1.2500", usd: "200.00" },
      { symbol: "USDC", label: "USDC", mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", amount: "40.00", usd: "40.00" },
    ],
    totalUsd: "240.00",
    readAt,
    example: true,
  };
}

export function configuredDemoMainnetAddress(): string | null {
  const value = import.meta.env?.VITE_DEMO_MAINNET_WATCH_ADDRESS;
  if (!value) return null;
  const trimmed = value.trim();
  try {
    return new PublicKey(trimmed).toBase58();
  } catch {
    return null;
  }
}

export async function fetchMainnetPortfolio(address: string): Promise<MainnetPortfolio> {
  const owner = new PublicKey(address);
  const connection = new Connection(MAINNET_RPC, "confirmed");
  const readAt = new Date().toISOString();
  const [lamports, parsed] = await Promise.all([
    connection.getBalance(owner, "confirmed"),
    connection.getParsedTokenAccountsByOwner(owner, { programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") }, "confirmed"),
  ]);
  const tokens: TokenBalance[] = parsed.value.map((item) => {
    const info = item.account.data.parsed.info;
    return {
      mint: String(info.mint),
      amountBase: String(info.tokenAmount.amount),
      decimals: Number(info.tokenAmount.decimals),
    };
  });
  const prices = await fetchPrices([SOL_MINT, ...tokens.map((token) => token.mint)]);
  return portfolioFromBalances({ address: owner.toBase58(), lamports, tokens, prices, readAt });
}

async function fetchPrices(mints: string[]): Promise<Record<string, number | null>> {
  const prices: Record<string, number | null> = {};
  for (const mint of mints) prices[mint] = null;
  try {
    const response = await fetch(`https://lite-api.jup.ag/price/v2?ids=${mints.join(",")}`);
    if (!response.ok) return prices;
    const body = (await response.json()) as { data?: Record<string, { price?: string }> };
    for (const mint of mints) {
      const raw = body.data?.[mint]?.price;
      const value = raw === undefined ? null : Number(raw);
      prices[mint] = value !== null && Number.isFinite(value) ? value : null;
    }
  } catch {
    return prices;
  }
  return prices;
}

function line(symbol: string, label: string, mint: string | null, amountBase: number | string, decimals: number, price: number | null): PortfolioLine {
  const human = new Decimal(amountBase.toString()).div(new Decimal(10).pow(decimals));
  const digits = decimals === 6 ? 2 : 4;
  const usd = price === null ? null : human.mul(price).toFixed(2);
  return { symbol, label, mint, amount: human.toFixed(digits), usd };
}

function usdRank(lineItem: PortfolioLine): number {
  return lineItem.usd === null ? -1 : Number(lineItem.usd);
}

function shortMint(mint: string): string {
  return mint.length < 8 ? mint : `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}
