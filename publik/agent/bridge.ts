import { createInterface } from "node:readline";

/**
 * MCP bridge for an agent runtime. Every tool call is forwarded to the Publik agent API with the paired
 * bearer credential, so payment requests land in the owner's Requests inbox. The bridge keeps no request
 * state and holds no wallet key.
 */
export interface BridgeApi {
  origin: string;
  token: string;
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
}

export interface BridgeContext {
  /** null when this machine is not paired. tools/list still works; tools/call returns an error result. */
  api: BridgeApi | null;
}

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: {
    name?: string;
    arguments?: Record<string, unknown>;
    protocolVersion?: string;
    [key: string]: unknown;
  };
}

const NOT_PAIRED = "This bridge is not paired with Publik. Run `bun agent/publik.ts connect <name>` and approve the code in Publik first.";

const TOOLS = [
  {
    name: "publik_get_rules",
    description: "Get this agent's Publik spending rules: daily Test USDC limit, what is already spent or reserved today, and whether the owner paused it.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "publik_request_payment",
    description: "Ask the owner for a Test USDC payment on Solana devnet. The request waits in the owner's Requests inbox; the owner signs it with their own wallet or rejects it. This does not move funds by itself.",
    inputSchema: {
      type: "object",
      properties: {
        amount: { type: "string", description: "Amount in Test USDC, at most 6 decimals (e.g. '5.00')" },
        recipient: { type: "string", description: "Recipient Solana wallet address" },
        reason: { type: "string", description: "Why the agent needs this payment. The owner reads it." },
        idempotencyKey: { type: "string", description: "Stable key for this payment. Reuse it on retry so a retry cannot create a second request." },
      },
      required: ["amount", "recipient"],
    },
  },
  {
    name: "publik_get_status",
    description: "Check a payment request by id. Status is pending_review, blocked, rejected, submitted, or confirmed; confirmed includes the devnet signature.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "request_id returned by publik_request_payment" } },
      required: ["id"],
    },
  },
  {
    name: "publik_get_balance",
    description: "Get the balances Publik observes for this agent. An unread balance is reported as unavailable, not zero.",
    inputSchema: { type: "object", properties: {} },
  },
];

function reply(id: JsonRpcMessage["id"], body: { result: unknown } | { error: { code: number; message: string } }): string {
  return JSON.stringify({ jsonrpc: "2.0", id: id ?? null, ...body });
}

function toolResult(id: JsonRpcMessage["id"], payload: unknown, isError: boolean): string {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload);
  return reply(id, { result: { content: [{ type: "text", text }], isError } });
}

/** Calls the agent API and returns the parsed body, or an MCP-ready error text with the API's code and message. */
async function callApi(api: BridgeApi, path: string, init: RequestInit = {}): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; text: string }> {
  let response: Response;
  try {
    response = await api.fetch(`${api.origin}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${api.token}`, "content-type": "application/json", ...init.headers },
    });
  } catch (caught) {
    return { ok: false, text: `Publik API at ${api.origin} did not answer: ${caught instanceof Error ? caught.message : String(caught)}` };
  }
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (response.ok) return { ok: true, body };
  const failure = body.error as { code?: string; message?: string } | undefined;
  return { ok: false, text: `${failure?.code ?? `HTTP_${response.status}`}: ${failure?.message ?? "The Publik API refused the call."}` };
}

async function callTool(api: BridgeApi, name: string | undefined, args: Record<string, unknown>): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; text: string }> {
  if (name === "publik_get_rules") return callApi(api, "/api/v1/agent/rules");
  if (name === "publik_get_balance") return callApi(api, "/api/v1/agent/balances");
  if (name === "publik_get_status") {
    const id = typeof args.id === "string" ? args.id.trim() : "";
    if (!id) return { ok: false, text: "id is required." };
    return callApi(api, `/api/v1/payment-requests/${encodeURIComponent(id)}`);
  }
  if (name === "publik_request_payment") {
    const rules = await callApi(api, "/api/v1/agent/rules");
    if (!rules.ok) return rules;
    const token = rules.body.token as { mint?: string } | undefined;
    const key = typeof args.idempotencyKey === "string" && args.idempotencyKey.trim() ? args.idempotencyKey.trim() : crypto.randomUUID();
    return callApi(api, "/api/v1/payment-requests", {
      method: "POST",
      headers: { "idempotency-key": key },
      body: JSON.stringify({
        network: rules.body.network,
        mint: token?.mint,
        amount: typeof args.amount === "number" ? String(args.amount) : args.amount,
        recipient: args.recipient,
        reason: args.reason ?? "",
      }),
    });
  }
  return { ok: false, text: `Unknown tool: ${name}` };
}

export async function handleMcp(line: string, ctx: BridgeContext): Promise<string | null> {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let msg: JsonRpcMessage;
  try {
    msg = JSON.parse(trimmed) as JsonRpcMessage;
  } catch {
    return reply(null, { error: { code: -32700, message: "Parse error" } });
  }
  if (!msg || typeof msg !== "object") return reply(null, { error: { code: -32600, message: "Invalid Request" } });
  if (msg.method === "notifications/initialized" || msg.method === "initialized") return null;

  if (msg.method === "initialize") {
    return reply(msg.id, {
      result: {
        protocolVersion: msg.params?.protocolVersion ?? "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "publik-bridge", version: "0.2.0" },
      },
    });
  }
  if (msg.method === "tools/list") return reply(msg.id, { result: { tools: TOOLS } });
  if (msg.method === "tools/call") {
    const name = msg.params?.name;
    if (!TOOLS.some((tool) => tool.name === name)) return reply(msg.id, { error: { code: -32602, message: `Unknown tool: ${name}` } });
    if (!ctx.api) return toolResult(msg.id, NOT_PAIRED, true);
    const outcome = await callTool(ctx.api, name, msg.params?.arguments ?? {});
    return outcome.ok ? toolResult(msg.id, outcome.body, false) : toolResult(msg.id, outcome.text, true);
  }
  return reply(msg.id, { error: { code: -32601, message: `Method not found: ${msg.method}` } });
}

/** Reads the credential `bun agent/publik.ts connect` stored next to this file. */
export async function loadBridgeApi(): Promise<BridgeApi | null> {
  const credential = Bun.file(new URL("./.publik-credential", import.meta.url));
  if (!(await credential.exists())) return null;
  const token = (await credential.text()).trim();
  if (!token) return null;
  return { origin: process.env.PUBLIK_PUBLIC_ORIGIN ?? "http://127.0.0.1:5173", token, fetch };
}

export function startLocalBridge(ctx: BridgeContext, port = 0): { port: number; stop: () => void } {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    async fetch(request) {
      if (request.method === "GET" && new URL(request.url).pathname === "/health") {
        return new Response("ok", { headers: { "Access-Control-Allow-Origin": "http://localhost:5174" } });
      }
      if (request.method === "POST") {
        const result = await handleMcp(await request.text(), ctx);
        return new Response(result ?? "", {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "http://localhost:5174",
          },
        });
      }
      return new Response("not found", { status: 404 });
    },
  });
  return { port: server.port ?? port, stop: () => server.stop(true) };
}

if (import.meta.main) {
  const ctx: BridgeContext = { api: await loadBridgeApi() };
  if (!ctx.api) process.stderr.write(`${NOT_PAIRED}\n`);
  if (process.env.PUBLIK_BRIDGE_HTTP === "1") startLocalBridge(ctx, Number(process.env.PUBLIK_BRIDGE_PORT ?? 8788));
  const rl = createInterface({ input: process.stdin, terminal: false });
  rl.on("line", (line: string) => {
    void handleMcp(line, ctx).then((res) => {
      if (res !== null) process.stdout.write(`${res}\n`);
    });
  });
}
