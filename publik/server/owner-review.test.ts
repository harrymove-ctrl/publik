import { describe, expect, test } from "bun:test";
import { Keypair, PublicKey, type ParsedTransactionWithMeta } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "./app";
import { verifyOwnerTransfer, type ChainProof, type OwnerTransferExpected } from "./chain";

const origin = "http://127.0.0.1:5173";
const mint = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const signatureOf = () => bs58.encode(nacl.randomBytes(64));

async function workspace(proofs: ChainProof[]) {
  const seen: OwnerTransferExpected[] = [];
  const api = createApp({
    dbPath: join(mkdtempSync(join(tmpdir(), "publik-review-")), "api.sqlite"),
    publicOrigin: origin,
    apiOrigin: origin,
    verifyChain: async (expected) => {
      seen.push(expected);
      return proofs.shift() ?? { ok: true };
    },
  });
  const call = (path: string, init?: RequestInit) => api.handle(new Request(`${origin}${path}`, init));
  const wallet = Keypair.generate();
  const challenge = await (await call("/api/v1/owner/challenge", { method: "POST", body: JSON.stringify({ wallet: wallet.publicKey.toBase58() }) })).json() as { nonce: string; message: string };
  const signed = Buffer.from(nacl.sign.detached(new TextEncoder().encode(challenge.message), wallet.secretKey)).toString("base64");
  const session = await call("/api/v1/owner/session", { method: "POST", body: JSON.stringify({ wallet: wallet.publicKey.toBase58(), signature: signed, nonce: challenge.nonce }) });
  const owner = { cookie: session.headers.get("set-cookie")?.split(";")[0] ?? "", "x-csrf-token": (await session.json() as { csrf: string }).csrf };
  const started = await (await call("/api/v1/agent-connections", { method: "POST", body: JSON.stringify({ name: "Scout" }) })).json() as { user_code: string; device_code: string };
  const approved = await (await call("/api/v1/owner/agent-connections/approve", { method: "POST", headers: owner, body: JSON.stringify({ user_code: started.user_code }) })).json() as { agent_id: string };
  const token = (await (await call("/api/v1/agent-connections/token", { method: "POST", body: JSON.stringify({ device_code: started.device_code }) })).json() as { access_token: string }).access_token;
  const agent = { authorization: `Bearer ${token}` };
  let n = 0;
  const request = async (amount: string) => {
    const response = await call("/api/v1/payment-requests", { method: "POST", headers: { ...agent, "idempotency-key": `k${++n}` }, body: JSON.stringify({ network: "solana-devnet", mint, amount, recipient: Keypair.generate().publicKey.toBase58(), reason: "test" }) });
    return (await response.json() as { request_id: string }).request_id;
  };
  const sign = (id: string, signature: string) => call(`/api/v1/owner/payment-requests/${id}/signature`, { method: "POST", headers: owner, body: JSON.stringify({ signature }) });
  const reject = (id: string) => call(`/api/v1/owner/payment-requests/${id}/reject`, { method: "POST", headers: owner });
  const status = async (id: string) => (await (await call(`/api/v1/payment-requests/${id}`, { headers: agent })).json() as { status: string; signature: string | null });
  const reserved = async () => (await (await call("/api/v1/agent/rules", { headers: agent })).json() as { reserved_base: string }).reserved_base;
  return { api, call, owner, agentId: approved.agent_id, wallet, seen, request, sign, reject, status, reserved };
}

describe("owner review loop", () => {
  test("a submitted signature stays reserved until the chain confirms it, and cannot be swapped for a second transfer", async () => {
    const w = await workspace([{ ok: false, code: "TX_NOT_FOUND", message: "not yet", retryable: true }, { ok: true }]);
    const id = await w.request("2.00");
    const first = signatureOf();

    const pending = await w.sign(id, first);
    expect(pending.status).toBe(202);
    expect(await w.status(id)).toMatchObject({ status: "submitted", signature: first });
    expect(await w.reserved()).toBe("2000000");

    expect((await w.sign(id, signatureOf())).status).toBe(409);

    const rechecked = await w.sign(id, first);
    expect(rechecked.status).toBe(200);
    expect(await w.status(id)).toMatchObject({ status: "confirmed", signature: first });
    expect(await w.reserved()).toBe("0");
    expect(w.seen.at(-1)).toMatchObject({ signature: first, amountBase: "2000000", owner: w.wallet.publicKey.toBase58() });

    expect((await w.reject(id)).status).toBe(409);
    expect((await w.sign(await w.request("1.00"), first)).status).toBe(409);
    w.api.close();
  });

  test("a failed or mismatched transfer returns the request to review and releases its signature", async () => {
    const w = await workspace([{ ok: false, code: "TRANSFER_MISMATCH", message: "wrong recipient", retryable: false }]);
    const id = await w.request("1.00");
    const response = await w.sign(id, signatureOf());
    expect(response.status).toBe(400);
    expect((await response.json() as { error: { code: string } }).error.code).toBe("TRANSFER_MISMATCH");
    expect(await w.status(id)).toMatchObject({ status: "pending_review", signature: null });
    w.api.close();
  });

  test("rejecting closes a waiting or blocked request and it can no longer be signed", async () => {
    const w = await workspace([]);
    const waiting = await w.request("1.00");
    const blocked = await w.request("30.00");
    expect((await w.status(blocked)).status).toBe("blocked");
    expect((await w.reject(waiting)).status).toBe(200);
    expect((await w.reject(blocked)).status).toBe(200);
    expect((await w.status(waiting)).status).toBe("rejected");
    expect((await w.sign(waiting, signatureOf())).status).toBe(409);
    expect((await w.sign(blocked, signatureOf())).status).toBe(409);
    expect(w.seen).toHaveLength(0);
    w.api.close();
  });

  test("a pasted request is filed by the owner and records why it was blocked", async () => {
    const w = await workspace([]);
    const headers = { ...w.owner, "content-type": "application/json" };
    const body = { amount: "1.50", recipient: Keypair.generate().publicKey.toBase58(), reason: "invoice", idempotency_key: "paste-1" };
    const filed = await w.call(`/api/v1/owner/agents/${w.agentId}/payment-requests`, { method: "POST", headers, body: JSON.stringify(body) });
    expect(filed.status).toBe(201);
    const saved = await filed.json() as { request_id: string; status: string };
    expect(saved.status).toBe("pending_review");
    const again = await w.call(`/api/v1/owner/agents/${w.agentId}/payment-requests`, { method: "POST", headers, body: JSON.stringify(body) });
    expect((await again.json() as { request_id: string }).request_id).toBe(saved.request_id);
    await w.call(`/api/v1/owner/agents/${w.agentId}/pause`, { method: "POST", headers: w.owner });
    const paused = await (await w.call(`/api/v1/owner/agents/${w.agentId}/payment-requests`, { method: "POST", headers, body: JSON.stringify({ ...body, idempotency_key: "paste-2" }) })).json() as { status: string; policy: { outcome: string; checks: { id: string }[] } };
    expect(paused).toMatchObject({ status: "blocked", policy: { outcome: "paused" } });
    expect(paused.policy.checks[0]?.id).toBe("paused");
    await w.call(`/api/v1/owner/agents/${w.agentId}/resume`, { method: "POST", headers: w.owner });
    const over = await (await w.call(`/api/v1/owner/agents/${w.agentId}/payment-requests`, { method: "POST", headers, body: JSON.stringify({ ...body, amount: "30.00", idempotency_key: "paste-3" }) })).json() as { policy: { outcome: string } };
    expect(over.policy.outcome).toBe("budget");
    const listed = await (await w.call("/api/v1/owner/payment-requests", { headers: w.owner })).json() as { requests: { policy_outcome: string }[] };
    expect(listed.requests.some((row) => row.policy_outcome === "budget")).toBe(true);
    w.api.close();
  });
});

describe("verifyOwnerTransfer", () => {
  const owner = Keypair.generate().publicKey.toBase58();
  const recipient = Keypair.generate().publicKey.toBase58();
  const destination = getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(recipient)).toBase58();
  const expected: OwnerTransferExpected = { signature: "sig", mint, amountBase: "1500000", recipient, owner };
  const transferChecked = (info: Record<string, unknown>) => ({
    program: "spl-token",
    programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
    parsed: { type: "transferChecked", info: { source: "src", mint, destination, authority: owner, tokenAmount: { amount: "1500000", decimals: 6 }, ...info } },
  });
  const rpc = (tx: unknown) => ({ getParsedTransaction: async () => tx as ParsedTransactionWithMeta | null });
  const tx = (top: unknown[], inner: unknown[] = [], err: unknown = null) => ({
    meta: { err, innerInstructions: inner.length ? [{ index: 0, instructions: inner }] : [] },
    transaction: { message: { instructions: top } },
  });

  test("accepts exactly this amount to the recipient's token account from the owner, top-level or inner", async () => {
    expect(await verifyOwnerTransfer(rpc(tx([transferChecked({})])), expected)).toEqual({ ok: true });
    expect(await verifyOwnerTransfer(rpc(tx([], [transferChecked({})])), expected)).toEqual({ ok: true });
  });

  test("refuses a transfer from another authority, of another amount or mint, or to another account", async () => {
    for (const info of [{ authority: recipient }, { tokenAmount: { amount: "1500001" } }, { mint: owner }, { destination: owner }]) {
      expect(await verifyOwnerTransfer(rpc(tx([transferChecked(info)])), expected)).toMatchObject({ ok: false, code: "TRANSFER_MISMATCH", retryable: false });
    }
  });

  test("a failed transaction is final; a missing one is retryable", async () => {
    expect(await verifyOwnerTransfer(rpc(tx([transferChecked({})], [], { InstructionError: [0, "Custom"] })), expected)).toMatchObject({ ok: false, code: "TX_FAILED", retryable: false });
    expect(await verifyOwnerTransfer(rpc(null), expected)).toMatchObject({ ok: false, code: "TX_NOT_FOUND", retryable: true });
  });
});
