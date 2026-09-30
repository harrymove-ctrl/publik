import Decimal from "decimal.js";

/** Base units are integers stored as decimal strings. Never use floats for amounts. */
export type BaseUnits = string;

export const SOL_DECIMALS = 9;
export const USDC_DECIMALS = 6;

/** Circle's official devnet USDC mint. Not the mainnet mint. */
export const DEVNET_USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

const ZERO = new Decimal(0);

export function base(value: string | number | bigint | Decimal): Decimal {
  const parsed = new Decimal(value.toString());
  if (!parsed.isInteger()) {
    throw new Error(`Expected whole base units, got ${value}`);
  }
  return parsed;
}

export function toBase(human: string | number, decimals: number): Decimal {
  const parsed = new Decimal(human);
  if (!parsed.isFinite() || parsed.isNegative()) {
    throw new Error("Amount must be a non-negative number");
  }
  const scaled = parsed.mul(new Decimal(10).pow(decimals));
  if (!scaled.isInteger()) {
    throw new Error(`Amount has more than ${decimals} decimal places`);
  }
  return scaled;
}

export function formatBase(amount: Decimal | string, decimals: number, maxFraction = decimals): string {
  const value = new Decimal(amount.toString()).div(new Decimal(10).pow(decimals));
  return trimFraction(value.toFixed(Math.min(maxFraction, decimals)));
}

export function formatUsdFromBase(amount: Decimal | string, decimals: number, priceUsd: string | null): string | null {
  if (!priceUsd) return null;
  const usd = new Decimal(amount.toString()).div(new Decimal(10).pow(decimals)).mul(priceUsd);
  return usd.toFixed(2);
}

function trimFraction(value: string): string {
  if (!value.includes(".")) return value;
  return value.replace(/\.?0+$/, "");
}

export function addBase(left: Decimal | string, right: Decimal | string): Decimal {
  return new Decimal(left.toString()).plus(right.toString());
}

export function subBase(left: Decimal | string, right: Decimal | string): Decimal {
  const result = new Decimal(left.toString()).minus(right.toString());
  if (result.isNegative()) throw new Error("Amount would go below zero");
  return result;
}

export function compareBase(left: Decimal | string, right: Decimal | string): number {
  return new Decimal(left.toString()).comparedTo(right.toString());
}

export function isZero(amount: Decimal | string): boolean {
  return new Decimal(amount.toString()).eq(ZERO);
}

export function formatGrouped(human: string): string {
  const [whole, fraction] = human.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction ? `${grouped}.${fraction}` : grouped;
}

export function displayAmount(amount: Decimal | string, decimals: number, symbol: string): string {
  return `${formatGrouped(formatBase(amount, decimals, decimals === 9 ? 4 : 2))} ${symbol}`;
}
