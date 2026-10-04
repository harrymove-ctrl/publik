import { createAssociatedTokenAccountInstruction, createTransferCheckedInstruction, getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey, Transaction } from "@solana/web3.js";
import { USDC_DECIMALS } from "@/domain/money";

const MAINNET_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export async function buildOwnerUsdcPayment(input: {
  owner: string;
  destinationOwner: string;
  mint: string;
  amountBase: bigint;
  blockhash: string;
  createDestination: boolean;
}): Promise<Transaction> {
  if (input.mint === MAINNET_USDC_MINT) {
    throw new Error("The mainnet USDC mint is refused. Publik does not send on mainnet.");
  }
  if (input.amountBase <= 0n) throw new Error("Amount must be greater than zero.");
  const owner = new PublicKey(input.owner);
  const destinationOwner = new PublicKey(input.destinationOwner);
  const mint = new PublicKey(input.mint);
  const source = await getAssociatedTokenAddress(mint, owner, false, TOKEN_PROGRAM_ID);
  const destination = await getAssociatedTokenAddress(mint, destinationOwner, false, TOKEN_PROGRAM_ID);
  const tx = new Transaction({ feePayer: owner, recentBlockhash: input.blockhash });
  if (input.createDestination) {
    tx.add(createAssociatedTokenAccountInstruction(owner, destination, destinationOwner, mint, TOKEN_PROGRAM_ID));
  }
  tx.add(createTransferCheckedInstruction(source, mint, destination, owner, input.amountBase, USDC_DECIMALS, [], TOKEN_PROGRAM_ID));
  return tx;
}
