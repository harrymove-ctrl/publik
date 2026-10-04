import { toBase } from "./money";
import type { Permissions } from "./policy";

const MAINNET_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export function buildSetupPrompt(agent: {
  name: string;
  id: string;
  address: string | null;
  mainnetWatchAddress?: string | null;
  permissions: Permissions;
}): string {
  const limit = (Number(agent.permissions.dailyUsdcBase) / 1_000_000).toFixed(2);
  const recipients = agent.permissions.allowedRecipients.map((item) => `${item.label} ${item.address}`).join(", ") || "none";
  const ask = agent.permissions.askBeforeNewRecipient ? "Ask before paying someone new." : "Never pay someone new.";
  const mainnet = agent.mainnetWatchAddress ? `Mainnet watch address (view only, never pay it): ${agent.mainnetWatchAddress}.` : "No mainnet address.";
  return [
    `You are "${agent.name}", an agent with a Publik budget on Solana devnet.`,
    `Your devnet address is ${agent.address ?? "not set yet"}.`,
    mainnet,
    "Your rules, set by your owner:",
    `- Spend at most ${limit} Test USDC per day.`,
    `- Pay only these recipients without asking: ${recipients}.`,
    `- ${ask}`,
    "These rules are guidance. They are not a lock on a wallet.",
    `To pay anyone, print exactly one line:`,
    `PUBLIK_REQUEST {"agent":"${agent.id}","token":"USDC","amount":"4.00","recipient":"<solana address>","reason":"<one line>"}`,
    "Wait for the owner to paste that line into Publik. Never send a payment any other way.",
    "Everything you pay is on Solana devnet. Test USDC has no real value. Never use mainnet.",
  ].join("\n");
}

export function parsePastedRequest(text: string, agentId: string): { amount: string; recipient: string; reason: string } | { error: string } {
  const match = text.match(/PUBLIK_REQUEST\s+(\{[\s\S]*\})/);
  if (!match) return { error: "Paste a line that starts with PUBLIK_REQUEST." };
  let body: { agent?: string; token?: string; amount?: string; recipient?: string; reason?: string };
  try {
    body = JSON.parse(match[1]) as typeof body;
  } catch {
    return { error: "That request block is not valid JSON." };
  }
  if (body.agent !== agentId) return { error: "That request is for a different agent." };
  if (body.token !== "USDC") return { error: "Only Test USDC requests can be pasted." };
  if (!body.reason || body.reason.trim().length === 0) return { error: "The request needs a reason." };
  if (body.recipient === MAINNET_USDC) return { error: "That is the mainnet USDC mint, not a recipient." };
  try {
    PublicKeySafe(body.recipient ?? "");
  } catch {
    return { error: "The recipient is not a Solana address." };
  }
  try {
    toBase(body.amount ?? "", 6);
  } catch {
    return { error: "The amount needs at most 6 decimal places." };
  }
  return { amount: body.amount ?? "", recipient: body.recipient ?? "", reason: body.reason.trim() };
}

function PublicKeySafe(value: string) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) throw new Error("bad address");
}
