import { describe, expect, test } from "bun:test";
import { Keypair } from "@solana/web3.js";
import nacl from "tweetnacl";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app";
import { handleMcp, type BridgeContext } from "./bridge";

const origin = "http://127.0.0.1:5173";
const recipient = Keypair.generate().publicKey.toBase58();

/** A real API in a temp database, an owner session, and a paired agent wired into a bridge context. */
async function pairedBridge() {
  const api = createApp({ dbPath: join(mkdtempSync(join(tmpdir(), "publik-bridge-")), "api.sqlite"), publicOrigin: origin, apiOrigin: origin });
  const call = (path: string, init?: RequestInit) => api.handle(new Request(`${origin}${path}`, init));
  const wallet = Keypair.generate();
  const challenge = await (await call("/api/v1/owner/challenge", { method: "POST", body: JSON.stringify({ wallet: wallet.publicKey.toBase58() }) })).json() as { nonce: string; message: string };
  const signature = Buffer.from(nacl.sign.detached(new TextEncoder().encode(challenge.message), wallet.secretKey)).toString("base64");
  const session = await call("/api/v1/owner/session", { method: "POST", body: JSON.stringify({ wallet: wallet.publicKey.toBase58(), signature, nonce: challenge.nonce }) });
  const owner = { cookie: session.headers.get("set-cookie")?.split(";")[0] ?? "", "x-csrf-token": (await session.json() as { csrf: string }).csrf };
  const started = await (await call("/api/v1/agent-connections", { method: "POST", body: JSON.stringify({ name: "Scout", client: { name: "test", version: "1" } }) })).json() as { user_code: string; device_code: string };
  const approved = await (await call("/api/v1/owner/agent-connections/approve", { method: "POST", headers: owner, body: JSON.stringify({ user_code: started.user_code }) })).json() as { agent_id: string };
  const token = await (await call("/api/v1/agent-connections/token", { method: "POST", body: JSON.stringify({ device_code: started.device_code }) })).json() as { access_token: string };
  const ctx: BridgeContext = { api: { origin, token: token.access_token, fetch: (input, init) => api.handle(new Request(input, init)) } };
  return { api, call, owner, agentId: approved.agent_id, ctx };
}

async function tool(ctx: BridgeContext, name: string, args: Record<string, unknown> = {}) {
  const raw = await handleMcp(JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name, arguments: args } }), ctx);
  const parsed = JSON.parse(raw!) as { result: { content: { text: string }[]; isError: boolean } };
  const text = parsed.result.content[0]!.text;
  return { isError: parsed.result.isError, text, body: parsed.result.isError ? null : JSON.parse(text) as Record<string, unknown> };
}

describe("agent bridge", () => {
  test("a bridge request lands in the owner's inbox and its status follows the owner's decision", async () => {
    const { api, call, owner, ctx } = await pairedBridge();
    const args = { amount: "3.50", recipient, reason: "GPU hour", idempotencyKey: "gpu-1" };
    const created = await tool(ctx, "publik_request_payment", args);
    expect(created.isError).toBe(false);
    expect(created.body?.status).toBe("pending_review");

    const retried = await tool(ctx, "publik_request_payment", args);
    expect(retried.body?.request_id).toBe(created.body?.request_id);

    const inbox = await (await call("/api/v1/owner/payment-requests", { headers: owner })).json() as { requests: { id: string; agent_name: string; amount_base: string; reason: string; status: string }[] };
    expect(inbox.requests).toHaveLength(1);
    expect(inbox.requests[0]).toMatchObject({ id: created.body?.request_id, agent_name: "Scout", amount_base: "3500000", reason: "GPU hour", status: "pending_review" });

    await call(`/api/v1/owner/payment-requests/${created.body?.request_id}/reject`, { method: "POST", headers: owner });
    const status = await tool(ctx, "publik_get_status", { id: created.body?.request_id });
    expect(status.body?.status).toBe("rejected");
    api.close();
  });

  test("a paused agent's request is recorded as blocked, not queued for signing", async () => {
    const { api, call, owner, agentId, ctx } = await pairedBridge();
    await call(`/api/v1/owner/agents/${agentId}/pause`, { method: "POST", headers: owner });
    const created = await tool(ctx, "publik_request_payment", { amount: "1", recipient });
    expect(created.body?.status).toBe("blocked");
    const rules = await tool(ctx, "publik_get_rules");
    expect(rules.body?.paused).toBe(true);
    api.close();
  });

  test("API refusals come back as tool errors with the API code", async () => {
    const { api, ctx } = await pairedBridge();
    const bad = await tool(ctx, "publik_request_payment", { amount: "1.00", recipient: "not-an-address" });
    expect(bad.isError).toBe(true);
    expect(bad.text).toStartWith("INVALID_RECIPIENT");
    const missing = await tool(ctx, "publik_get_status", { id: "req_unknown" });
    expect(missing.isError).toBe(true);
    expect(missing.text).toStartWith("NOT_FOUND");
    api.close();
  });

  test("an unpaired bridge lists tools but refuses calls with the pairing command", async () => {
    const ctx: BridgeContext = { api: null };
    const listed = JSON.parse((await handleMcp(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }), ctx))!) as { result: { tools: { name: string }[] } };
    expect(listed.result.tools.map((item) => item.name)).toEqual(["publik_get_rules", "publik_request_payment", "publik_get_status", "publik_get_balance"]);
    const refused = await tool(ctx, "publik_request_payment", { amount: "1", recipient });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("agent/publik.ts connect");
  });

  test("speaks JSON-RPC: notifications are silent, bad input and unknown names are errors", async () => {
    const ctx: BridgeContext = { api: null };
    expect(await handleMcp("   ", ctx)).toBeNull();
    expect(await handleMcp(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }), ctx)).toBeNull();
    expect(JSON.parse((await handleMcp("{ nope", ctx))!).error.code).toBe(-32700);
    expect(JSON.parse((await handleMcp(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "resources/list" }), ctx))!).error.code).toBe(-32601);
    expect(JSON.parse((await handleMcp(JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "publik_send_now" } }), ctx))!).error.code).toBe(-32602);
  });
});
