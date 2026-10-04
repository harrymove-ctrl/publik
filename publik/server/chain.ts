import { PublicKey, type Commitment, type AccountInfo, type SignatureStatus, type ParsedTransactionWithMeta } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import bs58 from "bs58";
import {
  VAULT_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  Ix,
  vaultErrorMessage,
  vaultErrorCode,
  vaultAddress,
  vaultAuthority,
  receiptAddress,
  tokenAccount,
  vaultTokenAccount,
  decodeVault,
  decodeReceipt,
  allowance,
  type VaultState,
  type ReceiptState,
  type Allowance,
} from "../src/solana/vault";

export interface ChainRpc {
  getAccountInfo(pubkey: PublicKey, commitment?: Commitment): Promise<AccountInfo<Buffer> | null>;
  getSlot(commitment?: Commitment): Promise<number>;
  getBlockTime(slot: number): Promise<number | null>;
  getTokenAccountBalance(tokenAccount: PublicKey): Promise<{ value: { amount: string } }>;
  getSignatureStatuses(signatures: string[], config?: { searchTransactionHistory: boolean }): Promise<{ value: Array<SignatureStatus | null> }>;
  getTransaction(signature: string, options?: unknown): Promise<unknown>;
  getSignaturesForAddress(address: PublicKey, options?: unknown, commitment?: Commitment): Promise<Array<{ signature: string; err: unknown; slot: number }>>;
}
export type DecodedTxInstruction = {
  programId: PublicKey;
  keys: PublicKey[];
  data: Buffer;
};

export async function isProgramDeployed(rpc: ChainRpc): Promise<boolean> {
  try {
    const info = await rpc.getAccountInfo(VAULT_PROGRAM_ID, "confirmed");
    return info !== null && Boolean(info.executable);
  } catch {
    return false;
  }
}

export async function getTokenBalanceBase(rpc: ChainRpc, account: PublicKey): Promise<bigint> {
  try {
    const res = await rpc.getTokenAccountBalance(account);
    return BigInt(res.value.amount);
  } catch {
    return 0n;
  }
}

export async function getChainTime(rpc: ChainRpc, slot: number): Promise<bigint> {
  try {
    const time = await rpc.getBlockTime(slot);
    if (time !== null && time !== undefined) return BigInt(time);
  } catch {
    // fallback to wall clock
  }
  return BigInt(Math.floor(Date.now() / 1000));
}

export async function readVaultChainState(
  rpc: ChainRpc,
  vaultPubkey: PublicKey,
  mintPubkey: PublicKey,
): Promise<{
  vault: VaultState;
  balanceBase: bigint;
  slot: number;
  blockTime: bigint;
  allowance: Allowance;
} | null> {
  const accountInfo = await rpc.getAccountInfo(vaultPubkey, "confirmed");
  if (!accountInfo) return null;
  const vault = decodeVault(vaultPubkey, accountInfo.data, accountInfo.owner);
  const vaultToken = vaultTokenAccount(vaultPubkey, mintPubkey);
  const [balanceBase, slot] = await Promise.all([
    getTokenBalanceBase(rpc, vaultToken),
    rpc.getSlot("confirmed"),
  ]);
  const blockTime = await getChainTime(rpc, slot);
  const allow = allowance(vault, blockTime, balanceBase);
  return { vault, balanceBase, slot, blockTime, allowance: allow };
}

export function extractInstructions(tx: unknown): DecodedTxInstruction[] {
  if (!tx || typeof tx !== "object" || !("transaction" in tx)) return [];
  const txObj = tx as { transaction?: { message?: unknown } };
  if (!txObj.transaction || typeof txObj.transaction !== "object" || !("message" in txObj.transaction)) return [];
  const message = txObj.transaction.message as Record<string, unknown> | null;
  if (!message || typeof message !== "object") return [];

  const getAccount = (index: number): PublicKey | null => {
    if ("accountKeys" in message && Array.isArray(message.accountKeys)) {
      const k = message.accountKeys[index];
      return k instanceof PublicKey ? k : typeof k === "string" ? new PublicKey(k) : null;
    }
    if ("staticAccountKeys" in message && Array.isArray(message.staticAccountKeys)) {
      const k = message.staticAccountKeys[index];
      return k instanceof PublicKey ? k : typeof k === "string" ? new PublicKey(k) : null;
    }
    if ("getAccountKeys" in message && typeof message.getAccountKeys === "function") {
      try {
        const getKeys = message.getAccountKeys as () => { get: (i: number) => PublicKey | undefined };
        const keys = getKeys();
        return keys.get(index) ?? null;
      } catch {
        // ignore
      }
    }
    return null;
  };

  const rawInstructions = (Array.isArray(message.instructions) ? message.instructions : Array.isArray(message.compiledInstructions) ? message.compiledInstructions : []) as Array<Record<string, unknown>>;
  const result: DecodedTxInstruction[] = [];

  for (const ix of rawInstructions) {
    if (ix.programId instanceof PublicKey && Array.isArray(ix.keys)) {
      const dataBuf = Buffer.isBuffer(ix.data)
        ? ix.data
        : typeof ix.data === "string"
        ? Buffer.from(bs58.decode(ix.data))
        : Buffer.from((ix.data as Uint8Array | undefined) ?? []);
      result.push({
        programId: ix.programId,
        keys: ix.keys.map((k: unknown) => {
          if (k && typeof k === "object" && "pubkey" in k) {
            const pk = k.pubkey;
            return pk instanceof PublicKey ? pk : new PublicKey(String(pk));
          }
          return k instanceof PublicKey ? k : new PublicKey(String(k));
        }),
        data: dataBuf,
      });
      continue;
    }

    const progIdx = typeof ix.programIdIndex === "number" ? ix.programIdIndex : -1;
    const programId = getAccount(progIdx);
    if (!programId) continue;
    const accountIndices = (Array.isArray(ix.accounts) ? ix.accounts : Array.isArray(ix.accountKeyIndexes) ? ix.accountKeyIndexes : []) as number[];
    const keys: PublicKey[] = [];
    for (const idx of accountIndices) {
      const key = getAccount(idx);
      if (key) keys.push(key);
    }
    const dataBuf = Buffer.isBuffer(ix.data)
      ? ix.data
      : typeof ix.data === "string"
      ? Buffer.from(bs58.decode(ix.data))
      : Buffer.from((ix.data as Uint8Array | undefined) ?? []);
    result.push({
      programId,
      keys,
      data: dataBuf,
    });
  }
  return result;
}

export type ReconcileExpected = {
  vault: PublicKey;
  agentKey?: string;
  recipient: string;
  mint: string;
  amountBase: bigint;
  executionId: Uint8Array;
  policyVersion: bigint;
};

export type ReconcileResult =
  | { status: "unresolved"; reason: string }
  | { status: "failed"; reason: string }
  | { status: "confirmed"; slot: number; verifiedAt: string };

export async function reconcileDelegatedAttempt(
  rpc: ChainRpc,
  signature: string,
  expected: ReconcileExpected,
): Promise<ReconcileResult> {
  let statusesRes: { value: Array<SignatureStatus | null> };
  try {
    statusesRes = await rpc.getSignatureStatuses([signature], { searchTransactionHistory: true });
  } catch {
    return { status: "unresolved", reason: "rpc_unavailable" };
  }

  const sigStatus = statusesRes?.value?.[0];
  if (!sigStatus) {
    return { status: "unresolved", reason: "not_found_yet" };
  }
  if (sigStatus.confirmationStatus !== "confirmed" && sigStatus.confirmationStatus !== "finalized") {
    return { status: "unresolved", reason: "not_confirmed_yet" };
  }

  let tx: { slot?: number; meta?: { err?: unknown; logMessages?: string[] | null } } | null = null;
  try {
    tx = (await rpc.getTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" })) as typeof tx;
  } catch {
    return { status: "unresolved", reason: "rpc_unavailable" };
  }

  if (!tx) {
    return { status: "unresolved", reason: "transaction_not_fetched" };
  }

  // Check on-chain transaction error
  if (sigStatus.err || tx.meta?.err) {
    const errObj = tx.meta?.err ?? sigStatus.err;
    const logs = Array.isArray(tx.meta?.logMessages) ? tx.meta.logMessages.join("\n") : "";
    const code = vaultErrorCode(logs) ?? vaultErrorCode(errObj);
    const reason = code !== null ? vaultErrorMessage(code) : (typeof errObj === "string" ? errObj : JSON.stringify(errObj));
    return { status: "failed", reason };
  }

  // Transaction succeeded on-chain, now independently verify instructions and receipt
  const instructions = extractInstructions(tx);
  if (instructions.length !== 1) {
    return { status: "failed", reason: "Verification failed: unexpected extra instruction" };
  }

  const ix = instructions[0];
  if (!ix || !ix.programId.equals(VAULT_PROGRAM_ID)) {
    return { status: "failed", reason: "Verification failed: unexpected program id" };
  }

  if (ix.data.length !== 49 || ix.data[0] !== Ix.execute) {
    return { status: "failed", reason: "Verification failed: unexpected instruction data or tag" };
  }

  const ixExecutionId = ix.data.subarray(1, 33);
  if (!Buffer.from(ixExecutionId).equals(Buffer.from(expected.executionId))) {
    return { status: "failed", reason: "Verification failed: substituted execution id" };
  }

  const ixAmount = ix.data.readBigUInt64LE(33);
  if (ixAmount !== expected.amountBase) {
    return { status: "failed", reason: "Verification failed: substituted amount" };
  }

  const ixVersion = ix.data.readBigUInt64LE(41);
  if (ixVersion !== expected.policyVersion) {
    return { status: "failed", reason: "Verification failed: substituted policy version" };
  }

  if (ix.keys.length !== 9) {
    return { status: "failed", reason: "Verification failed: unexpected account count" };
  }

  if (expected.agentKey) {
    const expectedAgent = new PublicKey(expected.agentKey);
    if (!ix.keys[0]?.equals(expectedAgent)) {
      return { status: "failed", reason: "Verification failed: substituted agent account" };
    }
  }

  if (!ix.keys[1]?.equals(expected.vault)) {
    return { status: "failed", reason: "Verification failed: substituted vault account" };
  }

  const expectedAuthority = vaultAuthority(expected.vault);
  if (!ix.keys[2]?.equals(expectedAuthority)) {
    return { status: "failed", reason: "Verification failed: substituted authority account" };
  }

  const expectedVaultToken = vaultTokenAccount(expected.vault, expected.mint);
  if (!ix.keys[3]?.equals(expectedVaultToken)) {
    return { status: "failed", reason: "Verification failed: substituted vault token account" };
  }

  const expectedRecipientToken = tokenAccount(expected.recipient, expected.mint);
  if (!ix.keys[4]?.equals(expectedRecipientToken)) {
    return { status: "failed", reason: "Verification failed: substituted recipient token account" };
  }

  if (!ix.keys[5]?.equals(new PublicKey(expected.mint))) {
    return { status: "failed", reason: "Verification failed: substituted mint account" };
  }

  if (!ix.keys[6]?.equals(TOKEN_PROGRAM_ID)) {
    return { status: "failed", reason: "Verification failed: substituted token program account" };
  }

  const systemProgram = new PublicKey("11111111111111111111111111111111");
  if (!ix.keys[7]?.equals(systemProgram)) {
    return { status: "failed", reason: "Verification failed: substituted system program account" };
  }

  const expectedReceiptPDA = receiptAddress(expected.vault, expected.executionId);
  if (!ix.keys[8]?.equals(expectedReceiptPDA)) {
    return { status: "failed", reason: "Verification failed: substituted receipt address" };
  }

  // Receipt PDA on-chain verification
  let receiptAccount: AccountInfo<Buffer> | null = null;
  try {
    receiptAccount = await rpc.getAccountInfo(expectedReceiptPDA, "confirmed");
  } catch {
    return { status: "unresolved", reason: "rpc_unavailable" };
  }

  if (!receiptAccount) {
    return { status: "unresolved", reason: "receipt_not_found_yet" };
  }
  let receipt: ReceiptState;
  try {
    receipt = decodeReceipt(expectedReceiptPDA, receiptAccount.data, receiptAccount.owner);
  } catch {
    return { status: "failed", reason: "Verification failed: invalid receipt PDA data" };
  }

  if (expected.agentKey && receipt.executionKey !== expected.agentKey) {
    return { status: "failed", reason: "Verification failed: receipt executionKey mismatch" };
  }
  if (receipt.recipient !== expected.recipient) {
    return { status: "failed", reason: "Verification failed: receipt recipient mismatch" };
  }
  if (receipt.amountBase !== expected.amountBase) {
    return { status: "failed", reason: "Verification failed: receipt amount mismatch" };
  }
  if (receipt.policyVersion !== expected.policyVersion) {
    return { status: "failed", reason: "Verification failed: receipt policy version mismatch" };
  }
  if (receipt.mint !== expected.mint) {
    return { status: "failed", reason: "Verification failed: receipt mint mismatch" };
  }
  return {
    status: "confirmed",
    slot: tx.slot ?? 0,
    verifiedAt: new Date().toISOString(),
  };
}

export type DirectExecutionRecord = {
  source: "publik" | "direct_chain";
  request_id: string | null;
  signature: string;
  execution_id: string;
  amount_base: string;
  recipient: string;
  policy_version: string;
  executed_at: string;
  slot: number;
  status: "confirmed";
  reason: string | null;
};

export async function discoverDirectChainExecutions(
  rpc: ChainRpc,
  vaultPubkey: PublicKey,
  getMatchingRequest: (executionId: string) => { id: string; reason: string | null } | null,
): Promise<DirectExecutionRecord[]> {
  let sigs: Array<{ signature: string; err: unknown; slot: number }>;
  try {
    sigs = await rpc.getSignaturesForAddress(vaultPubkey, { limit: 100 }, "confirmed");
  } catch {
    return [];
  }

  const results: DirectExecutionRecord[] = [];
  for (const sigInfo of sigs) {
    if (sigInfo.err) continue;
    let tx: { slot?: number; meta?: { err?: unknown } } | null = null;
    try {
      tx = (await rpc.getTransaction(sigInfo.signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" })) as typeof tx;
    } catch {
      continue;
    }
    if (!tx || tx.meta?.err) continue;
    const instructions = extractInstructions(tx);
    for (const ix of instructions) {
      if (!ix.programId.equals(VAULT_PROGRAM_ID) || ix.data.length !== 49 || ix.data[0] !== Ix.execute) {
        continue;
      }
      if (ix.keys.length < 2 || !ix.keys[1]?.equals(vaultPubkey)) {
        continue;
      }

      const executionIdBytes = Uint8Array.from(ix.data.subarray(1, 33));
      const executionIdBase58 = new PublicKey(executionIdBytes).toBase58();
      const receiptPDA = receiptAddress(vaultPubkey, executionIdBytes);

      let receiptAcc: AccountInfo<Buffer> | null = null;
      try {
        receiptAcc = await rpc.getAccountInfo(receiptPDA, "confirmed");
      } catch {
        continue;
      }
      if (!receiptAcc) continue;

      let receipt: ReceiptState;
      try {
        receipt = decodeReceipt(receiptPDA, receiptAcc.data, receiptAcc.owner);
      } catch {
        continue;
      }

      const matching = getMatchingRequest(executionIdBase58);
      if (matching) {
        results.push({
          source: "publik",
          request_id: matching.id,
          signature: sigInfo.signature,
          execution_id: executionIdBase58,
          amount_base: receipt.amountBase.toString(),
          recipient: receipt.recipient,
          policy_version: receipt.policyVersion.toString(),
          executed_at: receipt.executedAt.toString(),
          slot: tx.slot ?? sigInfo.slot,
          status: "confirmed",
          reason: matching.reason ?? null,
        });
      } else {
        results.push({
          source: "direct_chain",
          request_id: null,
          signature: sigInfo.signature,
          execution_id: executionIdBase58,
          amount_base: receipt.amountBase.toString(),
          recipient: receipt.recipient,
          policy_version: receipt.policyVersion.toString(),
          executed_at: receipt.executedAt.toString(),
          slot: tx.slot ?? sigInfo.slot,
          status: "confirmed",
          reason: null, // never invent a reason
        });
      }
    }
  }

  return results;
}

export type ChainProof = { ok: true } | { ok: false; code: string; message: string; retryable: boolean };

export type OwnerTransferExpected = { signature: string; mint: string; amountBase: string; recipient: string; owner: string };

type ParsedTokenInstruction = { program?: string; parsed?: { type?: string; info?: Record<string, unknown> } };

/**
 * Confirms an owner-signed payment from the chain itself: the transaction succeeded and moved exactly
 * `amountBase` of `mint` into the recipient's associated token account, with the owner as authority.
 * A missing transaction is retryable; it is not evidence that the payment failed.
 */
export async function verifyOwnerTransfer(
  rpc: { getParsedTransaction(signature: string, config: { commitment: "confirmed"; maxSupportedTransactionVersion: 0 }): Promise<ParsedTransactionWithMeta | null> },
  expected: OwnerTransferExpected,
): Promise<ChainProof> {
  let tx: ParsedTransactionWithMeta | null;
  try {
    tx = await rpc.getParsedTransaction(expected.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  } catch {
    return { ok: false, code: "RPC_UNAVAILABLE", message: "The RPC did not answer. Recheck the signature.", retryable: true };
  }
  if (!tx) return { ok: false, code: "TX_NOT_FOUND", message: "The transaction is not confirmed yet. Recheck the signature.", retryable: true };
  if (tx.meta?.err) return { ok: false, code: "TX_FAILED", message: "The transaction failed on chain. Nothing was paid.", retryable: false };
  const destination = getAssociatedTokenAddressSync(new PublicKey(expected.mint), new PublicKey(expected.recipient), true, TOKEN_PROGRAM_ID).toBase58();
  const instructions = [
    ...tx.transaction.message.instructions,
    ...(tx.meta?.innerInstructions ?? []).flatMap((inner) => inner.instructions),
  ] as ParsedTokenInstruction[];
  const matched = instructions.some((ix) => {
    if (ix.program !== "spl-token" || !ix.parsed?.info) return false;
    const { type, info } = ix.parsed;
    if (info.destination !== destination || info.authority !== expected.owner) return false;
    if (type === "transferChecked") {
      const amount = (info.tokenAmount as { amount?: string } | undefined)?.amount;
      return info.mint === expected.mint && amount === expected.amountBase;
    }
    return type === "transfer" && info.amount === expected.amountBase;
  });
  if (!matched) {
    return { ok: false, code: "TRANSFER_MISMATCH", message: "The transaction does not pay this request's amount to its recipient from the signed-in wallet.", retryable: false };
  }
  return { ok: true };
}
