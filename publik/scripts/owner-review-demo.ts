/**
 * Runs the owner-signed review loop against a real cluster with real transactions:
 * agent (MCP bridge) → Publik API → owner inbox → owner-signed transfer → on-chain verification → agent status.
 *
 *   bun scripts/owner-review-demo.ts --rpc https://api.devnet.solana.com
 *
 * The owner is ~/.config/publik/demo-owner.json (never printed) and must hold a little SOL. The script creates
 * its own six-decimal test mint, starts the API on 127.0.0.1 with a throwaway database, and never touches mainnet.
 */
import { createAssociatedTokenAccountIdempotentInstruction, createMintToInstruction, getAssociatedTokenAddressSync, getAccount } from "@solana/spl-token";
import type { PublicKey } from "@solana/web3.js";
import { mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import nacl from "tweetnacl";
import { handleMcp, type BridgeContext } from "../agent/bridge";
import { createApp } from "../server/app";
import { verifyOwnerTransfer } from "../server/chain";
import { buildOwnerUsdcPayment } from "../src/solana/ownerPay";
import { createTestMint, loadKey, openCluster, send } from "./devnet";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const rpc = flag("rpc") ?? "https://api.devnet.solana.com";
const keyDir = flag("keys") ?? join(homedir(), ".config", "publik");
const { connection, cluster, explorer } = await openCluster(rpc);
const owner = loadKey(keyDir, "demo-owner");
const recipient = loadKey(keyDir, "demo-recipient").publicKey;

let step = 0;
function report(title: string, detail: Record<string, unknown>) {
  step += 1;
  console.log(`\n${step}. ${title}`);
  for (const [key, value] of Object.entries(detail)) console.log(`   ${key}: ${String(value)}`);
}
function expectEqual(actual: unknown, expected: unknown, what: string) {
  if (actual !== expected) throw new Error(`${what}: expected ${String(expected)}, got ${String(actual)}`);
}

// 1. Test mint and owner funds.
const mint = await createTestMint(connection, owner, owner.publicKey);
const ownerAta = getAssociatedTokenAddressSync(mint, owner.publicKey);
const funded = await send(connection, [
  createAssociatedTokenAccountIdempotentInstruction(owner.publicKey, ownerAta, owner.publicKey, mint),
  createMintToInstruction(mint, ownerAta, owner.publicKey, 10_000_000n),
], [owner]);
report("Owner holds 10.00 of a fresh six-decimal test mint", { cluster, mint: mint.toBase58(), owner: owner.publicKey.toBase58(), explorer: explorer(funded) });

const api = createApp({
  dbPath: join(mkdtempSync(join(tmpdir(), "publik-review-demo-")), "api.sqlite"),
  publicOrigin: "http://127.0.0.1:5173",
  apiOrigin: "http://127.0.0.1:5173",
  mint: mint.toBase58(),
  verifyChain: (expected) => verifyOwnerTransfer(connection, expected),
});
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (request) => api.handle(request) });
const origin = `http://127.0.0.1:${server.port}`;
const call = (path: string, init?: RequestInit) => fetch(`${origin}${path}`, init);

try {
  // 2. Owner session from a signed challenge.
  const challenge = await (await call("/api/v1/owner/challenge", { method: "POST", body: JSON.stringify({ wallet: owner.publicKey.toBase58() }) })).json() as { nonce: string; message: string };
  const proof = Buffer.from(nacl.sign.detached(new TextEncoder().encode(challenge.message), owner.secretKey)).toString("base64");
  const session = await call("/api/v1/owner/session", { method: "POST", body: JSON.stringify({ wallet: owner.publicKey.toBase58(), signature: proof, nonce: challenge.nonce }) });
  const ownerHeaders = { cookie: session.headers.get("set-cookie")?.split(";")[0] ?? "", "x-csrf-token": (await session.json() as { csrf: string }).csrf };

  // 3. Agent pairs with the device flow; the owner approves the code.
  const started = await (await call("/api/v1/agent-connections", { method: "POST", body: JSON.stringify({ name: "Review demo agent", client: { name: "owner-review-demo", version: "1" } }) })).json() as { user_code: string; device_code: string };
  await call("/api/v1/owner/agent-connections/approve", { method: "POST", headers: ownerHeaders, body: JSON.stringify({ user_code: started.user_code }) });
  const token = (await (await call("/api/v1/agent-connections/token", { method: "POST", body: JSON.stringify({ device_code: started.device_code }) })).json() as { access_token: string }).access_token;
  const bridge: BridgeContext = { api: { origin, token, fetch } };
  report("Agent paired and the owner signed in", { api: origin, owner_session: "challenge signed by demo-owner" });

  let rpcId = 0;
  const tool = async (name: string, toolArgs: Record<string, unknown> = {}) => {
    const raw = await handleMcp(JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: toolArgs } }), bridge);
    const result = (JSON.parse(raw!) as { result: { content: { text: string }[]; isError: boolean } }).result;
    if (result.isError) throw new Error(`${name} failed: ${result.content[0]!.text}`);
    return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
  };
  const inbox = async () => (await (await call("/api/v1/owner/payment-requests", { headers: ownerHeaders })).json() as { requests: Array<{ id: string; agent_name: string; amount_base: string; status: string }> }).requests;
  const recordSignature = async (id: string, signature: string) => {
    for (let attempt = 0; attempt < 6; attempt++) {
      const response = await call(`/api/v1/owner/payment-requests/${id}/signature`, { method: "POST", headers: ownerHeaders, body: JSON.stringify({ signature }) });
      const body = await response.json() as { status?: string; error?: { code: string; message: string } };
      if (response.status !== 202) return { http: response.status, ...body };
      await Bun.sleep(1500);
    }
    throw new Error(`${signature} never became readable from ${cluster}.`);
  };
  const ownerPays = async (to: PublicKey, amountBase: bigint) => {
    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    const destination = getAssociatedTokenAddressSync(mint, to, true);
    const createDestination = (await connection.getAccountInfo(destination)) === null;
    const tx = await buildOwnerUsdcPayment({ owner: owner.publicKey.toBase58(), destinationOwner: to.toBase58(), mint: mint.toBase58(), amountBase, blockhash, createDestination });
    return send(connection, tx, [owner]);
  };

  // 4. Rules through the bridge.
  const rules = await tool("publik_get_rules");
  expectEqual((rules.token as { mint: string }).mint, mint.toBase58(), "rules mint");
  report("Bridge reads the agent's rules", { daily_limit_base: rules.daily_limit_base, payment_execution: rules.payment_execution });

  // 5. The agent asks for 1.25 through the bridge.
  const created = await tool("publik_request_payment", { amount: "1.25", recipient: recipient.toBase58(), reason: "Owner review demo", idempotencyKey: `review-${Date.now()}` });
  expectEqual(created.status, "pending_review", "new request status");
  const requestId = String(created.request_id);
  report("Agent requested 1.25 through the MCP bridge", { request_id: requestId, status: created.status });

  // 6. It is in the owner's inbox.
  const listed = (await inbox()).find((row) => row.id === requestId);
  expectEqual(listed?.agent_name, "Review demo agent", "inbox agent name");
  report("Owner inbox lists it", { agent: listed?.agent_name, amount_base: listed?.amount_base, status: listed?.status });

  // 7. Owner signs the transfer with the same builder the inbox uses.
  const paid = await ownerPays(recipient, 1_250_000n);
  const recipientBalance = (await getAccount(connection, getAssociatedTokenAddressSync(mint, recipient))).amount;
  report("Owner signed and landed the transfer", { signature: paid, recipient_balance_base: recipientBalance, explorer: explorer(paid) });

  // 8. API verifies it on chain.
  const confirmed = await recordSignature(requestId, paid);
  expectEqual(confirmed.status, "confirmed", "recorded status");
  report("API read the transfer on chain and confirmed the request", { http: confirmed.http, status: confirmed.status });

  // 9. The agent sees the result through the bridge.
  const seen = await tool("publik_get_status", { id: requestId });
  expectEqual(seen.status, "confirmed", "agent-visible status");
  expectEqual(seen.signature, paid, "agent-visible signature");
  report("Agent reads confirmed + signature through the bridge", { status: seen.status, signature: seen.signature });

  // 10. A transfer of the wrong amount does not confirm a request.
  const short = String((await tool("publik_request_payment", { amount: "0.75", recipient: recipient.toBase58(), reason: "Mismatch check" })).request_id);
  const shortPaid = await ownerPays(recipient, 700_000n);
  const mismatch = await recordSignature(short, shortPaid);
  expectEqual(mismatch.error?.code, "TRANSFER_MISMATCH", "wrong-amount verification");
  expectEqual((await tool("publik_get_status", { id: short })).status, "pending_review", "status after mismatch");
  report("A 0.70 transfer for a 0.75 request is refused and the request returns to review", { code: mismatch.error?.code, explorer: explorer(shortPaid) });

  // 11. One transfer cannot confirm two requests.
  const replay = await recordSignature(short, paid);
  expectEqual(replay.http, 409, "signature replay");
  report("Replaying the confirmed signature on another request is refused", { http: replay.http, code: replay.error?.code });

  // 12. Owner rejects; the agent sees it.
  await call(`/api/v1/owner/payment-requests/${short}/reject`, { method: "POST", headers: ownerHeaders });
  expectEqual((await tool("publik_get_status", { id: short })).status, "rejected", "status after reject");
  report("Owner rejected the other request; the bridge reports rejected", { request_id: short });

  // 13. Over the daily limit is blocked before it reaches the owner's wallet.
  const over = await tool("publik_request_payment", { amount: "30.00", recipient: recipient.toBase58(), reason: "Over limit" });
  expectEqual(over.status, "blocked", "over-limit status");
  report("A 30.00 request against the 25.00 daily limit is blocked", { status: over.status });

  console.log(`\nAll ${step} steps passed on ${cluster}.`);
} finally {
  server.stop(true);
  api.close();
}
