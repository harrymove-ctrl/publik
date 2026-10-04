import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { Keypair, PublicKey, type AccountInfo, type SignatureStatus } from "@solana/web3.js";
import nacl from "tweetnacl";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "./app";
import type { ChainRpc } from "./chain";
import {
  VAULT_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  Ix,
  VAULT_LEN,
  RECEIPT_LEN,
  vaultAddress,
  vaultAuthority,
  receiptAddress,
  tokenAccount,
  vaultTokenAccount,
} from "../src/solana/vault";

const origin = "http://127.0.0.1:5173";
const mint = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const recipient = Keypair.generate().publicKey.toBase58();

function app(file: string, chainRpc?: ChainRpc) {
  return createApp({ dbPath: file, publicOrigin: origin, apiOrigin: origin, chainRpc });
}

async function owner(file: string, chainRpc?: ChainRpc) {
  const api = app(file, chainRpc);
  const wallet = Keypair.generate();
  const challenge = await (await api.handle(new Request(`${origin}/api/v1/owner/challenge`, { method: "POST", body: JSON.stringify({ wallet: wallet.publicKey.toBase58() }) }))).json() as { nonce: string; message: string };
  const signature = Buffer.from(nacl.sign.detached(new TextEncoder().encode(challenge.message), wallet.secretKey)).toString("base64");
  const session = await api.handle(new Request(`${origin}/api/v1/owner/session`, { method: "POST", body: JSON.stringify({ wallet: wallet.publicKey.toBase58(), signature, nonce: challenge.nonce }) }));
  const cookie = session.headers.get("set-cookie")?.split(";")[0] ?? "";
  const body = await session.json() as { csrf: string };
  return { api, cookie, csrf: body.csrf };
}

describe("agent connection API", () => {
  test("pairs an agent, accepts one payment, blocks the next, and survives restart", async () => {
    const dir = mkdtempSync(join(tmpdir(), "publik-"));
    const file = join(dir, "api.sqlite");
    const first = await owner(file);
    const started = await (await first.api.handle(new Request(`${origin}/api/v1/agent-connections`, { method: "POST", body: JSON.stringify({ name: "Alice", description: "Research", client: { name: "test", version: "1" } }) }))).json() as { user_code: string; device_code: string; verification_uri: string };
    expect(started.verification_uri).toBe(`${origin}/connect`);
    const looked = await first.api.handle(new Request(`${origin}/api/v1/owner/agent-connections/lookup`, { method: "POST", headers: { cookie: first.cookie, "x-csrf-token": first.csrf }, body: JSON.stringify({ user_code: started.user_code }) }));
    expect(looked.status).toBe(200);
    const approved = await (await first.api.handle(new Request(`${origin}/api/v1/owner/agent-connections/approve`, { method: "POST", headers: { cookie: first.cookie, "x-csrf-token": first.csrf }, body: JSON.stringify({ user_code: started.user_code }) }))).json() as { agent_id: string };
    const token = await (await first.api.handle(new Request(`${origin}/api/v1/agent-connections/token`, { method: "POST", body: JSON.stringify({ device_code: started.device_code }) }))).json() as { status: string; access_token: string };
    expect(token.status).toBe("authorized");
    const rules = await (await first.api.handle(new Request(`${origin}/api/v1/agent/rules`, { headers: { authorization: `Bearer ${token.access_token}` } }))).json() as { daily_limit_base: string };
    expect(rules.daily_limit_base).toBe("25000000");
    const payment = await first.api.handle(new Request(`${origin}/api/v1/payment-requests`, { method: "POST", headers: { authorization: `Bearer ${token.access_token}`, "idempotency-key": "k1" }, body: JSON.stringify({ network: "solana-devnet", mint, amount: "4.00", recipient, reason: "dataset" }) }));
    expect(payment.status).toBe(201);
    const again = await first.api.handle(new Request(`${origin}/api/v1/payment-requests`, { method: "POST", headers: { authorization: `Bearer ${token.access_token}`, "idempotency-key": "k1" }, body: JSON.stringify({ network: "solana-devnet", mint, amount: "4.00", recipient, reason: "dataset" }) }));
    expect(again.status).toBe(200);
    const conflict = await first.api.handle(new Request(`${origin}/api/v1/payment-requests`, { method: "POST", headers: { authorization: `Bearer ${token.access_token}`, "idempotency-key": "k1" }, body: JSON.stringify({ network: "solana-devnet", mint, amount: "5.00", recipient, reason: "dataset" }) }));
    expect(conflict.status).toBe(409);
    const inbox = await (await first.api.handle(new Request(`${origin}/api/v1/owner/payment-requests`, { headers: { cookie: first.cookie } }))).json() as { requests: { reason: string }[] };
    expect(inbox.requests[0]?.reason).toBe("dataset");
    await first.api.handle(new Request(`${origin}/api/v1/owner/agents/${approved.agent_id}/pause`, { method: "POST", headers: { cookie: first.cookie, "x-csrf-token": first.csrf } }));
    const blocked = await (await first.api.handle(new Request(`${origin}/api/v1/payment-requests`, { method: "POST", headers: { authorization: `Bearer ${token.access_token}`, "idempotency-key": "k2" }, body: JSON.stringify({ network: "solana-devnet", mint, amount: "1.00", recipient, reason: "after pause" }) }))).json() as { status: string };
    expect(blocked.status).toBe("blocked");
    await first.api.handle(new Request(`${origin}/api/v1/owner/agents/${approved.agent_id}/disconnect`, { method: "POST", headers: { cookie: first.cookie, "x-csrf-token": first.csrf } }));
    const denied = await first.api.handle(new Request(`${origin}/api/v1/agent/me`, { headers: { authorization: `Bearer ${token.access_token}` } }));
    expect(denied.status).toBe(401);
    first.api.close();
    const restarted = app(file);
    const skill = await restarted.handle(new Request(`${origin}/skills/publik.md`));
    expect(skill.headers.get("content-type")).toContain("text/markdown");
    const still = new Database(file);
    expect((still.query("SELECT COUNT(*) AS n FROM agents").get() as { n: number }).n).toBe(1);
    still.close();
    restarted.close();
  });

  test("blocks a delegated request and does not fall back to owner-signed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "publik-del-"));
    const file = join(dir, "api.sqlite");
    const mockRpc = new MockChainRpc();
    mockRpc.deployed = false;
    const first = await owner(file, mockRpc);
    const started = await (await first.api.handle(new Request(`${origin}/api/v1/agent-connections`, { method: "POST", body: JSON.stringify({ name: "Alice", description: "Research", client: { name: "test", version: "1" } }) }))).json() as { user_code: string; device_code: string };
    await first.api.handle(new Request(`${origin}/api/v1/owner/agent-connections/approve`, { method: "POST", headers: { cookie: first.cookie, "x-csrf-token": first.csrf }, body: JSON.stringify({ user_code: started.user_code }) }));
    const token = await (await first.api.handle(new Request(`${origin}/api/v1/agent-connections/token`, { method: "POST", body: JSON.stringify({ device_code: started.device_code }) }))).json() as { access_token: string };
    const headers = { authorization: `Bearer ${token.access_token}`, "idempotency-key": "d1", "content-type": "application/json" };
    const body = { network: "solana-devnet", mint, amount_base: "1000000", recipient, execution_id: recipient, policy_version: "1" };
    const created = await first.api.handle(new Request(`${origin}/api/v1/delegated-payment-requests`, { method: "POST", headers, body: JSON.stringify(body) }));
    expect(created.status).toBe(201);
    const saved = await created.json() as { request_id: string; status: string; fallback: boolean; transaction: unknown; execution_id: string };
    expect(saved.status).toBe("blocked");
    expect(saved.fallback).toBe(false);
    expect(saved.transaction).toBeNull();
    expect(saved.execution_id).toBe(recipient);
    const again = await first.api.handle(new Request(`${origin}/api/v1/delegated-payment-requests`, { method: "POST", headers, body: JSON.stringify(body) }));
    expect(again.status).toBe(200);
    const state = await (await first.api.handle(new Request(`${origin}/api/v1/agent/delegation`, { headers: { authorization: `Bearer ${token.access_token}` } }))).json() as { deployed: boolean; mode: string };
    expect(state.deployed).toBe(false);
    expect(state.mode).toBe("owner-signed");
    const attempt = await first.api.handle(new Request(`${origin}/api/v1/delegated-payment-requests/${saved.request_id}/attempts`, { method: "POST", headers: { authorization: `Bearer ${token.access_token}`, "content-type": "application/json" }, body: JSON.stringify({ signature: "3" + "1".repeat(87) }) }));
    expect(attempt.status).toBe(201);
    const recorded = await attempt.json() as { status: string; execution_id: string };
    expect(recorded.status).toBe("unresolved");
    expect(recorded.execution_id).toBe(recipient);
    const db = new Database(file);
    expect((db.query("SELECT COUNT(*) AS n FROM payment_requests").get() as { n: number }).n).toBe(0);
    db.close();
    first.api.close();
  });

  test("transaction verification rejects substituted recipient, amount, program, and extra instructions", async () => {
    const dir = mkdtempSync(join(tmpdir(), "publik-verify-"));
    const file = join(dir, "api.sqlite");

    const mockRpc = new MockChainRpc();
    const ownerWallet = Keypair.generate();
    const agentKey = Keypair.generate();
    const recipKey = Keypair.generate();
    const recip2Key = Keypair.generate();
    const vaultId = new Uint8Array(32).fill(7);
    const vaultIdHex = Buffer.from(vaultId).toString("hex");
    const vaultPubkey = vaultAddress(ownerWallet.publicKey, vaultId);

    // Setup mock on-chain vault
    const vaultBuf = mockVaultBuffer({
      owner: ownerWallet.publicKey.toBase58(),
      mint,
      vaultId,
      executionKey: agentKey.publicKey.toBase58(),
      recipients: [recipKey.publicKey.toBase58()],
      perBase: 5_000_000n,
      dailyBase: 20_000_000n,
      lifetimeBase: 100_000_000n,
      version: 1n,
    });
    mockRpc.accounts.set(vaultPubkey.toBase58(), {
      data: vaultBuf,
      owner: VAULT_PROGRAM_ID,
    });
    const vaultToken = vaultTokenAccount(vaultPubkey, mint);
    mockRpc.tokenBalances.set(vaultToken.toBase58(), "50000000");

    const server = createApp({ dbPath: file, publicOrigin: origin, apiOrigin: origin, chainRpc: mockRpc });

    // Create owner session
    const challenge = await (await server.handle(new Request(`${origin}/api/v1/owner/challenge`, { method: "POST", body: JSON.stringify({ wallet: ownerWallet.publicKey.toBase58() }) }))).json() as { nonce: string; message: string };
    const sig = Buffer.from(nacl.sign.detached(new TextEncoder().encode(challenge.message), ownerWallet.secretKey)).toString("base64");
    const sessionRes = await server.handle(new Request(`${origin}/api/v1/owner/session`, { method: "POST", body: JSON.stringify({ wallet: ownerWallet.publicKey.toBase58(), signature: sig, nonce: challenge.nonce }) }));
    const cookie = sessionRes.headers.get("set-cookie")?.split(";")[0] ?? "";
    const sessionData = await sessionRes.json() as { csrf: string };

    // Pair agent
    const started = await (await server.handle(new Request(`${origin}/api/v1/agent-connections`, { method: "POST", body: JSON.stringify({ name: "Bob", description: "Worker" }) }))).json() as { user_code: string; device_code: string };
    const approved = await (await server.handle(new Request(`${origin}/api/v1/owner/agent-connections/approve`, { method: "POST", headers: { cookie, "x-csrf-token": sessionData.csrf }, body: JSON.stringify({ user_code: started.user_code }) }))).json() as { agent_id: string };
    const token = await (await server.handle(new Request(`${origin}/api/v1/agent-connections/token`, { method: "POST", body: JSON.stringify({ device_code: started.device_code }) }))).json() as { access_token: string };

    // Link vault via PUT
    const linkRes = await server.handle(new Request(`${origin}/api/v1/agents/${approved.agent_id}/delegation`, {
      method: "PUT",
      headers: { cookie, "x-csrf-token": sessionData.csrf, "content-type": "application/json" },
      body: JSON.stringify({
        vault: vaultPubkey.toBase58(),
        owner: ownerWallet.publicKey.toBase58(),
        vault_id_hex: vaultIdHex,
        execution_key: agentKey.publicKey.toBase58(),
        mint,
        network: "solana-devnet",
      }),
    }));
    expect(linkRes.status).toBe(200);
    const linkData = await linkRes.json() as { mode: string; deployed: boolean };
    expect(linkData.mode).toBe("delegated");
    expect(linkData.deployed).toBe(true);

    // Create delegated request -> status: ready
    const execId1 = Keypair.generate().publicKey.toBase58();
    const execId1Bytes = new PublicKey(execId1).toBytes();
    const reqRes = await server.handle(new Request(`${origin}/api/v1/delegated-payment-requests`, {
      method: "POST",
      headers: { authorization: `Bearer ${token.access_token}`, "idempotency-key": "k-v1", "content-type": "application/json" },
      body: JSON.stringify({
        network: "solana-devnet",
        mint,
        amount_base: "1000000",
        recipient: recipKey.publicKey.toBase58(),
        execution_id: execId1,
        policy_version: "1",
      }),
    }));
    expect(reqRes.status).toBe(201);
    const reqData = await reqRes.json() as { request_id: string; status: string };
    expect(reqData.status).toBe("ready");

    // 1. Substituted recipient rejection
    const sigSubRecip = "subRecip" + "1".repeat(80);
    mockRpc.signatureStatuses.set(sigSubRecip, { confirmationStatus: "confirmed", err: null, slot: 101 } as SignatureStatus);
    mockRpc.transactions.set(sigSubRecip, mockExecuteTransaction({
      vault: vaultPubkey,
      executionKey: agentKey.publicKey,
      recipient: recip2Key.publicKey, // substituted recipient ATA!
      mint: new PublicKey(mint),
      amountBase: 1_000_000n,
      executionId: execId1Bytes,
      policyVersion: 1n,
    }));
    const attSubRecip = await server.handle(new Request(`${origin}/api/v1/delegated-payment-requests/${reqData.request_id}/attempts`, {
      method: "POST",
      headers: { authorization: `Bearer ${token.access_token}`, "content-type": "application/json" },
      body: JSON.stringify({ signature: sigSubRecip }),
    }));
    const attSubRecipData = await attSubRecip.json() as { status: string; reason: string };
    expect(attSubRecipData.status).toBe("failed");
    expect(attSubRecipData.reason).toContain("substituted recipient");

    // 2. Substituted amount rejection
    const sigSubAmt = "subAmt" + "1".repeat(82);
    mockRpc.signatureStatuses.set(sigSubAmt, { confirmationStatus: "confirmed", err: null, slot: 102 } as SignatureStatus);
    mockRpc.transactions.set(sigSubAmt, mockExecuteTransaction({
      vault: vaultPubkey,
      executionKey: agentKey.publicKey,
      recipient: recipKey.publicKey,
      mint: new PublicKey(mint),
      amountBase: 2_000_000n, // substituted amount!
      executionId: execId1Bytes,
      policyVersion: 1n,
    }));
    const attSubAmt = await server.handle(new Request(`${origin}/api/v1/delegated-payment-requests/${reqData.request_id}/attempts`, {
      method: "POST",
      headers: { authorization: `Bearer ${token.access_token}`, "content-type": "application/json" },
      body: JSON.stringify({ signature: sigSubAmt }),
    }));
    const attSubAmtData = await attSubAmt.json() as { status: string; reason: string };
    expect(attSubAmtData.status).toBe("failed");
    expect(attSubAmtData.reason).toContain("substituted amount");

    // 3. Substituted program rejection
    const sigSubProg = "subProg" + "1".repeat(81);
    mockRpc.signatureStatuses.set(sigSubProg, { confirmationStatus: "confirmed", err: null, slot: 103 } as SignatureStatus);
    mockRpc.transactions.set(sigSubProg, mockExecuteTransaction({
      programId: Keypair.generate().publicKey, // substituted program!
      vault: vaultPubkey,
      executionKey: agentKey.publicKey,
      recipient: recipKey.publicKey,
      mint: new PublicKey(mint),
      amountBase: 1_000_000n,
      executionId: execId1Bytes,
      policyVersion: 1n,
    }));
    const attSubProg = await server.handle(new Request(`${origin}/api/v1/delegated-payment-requests/${reqData.request_id}/attempts`, {
      method: "POST",
      headers: { authorization: `Bearer ${token.access_token}`, "content-type": "application/json" },
      body: JSON.stringify({ signature: sigSubProg }),
    }));
    const attSubProgData = await attSubProg.json() as { status: string; reason: string };
    expect(attSubProgData.status).toBe("failed");
    expect(attSubProgData.reason).toContain("unexpected program id");

    // 4. Unexpected extra instruction rejection
    const sigExtraIx = "extraix" + "1".repeat(81);
    mockRpc.signatureStatuses.set(sigExtraIx, { confirmationStatus: "confirmed", err: null, slot: 104 } as SignatureStatus);
    mockRpc.transactions.set(sigExtraIx, mockExecuteTransaction({
      vault: vaultPubkey,
      executionKey: agentKey.publicKey,
      recipient: recipKey.publicKey,
      mint: new PublicKey(mint),
      amountBase: 1_000_000n,
      executionId: execId1Bytes,
      policyVersion: 1n,
      extraInstruction: true, // extra instruction!
    }));
    const attExtraIx = await server.handle(new Request(`${origin}/api/v1/delegated-payment-requests/${reqData.request_id}/attempts`, {
      method: "POST",
      headers: { authorization: `Bearer ${token.access_token}`, "content-type": "application/json" },
      body: JSON.stringify({ signature: sigExtraIx }),
    }));
    const attExtraIxData = await attExtraIx.json() as { status: string; reason: string };
    expect(attExtraIxData.status).toBe("failed");
    expect(attExtraIxData.reason).toContain("unexpected extra instruction");

    // 5. Valid transaction confirms
    const sigValid = "siggood" + "1".repeat(80);
    mockRpc.signatureStatuses.set(sigValid, { confirmationStatus: "confirmed", err: null, slot: 105 } as SignatureStatus);
    mockRpc.transactions.set(sigValid, mockExecuteTransaction({
      vault: vaultPubkey,
      executionKey: agentKey.publicKey,
      recipient: recipKey.publicKey,
      mint: new PublicKey(mint),
      amountBase: 1_000_000n,
      executionId: execId1Bytes,
      policyVersion: 1n,
    }));
    // Add receipt account on-chain
    const receiptPDA = receiptAddress(vaultPubkey, execId1Bytes);
    const receiptBuf = mockReceiptBuffer({
      recipient: recipKey.publicKey.toBase58(),
      amountBase: 1_000_000n,
      version: 1n,
      executionKey: agentKey.publicKey.toBase58(),
      mint,
    });
    mockRpc.accounts.set(receiptPDA.toBase58(), {
      data: receiptBuf,
      owner: VAULT_PROGRAM_ID,
    });

    const attValid = await server.handle(new Request(`${origin}/api/v1/delegated-payment-requests/${reqData.request_id}/attempts`, {
      method: "POST",
      headers: { authorization: `Bearer ${token.access_token}`, "content-type": "application/json" },
      body: JSON.stringify({ signature: sigValid, blockhash: "testblockhash", last_valid_block_height: 500 }),
    }));
    const attValidData = await attValid.json() as { status: string; slot: number; verified_at: string };
    expect(attValidData.status).toBe("confirmed");
    expect(attValidData.slot).toBe(123);
    expect(Boolean(attValidData.verified_at)).toBe(true);

    // GET confirms the request is confirmed
    const getReq = await server.handle(new Request(`${origin}/api/v1/delegated-payment-requests/${reqData.request_id}`, {
      headers: { authorization: `Bearer ${token.access_token}` },
    }));
    const getReqData = await getReq.json() as { status: string };
    expect(getReqData.status).toBe("confirmed");

    server.close();
  });

  test("attempt stays unresolved when RPC throws and does not fail", async () => {
    const dir = mkdtempSync(join(tmpdir(), "publik-throw-"));
    const file = join(dir, "api.sqlite");

    const mockRpc = new MockChainRpc();
    const ownerWallet = Keypair.generate();
    const agentKey = Keypair.generate();
    const recipKey = Keypair.generate();
    const vaultId = new Uint8Array(32).fill(9);
    const vaultPubkey = vaultAddress(ownerWallet.publicKey, vaultId);

    mockRpc.accounts.set(vaultPubkey.toBase58(), {
      data: mockVaultBuffer({
        owner: ownerWallet.publicKey.toBase58(),
        mint,
        vaultId,
        executionKey: agentKey.publicKey.toBase58(),
        recipients: [recipKey.publicKey.toBase58()],
      }),
      owner: VAULT_PROGRAM_ID,
    });
    mockRpc.tokenBalances.set(vaultTokenAccount(vaultPubkey, mint).toBase58(), "50000000");

    const server = createApp({ dbPath: file, publicOrigin: origin, apiOrigin: origin, chainRpc: mockRpc });

    // Create owner session & agent
    const challenge = await (await server.handle(new Request(`${origin}/api/v1/owner/challenge`, { method: "POST", body: JSON.stringify({ wallet: ownerWallet.publicKey.toBase58() }) }))).json() as { nonce: string; message: string };
    const sig = Buffer.from(nacl.sign.detached(new TextEncoder().encode(challenge.message), ownerWallet.secretKey)).toString("base64");
    const sessionRes = await server.handle(new Request(`${origin}/api/v1/owner/session`, { method: "POST", body: JSON.stringify({ wallet: ownerWallet.publicKey.toBase58(), signature: sig, nonce: challenge.nonce }) }));
    const cookie = sessionRes.headers.get("set-cookie")?.split(";")[0] ?? "";
    const sessionData = await sessionRes.json() as { csrf: string };

    const started = await (await server.handle(new Request(`${origin}/api/v1/agent-connections`, { method: "POST", body: JSON.stringify({ name: "Bob", description: "Worker" }) }))).json() as { user_code: string; device_code: string };
    const approved = await (await server.handle(new Request(`${origin}/api/v1/owner/agent-connections/approve`, { method: "POST", headers: { cookie, "x-csrf-token": sessionData.csrf }, body: JSON.stringify({ user_code: started.user_code }) }))).json() as { agent_id: string };
    const token = await (await server.handle(new Request(`${origin}/api/v1/agent-connections/token`, { method: "POST", body: JSON.stringify({ device_code: started.device_code }) }))).json() as { access_token: string };

    await server.handle(new Request(`${origin}/api/v1/agents/${approved.agent_id}/delegation`, {
      method: "PUT",
      headers: { cookie, "x-csrf-token": sessionData.csrf, "content-type": "application/json" },
      body: JSON.stringify({
        vault: vaultPubkey.toBase58(),
        owner: ownerWallet.publicKey.toBase58(),
        vault_id_hex: Buffer.from(vaultId).toString("hex"),
        execution_key: agentKey.publicKey.toBase58(),
        mint,
        network: "solana-devnet",
      }),
    }));

    const execId = Keypair.generate().publicKey.toBase58();
    const reqRes = await server.handle(new Request(`${origin}/api/v1/delegated-payment-requests`, {
      method: "POST",
      headers: { authorization: `Bearer ${token.access_token}`, "idempotency-key": "k-throw", "content-type": "application/json" },
      body: JSON.stringify({
        network: "solana-devnet",
        mint,
        amount_base: "1000000",
        recipient: recipKey.publicKey.toBase58(),
        execution_id: execId,
        policy_version: "1",
      }),
    }));
    const reqData = await reqRes.json() as { request_id: string };

    // Simulate RPC network failure
    mockRpc.throwOnRpc = true;

    const attRes = await server.handle(new Request(`${origin}/api/v1/delegated-payment-requests/${reqData.request_id}/attempts`, {
      method: "POST",
      headers: { authorization: `Bearer ${token.access_token}`, "content-type": "application/json" },
      body: JSON.stringify({ signature: "throwSig" + "1".repeat(80) }),
    }));
    const attData = await attRes.json() as { status: string };
    expect(attData.status).toBe("unresolved");

    const getRes = await server.handle(new Request(`${origin}/api/v1/delegated-payment-requests/${reqData.request_id}`, {
      headers: { authorization: `Bearer ${token.access_token}` },
    }));
    const getData = await getRes.json() as { status: string };
    // Status remains submitted/unresolved, never failed
    expect(getData.status).not.toBe("failed");

    server.close();
  });

  test("direct-chain execution without request is discovered and labeled with null reason", async () => {
    const dir = mkdtempSync(join(tmpdir(), "publik-direct-"));
    const file = join(dir, "api.sqlite");

    const mockRpc = new MockChainRpc();
    const ownerWallet = Keypair.generate();
    const agentKey = Keypair.generate();
    const recipKey = Keypair.generate();
    const vaultId = new Uint8Array(32).fill(11);
    const vaultPubkey = vaultAddress(ownerWallet.publicKey, vaultId);

    mockRpc.accounts.set(vaultPubkey.toBase58(), {
      data: mockVaultBuffer({
        owner: ownerWallet.publicKey.toBase58(),
        mint,
        vaultId,
        executionKey: agentKey.publicKey.toBase58(),
        recipients: [recipKey.publicKey.toBase58()],
      }),
      owner: VAULT_PROGRAM_ID,
    });
    mockRpc.tokenBalances.set(vaultTokenAccount(vaultPubkey, mint).toBase58(), "50000000");

    const server = createApp({ dbPath: file, publicOrigin: origin, apiOrigin: origin, chainRpc: mockRpc });

    // Owner session
    const challenge = await (await server.handle(new Request(`${origin}/api/v1/owner/challenge`, { method: "POST", body: JSON.stringify({ wallet: ownerWallet.publicKey.toBase58() }) }))).json() as { nonce: string; message: string };
    const sig = Buffer.from(nacl.sign.detached(new TextEncoder().encode(challenge.message), ownerWallet.secretKey)).toString("base64");
    const sessionRes = await server.handle(new Request(`${origin}/api/v1/owner/session`, { method: "POST", body: JSON.stringify({ wallet: ownerWallet.publicKey.toBase58(), signature: sig, nonce: challenge.nonce }) }));
    const cookie = sessionRes.headers.get("set-cookie")?.split(";")[0] ?? "";
    const sessionData = await sessionRes.json() as { csrf: string };

    const started = await (await server.handle(new Request(`${origin}/api/v1/agent-connections`, { method: "POST", body: JSON.stringify({ name: "Bob", description: "Worker" }) }))).json() as { user_code: string; device_code: string };
    const approved = await (await server.handle(new Request(`${origin}/api/v1/owner/agent-connections/approve`, { method: "POST", headers: { cookie, "x-csrf-token": sessionData.csrf }, body: JSON.stringify({ user_code: started.user_code }) }))).json() as { agent_id: string };
    const token = await (await server.handle(new Request(`${origin}/api/v1/agent-connections/token`, { method: "POST", body: JSON.stringify({ device_code: started.device_code }) }))).json() as { access_token: string };

    await server.handle(new Request(`${origin}/api/v1/agents/${approved.agent_id}/delegation`, {
      method: "PUT",
      headers: { cookie, "x-csrf-token": sessionData.csrf, "content-type": "application/json" },
      body: JSON.stringify({
        vault: vaultPubkey.toBase58(),
        owner: ownerWallet.publicKey.toBase58(),
        vault_id_hex: Buffer.from(vaultId).toString("hex"),
        execution_key: agentKey.publicKey.toBase58(),
        mint,
        network: "solana-devnet",
      }),
    }));

    // 1. Direct-chain execution (NO Publik request in DB)
    const directExecId = Keypair.generate().publicKey.toBase58();
    const directExecIdBytes = new PublicKey(directExecId).toBytes();
    const directSig = "directSig" + "1".repeat(79);
    const directReceiptPDA = receiptAddress(vaultPubkey, directExecIdBytes);
    mockRpc.accounts.set(directReceiptPDA.toBase58(), {
      data: mockReceiptBuffer({
        recipient: recipKey.publicKey.toBase58(),
        amountBase: 1_230_000n,
        version: 1n,
        executionKey: agentKey.publicKey.toBase58(),
        mint,
      }),
      owner: VAULT_PROGRAM_ID,
    });
    mockRpc.transactions.set(directSig, mockExecuteTransaction({
      vault: vaultPubkey,
      executionKey: agentKey.publicKey,
      recipient: recipKey.publicKey,
      mint: new PublicKey(mint),
      amountBase: 1_230_000n,
      executionId: directExecIdBytes,
      policyVersion: 1n,
    }));

    // 2. Publik execution (WITH Publik request in DB)
    const publikExecId = Keypair.generate().publicKey.toBase58();
    const publikExecIdBytes = new PublicKey(publikExecId).toBytes();
    const publikSig = "pubksig" + "1".repeat(79);
    const reqRes = await server.handle(new Request(`${origin}/api/v1/delegated-payment-requests`, {
      method: "POST",
      headers: { authorization: `Bearer ${token.access_token}`, "idempotency-key": "k-publik", "content-type": "application/json" },
      body: JSON.stringify({
        network: "solana-devnet",
        mint,
        amount_base: "770000",
        recipient: recipKey.publicKey.toBase58(),
        execution_id: publikExecId,
        policy_version: "1",
      }),
    }));
    const reqData = await reqRes.json() as { request_id: string };

    const publikReceiptPDA = receiptAddress(vaultPubkey, publikExecIdBytes);
    mockRpc.accounts.set(publikReceiptPDA.toBase58(), {
      data: mockReceiptBuffer({
        recipient: recipKey.publicKey.toBase58(),
        amountBase: 770_000n,
        version: 1n,
        executionKey: agentKey.publicKey.toBase58(),
        mint,
      }),
      owner: VAULT_PROGRAM_ID,
    });
    mockRpc.transactions.set(publikSig, mockExecuteTransaction({
      vault: vaultPubkey,
      executionKey: agentKey.publicKey,
      recipient: recipKey.publicKey,
      mint: new PublicKey(mint),
      amountBase: 770_000n,
      executionId: publikExecIdBytes,
      policyVersion: 1n,
    }));

    // Set signatures on vault address
    mockRpc.vaultSignatures.set(vaultPubkey.toBase58(), [
      { signature: directSig, err: null, slot: 201 },
      { signature: publikSig, err: null, slot: 202 },
    ]);

    // Query executions via owner endpoint
    const execsRes = await server.handle(new Request(`${origin}/api/v1/agents/${approved.agent_id}/delegation/executions`, {
      headers: { cookie },
    }));
    expect(execsRes.status).toBe(200);
    const execsData = await execsRes.json() as { executions: Array<{ source: string; request_id: string | null; reason: string | null; execution_id: string; amount_base: string }> };
    expect(execsData.executions.length).toBe(2);

    const directItem = execsData.executions.find((e) => e.execution_id === directExecId);
    expect(directItem).toBeDefined();
    expect(directItem?.source).toBe("direct_chain");
    expect(directItem?.request_id).toBeNull();
    expect(directItem?.reason).toBeNull(); // direct chain execution has null reason
    expect(directItem?.amount_base).toBe("1230000");

    const publikItem = execsData.executions.find((e) => e.execution_id === publikExecId);
    expect(publikItem).toBeDefined();
    expect(publikItem?.source).toBe("publik");
    expect(publikItem?.request_id).toBe(reqData.request_id);
    expect(publikItem?.amount_base).toBe("770000");

    server.close();
  });

  test("returns unresolved with receipt_not_found_yet when tx is confirmed but receipt PDA does not exist yet", async () => {
    const dir = mkdtempSync(join(tmpdir(), "publik-notfound-"));
    const file = join(dir, "api.sqlite");

    const mockRpc = new MockChainRpc();
    const ownerWallet = Keypair.generate();
    const agentKey = Keypair.generate();
    const recipKey = Keypair.generate();
    const vaultId = new Uint8Array(32).fill(15);
    const vaultPubkey = vaultAddress(ownerWallet.publicKey, vaultId);

    mockRpc.accounts.set(vaultPubkey.toBase58(), {
      data: mockVaultBuffer({
        owner: ownerWallet.publicKey.toBase58(),
        mint,
        vaultId,
        executionKey: agentKey.publicKey.toBase58(),
        recipients: [recipKey.publicKey.toBase58()],
      }),
      owner: VAULT_PROGRAM_ID,
    });
    mockRpc.tokenBalances.set(vaultTokenAccount(vaultPubkey, mint).toBase58(), "50000000");

    const server = createApp({ dbPath: file, publicOrigin: origin, apiOrigin: origin, chainRpc: mockRpc });

    // Pair agent and link vault
    const challenge = await (await server.handle(new Request(`${origin}/api/v1/owner/challenge`, { method: "POST", body: JSON.stringify({ wallet: ownerWallet.publicKey.toBase58() }) }))).json() as { nonce: string; message: string };
    const sig = Buffer.from(nacl.sign.detached(new TextEncoder().encode(challenge.message), ownerWallet.secretKey)).toString("base64");
    const sessionRes = await server.handle(new Request(`${origin}/api/v1/owner/session`, { method: "POST", body: JSON.stringify({ wallet: ownerWallet.publicKey.toBase58(), signature: sig, nonce: challenge.nonce }) }));
    const cookie = sessionRes.headers.get("set-cookie")?.split(";")[0] ?? "";
    const sessionData = await sessionRes.json() as { csrf: string };

    const started = await (await server.handle(new Request(`${origin}/api/v1/agent-connections`, { method: "POST", body: JSON.stringify({ name: "Bob", description: "Worker" }) }))).json() as { user_code: string; device_code: string };
    const approved = await (await server.handle(new Request(`${origin}/api/v1/owner/agent-connections/approve`, { method: "POST", headers: { cookie, "x-csrf-token": sessionData.csrf }, body: JSON.stringify({ user_code: started.user_code }) }))).json() as { agent_id: string };
    const token = await (await server.handle(new Request(`${origin}/api/v1/agent-connections/token`, { method: "POST", body: JSON.stringify({ device_code: started.device_code }) }))).json() as { access_token: string };

    await server.handle(new Request(`${origin}/api/v1/agents/${approved.agent_id}/delegation`, {
      method: "PUT",
      headers: { cookie, "x-csrf-token": sessionData.csrf, "content-type": "application/json" },
      body: JSON.stringify({
        vault: vaultPubkey.toBase58(),
        owner: ownerWallet.publicKey.toBase58(),
        vault_id_hex: Buffer.from(vaultId).toString("hex"),
        execution_key: agentKey.publicKey.toBase58(),
        mint,
        network: "solana-devnet",
      }),
    }));

    const execId = Keypair.generate().publicKey.toBase58();
    const execIdBytes = new PublicKey(execId).toBytes();
    const reqRes = await server.handle(new Request(`${origin}/api/v1/delegated-payment-requests`, {
      method: "POST",
      headers: { authorization: `Bearer ${token.access_token}`, "idempotency-key": "k-pda-notfound", "content-type": "application/json" },
      body: JSON.stringify({
        network: "solana-devnet",
        mint,
        amount_base: "1000000",
        recipient: recipKey.publicKey.toBase58(),
        execution_id: execId,
        policy_version: "1",
      }),
    }));
    const reqData = await reqRes.json() as { request_id: string };

    // Tx confirmed with no error, but receipt PDA is NOT added to mockRpc.accounts yet
    const sigNoReceipt = "sigNoReceipt" + "1".repeat(70);
    mockRpc.signatureStatuses.set(sigNoReceipt, { confirmationStatus: "confirmed", err: null, slot: 106 } as SignatureStatus);
    mockRpc.transactions.set(sigNoReceipt, mockExecuteTransaction({
      vault: vaultPubkey,
      executionKey: agentKey.publicKey,
      recipient: recipKey.publicKey,
      mint: new PublicKey(mint),
      amountBase: 1_000_000n,
      executionId: execIdBytes,
      policyVersion: 1n,
    }));

    const attRes = await server.handle(new Request(`${origin}/api/v1/delegated-payment-requests/${reqData.request_id}/attempts`, {
      method: "POST",
      headers: { authorization: `Bearer ${token.access_token}`, "content-type": "application/json" },
      body: JSON.stringify({ signature: sigNoReceipt }),
    }));
    const attData = await attRes.json() as { status: string; reason: string };
    // MUST return unresolved with receipt_not_found_yet, never failed
    expect(attData.status).toBe("unresolved");
    expect(attData.reason).toBe("receipt_not_found_yet");

    const getRes = await server.handle(new Request(`${origin}/api/v1/delegated-payment-requests/${reqData.request_id}`, {
      headers: { authorization: `Bearer ${token.access_token}` },
    }));
    const getData = await getRes.json() as { status: string };
    expect(getData.status).toBe("submitted");

    server.close();
  });

  test("retry after stale_policy_version updates policy_version and re-runs preflight without 409", async () => {
    const dir = mkdtempSync(join(tmpdir(), "publik-retry-"));
    const file = join(dir, "api.sqlite");

    const mockRpc = new MockChainRpc();
    const ownerWallet = Keypair.generate();
    const agentKey = Keypair.generate();
    const recipKey = Keypair.generate();
    const vaultId = new Uint8Array(32).fill(21);
    const vaultPubkey = vaultAddress(ownerWallet.publicKey, vaultId);

    // Vault on chain has version 2
    mockRpc.accounts.set(vaultPubkey.toBase58(), {
      data: mockVaultBuffer({
        owner: ownerWallet.publicKey.toBase58(),
        mint,
        vaultId,
        executionKey: agentKey.publicKey.toBase58(),
        recipients: [recipKey.publicKey.toBase58()],
        version: 2n,
      }),
      owner: VAULT_PROGRAM_ID,
    });
    mockRpc.tokenBalances.set(vaultTokenAccount(vaultPubkey, mint).toBase58(), "50000000");

    const server = createApp({ dbPath: file, publicOrigin: origin, apiOrigin: origin, chainRpc: mockRpc });

    // Pair agent and link vault
    const challenge = await (await server.handle(new Request(`${origin}/api/v1/owner/challenge`, { method: "POST", body: JSON.stringify({ wallet: ownerWallet.publicKey.toBase58() }) }))).json() as { nonce: string; message: string };
    const sig = Buffer.from(nacl.sign.detached(new TextEncoder().encode(challenge.message), ownerWallet.secretKey)).toString("base64");
    const sessionRes = await server.handle(new Request(`${origin}/api/v1/owner/session`, { method: "POST", body: JSON.stringify({ wallet: ownerWallet.publicKey.toBase58(), signature: sig, nonce: challenge.nonce }) }));
    const cookie = sessionRes.headers.get("set-cookie")?.split(";")[0] ?? "";
    const sessionData = await sessionRes.json() as { csrf: string };

    const started = await (await server.handle(new Request(`${origin}/api/v1/agent-connections`, { method: "POST", body: JSON.stringify({ name: "Bob", description: "Worker" }) }))).json() as { user_code: string; device_code: string };
    const approved = await (await server.handle(new Request(`${origin}/api/v1/owner/agent-connections/approve`, { method: "POST", headers: { cookie, "x-csrf-token": sessionData.csrf }, body: JSON.stringify({ user_code: started.user_code }) }))).json() as { agent_id: string };
    const token = await (await server.handle(new Request(`${origin}/api/v1/agent-connections/token`, { method: "POST", body: JSON.stringify({ device_code: started.device_code }) }))).json() as { access_token: string };

    await server.handle(new Request(`${origin}/api/v1/agents/${approved.agent_id}/delegation`, {
      method: "PUT",
      headers: { cookie, "x-csrf-token": sessionData.csrf, "content-type": "application/json" },
      body: JSON.stringify({
        vault: vaultPubkey.toBase58(),
        owner: ownerWallet.publicKey.toBase58(),
        vault_id_hex: Buffer.from(vaultId).toString("hex"),
        execution_key: agentKey.publicKey.toBase58(),
        mint,
        network: "solana-devnet",
      }),
    }));

    const execId = Keypair.generate().publicKey.toBase58();

    // 1. Initial request with stale policy version "1" -> blocked with stale_policy_version
    const firstRes = await server.handle(new Request(`${origin}/api/v1/delegated-payment-requests`, {
      method: "POST",
      headers: { authorization: `Bearer ${token.access_token}`, "idempotency-key": "k-retry-id", "content-type": "application/json" },
      body: JSON.stringify({
        network: "solana-devnet",
        mint,
        amount_base: "1000000",
        recipient: recipKey.publicKey.toBase58(),
        execution_id: execId,
        policy_version: "1",
      }),
    }));
    expect(firstRes.status).toBe(201);
    const firstData = await firstRes.json() as { status: string; reason: string; policy_version: string };
    expect(firstData.status).toBe("blocked");
    expect(firstData.reason).toBe("stale_policy_version");
    expect(firstData.policy_version).toBe("1");

    // 2. Retry with same execution_id and idempotency-key, but refreshed policy_version "2"
    const retryRes = await server.handle(new Request(`${origin}/api/v1/delegated-payment-requests`, {
      method: "POST",
      headers: { authorization: `Bearer ${token.access_token}`, "idempotency-key": "k-retry-id", "content-type": "application/json" },
      body: JSON.stringify({
        network: "solana-devnet",
        mint,
        amount_base: "1000000",
        recipient: recipKey.publicKey.toBase58(),
        execution_id: execId,
        policy_version: "2",
      }),
    }));
    // Must NOT return 409 IDEMPOTENCY_CONFLICT; must re-run preflight and update policy_version
    expect(retryRes.status).toBe(200);
    const retryData = await retryRes.json() as { status: string; reason: string | null; policy_version: string };
    expect(retryData.status).toBe("ready");
    expect(retryData.reason).toBeNull();
    expect(retryData.policy_version).toBe("2");

    server.close();
  });

  test("discoverDirectChainExecutions matches vault keys[1] only and processes multiple vault instructions in one tx", async () => {
    const dir = mkdtempSync(join(tmpdir(), "publik-multi-"));
    const file = join(dir, "api.sqlite");

    const mockRpc = new MockChainRpc();
    const ownerWallet = Keypair.generate();
    const agentKey = Keypair.generate();
    const recipKey = Keypair.generate();
    const vaultIdA = new Uint8Array(32).fill(31);
    const vaultPubkeyA = vaultAddress(ownerWallet.publicKey, vaultIdA);
    const vaultIdB = new Uint8Array(32).fill(32);
    const vaultPubkeyB = vaultAddress(ownerWallet.publicKey, vaultIdB);

    mockRpc.accounts.set(vaultPubkeyA.toBase58(), {
      data: mockVaultBuffer({
        owner: ownerWallet.publicKey.toBase58(),
        mint,
        vaultId: vaultIdA,
        executionKey: agentKey.publicKey.toBase58(),
        recipients: [recipKey.publicKey.toBase58()],
      }),
      owner: VAULT_PROGRAM_ID,
    });
    mockRpc.tokenBalances.set(vaultTokenAccount(vaultPubkeyA, mint).toBase58(), "50000000");

    const server = createApp({ dbPath: file, publicOrigin: origin, apiOrigin: origin, chainRpc: mockRpc });

    // Owner session & agent
    const challenge = await (await server.handle(new Request(`${origin}/api/v1/owner/challenge`, { method: "POST", body: JSON.stringify({ wallet: ownerWallet.publicKey.toBase58() }) }))).json() as { nonce: string; message: string };
    const sig = Buffer.from(nacl.sign.detached(new TextEncoder().encode(challenge.message), ownerWallet.secretKey)).toString("base64");
    const sessionRes = await server.handle(new Request(`${origin}/api/v1/owner/session`, { method: "POST", body: JSON.stringify({ wallet: ownerWallet.publicKey.toBase58(), signature: sig, nonce: challenge.nonce }) }));
    const cookie = sessionRes.headers.get("set-cookie")?.split(";")[0] ?? "";
    const sessionData = await sessionRes.json() as { csrf: string };

    const started = await (await server.handle(new Request(`${origin}/api/v1/agent-connections`, { method: "POST", body: JSON.stringify({ name: "Bob", description: "Worker" }) }))).json() as { user_code: string; device_code: string };
    const approved = await (await server.handle(new Request(`${origin}/api/v1/owner/agent-connections/approve`, { method: "POST", headers: { cookie, "x-csrf-token": sessionData.csrf }, body: JSON.stringify({ user_code: started.user_code }) }))).json() as { agent_id: string };

    await server.handle(new Request(`${origin}/api/v1/agents/${approved.agent_id}/delegation`, {
      method: "PUT",
      headers: { cookie, "x-csrf-token": sessionData.csrf, "content-type": "application/json" },
      body: JSON.stringify({
        vault: vaultPubkeyA.toBase58(),
        owner: ownerWallet.publicKey.toBase58(),
        vault_id_hex: Buffer.from(vaultIdA).toString("hex"),
        execution_key: agentKey.publicKey.toBase58(),
        mint,
        network: "solana-devnet",
      }),
    }));

    // Create one transaction with THREE execute instructions:
    // 1. For vaultPubkeyA (execution 1)
    // 2. For vaultPubkeyB (should be ignored for vault A!)
    // 3. For vaultPubkeyA (execution 2)
    const execIdA1 = Keypair.generate().publicKey.toBase58();
    const execIdA1Bytes = new PublicKey(execIdA1).toBytes();
    const execIdB = Keypair.generate().publicKey.toBase58();
    const execIdBBytes = new PublicKey(execIdB).toBytes();
    const execIdA2 = Keypair.generate().publicKey.toBase58();
    const execIdA2Bytes = new PublicKey(execIdA2).toBytes();

    const receiptA1PDA = receiptAddress(vaultPubkeyA, execIdA1Bytes);
    mockRpc.accounts.set(receiptA1PDA.toBase58(), {
      data: mockReceiptBuffer({ recipient: recipKey.publicKey.toBase58(), amountBase: 100_000n, version: 1n, executionKey: agentKey.publicKey.toBase58(), mint }),
      owner: VAULT_PROGRAM_ID,
    });

    const receiptBPDA = receiptAddress(vaultPubkeyB, execIdBBytes);
    mockRpc.accounts.set(receiptBPDA.toBase58(), {
      data: mockReceiptBuffer({ recipient: recipKey.publicKey.toBase58(), amountBase: 200_000n, version: 1n, executionKey: agentKey.publicKey.toBase58(), mint }),
      owner: VAULT_PROGRAM_ID,
    });

    const receiptA2PDA = receiptAddress(vaultPubkeyA, execIdA2Bytes);
    mockRpc.accounts.set(receiptA2PDA.toBase58(), {
      data: mockReceiptBuffer({ recipient: recipKey.publicKey.toBase58(), amountBase: 300_000n, version: 1n, executionKey: agentKey.publicKey.toBase58(), mint }),
      owner: VAULT_PROGRAM_ID,
    });

    const txMulti = {
      slot: 300,
      meta: { err: null },
      transaction: {
        message: {
          instructions: [
            mockExecuteTransaction({ vault: vaultPubkeyA, executionKey: agentKey.publicKey, recipient: recipKey.publicKey, mint: new PublicKey(mint), amountBase: 100_000n, executionId: execIdA1Bytes, policyVersion: 1n }).transaction.message.instructions[0],
            mockExecuteTransaction({ vault: vaultPubkeyB, executionKey: agentKey.publicKey, recipient: recipKey.publicKey, mint: new PublicKey(mint), amountBase: 200_000n, executionId: execIdBBytes, policyVersion: 1n }).transaction.message.instructions[0],
            mockExecuteTransaction({ vault: vaultPubkeyA, executionKey: agentKey.publicKey, recipient: recipKey.publicKey, mint: new PublicKey(mint), amountBase: 300_000n, executionId: execIdA2Bytes, policyVersion: 1n }).transaction.message.instructions[0],
          ],
        },
      },
    };

    const multiSig = "multiSig" + "1".repeat(70);
    mockRpc.transactions.set(multiSig, txMulti);
    mockRpc.vaultSignatures.set(vaultPubkeyA.toBase58(), [
      { signature: multiSig, err: null, slot: 300 },
    ]);

    const res = await server.handle(new Request(`${origin}/api/v1/agents/${approved.agent_id}/delegation/executions`, {
      headers: { cookie },
    }));
    expect(res.status).toBe(200);
    const data = await res.json() as { executions: Array<{ execution_id: string; amount_base: string }> };

    // MUST contain both execIdA1 and execIdA2, and MUST NOT contain execIdB
    expect(data.executions.length).toBe(2);
    expect(data.executions.some((e) => e.execution_id === execIdA1)).toBe(true);
    expect(data.executions.some((e) => e.execution_id === execIdA2)).toBe(true);
    expect(data.executions.some((e) => e.execution_id === execIdB)).toBe(false);

    server.close();
  });

  test("security and auth gates: unauthenticated PUT returns 401, wrong wallet returns 403, unauthenticated executions returns 401, pairing without agent_id creates new profile", async () => {
    const dir = mkdtempSync(join(tmpdir(), "publik-auth-"));
    const file = join(dir, "api.sqlite");
    const mockRpc = new MockChainRpc();

    const ownerWallet = Keypair.generate();
    const outsiderWallet = Keypair.generate();
    const agentKey = Keypair.generate();
    const vaultId = Buffer.alloc(32, 1);
    const vaultIdHex = vaultId.toString("hex");
    const vaultPubkey = vaultAddress(ownerWallet.publicKey.toBase58(), vaultId);

    const server = createApp({ dbPath: file, publicOrigin: origin, apiOrigin: origin, chainRpc: mockRpc });

    // 1. Create owner session for ownerWallet
    const chal1 = await (await server.handle(new Request(`${origin}/api/v1/owner/challenge`, { method: "POST", body: JSON.stringify({ wallet: ownerWallet.publicKey.toBase58() }) }))).json() as { nonce: string; message: string };
    const sig1 = Buffer.from(nacl.sign.detached(new TextEncoder().encode(chal1.message), ownerWallet.secretKey)).toString("base64");
    const ses1 = await server.handle(new Request(`${origin}/api/v1/owner/session`, { method: "POST", body: JSON.stringify({ wallet: ownerWallet.publicKey.toBase58(), signature: sig1, nonce: chal1.nonce }) }));
    const cookieOwner = ses1.headers.get("set-cookie")?.split(";")[0] ?? "";
    const dataOwner = await ses1.json() as { csrf: string };

    // Create an agent profile under ownerWallet
    const createdAgent = await (await server.handle(new Request(`${origin}/api/v1/owner/agents`, {
      method: "POST",
      headers: { cookie: cookieOwner, "x-csrf-token": dataOwner.csrf },
      body: JSON.stringify({ name: "Alice", description: "Worker" }),
    }))).json() as { agent_id: string };

    // 2. Unauthenticated PUT returns 401
    const unauthPut = await server.handle(new Request(`${origin}/api/v1/agents/${createdAgent.agent_id}/delegation`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        vault: vaultPubkey.toBase58(),
        owner: ownerWallet.publicKey.toBase58(),
        vault_id_hex: vaultIdHex,
        execution_key: agentKey.publicKey.toBase58(),
        mint,
        network: "solana-devnet",
      }),
    }));
    expect(unauthPut.status).toBe(401);

    // 3. Create outsider session
    const chal2 = await (await server.handle(new Request(`${origin}/api/v1/owner/challenge`, { method: "POST", body: JSON.stringify({ wallet: outsiderWallet.publicKey.toBase58() }) }))).json() as { nonce: string; message: string };
    const sig2 = Buffer.from(nacl.sign.detached(new TextEncoder().encode(chal2.message), outsiderWallet.secretKey)).toString("base64");
    const ses2 = await server.handle(new Request(`${origin}/api/v1/owner/session`, { method: "POST", body: JSON.stringify({ wallet: outsiderWallet.publicKey.toBase58(), signature: sig2, nonce: chal2.nonce }) }));
    const cookieOutsider = ses2.headers.get("set-cookie")?.split(";")[0] ?? "";
    const dataOutsider = await ses2.json() as { csrf: string };

    // Create an agent profile under outsider
    const outsiderAgent = await (await server.handle(new Request(`${origin}/api/v1/owner/agents`, {
      method: "POST",
      headers: { cookie: cookieOutsider, "x-csrf-token": dataOutsider.csrf },
      body: JSON.stringify({ name: "OutsiderAgent", description: "Other" }),
    }))).json() as { agent_id: string };

    // Signed-in wallet (outsider) that differs from vault owner (ownerWallet) gets 403
    const wrongWalletPut = await server.handle(new Request(`${origin}/api/v1/agents/${outsiderAgent.agent_id}/delegation`, {
      method: "PUT",
      headers: { cookie: cookieOutsider, "x-csrf-token": dataOutsider.csrf, "content-type": "application/json" },
      body: JSON.stringify({
        vault: vaultPubkey.toBase58(),
        owner: ownerWallet.publicKey.toBase58(),
        vault_id_hex: vaultIdHex,
        execution_key: agentKey.publicKey.toBase58(),
        mint,
        network: "solana-devnet",
      }),
    }));
    expect(wrongWalletPut.status).toBe(403);
    const wrongBody = await wrongWalletPut.json() as { error?: { message: string } };
    expect(wrongBody.error?.message).toBe("The signed-in wallet does not own this vault.");

    // 4. Executions fetched without a session return 401
    const unauthExecs = await server.handle(new Request(`${origin}/api/v1/agents/${createdAgent.agent_id}/delegation/executions`));
    expect(unauthExecs.status).toBe(401);

    // 5. Pairing rules:
    // Pairing request with name "Alice" (same name as createdAgent)
    const pairReq1 = await (await server.handle(new Request(`${origin}/api/v1/agent-connections`, { method: "POST", body: JSON.stringify({ name: "Alice", description: "Bot" }) }))).json() as { user_code: string };
    // Approving WITHOUT agent_id MUST create a new agent, NEVER silently attaching to createdAgent
    const approvedWithoutId = await (await server.handle(new Request(`${origin}/api/v1/owner/agent-connections/approve`, {
      method: "POST",
      headers: { cookie: cookieOwner, "x-csrf-token": dataOwner.csrf },
      body: JSON.stringify({ user_code: pairReq1.user_code }),
    }))).json() as { agent_id: string };
    expect(approvedWithoutId.agent_id).not.toBe(createdAgent.agent_id);

    // Pairing request with name "Alice" approved WITH explicit agent_id attaches to that agent
    const pairReq2 = await (await server.handle(new Request(`${origin}/api/v1/agent-connections`, { method: "POST", body: JSON.stringify({ name: "Alice", description: "Bot 2" }) }))).json() as { user_code: string };
    const approvedWithId = await (await server.handle(new Request(`${origin}/api/v1/owner/agent-connections/approve`, {
      method: "POST",
      headers: { cookie: cookieOwner, "x-csrf-token": dataOwner.csrf },
      body: JSON.stringify({ user_code: pairReq2.user_code, agent_id: createdAgent.agent_id }),
    }))).json() as { agent_id: string };
    expect(approvedWithId.agent_id).toBe(createdAgent.agent_id);

    server.close();
  });
});

class MockChainRpc implements ChainRpc {
  deployed = true;
  slot = 100;
  blockTime = 1_700_000_000;
  accounts = new Map<string, { data: Buffer; owner: PublicKey; executable?: boolean }>();
  tokenBalances = new Map<string, string>();
  signatureStatuses = new Map<string, SignatureStatus>();
  transactions = new Map<string, unknown>();
  vaultSignatures = new Map<string, Array<{ signature: string; err: unknown; slot: number }>>();
  throwOnRpc = false;

  async getAccountInfo(pubkey: PublicKey): Promise<AccountInfo<Buffer> | null> {
    if (this.throwOnRpc) throw new Error("RPC network failure simulated");
    if (pubkey.equals(VAULT_PROGRAM_ID)) {
      if (!this.deployed) return null;
      return {
        data: Buffer.alloc(0),
        executable: true,
        lamports: 1_000_000,
        owner: new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"),
      } as AccountInfo<Buffer>;
    }
    const acc = this.accounts.get(pubkey.toBase58());
    if (!acc) return null;
    return {
      data: acc.data,
      executable: acc.executable ?? false,
      lamports: 1_000_000,
      owner: acc.owner,
    } as AccountInfo<Buffer>;
  }

  async getSlot(): Promise<number> {
    if (this.throwOnRpc) throw new Error("RPC network failure simulated");
    return this.slot;
  }

  async getBlockTime(): Promise<number | null> {
    if (this.throwOnRpc) throw new Error("RPC network failure simulated");
    return this.blockTime;
  }

  async getTokenAccountBalance(tokenAccount: PublicKey): Promise<{ value: { amount: string } }> {
    if (this.throwOnRpc) throw new Error("RPC network failure simulated");
    const amount = this.tokenBalances.get(tokenAccount.toBase58()) ?? "0";
    return { value: { amount } };
  }

  async getSignatureStatuses(signatures: string[]): Promise<{ value: Array<SignatureStatus | null> }> {
    if (this.throwOnRpc) throw new Error("RPC network failure simulated");
    return {
      value: signatures.map((sig) => this.signatureStatuses.get(sig) ?? null),
    };
  }

  async getTransaction(signature: string): Promise<unknown> {
    if (this.throwOnRpc) throw new Error("RPC network failure simulated");
    return this.transactions.get(signature) ?? null;
  }

  async getSignaturesForAddress(address: PublicKey): Promise<Array<{ signature: string; err: unknown; slot: number }>> {
    if (this.throwOnRpc) throw new Error("RPC network failure simulated");
    return this.vaultSignatures.get(address.toBase58()) ?? [];
  }
}

function mockVaultBuffer(input: {
  owner: string;
  mint: string;
  vaultId: Uint8Array;
  executionKey: string;
  paused?: boolean;
  revoked?: boolean;
  version?: bigint;
  perBase?: bigint;
  dailyBase?: bigint;
  lifetimeBase?: bigint;
  recipients?: string[];
}): Buffer {
  const buf = Buffer.alloc(VAULT_LEN);
  buf.write("PUBLIKV1", 0, 8, "ascii");
  buf.set(new PublicKey(input.owner).toBytes(), 8);
  buf.set(new PublicKey(input.mint).toBytes(), 40);
  buf.set(input.vaultId, 72);
  buf.set(new PublicKey(input.executionKey).toBytes(), 104);
  buf[136] = 255; // bump
  buf[137] = input.paused ? 1 : 0;
  buf[138] = input.revoked ? 1 : 0;
  buf.writeBigUInt64LE(input.version ?? 1n, 140);
  buf.writeBigUInt64LE(input.perBase ?? 10_000_000n, 148);
  buf.writeBigUInt64LE(input.dailyBase ?? 50_000_000n, 156);
  buf.writeBigUInt64LE(input.lifetimeBase ?? 100_000_000n, 164);
  buf.writeBigUInt64LE(0n, 172); // spent today
  buf.writeBigUInt64LE(0n, 180); // lifetime spent
  buf.writeBigInt64LE(0n, 188); // day index
  buf.writeBigInt64LE(0n, 196); // start ts
  buf.writeBigInt64LE(2_000_000_000n, 204); // expiry ts
  const recs = input.recipients ?? [];
  buf[212] = recs.length;
  for (let i = 0; i < recs.length; i++) {
    buf.set(new PublicKey(recs[i]).toBytes(), 216 + i * 32);
  }
  return buf;
}

function mockReceiptBuffer(input: {
  recipient: string;
  amountBase: bigint;
  version: bigint;
  executionKey: string;
  mint: string;
}): Buffer {
  const buf = Buffer.alloc(RECEIPT_LEN);
  buf.write("RECEIPT1", 0, 8, "ascii");
  buf.set(new PublicKey(input.recipient).toBytes(), 8);
  buf.writeBigUInt64LE(input.amountBase, 40);
  buf.writeBigUInt64LE(input.version, 48);
  buf.writeBigInt64LE(BigInt(Math.floor(Date.now() / 1000)), 56);
  buf.set(new PublicKey(input.executionKey).toBytes(), 64);
  buf.set(new PublicKey(input.mint).toBytes(), 96);
  return buf;
}

function mockExecuteTransaction(input: {
  programId?: PublicKey;
  vault: PublicKey;
  executionKey: PublicKey;
  recipient: PublicKey;
  mint: PublicKey;
  amountBase: bigint;
  executionId: Uint8Array;
  policyVersion: bigint;
  extraInstruction?: boolean;
}) {
  const progId = input.programId ?? VAULT_PROGRAM_ID;
  const authority = vaultAuthority(input.vault);
  const vaultToken = vaultTokenAccount(input.vault, input.mint);
  const recipToken = tokenAccount(input.recipient, input.mint);
  const receipt = receiptAddress(input.vault, input.executionId);

  const data = Buffer.alloc(49);
  data[0] = Ix.execute;
  data.set(input.executionId, 1);
  data.writeBigUInt64LE(input.amountBase, 33);
  data.writeBigUInt64LE(input.policyVersion, 41);

  const keys = [
    { pubkey: input.executionKey, isSigner: true, isWritable: true },
    { pubkey: input.vault, isSigner: false, isWritable: true },
    { pubkey: authority, isSigner: false, isWritable: false },
    { pubkey: vaultToken, isSigner: false, isWritable: true },
    { pubkey: recipToken, isSigner: false, isWritable: true },
    { pubkey: input.mint, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: new PublicKey("11111111111111111111111111111111"), isSigner: false, isWritable: false },
    { pubkey: receipt, isSigner: false, isWritable: true },
  ];

  const instructions: Array<{ programId: PublicKey; keys: typeof keys; data: Buffer }> = [
    {
      programId: progId,
      keys,
      data,
    },
  ];

  if (input.extraInstruction) {
    instructions.push({
      programId: new PublicKey("11111111111111111111111111111111"),
      keys: [],
      data: Buffer.alloc(0),
    });
  }

  return {
    slot: 123,
    meta: {
      err: null,
      logMessages: [],
    },
    transaction: {
      message: {
        instructions,
      },
    },
  };
}
