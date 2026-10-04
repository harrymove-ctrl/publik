import { readFileSync } from "node:fs";
import { Connection, Keypair, Transaction } from "@solana/web3.js";
import { buildDelegateTransfer } from "../src/solana/delegate";
import { DEVNET_USDC_MINT, toBase, USDC_DECIMALS } from "../src/domain/money";

export function loadAgentKey(file: string): { publicKey: string; secret: Uint8Array } {
  const raw = readFileSync(file, "utf8");
  const bytes = JSON.parse(raw);
  if (!Array.isArray(bytes) || bytes.length !== 64) {
    throw new Error("Key file must contain a JSON array of 64 bytes");
  }
  const secret = new Uint8Array(bytes);
  const keypair = Keypair.fromSecretKey(secret);
  return {
    publicKey: keypair.publicKey.toBase58(),
    secret,
  };
}

export async function delegatePayTransaction(input: {
  keyFile: string;
  sourceOwner: string;
  mint: string;
  destinationOwner: string;
  amountBase: bigint;
  blockhash: string;
}): Promise<{ publicKey: string; transaction: Transaction }> {
  const loaded = loadAgentKey(input.keyFile);
  const tx = await buildDelegateTransfer({
    delegate: loaded.publicKey,
    sourceOwner: input.sourceOwner,
    mint: input.mint,
    destinationOwner: input.destinationOwner,
    amountBase: input.amountBase,
    blockhash: input.blockhash,
  });
  return {
    publicKey: loaded.publicKey,
    transaction: tx,
  };
}

export async function runCli(): Promise<void> {
  const args = process.argv.slice(2);
  const [keyFile, sourceOwner, destinationOwner, uiAmount] = args;
  if (!keyFile || !sourceOwner || !destinationOwner || !uiAmount) {
    process.stderr.write("Usage: bun agent/pay.ts <keyFile> <sourceOwner> <destinationOwner> <uiAmount>\n");
    process.exit(1);
  }

  const loaded = loadAgentKey(keyFile);
  const amountBase = BigInt(toBase(uiAmount, USDC_DECIMALS).toString());
  const mint = process.env.PUBLIK_MINT ?? DEVNET_USDC_MINT;

  const shouldSend = process.env.PUBLIK_SEND === "1" && Boolean(process.env.PUBLIK_RPC);
  if (!shouldSend) {
    process.stdout.write(`${loaded.publicKey} not sent\n`);
    return;
  }

  const rpc = process.env.PUBLIK_RPC!;
  const connection = new Connection(rpc, "confirmed");
  const { blockhash } = await connection.getLatestBlockhash("confirmed");

  const { transaction } = await delegatePayTransaction({
    keyFile,
    sourceOwner,
    mint,
    destinationOwner,
    amountBase,
    blockhash,
  });

  const signer = Keypair.fromSecretKey(loaded.secret);
  transaction.sign(signer);

  const signature = await connection.sendRawTransaction(transaction.serialize());
  process.stdout.write(`${signature}\n`);
}

if (import.meta.main) {
  runCli().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
