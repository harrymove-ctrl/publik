import {
  createApproveCheckedInstruction,
  createRevokeInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PublicKey, Transaction } from "@solana/web3.js";

const USDC_DECIMALS = 6;

export async function ownerUsdcAccount(owner: string, mint: string): Promise<string> {
  const ata = await getAssociatedTokenAddress(new PublicKey(mint), new PublicKey(owner), false, TOKEN_PROGRAM_ID);
  return ata.toBase58();
}

/** Owner signs. The agent key is only the delegate. Publik does not sign. */
export async function buildApproveBudget(input: {
  owner: string;
  agent: string;
  mint: string;
  amountBase: bigint;
  blockhash: string;
}): Promise<Transaction> {
  const ownerKey = new PublicKey(input.owner);
  const agentKey = new PublicKey(input.agent);
  const mintKey = new PublicKey(input.mint);
  const tokenAccount = await getAssociatedTokenAddress(mintKey, ownerKey, false, TOKEN_PROGRAM_ID);
  const tx = new Transaction({ feePayer: ownerKey, recentBlockhash: input.blockhash });
  tx.add(
    createApproveCheckedInstruction(
      tokenAccount,
      mintKey,
      agentKey,
      ownerKey,
      input.amountBase,
      USDC_DECIMALS,
      [],
      TOKEN_PROGRAM_ID,
    ),
  );
  return tx;
}

/** Owner signs. After this confirms, the agent can no longer move the owner's Test USDC. */
export async function buildRevokeBudget(input: {
  owner: string;
  mint: string;
  blockhash: string;
}): Promise<Transaction> {
  const ownerKey = new PublicKey(input.owner);
  const mintKey = new PublicKey(input.mint);
  const tokenAccount = await getAssociatedTokenAddress(mintKey, ownerKey, false, TOKEN_PROGRAM_ID);
  const tx = new Transaction({ feePayer: ownerKey, recentBlockhash: input.blockhash });
  tx.add(createRevokeInstruction(tokenAccount, ownerKey, [], TOKEN_PROGRAM_ID));
  return tx;
}

/** The agent key signs this as the delegate. The browser must never call it with a secret. */
export async function buildDelegateTransfer(input: {
  delegate: string;
  sourceOwner: string;
  mint: string;
  destinationOwner: string;
  amountBase: bigint;
  blockhash: string;
}): Promise<Transaction> {
  const delegateKey = new PublicKey(input.delegate);
  const mintKey = new PublicKey(input.mint);
  const source = await getAssociatedTokenAddress(mintKey, new PublicKey(input.sourceOwner), false, TOKEN_PROGRAM_ID);
  const destination = await getAssociatedTokenAddress(mintKey, new PublicKey(input.destinationOwner), false, TOKEN_PROGRAM_ID);
  const tx = new Transaction({ feePayer: delegateKey, recentBlockhash: input.blockhash });
  tx.add(
    createTransferCheckedInstruction(
      source,
      mintKey,
      destination,
      delegateKey,
      input.amountBase,
      USDC_DECIMALS,
      [],
      TOKEN_PROGRAM_ID,
    ),
  );
  return tx;
}
