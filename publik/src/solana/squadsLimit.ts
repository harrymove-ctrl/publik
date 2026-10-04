import { PublicKey, Transaction } from "@solana/web3.js";
import * as multisig from "@sqds/multisig";

/** Owner is the config authority and the fee payer. Publik does not sign. */
export function buildDailySpendingLimit(input: {
  owner: string;
  multisig: string;
  agent: string;
  mint: string;
  amountBase: bigint;
  destinations: string[];
  blockhash: string;
  createKey: string;
}): Transaction {
  const ownerKey = new PublicKey(input.owner);
  const multisigPda = new PublicKey(input.multisig);
  const createKey = new PublicKey(input.createKey);
  const [spendingLimit] = multisig.getSpendingLimitPda({ multisigPda, createKey });
  const instruction = multisig.instructions.multisigAddSpendingLimit({
    multisigPda,
    configAuthority: ownerKey,
    spendingLimit,
    rentPayer: ownerKey,
    createKey,
    vaultIndex: 0,
    mint: new PublicKey(input.mint),
    amount: input.amountBase,
    period: multisig.generated.Period.Day,
    members: [new PublicKey(input.agent)],
    destinations: input.destinations.map((item) => new PublicKey(item)),
  });
  const tx = new Transaction({ feePayer: ownerKey, recentBlockhash: input.blockhash });
  tx.add(instruction);
  return tx;
}

export const SQUADS_PROGRAM = multisig.PROGRAM_ADDRESS;
