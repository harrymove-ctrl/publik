import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  vaultAddress,
  vaultAuthority,
  receiptAddress,
  vaultTokenAccount,
  decodeVault,
  decodeReceipt,
  allowance,
  buildExecutePayment,
  assertExecutePayment,
  type ReceiptState,
  VAULT_PROGRAM_ID,
} from "../src/solana/vault";
import { loadAgentKey, getPendingExecution, savePendingExecution, clearPendingExecution } from "./key";
import { maySignDelegated } from "./gate";

export type ExecutePaymentOptions = {
  to: string;
  amountDecimal: string;
  keyName?: string;
  executionId?: string;
  origin: string;
  token: string;
  rpcUrl?: string;
  keyDir?: string;
  skipPreflight?: boolean;
  bypassApiPreflight?: boolean;
  connection?: Connection;
  log?: (msg: string) => void;
};

export type ExecuteResult =
  | { status: "confirmed"; signature: string; requestId: string; executionId: string; slot?: number }
  | { status: "already_confirmed"; receipt: ReceiptState; executionId: string }
  | { status: "failed"; reason: string; signature?: string; requestId: string; executionId: string }
  | { status: "blocked"; reason: string; executionId: string }
  | { status: "unresolved"; signature: string; requestId: string; executionId: string };

export function parseBaseUnits(amount: string): bigint {
  if (!/^\d+(\.\d{1,6})?$/.test(amount)) {
    throw new Error("Amount must be a positive decimal with at most 6 decimal places.");
  }
  const [whole, frac = ""] = amount.split(".");
  const base = BigInt(whole) * 1_000_000n + BigInt((frac + "000000").slice(0, 6));
  if (base <= 0n) throw new Error("Amount must be greater than zero.");
  return base;
}

export async function executeDelegatedPayment(options: ExecutePaymentOptions): Promise<ExecuteResult> {
  const log = options.log ?? ((msg: string) => console.log(msg));
  const amountBase = parseBaseUnits(options.amountDecimal);

  // Validate recipient address
  let recipientKey: PublicKey;
  try {
    recipientKey = new PublicKey(options.to);
  } catch {
    throw new Error(`Invalid recipient Solana address: ${options.to}`);
  }
  const to = recipientKey.toBase58();

  // 1. Read delegation state from API
  const delRes = await fetch(`${options.origin}/api/v1/agent/delegation`, {
    headers: { authorization: `Bearer ${options.token}` },
  });
  if (!delRes.ok) {
    throw new Error(`Failed to read delegation from API (${delRes.status}): ${await delRes.text()}`);
  }
  const delData = (await delRes.json()) as {
    mode: string;
    deployed: boolean;
    network: string;
    vault: {
      address: string;
      owner: string;
      vault_id_hex: string;
      mint: string;
      execution_key: string;
      version: string;
    } | null;
    transaction?: unknown;
    note?: string;
  };

  if (!delData.vault) {
    throw new Error(`Agent is not configured for delegated payments: ${delData.note ?? "no vault linked"}`);
  }
  const network = delData.network ?? "solana-devnet";
  const { owner, vault_id_hex: vaultIdHex, mint } = delData.vault;
  // 2. Connect to chain RPC
  const rpcEndpoint =
    options.rpcUrl ??
    (network === "solana-localnet"
      ? (process.env.PUBLIK_SOLANA_RPC_URL ?? "http://127.0.0.1:8899")
      : (process.env.PUBLIK_SOLANA_RPC_URL ?? "https://api.devnet.solana.com"));
  const connection = options.connection ?? new Connection(rpcEndpoint, "confirmed");

  // 3. Load agent execution key
  const keyDir = options.keyDir ?? process.env.PUBLIK_KEY_DIR ?? join(homedir(), ".publik", "keys");
  const keyName = options.keyName ?? "agent";
  const { keypair, publicKey, stateFile } = loadAgentKey(keyDir, keyName, { origin: options.origin, network });

  if (publicKey === owner) {
    throw new Error("Execution key must not be the vault owner wallet.");
  }

  // 4. Verify vault ref against chain
  const vaultIdBytes = Buffer.from(vaultIdHex, "hex");
  const vaultPubkey = vaultAddress(owner, vaultIdBytes);
  if (vaultPubkey.toBase58() !== delData.vault.address) {
    throw new Error("Vault address mismatch between seeds and API response.");
  }

  const vaultAccount = await connection.getAccountInfo(vaultPubkey, "confirmed");
  if (!vaultAccount) {
    throw new Error("Vault account does not exist on-chain.");
  }
  const vaultState = decodeVault(vaultPubkey, vaultAccount.data, vaultAccount.owner);

  if (!options.skipPreflight) {
    if (vaultState.executionKey !== publicKey) {
      throw new Error(
        `On-chain vault execution key (${vaultState.executionKey}) does not match local execution key (${publicKey}).`,
      );
    }
    if (vaultState.owner === publicKey) {
      throw new Error("Execution key must not be the vault owner.");
    }
  }

  // 5. Validate intent locally
  const vaultToken = vaultTokenAccount(vaultPubkey, new PublicKey(mint));
  let balanceBase = 0n;
  try {
    const b = await connection.getTokenAccountBalance(vaultToken);
    balanceBase = BigInt(b.value.amount);
  } catch {
    // 0 balance
  }

  const slot = await connection.getSlot("confirmed");
  let blockTime = BigInt(Math.floor(Date.now() / 1000));
  try {
    const bt = await connection.getBlockTime(slot);
    if (bt !== null && bt !== undefined) blockTime = BigInt(bt);
  } catch {
    // fallback
  }

  const allow = allowance(vaultState, blockTime, balanceBase);

  if (!options.skipPreflight) {
    if (vaultState.revoked) throw new Error("Vault delegation has been permanently revoked on-chain.");
    if (vaultState.paused) throw new Error("Vault delegation is paused by the owner on-chain.");
    if (blockTime < vaultState.startTs) throw new Error("Vault policy is not active yet.");
    if (blockTime >= vaultState.expiryTs) throw new Error("Vault policy has expired.");
    if (!vaultState.recipients.includes(to)) {
      throw new Error(`Recipient ${to} is not on the on-chain allowlist.`);
    }

    if (!options.bypassApiPreflight) {
      if (amountBase > vaultState.perBase) {
        throw new Error(`Amount (${amountBase}) exceeds on-chain per-payment limit (${vaultState.perBase}).`);
      }
      if (amountBase > allow.dailyRemainingBase) {
        throw new Error(`Amount (${amountBase}) exceeds on-chain daily remaining limit (${allow.dailyRemainingBase}).`);
      }
      if (amountBase > allow.lifetimeRemainingBase) {
        throw new Error(`Amount (${amountBase}) exceeds on-chain lifetime remaining limit (${allow.lifetimeRemainingBase}).`);
      }
      if (amountBase > balanceBase) {
        throw new Error(`Amount (${amountBase}) exceeds current vault token balance (${balanceBase}).`);
      }
    }
  }

  // 6. Execution id. Reusing an id is always safe: the receipt PDA lets it pay at most once.
  //    Minting a new id while an earlier transaction may still land could pay twice, so refuse that.
  let executionId = options.executionId;
  const pending = getPendingExecution(stateFile);
  if (pending && pending.executionId !== executionId) {
    const sameIntent = pending.recipient === to && pending.amountBase === amountBase.toString();
    const pendingReceipt = await connection.getAccountInfo(receiptAddress(vaultPubkey, new PublicKey(pending.executionId).toBytes()), "confirmed");
    const height = await connection.getBlockHeight("confirmed");
    const expired = pending.lastValidBlockHeight === undefined || height > pending.lastValidBlockHeight;
    if (pendingReceipt) {
      clearPendingExecution(stateFile);
      // Same payment already landed: keep its id so step 7 reports it instead of paying again.
      if (sameIntent && !executionId) executionId = pending.executionId;
    } else if (sameIntent && !executionId) {
      executionId = pending.executionId;
      log(`Reusing pending execution ID: ${executionId}`);
    } else if (!expired) {
      throw new Error(
        `Execution ${pending.executionId} may still land until block height ${pending.lastValidBlockHeight}. ` +
          `Retry the same payment or run "payment status" before starting a different one.`,
      );
    } else {
      clearPendingExecution(stateFile);
    }
  }
  if (!executionId) executionId = new PublicKey(randomBytes(32)).toBase58();
  savePendingExecution(stateFile, {
    executionId,
    recipient: to,
    amountBase: amountBase.toString(),
    createdAt: new Date().toISOString(),
  });

  const executionIdBytes = new PublicKey(executionId).toBytes();

  // 7. Check whether receipt PDA already exists on-chain before rebuilding/sending
  const receiptPDA = receiptAddress(vaultPubkey, executionIdBytes);
  const existingReceiptAcc = await connection.getAccountInfo(receiptPDA, "confirmed");
  if (existingReceiptAcc) {
    const dec = decodeReceipt(receiptPDA, existingReceiptAcc.data, existingReceiptAcc.owner);
    clearPendingExecution(stateFile);
    log(`Payment already executed and confirmed on-chain at receipt: ${receiptPDA.toBase58()}`);
    return { status: "already_confirmed", receipt: dec, executionId };
  }

  // 8. Create / retrieve the idempotent delegated payment request. `--bypass-api-preflight` still
  //    registers the request (so the attempt reconciles) but sends even when preflight says blocked,
  //    which is how an on-chain rejection is demonstrated.
  const reqRes = await fetch(`${options.origin}/api/v1/delegated-payment-requests`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${options.token}`,
      "content-type": "application/json",
      "idempotency-key": `exec_${executionId}`,
    },
    body: JSON.stringify({
      network,
      mint,
      amount_base: amountBase.toString(),
      recipient: to,
      execution_id: executionId,
      policy_version: vaultState.version.toString(),
    }),
  });
  const reqData = (await reqRes.json()) as { request_id: string; status: string; reason?: string | null };
  if (reqData.status === "blocked" && !options.bypassApiPreflight) {
    clearPendingExecution(stateFile);
    log(`API preflight blocked request: ${reqData.reason ?? "unknown"}`);
    return { status: "blocked", reason: reqData.reason ?? "preflight_blocked", executionId };
  }
  const requestId = reqData.request_id;

  // 9. Build transaction locally (never sign server-provided transaction)
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const executeInput = {
    owner,
    vaultId: vaultState.vaultId,
    agent: publicKey,
    executionId: executionIdBytes,
    mint,
    recipient: to,
    amountBase,
    policyVersion: vaultState.version,
    blockhash,
  };
  const tx = buildExecutePayment(executeInput);

  // 10. assertExecutePayment strict pre-sign check
  assertExecutePayment(tx, executeInput);
  // Persist the expiry height before signing so a crash after send still knows when the attempt is dead.
  savePendingExecution(stateFile, {
    executionId,
    recipient: to,
    amountBase: amountBase.toString(),
    createdAt: new Date().toISOString(),
    lastValidBlockHeight,
  });

  // 11. Final gate on chain-verified state, then sign with the local execution key file.
  const program = await connection.getAccountInfo(VAULT_PROGRAM_ID, "confirmed");
  const signable = maySignDelegated({
    deployed: program?.executable === true,
    transaction: delData.transaction,
    chainVerified: true,
    vault: options.skipPreflight
      ? undefined
      : { paused: vaultState.paused, revoked: vaultState.revoked, executionKey: vaultState.executionKey, owner: vaultState.owner, recipients: vaultState.recipients },
    agentKey: publicKey,
    recipient: to,
  });
  if (!signable) {
    clearPendingExecution(stateFile);
    throw new Error("Refusing to sign: the program is not deployed on this cluster, the API returned a transaction, or the chain state does not allow this key.");
  }
  tx.sign(keypair);

  // 12. Send raw transaction
  let signature: string;
  try {
    signature = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: options.skipPreflight ?? false,
    });
    log(`Transaction sent: ${signature}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`Failed to send transaction: ${msg}`);
    throw err;
  }

  // 13. POST attempt with signature and blockhash info
  try {
    await fetch(`${options.origin}/api/v1/delegated-payment-requests/${requestId}/attempts`, {
      method: "POST",
      headers: { authorization: `Bearer ${options.token}`, "content-type": "application/json" },
      body: JSON.stringify({
        signature,
        blockhash,
        last_valid_block_height: lastValidBlockHeight,
      }),
    });
  } catch (err) {
    log(`Warning: Failed to record attempt with API: ${err}`);
  }

  // 14. Poll reconcile until terminal state or timeout
  for (let i = 0; i < 30; i++) {
    await Bun.sleep(1000);
    try {
      const pollRes = await fetch(`${options.origin}/api/v1/delegated-payment-requests/${requestId}`, {
        headers: { authorization: `Bearer ${options.token}` },
      });
      if (pollRes.ok) {
        const pollData = (await pollRes.json()) as {
          status: string;
          reason?: string | null;
          attempts?: Array<{ signature: string; status: string; reason?: string | null; slot?: number }>;
        };
        if (pollData.status === "confirmed") {
          clearPendingExecution(stateFile);
          log(`Payment confirmed! Signature: ${signature}`);
          return { status: "confirmed", signature, requestId, executionId, slot: pollData.attempts?.[0]?.slot };
        }
        if (pollData.status === "failed") {
          clearPendingExecution(stateFile);
          log(`Payment failed on-chain: ${pollData.reason}`);
          return { status: "failed", reason: pollData.reason ?? "failed", signature, requestId, executionId };
        }
      }
    } catch {
      // keep polling
    }
  }

  log(`Confirmation pending for signature ${signature}. Execution state retained in ${stateFile}.`);
  return { status: "unresolved", signature, requestId, executionId };
}
