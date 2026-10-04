import { createAssociatedTokenAccountIdempotentInstruction } from "@solana/spl-token";
import { PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";

/** Publik vault program. Devnet only in the first release. */
export const VAULT_PROGRAM_ID = new PublicKey("4Z9q35j8kamid7FECpF3kcU4bgtd7gYxAXg24MRHkzXx");
export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const SYSTEM_PROGRAM_ID = new PublicKey("11111111111111111111111111111111");

export const MAX_RECIPIENTS = 8;
export const VAULT_LEN = 216 + 32 * MAX_RECIPIENTS;
export const RECEIPT_LEN = 128;
export const MINT_DECIMALS = 6;
export const DAY_SECONDS = 86_400;

export const Ix = {
  initialize: 0,
  configure: 1,
  setPaused: 2,
  rotate: 3,
  revoke: 4,
  execute: 5,
  withdraw: 6,
} as const;

/** Custom error codes returned by the program, in `PolicyError` order. */
export const VAULT_ERRORS = [
  "Unauthorized signer",
  "Delegation paused",
  "Delegation revoked",
  "Policy not active yet",
  "Policy expired",
  "Zero amount",
  "Over the per-payment limit",
  "Over the daily limit",
  "Over the lifetime limit",
  "Vault balance too low",
  "Recipient not on the allowlist",
  "Stale policy version",
  "Arithmetic overflow",
  "Too many recipients",
  "Invalid policy",
] as const;

export function vaultErrorMessage(code: number): string {
  return VAULT_ERRORS[code] ?? `Program error ${code}`;
}

export function vaultAddress(owner: string | PublicKey, vaultId: Uint8Array): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), new PublicKey(owner).toBuffer(), Buffer.from(id32(vaultId))],
    VAULT_PROGRAM_ID,
  )[0];
}

export function vaultAuthority(vault: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("authority"), vault.toBuffer()], VAULT_PROGRAM_ID)[0];
}

export function receiptAddress(vault: PublicKey, executionId: Uint8Array): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("receipt"), vault.toBuffer(), Buffer.from(id32(executionId))],
    VAULT_PROGRAM_ID,
  )[0];
}

/** Canonical legacy-token associated account. */
export function tokenAccount(wallet: string | PublicKey, mint: string | PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [new PublicKey(wallet).toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), new PublicKey(mint).toBuffer()],
    ATA_PROGRAM_ID,
  )[0];
}

export function vaultTokenAccount(vault: PublicKey, mint: string | PublicKey): PublicKey {
  return tokenAccount(vaultAuthority(vault), mint);
}

function id32(bytes: Uint8Array): Uint8Array {
  if (bytes.length !== 32) throw new Error("id must be 32 bytes");
  return bytes;
}

function u64(value: bigint): Buffer {
  if (value < 0n || value > 0xffffffffffffffffn) throw new Error("amount out of range");
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(value);
  return out;
}

function i64(value: bigint): Buffer {
  const out = Buffer.alloc(8);
  out.writeBigInt64LE(value);
  return out;
}

function recipientList(recipients: string[]): Buffer {
  if (recipients.length > MAX_RECIPIENTS) throw new Error(`At most ${MAX_RECIPIENTS} recipients`);
  const keys = recipients.map((item) => new PublicKey(item));
  if (new Set(keys.map((key) => key.toBase58())).size !== keys.length) throw new Error("duplicate recipient");
  return Buffer.concat([Buffer.from([keys.length]), ...keys.map((key) => key.toBuffer())]);
}

export type PolicyLimits = { perBase: bigint; dailyBase: bigint; lifetimeBase: bigint };

function limits(input: PolicyLimits): Buffer {
  if (input.perBase <= 0n || input.dailyBase <= 0n || input.lifetimeBase <= 0n) throw new Error("limits must be positive");
  return Buffer.concat([u64(input.perBase), u64(input.dailyBase), u64(input.lifetimeBase)]);
}

/**
 * Owner signs. Creates the vault token account (if missing) and the vault state in one transaction.
 * The token account is owned by the program authority PDA, never by the agent.
 */
export function initializeVaultInstructions(input: PolicyLimits & {
  owner: string;
  vaultId: Uint8Array;
  executionKey: string;
  mint: string;
  startTs: bigint;
  expiryTs: bigint;
  recipients: string[];
}): TransactionInstruction[] {
  if (input.expiryTs <= input.startTs) throw new Error("expiry must be after start");
  if (input.executionKey === input.owner) throw new Error("the execution key must not be the owner wallet");
  const owner = new PublicKey(input.owner);
  const mint = new PublicKey(input.mint);
  const vault = vaultAddress(owner, input.vaultId);
  const authority = vaultAuthority(vault);
  const vaultToken = tokenAccount(authority, mint);
  const data = Buffer.concat([
    Buffer.from([Ix.initialize]),
    Buffer.from(id32(input.vaultId)),
    new PublicKey(input.executionKey).toBuffer(),
    limits(input),
    i64(input.startTs),
    i64(input.expiryTs),
    recipientList(input.recipients),
  ]);
  return [
    createAssociatedTokenAccountIdempotentInstruction(owner, vaultToken, authority, mint, TOKEN_PROGRAM_ID, ATA_PROGRAM_ID),
    new TransactionInstruction({
      programId: VAULT_PROGRAM_ID,
      keys: [
        { pubkey: owner, isSigner: true, isWritable: true },
        { pubkey: vault, isSigner: false, isWritable: true },
        { pubkey: authority, isSigner: false, isWritable: false },
        { pubkey: vaultToken, isSigner: false, isWritable: false },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data,
    }),
  ];
}

function ownerEdit(owner: PublicKey, vault: PublicKey, data: Buffer): TransactionInstruction {
  return new TransactionInstruction({
    programId: VAULT_PROGRAM_ID,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
    ],
    data,
  });
}

export type VaultRef = { owner: string; vaultId: Uint8Array };

/** Owner signs. Replaces limits and allowlist. Spend counters are not reset. */
export function configurePolicyInstruction(input: VaultRef & PolicyLimits & { expectedVersion: bigint; recipients: string[] }): TransactionInstruction {
  const owner = new PublicKey(input.owner);
  return ownerEdit(owner, vaultAddress(owner, input.vaultId), Buffer.concat([
    Buffer.from([Ix.configure]), u64(input.expectedVersion), limits(input), recipientList(input.recipients),
  ]));
}

export function setPausedInstruction(input: VaultRef & { expectedVersion: bigint; paused: boolean }): TransactionInstruction {
  const owner = new PublicKey(input.owner);
  return ownerEdit(owner, vaultAddress(owner, input.vaultId), Buffer.concat([
    Buffer.from([Ix.setPaused]), u64(input.expectedVersion), Buffer.from([input.paused ? 1 : 0]),
  ]));
}

export function rotateExecutionKeyInstruction(input: VaultRef & { expectedVersion: bigint; executionKey: string }): TransactionInstruction {
  if (input.executionKey === input.owner) throw new Error("the execution key must not be the owner wallet");
  const owner = new PublicKey(input.owner);
  return ownerEdit(owner, vaultAddress(owner, input.vaultId), Buffer.concat([
    Buffer.from([Ix.rotate]), u64(input.expectedVersion), new PublicKey(input.executionKey).toBuffer(),
  ]));
}

/** Terminal. A revoked vault cannot be re-enabled; the owner can still withdraw. */
export function revokeDelegationInstruction(input: VaultRef & { expectedVersion: bigint }): TransactionInstruction {
  const owner = new PublicKey(input.owner);
  return ownerEdit(owner, vaultAddress(owner, input.vaultId), Buffer.concat([Buffer.from([Ix.revoke]), u64(input.expectedVersion)]));
}

/** Owner signs. Works while paused or revoked. Destination defaults to the owner's own token account. */
export function withdrawOwnerFundsInstruction(input: VaultRef & { mint: string; amountBase: bigint; destination?: string }): TransactionInstruction {
  if (input.amountBase <= 0n) throw new Error("amount must be positive");
  const owner = new PublicKey(input.owner);
  const mint = new PublicKey(input.mint);
  const vault = vaultAddress(owner, input.vaultId);
  const authority = vaultAuthority(vault);
  return new TransactionInstruction({
    programId: VAULT_PROGRAM_ID,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: false },
      { pubkey: authority, isSigner: false, isWritable: false },
      { pubkey: tokenAccount(authority, mint), isSigner: false, isWritable: true },
      { pubkey: input.destination ? new PublicKey(input.destination) : tokenAccount(owner, mint), isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from([Ix.withdraw]), u64(input.amountBase)]),
  });
}

export type ExecuteInput = VaultRef & {
  agent: string;
  executionId: Uint8Array;
  mint: string;
  recipient: string;
  amountBase: bigint;
  policyVersion: bigint;
};

function executeKeys(input: ExecuteInput) {
  const agent = new PublicKey(input.agent);
  const mint = new PublicKey(input.mint);
  const vault = vaultAddress(input.owner, input.vaultId);
  const authority = vaultAuthority(vault);
  return [
    { pubkey: agent, isSigner: true, isWritable: true },
    { pubkey: vault, isSigner: false, isWritable: true },
    { pubkey: authority, isSigner: false, isWritable: false },
    { pubkey: tokenAccount(authority, mint), isSigner: false, isWritable: true },
    { pubkey: tokenAccount(input.recipient, mint), isSigner: false, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: receiptAddress(vault, input.executionId), isSigner: false, isWritable: true },
  ];
}

function executeData(input: ExecuteInput): Buffer {
  if (input.amountBase <= 0n) throw new Error("amount must be positive");
  return Buffer.concat([Buffer.from([Ix.execute]), Buffer.from(id32(input.executionId)), u64(input.amountBase), u64(input.policyVersion)]);
}

/** The agent execution key signs this and pays fee plus receipt rent. Never the owner, never Publik. */
export function executePaymentInstruction(input: ExecuteInput): TransactionInstruction {
  return new TransactionInstruction({ programId: VAULT_PROGRAM_ID, keys: executeKeys(input), data: executeData(input) });
}

export function buildExecutePayment(input: ExecuteInput & { blockhash: string }): Transaction {
  const tx = new Transaction({ feePayer: new PublicKey(input.agent), recentBlockhash: input.blockhash });
  tx.add(executePaymentInstruction(input));
  return tx;
}

/**
 * Checks a transaction before the execution key signs it. Rejects extra instructions, a different
 * fee payer, substituted accounts, changed signer/writable flags, and any data byte that differs.
 */
export function assertExecutePayment(tx: Transaction, input: ExecuteInput): void {
  const ix = tx.instructions[0];
  if (tx.instructions.length !== 1 || !ix || !ix.programId.equals(VAULT_PROGRAM_ID) || ix.data[0] !== Ix.execute) {
    throw new Error("unexpected instruction");
  }
  if (!tx.feePayer?.equals(new PublicKey(input.agent))) throw new Error("unexpected fee payer");
  const expected = executeKeys(input);
  if (ix.keys.length !== expected.length || expected.some((key, index) => {
    const actual = ix.keys[index];
    return !actual || !actual.pubkey.equals(key.pubkey) || actual.isSigner !== key.isSigner || actual.isWritable !== key.isWritable;
  })) {
    throw new Error("substituted account");
  }
  if (!Buffer.from(ix.data).equals(executeData(input))) throw new Error("substituted amount");
}

export type VaultState = {
  address: string;
  owner: string;
  mint: string;
  vaultId: Uint8Array;
  executionKey: string;
  paused: boolean;
  revoked: boolean;
  version: bigint;
  perBase: bigint;
  dailyBase: bigint;
  lifetimeBase: bigint;
  spentTodayBase: bigint;
  lifetimeSpentBase: bigint;
  dayIndex: bigint;
  startTs: bigint;
  expiryTs: bigint;
  recipients: string[];
};

/** Decodes vault state. Throws on anything not written by the Publik program. */
export function decodeVault(address: PublicKey, data: Uint8Array, accountOwner: PublicKey): VaultState {
  const raw = Buffer.from(data);
  if (!accountOwner.equals(VAULT_PROGRAM_ID) || raw.length !== VAULT_LEN || raw.subarray(0, 8).toString() !== "PUBLIKV1") {
    throw new Error("not a Publik vault");
  }
  const key = (at: number) => new PublicKey(raw.subarray(at, at + 32)).toBase58();
  const count = raw[212] ?? 0;
  if (count > MAX_RECIPIENTS) throw new Error("not a Publik vault");
  const state: VaultState = {
    address: address.toBase58(),
    owner: key(8),
    mint: key(40),
    vaultId: new Uint8Array(raw.subarray(72, 104)),
    executionKey: key(104),
    paused: raw[137] === 1,
    revoked: raw[138] === 1,
    version: raw.readBigUInt64LE(140),
    perBase: raw.readBigUInt64LE(148),
    dailyBase: raw.readBigUInt64LE(156),
    lifetimeBase: raw.readBigUInt64LE(164),
    spentTodayBase: raw.readBigUInt64LE(172),
    lifetimeSpentBase: raw.readBigUInt64LE(180),
    dayIndex: raw.readBigInt64LE(188),
    startTs: raw.readBigInt64LE(196),
    expiryTs: raw.readBigInt64LE(204),
    recipients: Array.from({ length: count }, (_, index) => key(216 + index * 32)),
  };
  if (!vaultAddress(state.owner, state.vaultId).equals(address)) throw new Error("vault address does not match its seeds");
  return state;
}

export type ReceiptState = {
  address: string;
  recipient: string;
  amountBase: bigint;
  policyVersion: bigint;
  executedAt: bigint;
  executionKey: string;
  mint: string;
};

export function decodeReceipt(address: PublicKey, data: Uint8Array, accountOwner: PublicKey): ReceiptState {
  const raw = Buffer.from(data);
  if (!accountOwner.equals(VAULT_PROGRAM_ID) || raw.length !== RECEIPT_LEN || raw.subarray(0, 8).toString() !== "RECEIPT1") {
    throw new Error("not a Publik receipt");
  }
  return {
    address: address.toBase58(),
    recipient: new PublicKey(raw.subarray(8, 40)).toBase58(),
    amountBase: raw.readBigUInt64LE(40),
    policyVersion: raw.readBigUInt64LE(48),
    executedAt: raw.readBigInt64LE(56),
    executionKey: new PublicKey(raw.subarray(64, 96)).toBase58(),
    mint: new PublicKey(raw.subarray(96, 128)).toBase58(),
  };
}

export type Allowance = {
  dailyRemainingBase: bigint;
  lifetimeRemainingBase: bigint;
  /** What one execution can move right now: min of per-payment, daily, lifetime, and vault balance. */
  spendableNowBase: bigint;
  blockedBy: "revoked" | "paused" | "not_active" | "expired" | null;
};

/** Mirrors the program's rules. Display only; the program is the enforcement boundary. */
export function allowance(vault: VaultState, nowTs: bigint, vaultBalanceBase: bigint): Allowance {
  const today = nowTs >= 0n ? nowTs / BigInt(DAY_SECONDS) : (nowTs - BigInt(DAY_SECONDS) + 1n) / BigInt(DAY_SECONDS);
  const spentToday = today === vault.dayIndex ? vault.spentTodayBase : 0n;
  const dailyRemainingBase = vault.dailyBase > spentToday ? vault.dailyBase - spentToday : 0n;
  const lifetimeRemainingBase = vault.lifetimeBase > vault.lifetimeSpentBase ? vault.lifetimeBase - vault.lifetimeSpentBase : 0n;
  const blockedBy = vault.revoked ? "revoked" : vault.paused ? "paused" : nowTs < vault.startTs ? "not_active" : nowTs >= vault.expiryTs ? "expired" : null;
  const spendable = [vault.perBase, dailyRemainingBase, lifetimeRemainingBase, vaultBalanceBase].reduce((min, value) => (value < min ? value : min));
  return { dailyRemainingBase, lifetimeRemainingBase, spendableNowBase: blockedBy ? 0n : spendable, blockedBy };
}

/** Parses `custom program error: 0x6` style failures from logs or simulation errors. */
export function vaultErrorCode(error: unknown): number | null {
  const parts: string[] = [];
  if (typeof error === "string") parts.push(error);
  if (error instanceof Error) {
    parts.push(error.message);
    if ("logs" in error) {
      const logs = error.logs;
      if (Array.isArray(logs)) {
        for (const item of logs) {
          if (typeof item === "string") parts.push(item);
        }
      }
    }
  }
  try {
    parts.push(JSON.stringify(error, (_key, value) => (typeof value === "bigint" ? value.toString() : value)) ?? "");
  } catch {
    // Ignore serialization issues
  }
  const text = parts.join(" ");
  const custom =
    /"Custom":\s*(\d+)/.exec(text) ??
    /custom program error: 0x([0-9a-f]+)/i.exec(text) ??
    /InstructionError:\s*\[\s*\d+\s*,\s*\{\s*"Custom":\s*(\d+)\s*\}\s*\]/.exec(text);
  if (!custom?.[1]) return null;
  return custom[0].includes("Custom") ? Number(custom[1]) : Number.parseInt(custom[1], 16);
}
