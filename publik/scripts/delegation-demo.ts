/**
 * Runs the delegated-payment demo against a real cluster with real transactions.
 *
 *   bun scripts/delegation-demo.ts --rpc http://127.0.0.1:8899      # local validator
 *   bun scripts/delegation-demo.ts --rpc https://api.devnet.solana.com
 *
 * Keys are read from ~/.config/publik/{demo-owner,demo-agent,demo-recipient,demo-outsider}.json and
 * never printed. On localnet the script airdrops SOL; on devnet the keys must already hold SOL
 * (or `--funder <keypair>` pays them). It creates its own six-decimal test mint. Never mainnet.
 */
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  createTransferCheckedInstruction,
  getAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  type TransactionInstruction,
} from "@solana/web3.js";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import {
  allowance,
  decodeReceipt,
  decodeVault,
  executePaymentInstruction,
  initializeVaultInstructions,
  receiptAddress,
  revokeDelegationInstruction,
  setPausedInstruction,
  tokenAccount,
  VAULT_PROGRAM_ID,
  vaultAddress,
  vaultErrorCode,
  vaultErrorMessage,
  vaultTokenAccount,
  withdrawOwnerFundsInstruction,
} from "../src/solana/vault";

import {
  createTestMint,
  land as landTx,
  loadKey,
  openCluster,
  send as sendTx,
} from "./devnet";

const UNIT = 1_000_000n;

const args = process.argv.slice(2);
const flag = (name: string) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const rpc = flag("rpc") ?? "http://127.0.0.1:8899";
const keyDir = flag("keys") ?? join(homedir(), ".config", "publik");
const { connection, cluster, explorer } = await openCluster(rpc);
const local = cluster === "localnet";

const owner = loadKey(keyDir, "demo-owner");
const agent = loadKey(keyDir, "demo-agent");
const recipient = loadKey(keyDir, "demo-recipient");
const outsider = loadKey(keyDir, "demo-outsider");

const program = await connection.getAccountInfo(VAULT_PROGRAM_ID);
if (!program?.executable) throw new Error(`Vault program ${VAULT_PROGRAM_ID.toBase58()} is not deployed on ${cluster}.`);

let step = 0;
function report(title: string, detail: Record<string, unknown>) {
  step += 1;
  console.log(`\n${step}. ${title}`);
  for (const [key, value] of Object.entries(detail)) console.log(`   ${key}: ${String(value)}`);
}

/**
 * Signs, sends, and waits for `confirmed` by polling signature status over HTTP. Public devnet often
 * rejects websocket subscriptions with 429, so confirmTransaction is not reliable there.
 * Returns the on-chain error (null on success). Never treats an RPC hiccup as a program failure.
 */
const land = (instructions: TransactionInstruction[], signers: Keypair[], skipPreflight: boolean) =>
  landTx(connection, instructions, signers, skipPreflight);

const send = (instructions: TransactionInstruction[], signers: Keypair[]) =>
  sendTx(connection, instructions, signers);

/** Lands the transaction on chain without simulation so the program itself rejects it. */
async function sendExpectingProgramError(instructions: TransactionInstruction[], signer: Keypair): Promise<{ signature: string; code: number }> {
  const { signature, err } = await land(instructions, [signer], true);
  if (!err) throw new Error(`Expected an on-chain failure, but ${signature} succeeded.`);
  const code = vaultErrorCode(err);
  if (code === null) throw new Error(`Unexpected failure ${JSON.stringify(err)}`);
  return { signature, code };
}

async function readVault(vault: PublicKey) {
  const info = await connection.getAccountInfo(vault, "confirmed");
  if (!info) throw new Error("vault not found");
  return decodeVault(vault, info.data, info.owner);
}

async function ensureSol(keypair: Keypair, minimum: number) {
  const balance = await connection.getBalance(keypair.publicKey);
  if (balance >= minimum) return;
  if (local) {
    const signature = await connection.requestAirdrop(keypair.publicKey, 2 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(signature, "confirmed");
    return;
  }
  const funderPath = flag("funder");
  if (!funderPath) throw new Error(`${keypair.publicKey.toBase58()} needs ${minimum / LAMPORTS_PER_SOL} SOL on devnet. Pass --funder <keypair>.`);
  const funder = loadKey(keyDir, funderPath);
  await send([SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: keypair.publicKey, lamports: minimum - balance })], [funder]);
}

console.log(`Cluster: ${cluster} (${rpc})`);
console.log(`Program: ${VAULT_PROGRAM_ID.toBase58()} (executable)`);
console.log(`Owner ${owner.publicKey.toBase58()} | execution key ${agent.publicKey.toBase58()} | recipient ${recipient.publicKey.toBase58()} | outsider ${outsider.publicKey.toBase58()}`);

await ensureSol(owner, 0.1 * LAMPORTS_PER_SOL);
await ensureSol(agent, 0.03 * LAMPORTS_PER_SOL);

// Test token: our own six-decimal mint. It has no monetary backing.
const mint = await createTestMint(connection, owner, owner.publicKey);
const ownerToken = tokenAccount(owner.publicKey, mint);
const recipientToken = tokenAccount(recipient.publicKey, mint);
const outsiderToken = tokenAccount(outsider.publicKey, mint);
await send([
  createAssociatedTokenAccountIdempotentInstruction(owner.publicKey, ownerToken, owner.publicKey, mint),
  createAssociatedTokenAccountIdempotentInstruction(owner.publicKey, recipientToken, recipient.publicKey, mint),
  createAssociatedTokenAccountIdempotentInstruction(owner.publicKey, outsiderToken, outsider.publicKey, mint),
  createMintToInstruction(mint, ownerToken, owner.publicKey, 100n * UNIT),
], [owner]);
console.log(`Test mint ${mint.toBase58()} (6 decimals, minted 100 test tokens to the owner)`);

const vaultId = new Uint8Array(randomBytes(32));
const vault = vaultAddress(owner.publicKey, vaultId);
const now = BigInt((await connection.getBlockTime(await connection.getSlot())) ?? Math.floor(Date.now() / 1000));
const policy = { perBase: 2n * UNIT, dailyBase: 5n * UNIT, lifetimeBase: 8n * UNIT };

const initSignature = await send(initializeVaultInstructions({
  owner: owner.publicKey.toBase58(),
  vaultId,
  executionKey: agent.publicKey.toBase58(),
  mint: mint.toBase58(),
  ...policy,
  startTs: now - 60n,
  expiryTs: now + 7n * 86_400n,
  recipients: [recipient.publicKey.toBase58()],
}), [owner]);
const initial = await readVault(vault);
report("Owner initialized the vault", { signature: initSignature, explorer: explorer(initSignature), vault: vault.toBase58(), version: initial.version });

report("Owner authorized the agent execution key", {
  execution_key: initial.executionKey,
  matches_agent: initial.executionKey === agent.publicKey.toBase58(),
  owner_signed: true,
  agent_holds_vault_authority: false,
});

report("Policy allows a small payment to one recipient", {
  per_payment: `${initial.perBase} base units`,
  daily_utc: `${initial.dailyBase} base units`,
  lifetime: `${initial.lifetimeBase} base units`,
  allowlist: initial.recipients.join(", "),
});

const vaultToken = vaultTokenAccount(vault, mint);
const fundSignature = await send([createTransferCheckedInstruction(ownerToken, mint, vaultToken, owner.publicKey, 10n * UNIT, 6)], [owner]);
const funded = await getAccount(connection, vaultToken, "confirmed");
const afterFunding = await readVault(vault);
report("Owner funded the vault with test tokens", {
  signature: fundSignature,
  explorer: explorer(fundSignature),
  vault_token_balance: funded.amount,
  counters_unchanged: afterFunding.lifetimeSpentBase === 0n && afterFunding.version === initial.version,
});

const executionId = new Uint8Array(randomBytes(32));
const paySignature = await send([executePaymentInstruction({
  owner: owner.publicKey.toBase58(),
  vaultId,
  agent: agent.publicKey.toBase58(),
  executionId,
  mint: mint.toBase58(),
  recipient: recipient.publicKey.toBase58(),
  amountBase: 1_500_000n,
  policyVersion: afterFunding.version,
})], [agent]);
report("Agent executed an allowed payment without an owner signature", { signature: paySignature, explorer: explorer(paySignature), signer: agent.publicKey.toBase58(), amount_base: 1_500_000 });

const receipt = receiptAddress(vault, executionId);
const receiptInfo = await connection.getAccountInfo(receipt, "confirmed");
if (!receiptInfo) throw new Error("receipt missing");
const decoded = decodeReceipt(receipt, receiptInfo.data, receiptInfo.owner);
const tx = await connection.getTransaction(paySignature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
const recipientBalance = (await getAccount(connection, recipientToken, "confirmed")).amount;
const verified = tx?.meta?.err === null
  && decoded.amountBase === 1_500_000n
  && decoded.recipient === recipient.publicKey.toBase58()
  && decoded.mint === mint.toBase58()
  && decoded.executionKey === agent.publicKey.toBase58()
  && decoded.policyVersion === afterFunding.version
  && recipientBalance === 1_500_000n;
if (!verified) throw new Error("receipt verification failed");
const afterPay = await readVault(vault);
const room = allowance(afterPay, now, (await getAccount(connection, vaultToken, "confirmed")).amount);
report("Publik independently verified the receipt", {
  receipt: receipt.toBase58(),
  slot: tx?.slot,
  recipient_balance_base: recipientBalance,
  lifetime_spent_base: afterPay.lifetimeSpentBase,
  spendable_now_base: room.spendableNowBase,
});

const overLimit = await sendExpectingProgramError([executePaymentInstruction({
  owner: owner.publicKey.toBase58(),
  vaultId,
  agent: agent.publicKey.toBase58(),
  executionId: new Uint8Array(randomBytes(32)),
  mint: mint.toBase58(),
  recipient: recipient.publicKey.toBase58(),
  amountBase: 3n * UNIT,
  policyVersion: afterPay.version,
})], agent);
report("Over-limit attempt failed on-chain", { signature: overLimit.signature, explorer: explorer(overLimit.signature), program_error: `${overLimit.code} ${vaultErrorMessage(overLimit.code)}` });

const outsiderAttempt = await sendExpectingProgramError([executePaymentInstruction({
  owner: owner.publicKey.toBase58(),
  vaultId,
  agent: agent.publicKey.toBase58(),
  executionId: new Uint8Array(randomBytes(32)),
  mint: mint.toBase58(),
  recipient: outsider.publicKey.toBase58(),
  amountBase: 1n * UNIT,
  policyVersion: afterPay.version,
})], agent);
report("Non-allowlisted recipient attempt failed on-chain", {
  signature: outsiderAttempt.signature,
  explorer: explorer(outsiderAttempt.signature),
  program_error: `${outsiderAttempt.code} ${vaultErrorMessage(outsiderAttempt.code)}`,
  outsider_balance_base: (await getAccount(connection, outsiderToken, "confirmed")).amount,
});

const pauseSignature = await send([setPausedInstruction({ owner: owner.publicKey.toBase58(), vaultId, expectedVersion: afterPay.version, paused: true })], [owner]);
const revokeSignature = await send([revokeDelegationInstruction({ owner: owner.publicKey.toBase58(), vaultId, expectedVersion: afterPay.version + 1n })], [owner]);
const revoked = await readVault(vault);
report("Owner confirmed an on-chain pause, then revoke", {
  pause: explorer(pauseSignature),
  revoke: explorer(revokeSignature),
  paused: revoked.paused,
  revoked: revoked.revoked,
  version: revoked.version,
});

const afterRevoke = await sendExpectingProgramError([executePaymentInstruction({
  owner: owner.publicKey.toBase58(),
  vaultId,
  agent: agent.publicKey.toBase58(),
  executionId: new Uint8Array(randomBytes(32)),
  mint: mint.toBase58(),
  recipient: recipient.publicKey.toBase58(),
  amountBase: 1n,
  policyVersion: revoked.version,
})], agent);
report("Agent execution after revoke failed on-chain", { signature: afterRevoke.signature, explorer: explorer(afterRevoke.signature), program_error: `${afterRevoke.code} ${vaultErrorMessage(afterRevoke.code)}` });

const remaining = (await getAccount(connection, vaultToken, "confirmed")).amount;
const withdrawSignature = await send([withdrawOwnerFundsInstruction({ owner: owner.publicKey.toBase58(), vaultId, mint: mint.toBase58(), amountBase: remaining })], [owner]);
report("Owner withdrew the remaining test tokens", {
  signature: withdrawSignature,
  explorer: explorer(withdrawSignature),
  withdrawn_base: remaining,
  vault_balance_base: (await getAccount(connection, vaultToken, "confirmed")).amount,
  owner_balance_base: (await getAccount(connection, tokenAccount(owner.publicKey, mint), "confirmed")).amount,
});
