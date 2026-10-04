import { DEVNET_USDC_MINT } from "@/domain/money";

export const SPL_TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const SPL_TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

export function tokenLabel(mint: string): string {
  return mint === DEVNET_USDC_MINT ? "Test USDC" : "Publik Test USD";
}

export function mintProblem(owner: string, decimals: number): string | null {
  if (owner !== SPL_TOKEN_PROGRAM && owner !== SPL_TOKEN_2022_PROGRAM) {
    return "This address is not an SPL token mint on the connected cluster.";
  }
  if (decimals !== 6) return `This mint uses ${decimals} decimals. Publik sends 6-decimal amounts.`;
  return null;
}
