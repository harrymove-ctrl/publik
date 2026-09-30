import { getAccount, getAssociatedTokenAddress, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Connection, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import Decimal from "decimal.js";
import { DEVNET_USDC_MINT, USDC_DECIMALS } from "@/domain/money";
import type { Holding } from "@/domain/types";

export const DEVNET_RPC = "https://api.devnet.solana.com";
const MAINNET_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export function resolveDevnetRpc(input: string | undefined): { endpoint: string; rejectedMainnet: boolean } {
  if (!input || input.trim().length === 0) return { endpoint: DEVNET_RPC, rejectedMainnet: false };
  const value = input.trim();
  if (value.toLowerCase().includes("mainnet")) return { endpoint: DEVNET_RPC, rejectedMainnet: true };
  return { endpoint: value, rejectedMainnet: false };
}

export function devnetUsdcMint(): string {
  const configured = import.meta.env.VITE_DEVNET_USDC_MINT as string | undefined;
  if (!configured || configured === MAINNET_USDC_MINT) return DEVNET_USDC_MINT;
  return configured;
}

export function isSolanaAddress(value: string): boolean {
  try {
    new PublicKey(value.trim());
    return true;
  } catch {
    return false;
  }
}

export function devnetExplorerAddress(address: string): string {
  return `https://explorer.solana.com/address/${address}?cluster=devnet`;
}

export function devnetExplorerTx(signature: string): string | null {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,128}$/.test(signature)) return null;
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}

export async function fetchDevnetHoldings(connection: Connection, address: string): Promise<Holding[]> {
  const owner = new PublicKey(address);
  const mint = new PublicKey(devnetUsdcMint());
  const sol = await connection.getBalance(owner, "confirmed");
  const usdc = await readTokenAmount(connection, owner, mint, TOKEN_PROGRAM_ID);
  const others = await readOtherTokens(connection, owner, mint.toBase58());
  const priceUsd = await fetchSolPriceUsd();

  return [
    {
      symbol: "SOL",
      label: "SOL",
      mint: null,
      decimals: 9,
      amountBase: sol.toString(),
      priceUsd,
    },
    {
      symbol: "USDC",
      label: "Test USDC",
      mint: mint.toBase58(),
      decimals: USDC_DECIMALS,
      amountBase: usdc,
      priceUsd: null,
    },
    ...others,
  ];
}

async function readTokenAmount(
  connection: Connection,
  owner: PublicKey,
  mint: PublicKey,
  programId: PublicKey,
): Promise<string> {
  const ata = await getAssociatedTokenAddress(mint, owner, false, programId);
  try {
    const account = await getAccount(connection, ata, "confirmed", programId);
    return account.amount.toString();
  } catch {
    return "0";
  }
}

async function readOtherTokens(connection: Connection, owner: PublicKey, usdcMint: string): Promise<Holding[]> {
  const programs = [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID];
  const holdings: Holding[] = [];
  for (const programId of programs) {
    const response = await connection.getParsedTokenAccountsByOwner(owner, { programId }, "confirmed");
    for (const item of response.value) {
      const info = item.account.data.parsed.info as {
        mint: string;
        tokenAmount: { amount: string; decimals: number };
      };
      if (info.mint === usdcMint) continue;
      if (info.tokenAmount.amount === "0") continue;
      holdings.push({
        symbol: "SPL",
        label: "Token",
        mint: info.mint,
        decimals: info.tokenAmount.decimals,
        amountBase: info.tokenAmount.amount,
        priceUsd: null,
      });
    }
  }
  return holdings;
}

let solPriceCache: { at: number; price: string | null } | null = null;

export async function fetchSolPriceUsd(): Promise<string | null> {
  if (solPriceCache && Date.now() - solPriceCache.at < 10 * 60 * 1000) return solPriceCache.price;
  try {
    const response = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd");
    if (!response.ok) throw new Error("price unavailable");
    const body = (await response.json()) as { solana?: { usd?: number } };
    const usd = body.solana?.usd;
    const price = typeof usd === "number" && Number.isFinite(usd) ? new Decimal(usd).toFixed(2) : null;
    solPriceCache = { at: Date.now(), price };
    return price;
  } catch {
    solPriceCache = { at: Date.now(), price: null };
    return null;
  }
}

export async function estimateTransferFeeLamports(connection: Connection, feePayer: string): Promise<string | null> {
  try {
    const payer = new PublicKey(feePayer);
    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    const transaction = new Transaction({ recentBlockhash: blockhash, feePayer: payer }).add(
      SystemProgram.transfer({ fromPubkey: payer, toPubkey: payer, lamports: 0 }),
    );
    const fee = await connection.getFeeForMessage(transaction.compileMessage(), "confirmed");
    return fee.value === null ? null : fee.value.toString();
  } catch {
    return null;
  }
}

export interface RuntimePaymentRequest {
  id: string;
  agentId: string;
  mint: string | null;
  amountBase: string;
  destination: string;
}

export interface RuntimePaymentResult {
  mode: "simulated";
  signature: null;
  message: string;
}

/** No signing service is configured. This never invents a signature. */
export function submitRuntimePayment(_request: RuntimePaymentRequest): RuntimePaymentResult {
  return {
    mode: "simulated",
    signature: null,
    message: "No signing service is configured. Publik did not send this payment.",
  };
}
