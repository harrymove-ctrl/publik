import { formatBase, formatGrouped, formatUsdFromBase } from "./money";
import type { RequestStatus } from "./policy";
import type { Agent, Holding } from "./types";

export function holdingQuantity(holding: Holding): string {
  const digits = holding.symbol === "USDC" ? 2 : 4;
  const raw = formatBase(holding.amountBase, holding.decimals, digits);
  return formatGrouped(holding.symbol === "USDC" ? padUsd(raw) : raw);
}

export function holdingFiat(holding: Holding): string | null {
  const usd = formatUsdFromBase(holding.amountBase, holding.decimals, holding.priceUsd);
  if (!usd) return null;
  return `$${formatGrouped(padUsd(usd))}`;
}

export function tokenName(symbol: Holding["symbol"]): string {
  return symbol === "USDC" ? "Test USDC" : symbol === "SOL" ? "SOL" : symbol;
}

export function compactSpend(agent: Agent): string {
  if (agent.walletMode === "readonly") return "Watch";
  const usdc = agent.holdings.find((holding) => holding.symbol === "USDC");
  if (!usdc || usdc.amountBase === "0") return "—";
  return holdingQuantity(usdc);
}

export function agentBalanceLabel(agent: Agent): string {
  const amount = compactSpend(agent);
  if (amount === "Watch") return "Watching devnet";
  if (amount === "—") return agent.walletMode === "unconnected" ? "No wallet yet" : "No Test USDC yet";
  return `${amount} Test USDC available`;
}

export function statusLabel(status: RequestStatus): string {
  switch (status) {
    case "pending":
      return "Needs you";
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    case "blocked":
      return "Blocked";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    default:
      return status;
  }
}

export function requestTitle(request: { token: "SOL" | "USDC"; amountBase: string; decimals: number; recipientLabel: string }): string {
  const digits = request.token === "USDC" ? 2 : 4;
  const raw = formatBase(request.amountBase, request.decimals, digits);
  const amount = formatGrouped(request.token === "USDC" ? padUsd(raw) : raw);
  const token = request.token === "USDC" ? "Test USDC" : "SOL";
  return `Send ${amount} ${token} to ${request.recipientLabel}`;
}

export function shortAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(date);
}

function padUsd(value: string): string {
  const [whole, fraction = ""] = value.split(".");
  return `${whole}.${fraction.padEnd(2, "0")}`;
}

export function usdcAmount(amountBase: string): string {
  return formatGrouped(padUsd(formatBase(amountBase, 6, 2)));
}
