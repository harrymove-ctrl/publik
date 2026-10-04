/**
 * Verifies SPL Token delegate and Squads daily spending limit on Solana devnet with real transactions.
 *
 * Usage:
 *   bun scripts/delegate-limits-demo.ts --rpc https://api.devnet.solana.com [--keys DIR] [--funder devnet-deployer]
 *   bun run demo:limits -- --rpc https://api.devnet.solana.com [--keys DIR] [--funder devnet-deployer]
 *
 * Keys are read from ~/.config/publik/{demo-owner,demo-agent,demo-recipient,demo-outsider,devnet-deployer}.json
 * and NEVER printed. Frugal on SOL; top-ups only occur when balance is below minimum.
 */
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  getAccount,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import * as multisig from "@sqds/multisig";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  buildApproveBudget,
  buildDelegateTransfer,
  buildRevokeBudget,
} from "../src/solana/delegate";
import {
  buildDailySpendingLimit,
  SQUADS_PROGRAM,
} from "../src/solana/squadsLimit";
import {
  createTestMint,
  land,
  loadKey,
  openCluster,
  send,
} from "./devnet";

const UNIT = 1_000_000n;
const SQUADS_PROGRAM_ID = new PublicKey(SQUADS_PROGRAM);

const args = process.argv.slice(2);
const flag = (name: string) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};

const rpc = flag("rpc") ?? "https://api.devnet.solana.com";
const keyDir = flag("keys") ?? join(homedir(), ".config", "publik");
const funderArg = flag("funder") ?? "devnet-deployer";

const { connection, cluster, explorer } = await openCluster(rpc);
const local = cluster === "localnet";

const owner = loadKey(keyDir, "demo-owner");
const agent = loadKey(keyDir, "demo-agent");
const recipient = loadKey(keyDir, "demo-recipient");
const outsider = loadKey(keyDir, "demo-outsider");

let step = 0;
function report(title: string, detail: Record<string, unknown>) {
  step += 1;
  console.log(`\n${step}. ${title}`);
  for (const [key, value] of Object.entries(detail)) {
    console.log(`   ${key}: ${String(value)}`);
  }
}

function parseCustomError(err: unknown): number | null {
  if (!err) return null;
  if (typeof err === "object") {
    const errorObj = err as Record<string, unknown>;
    if (Array.isArray(errorObj.InstructionError) && errorObj.InstructionError.length >= 2) {
      const detail = errorObj.InstructionError[1] as Record<string, unknown>;
      if (typeof detail === "object" && detail !== null && typeof detail.Custom === "number") {
        return detail.Custom;
      }
    }
  }
  const text = JSON.stringify(err);
  const match = /"Custom":\s*(\d+)/.exec(text);
  if (match) return Number(match[1]);
  const hexMatch = /custom program error: 0x([0-9a-f]+)/i.exec(text);
  if (hexMatch) return Number.parseInt(hexMatch[1], 16);
  return null;
}

function explainError(code: number | null): string {
  if (code === null) return "unknown error";
  if (code === 1) return `${code} (InsufficientFunds)`;
  if (code === 4) return `${code} (OwnerMismatch)`;
  try {
    const squadsErr = multisig.generated.errorFromCode(code);
    if (squadsErr) return `${code} (${squadsErr.name})`;
  } catch {
    // Ignore error lookup failures
  }
  return `${code}`;
}

async function ensureSol(keypair: Keypair, minimum: number) {
  const balance = await connection.getBalance(keypair.publicKey);
  if (balance >= minimum) return;
  if (local) {
    const signature = await connection.requestAirdrop(keypair.publicKey, 2 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(signature, "confirmed");
    return;
  }
  const funder = loadKey(keyDir, funderArg);
  const needed = minimum - balance;
  await send(
    connection,
    [
      SystemProgram.transfer({
        fromPubkey: funder.publicKey,
        toPubkey: keypair.publicKey,
        lamports: needed,
      }),
    ],
    [funder],
  );
}

// Check Squads program executable on chain
const squadsInfo = await connection.getAccountInfo(SQUADS_PROGRAM_ID);
if (!squadsInfo?.executable) {
  throw new Error(`Squads program ${SQUADS_PROGRAM_ID.toBase58()} is not executable on ${cluster}.`);
}

console.log(`Cluster: ${cluster} (${rpc})`);
console.log(`Squads Program: ${SQUADS_PROGRAM_ID.toBase58()} (executable)`);
console.log(`Owner: ${owner.publicKey.toBase58()}`);
console.log(`Agent: ${agent.publicKey.toBase58()}`);
console.log(`Recipient: ${recipient.publicKey.toBase58()}`);
console.log(`Outsider: ${outsider.publicKey.toBase58()}`);

// Frugal SOL check: ensure baseline balances
await ensureSol(owner, 0.04 * LAMPORTS_PER_SOL);
await ensureSol(agent, 0.01 * LAMPORTS_PER_SOL);

const initialOwnerLamports = await connection.getBalance(owner.publicKey);
const initialAgentLamports = await connection.getBalance(agent.publicKey);

// ==========================================
// PART 1: Token Delegate Proofs (Steps 1-6)
// ==========================================

// Step 1: Create test mint, owner ATA, mint 10.00 to owner; create recipient ATA (owner pays)
const mint = await createTestMint(connection, owner, owner.publicKey);
const ownerToken = await getAssociatedTokenAddress(mint, owner.publicKey, false, TOKEN_PROGRAM_ID);
const recipientToken = await getAssociatedTokenAddress(mint, recipient.publicKey, false, TOKEN_PROGRAM_ID);
const outsiderToken = await getAssociatedTokenAddress(mint, outsider.publicKey, false, TOKEN_PROGRAM_ID);

const initAtasSig = await send(
  connection,
  [
    createAssociatedTokenAccountIdempotentInstruction(owner.publicKey, ownerToken, owner.publicKey, mint),
    createAssociatedTokenAccountIdempotentInstruction(owner.publicKey, recipientToken, recipient.publicKey, mint),
    createMintToInstruction(mint, ownerToken, owner.publicKey, 10n * UNIT),
  ],
  [owner],
);

const ownerInitialAta = await getAccount(connection, ownerToken, "confirmed");
if (ownerInitialAta.amount !== 10n * UNIT) {
  throw new Error(`Expected owner balance 10000000, got ${ownerInitialAta.amount}`);
}

report("Created test mint and initialized ATAs with 10.00 tokens to owner", {
  mint: mint.toBase58(),
  owner_ata: ownerToken.toBase58(),
  recipient_ata: recipientToken.toBase58(),
  signature: initAtasSig,
  explorer: explorer(initAtasSig),
});

// Step 2: Owner signs buildApproveBudget for 5.00 to the agent key. Read owner ATA: delegate == agent, delegatedAmount == 5000000
const { blockhash: bh2 } = await connection.getLatestBlockhash("confirmed");
const tx2 = await buildApproveBudget({
  owner: owner.publicKey.toBase58(),
  agent: agent.publicKey.toBase58(),
  mint: mint.toBase58(),
  amountBase: 5n * UNIT,
  blockhash: bh2,
});
const { signature: sig2, err: err2 } = await land(connection, tx2, [owner], false);
if (err2) throw new Error(`Approve budget failed on chain: ${JSON.stringify(err2)}`);

const ownerAccount2 = await getAccount(connection, ownerToken, "confirmed");
if (ownerAccount2.delegate?.toBase58() !== agent.publicKey.toBase58()) {
  throw new Error(`Expected delegate ${agent.publicKey.toBase58()}, got ${ownerAccount2.delegate?.toBase58()}`);
}
if (ownerAccount2.delegatedAmount !== 5n * UNIT) {
  throw new Error(`Expected delegatedAmount 5000000, got ${ownerAccount2.delegatedAmount}`);
}

report("Owner approved 5.00 token budget to agent delegate", {
  signature: sig2,
  explorer: explorer(sig2),
  delegate: ownerAccount2.delegate.toBase58(),
  delegated_amount: Number(ownerAccount2.delegatedAmount) / Number(UNIT),
});

// Step 3: Agent signs buildDelegateTransfer 2.00 owner→recipient. Expect success; delegatedAmount == 3000000; recipient balance +2.
const { blockhash: bh3 } = await connection.getLatestBlockhash("confirmed");
const tx3 = await buildDelegateTransfer({
  delegate: agent.publicKey.toBase58(),
  sourceOwner: owner.publicKey.toBase58(),
  mint: mint.toBase58(),
  destinationOwner: recipient.publicKey.toBase58(),
  amountBase: 2n * UNIT,
  blockhash: bh3,
});
const { signature: sig3, err: err3 } = await land(connection, tx3, [agent], false);
if (err3) throw new Error(`Delegate transfer failed on chain: ${JSON.stringify(err3)}`);

const ownerAccount3 = await getAccount(connection, ownerToken, "confirmed");
const recipientAccount3 = await getAccount(connection, recipientToken, "confirmed");
if (ownerAccount3.delegatedAmount !== 3n * UNIT) {
  throw new Error(`Expected delegatedAmount 3000000, got ${ownerAccount3.delegatedAmount}`);
}
if (recipientAccount3.amount !== 2n * UNIT) {
  throw new Error(`Expected recipient balance 2000000, got ${recipientAccount3.amount}`);
}

report("Agent transferred 2.00 tokens within approved delegate budget", {
  signature: sig3,
  explorer: explorer(sig3),
  delegated_remaining: Number(ownerAccount3.delegatedAmount) / Number(UNIT),
  recipient_balance: Number(recipientAccount3.amount) / Number(UNIT),
});

// Step 4: Agent tries 4.00 (over remaining 3.00), sent with skipPreflight. Expect on-chain failure (InsufficientFunds custom error 1). Balances unchanged.
const { blockhash: bh4 } = await connection.getLatestBlockhash("confirmed");
const tx4 = await buildDelegateTransfer({
  delegate: agent.publicKey.toBase58(),
  sourceOwner: owner.publicKey.toBase58(),
  mint: mint.toBase58(),
  destinationOwner: recipient.publicKey.toBase58(),
  amountBase: 4n * UNIT,
  blockhash: bh4,
});
const { signature: sig4, err: err4 } = await land(connection, tx4, [agent], true);
if (!err4) throw new Error(`Expected on-chain failure for over-budget transfer, but ${sig4} succeeded.`);
const code4 = parseCustomError(err4);
if (code4 !== 1) {
  throw new Error(`Expected custom error 1 (InsufficientFunds), got ${code4} (${JSON.stringify(err4)})`);
}

const ownerAccount4 = await getAccount(connection, ownerToken, "confirmed");
const recipientAccount4 = await getAccount(connection, recipientToken, "confirmed");
if (ownerAccount4.delegatedAmount !== 3n * UNIT) {
  throw new Error(`Owner delegatedAmount changed unexpectedly: ${ownerAccount4.delegatedAmount}`);
}
if (recipientAccount4.amount !== 2n * UNIT) {
  throw new Error(`Recipient balance changed unexpectedly: ${recipientAccount4.amount}`);
}

report("Over-budget transfer rejected on chain (InsufficientFunds)", {
  signature: sig4,
  explorer: explorer(sig4),
  expected_error: explainError(code4),
  raw_err: JSON.stringify(err4),
  delegated_remaining: Number(ownerAccount4.delegatedAmount) / Number(UNIT),
  recipient_balance: Number(recipientAccount4.amount) / Number(UNIT),
});

// Step 5: Owner signs buildRevokeBudget. delegate == null.
const { blockhash: bh5 } = await connection.getLatestBlockhash("confirmed");
const tx5 = await buildRevokeBudget({
  owner: owner.publicKey.toBase58(),
  mint: mint.toBase58(),
  blockhash: bh5,
});
const { signature: sig5, err: err5 } = await land(connection, tx5, [owner], false);
if (err5) throw new Error(`Revoke budget failed on chain: ${JSON.stringify(err5)}`);

const ownerAccount5 = await getAccount(connection, ownerToken, "confirmed");
if (ownerAccount5.delegate !== null) {
  throw new Error(`Expected delegate to be null, got ${ownerAccount5.delegate?.toBase58()}`);
}
if (ownerAccount5.delegatedAmount !== 0n) {
  throw new Error(`Expected delegatedAmount to be 0, got ${ownerAccount5.delegatedAmount}`);
}

report("Owner revoked token delegate budget", {
  signature: sig5,
  explorer: explorer(sig5),
  delegate: "null",
  delegated_amount: Number(ownerAccount5.delegatedAmount),
});

// Step 6: Agent tries 1.00 after revoke, skipPreflight. Expect on-chain failure (OwnerMismatch custom error 4).
const { blockhash: bh6 } = await connection.getLatestBlockhash("confirmed");
const tx6 = await buildDelegateTransfer({
  delegate: agent.publicKey.toBase58(),
  sourceOwner: owner.publicKey.toBase58(),
  mint: mint.toBase58(),
  destinationOwner: recipient.publicKey.toBase58(),
  amountBase: 1n * UNIT,
  blockhash: bh6,
});
const { signature: sig6, err: err6 } = await land(connection, tx6, [agent], true);
if (!err6) throw new Error(`Expected on-chain failure for transfer after revoke, but ${sig6} succeeded.`);
const code6 = parseCustomError(err6);
if (code6 !== 4) {
  throw new Error(`Expected custom error 4 (OwnerMismatch), got ${code6} (${JSON.stringify(err6)})`);
}

report("Post-revoke transfer rejected on chain (OwnerMismatch)", {
  signature: sig6,
  explorer: explorer(sig6),
  expected_error: explainError(code6),
  raw_err: JSON.stringify(err6),
});

// ==========================================
// PART 2: Squads Spending Limit (Steps 7-12)
// ==========================================

// Step 7: Owner creates a multisig with multisigCreateV2
const [programConfigPda] = multisig.getProgramConfigPda({ programId: SQUADS_PROGRAM_ID });
const programConfig = await multisig.accounts.ProgramConfig.fromAccountAddress(connection, programConfigPda);

const multisigCreateKeypair = Keypair.generate();
const [multisigPda] = multisig.getMultisigPda({
  createKey: multisigCreateKeypair.publicKey,
  programId: SQUADS_PROGRAM_ID,
});

const createMultisigIx = multisig.instructions.multisigCreateV2({
  treasury: programConfig.treasury,
  creator: owner.publicKey,
  multisigPda,
  configAuthority: owner.publicKey,
  threshold: 1,
  members: [{ key: owner.publicKey, permissions: multisig.types.Permissions.all() }],
  timeLock: 0,
  createKey: multisigCreateKeypair.publicKey,
  rentCollector: null,
  programId: SQUADS_PROGRAM_ID,
});

const sig7 = await send(connection, [createMultisigIx], [owner, multisigCreateKeypair]);

report("Owner created Squads v4 multisig with configAuthority = owner", {
  signature: sig7,
  explorer: explorer(sig7),
  multisig: multisigPda.toBase58(),
  create_key: multisigCreateKeypair.publicKey.toBase58(),
  threshold: 1,
  config_authority: owner.publicKey.toBase58(),
});

// Step 8: Fund the multisig vault (vaultIndex 0 PDA) ATA with 5.00 test tokens
const [vaultPda] = multisig.getVaultPda({
  multisigPda,
  index: 0,
  programId: SQUADS_PROGRAM_ID,
});
const vaultToken = await getAssociatedTokenAddress(mint, vaultPda, true, TOKEN_PROGRAM_ID);

const fundVaultSig = await send(
  connection,
  [
    createAssociatedTokenAccountIdempotentInstruction(owner.publicKey, vaultToken, vaultPda, mint),
    createMintToInstruction(mint, vaultToken, owner.publicKey, 5n * UNIT),
  ],
  [owner],
);

const vaultAccount8 = await getAccount(connection, vaultToken, "confirmed");
if (vaultAccount8.amount !== 5n * UNIT) {
  throw new Error(`Expected vault ATA balance 5000000, got ${vaultAccount8.amount}`);
}

report("Owner funded multisig vault ATA with 5.00 test tokens", {
  signature: fundVaultSig,
  explorer: explorer(fundVaultSig),
  vault_pda: vaultPda.toBase58(),
  vault_ata: vaultToken.toBase58(),
  vault_balance: Number(vaultAccount8.amount) / Number(UNIT),
});

// Step 9: Owner signs buildDailySpendingLimit
const limitCreateKeypair = Keypair.generate();
const limitCreateKey = limitCreateKeypair.publicKey;
const [spendingLimitPda] = multisig.getSpendingLimitPda({
  multisigPda,
  createKey: limitCreateKey,
  programId: SQUADS_PROGRAM_ID,
});

const { blockhash: bh9 } = await connection.getLatestBlockhash("confirmed");
const tx9 = buildDailySpendingLimit({
  owner: owner.publicKey.toBase58(),
  multisig: multisigPda.toBase58(),
  agent: agent.publicKey.toBase58(),
  mint: mint.toBase58(),
  amountBase: 3n * UNIT,
  destinations: [recipient.publicKey.toBase58()],
  blockhash: bh9,
  createKey: limitCreateKey.toBase58(),
});

const { signature: sig9, err: err9 } = await land(connection, tx9, [owner], false);
if (err9) throw new Error(`Add spending limit failed on chain: ${JSON.stringify(err9)}`);

const spendingLimitAccount = await multisig.accounts.SpendingLimit.fromAccountAddress(
  connection,
  spendingLimitPda,
);

if (BigInt(spendingLimitAccount.amount.toString()) !== 3n * UNIT) {
  throw new Error(`Expected spending limit amount 3000000, got ${spendingLimitAccount.amount}`);
}
if (BigInt(spendingLimitAccount.remainingAmount.toString()) !== 3n * UNIT) {
  throw new Error(`Expected remainingAmount 3000000, got ${spendingLimitAccount.remainingAmount}`);
}
if (!spendingLimitAccount.members.some((m) => m.equals(agent.publicKey))) {
  throw new Error(`Agent key ${agent.publicKey.toBase58()} not found in spending limit members`);
}
if (!spendingLimitAccount.destinations.some((d) => d.equals(recipient.publicKey))) {
  throw new Error(`Recipient key ${recipient.publicKey.toBase58()} not found in spending limit destinations`);
}

report("Owner configured daily spending limit for agent", {
  signature: sig9,
  explorer: explorer(sig9),
  spending_limit: spendingLimitPda.toBase58(),
  amount: Number(spendingLimitAccount.amount) / Number(UNIT),
  remaining_amount: Number(spendingLimitAccount.remainingAmount) / Number(UNIT),
  period: "Day",
  members: spendingLimitAccount.members.map((m) => m.toBase58()).join(", "),
  destinations: spendingLimitAccount.destinations.map((d) => d.toBase58()).join(", "),
});

// Step 10: Agent uses the limit via spendingLimitUse to send 2.00 vault→recipient
const useIx10 = multisig.instructions.spendingLimitUse({
  multisigPda,
  member: agent.publicKey,
  spendingLimit: spendingLimitPda,
  mint,
  vaultIndex: 0,
  amount: 2_000_000n,
  decimals: 6,
  destination: recipient.publicKey,
  programId: SQUADS_PROGRAM_ID,
});

const sig10 = await send(connection, [useIx10], [agent]);

const limitAccount10 = await multisig.accounts.SpendingLimit.fromAccountAddress(
  connection,
  spendingLimitPda,
);
const recipientAccount10 = await getAccount(connection, recipientToken, "confirmed");

if (BigInt(limitAccount10.remainingAmount.toString()) !== 1n * UNIT) {
  throw new Error(`Expected remainingAmount 1000000, got ${limitAccount10.remainingAmount}`);
}
if (recipientAccount10.amount !== 4n * UNIT) {
  throw new Error(`Expected recipient balance 4000000 (2.00 from delegate + 2.00 from squads), got ${recipientAccount10.amount}`);
}

report("Agent spent 2.00 from vault via Squads daily spending limit", {
  signature: sig10,
  explorer: explorer(sig10),
  remaining_amount: Number(limitAccount10.remainingAmount) / Number(UNIT),
  recipient_balance: Number(recipientAccount10.amount) / Number(UNIT),
});

// Step 11: Agent tries 2.00 more (over remaining 1.00), skipPreflight. Expect on-chain failure (SpendingLimitExceeded).
const useIx11 = multisig.instructions.spendingLimitUse({
  multisigPda,
  member: agent.publicKey,
  spendingLimit: spendingLimitPda,
  mint,
  vaultIndex: 0,
  amount: 2_000_000n,
  decimals: 6,
  destination: recipient.publicKey,
  programId: SQUADS_PROGRAM_ID,
});

const { signature: sig11, err: err11 } = await land(connection, [useIx11], [agent], true);
if (!err11) throw new Error(`Expected on-chain failure for spending limit exceeded, but ${sig11} succeeded.`);
const code11 = parseCustomError(err11);
if (code11 !== 6026) {
  throw new Error(`Expected custom error 6026 (SpendingLimitExceeded), got ${code11} (${JSON.stringify(err11)})`);
}

const limitAccount11 = await multisig.accounts.SpendingLimit.fromAccountAddress(
  connection,
  spendingLimitPda,
);
if (BigInt(limitAccount11.remainingAmount.toString()) !== 1n * UNIT) {
  throw new Error(`Remaining amount changed unexpectedly: ${limitAccount11.remainingAmount}`);
}

report("Over-limit spend rejected on chain (SpendingLimitExceeded)", {
  signature: sig11,
  explorer: explorer(sig11),
  expected_error: explainError(code11),
  raw_err: JSON.stringify(err11),
  remaining_amount: Number(limitAccount11.remainingAmount) / Number(UNIT),
});

// Step 12: Agent tries 0.50 to outsider wallet (not in destinations), skipPreflight (create outsider ATA first, owner pays). Expect on-chain failure (InvalidDestination).
const createOutsiderAtaSig = await send(
  connection,
  [
    createAssociatedTokenAccountIdempotentInstruction(owner.publicKey, outsiderToken, outsider.publicKey, mint),
  ],
  [owner],
);

const useIx12 = multisig.instructions.spendingLimitUse({
  multisigPda,
  member: agent.publicKey,
  spendingLimit: spendingLimitPda,
  mint,
  vaultIndex: 0,
  amount: 500_000n,
  decimals: 6,
  destination: outsider.publicKey,
  programId: SQUADS_PROGRAM_ID,
});

const { signature: sig12, err: err12 } = await land(connection, [useIx12], [agent], true);
if (!err12) throw new Error(`Expected on-chain failure for non-allowlisted destination, but ${sig12} succeeded.`);
const code12 = parseCustomError(err12);
if (code12 !== 6025) {
  throw new Error(`Expected custom error 6025 (InvalidDestination), got ${code12} (${JSON.stringify(err12)})`);
}

report("Non-allowlisted destination spend rejected on chain (InvalidDestination)", {
  signature: sig12,
  explorer: explorer(sig12),
  outsider_ata_sig: createOutsiderAtaSig,
  expected_error: explainError(code12),
  raw_err: JSON.stringify(err12),
});

// Summary and SOL spent calculation
const finalOwnerLamports = await connection.getBalance(owner.publicKey);
const finalAgentLamports = await connection.getBalance(agent.publicKey);

const ownerSpentSol = Number(initialOwnerLamports - finalOwnerLamports) / LAMPORTS_PER_SOL;
const agentSpentSol = Number(initialAgentLamports - finalAgentLamports) / LAMPORTS_PER_SOL;
const totalSpentSol = ownerSpentSol + agentSpentSol;

console.log(
  `\nSummary: All 12 steps passed on ${cluster}. Total SOL spent: ${totalSpentSol.toFixed(6)} SOL (owner: ${ownerSpentSol.toFixed(6)} SOL, agent: ${agentSpentSol.toFixed(6)} SOL).`,
);
