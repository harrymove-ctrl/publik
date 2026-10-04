import {
  createInitializeMint2Instruction,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

export const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
export const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";

export async function openCluster(rpc: string): Promise<{
  connection: Connection;
  cluster: "devnet" | "localnet";
  explorer: (signature: string) => string;
}> {
  const connection = new Connection(rpc, "confirmed");
  const genesis = await connection.getGenesisHash();
  if (genesis === MAINNET_GENESIS) throw new Error("Refusing to run on mainnet.");
  const local = genesis !== DEVNET_GENESIS;
  const cluster = local ? "localnet" : "devnet";
  const explorer = (signature: string) =>
    local
      ? `https://explorer.solana.com/tx/${signature}?cluster=custom&customUrl=${encodeURIComponent(rpc)}`
      : `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
  return { connection, cluster, explorer };
}

export function loadKey(dir: string, name: string): Keypair {
  const filePath = existsSync(name)
    ? name
    : join(dir, name.endsWith(".json") ? name : `${name}.json`);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(filePath, "utf8"))));
}

/**
 * Signs, sends, and waits for `confirmed` by polling signature status over HTTP. Public devnet often
 * rejects websocket subscriptions with 429, so confirmTransaction is not reliable there.
 * Returns the on-chain error (null on success). Never treats an RPC hiccup as a program failure.
 */
export async function land(
  connection: Connection,
  instructionsOrTx: TransactionInstruction[] | Transaction,
  signers: Keypair[],
  skipPreflight: boolean = false,
): Promise<{ signature: string; err: unknown }> {
  let tx: Transaction;
  let expiryHeight: number;
  if (Array.isArray(instructionsOrTx)) {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    expiryHeight = lastValidBlockHeight;
    tx = new Transaction({ feePayer: signers[0]!.publicKey, blockhash, lastValidBlockHeight }).add(
      ...instructionsOrTx,
    );
  } else {
    tx = instructionsOrTx;
    if (!tx.feePayer && signers[0]) {
      tx.feePayer = signers[0].publicKey;
    }
    if (!tx.recentBlockhash) {
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
      tx.recentBlockhash = blockhash;
      expiryHeight = lastValidBlockHeight;
    } else if (tx.lastValidBlockHeight) {
      expiryHeight = tx.lastValidBlockHeight;
    } else {
      const currentHeight = await connection.getBlockHeight("confirmed").catch(() => 0);
      expiryHeight = currentHeight + 150;
    }
  }
  tx.sign(...signers);
  const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight });
  for (;;) {
    const status = (
      await connection.getSignatureStatuses([signature], { searchTransactionHistory: true }).catch(() => null)
    )?.value[0];
    if (status && (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized")) {
      return { signature, err: status.err };
    }
    const height = await connection.getBlockHeight("confirmed").catch(() => 0);
    if (expiryHeight && height > expiryHeight) {
      throw new Error(`${signature} expired without confirming. Check it before retrying.`);
    }
    await Bun.sleep(800);
  }
}

export async function send(
  connection: Connection,
  instructionsOrTx: TransactionInstruction[] | Transaction,
  signers: Keypair[],
): Promise<string> {
  const { signature, err } = await land(connection, instructionsOrTx, signers, false);
  if (err) throw new Error(`${signature} failed: ${JSON.stringify(err)}`);
  return signature;
}

export async function createTestMint(
  connection: Connection,
  payer: Keypair,
  authority: PublicKey,
): Promise<PublicKey> {
  const mintKeypair = Keypair.generate();
  const mint = mintKeypair.publicKey;
  const lamports = await connection.getMinimumBalanceForRentExemption(MINT_SIZE);
  await send(
    connection,
    [
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: mint,
        lamports,
        space: MINT_SIZE,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMint2Instruction(mint, 6, authority, null),
    ],
    [payer, mintKeypair],
  );
  return mint;
}
