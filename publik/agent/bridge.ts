import { createInterface } from "node:readline";

export interface AgentRules {
  name: string;
  address: string | null;
  dailyUsdc: string | number;
  spentToday: string | number;
  allowedRecipients: unknown[];
  paused: boolean;
}

export interface AgentLike {
  name?: string;
  address?: string | null;
  dailyUsdc?: string | number;
  spentToday?: string | number;
  allowedRecipients?: unknown[];
  paused?: boolean;
  status?: string;
  permissions?: {
    dailyUsdcBase?: string;
    allowedRecipients?: unknown[];
    [key: string]: unknown;
  };
  spentTodayBase?: string;
  [key: string]: unknown;
}

export interface PaymentRequestInput {
  amount: string | number;
  recipient: string;
  reason?: string;
  idempotencyKey?: string;
  paused?: boolean;
}

export interface PaymentRequest {
  id: string;
  amount: string;
  recipient: string;
  reason: string;
  idempotencyKey?: string;
  status: "pending" | "paused" | "completed" | "failed";
  createdAt: string;
}

export interface BridgeContext {
  agent?: AgentLike;
  store?: Map<string, PaymentRequest>;
  balance?: unknown;
  paused?: boolean;
  [key: string]: unknown;
}

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: {
    name?: string;
    tool?: string;
    arguments?: Record<string, unknown>;
    input?: Record<string, unknown>;
    args?: Record<string, unknown>;
    protocolVersion?: string;
    [key: string]: unknown;
  };
}

const defaultStore = new Map<string, PaymentRequest>();

export function getRules(agent: unknown): AgentRules {
  if (!agent || typeof agent !== "object") {
    return {
      name: "",
      address: null,
      dailyUsdc: "0.00",
      spentToday: "0.00",
      allowedRecipients: [],
      paused: false,
    };
  }

  const record = agent as AgentLike;
  const name = typeof record.name === "string" ? record.name : "";
  const address = typeof record.address === "string" ? record.address : null;
  const paused =
    typeof record.paused === "boolean"
      ? record.paused
      : record.status === "paused";

  let dailyUsdc: string | number = "0.00";
  if (record.dailyUsdc !== undefined) {
    dailyUsdc = record.dailyUsdc;
  } else if (record.permissions?.dailyUsdcBase !== undefined) {
    dailyUsdc = (Number(record.permissions.dailyUsdcBase) / 1_000_000).toFixed(2);
  }

  let spentToday: string | number = "0.00";
  if (record.spentToday !== undefined) {
    spentToday = record.spentToday;
  } else if (record.spentTodayBase !== undefined) {
    spentToday = (Number(record.spentTodayBase) / 1_000_000).toFixed(2);
  }

  let allowedRecipients: unknown[] = [];
  if (Array.isArray(record.allowedRecipients)) {
    allowedRecipients = record.allowedRecipients;
  } else if (Array.isArray(record.permissions?.allowedRecipients)) {
    allowedRecipients = record.permissions.allowedRecipients;
  }

  return {
    name,
    address,
    dailyUsdc,
    spentToday,
    allowedRecipients,
    paused,
  };
}

export function requestPayment(
  store: Map<string, PaymentRequest>,
  input: PaymentRequestInput
): { id?: string; status: string } {
  if (input.paused) {
    return { status: "paused" };
  }

  if (input.idempotencyKey) {
    for (const req of store.values()) {
      if (req.idempotencyKey === input.idempotencyKey) {
        return { id: req.id, status: req.status };
      }
    }
  }

  const id = crypto.randomUUID();
  const record: PaymentRequest = {
    id,
    amount: String(input.amount),
    recipient: input.recipient,
    reason: input.reason ?? "",
    idempotencyKey: input.idempotencyKey,
    status: "pending",
    createdAt: new Date().toISOString(),
  };

  store.set(id, record);
  return { id, status: "pending" };
}

export function getStatus(store: Map<string, PaymentRequest>, id: string): PaymentRequest | null {
  return store.get(id) ?? null;
}

export function handleMcp(line: string, ctx?: BridgeContext): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let msg: JsonRpcMessage;
  try {
    msg = JSON.parse(trimmed) as JsonRpcMessage;
  } catch {
    return JSON.stringify({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Parse error" },
    });
  }

  if (!msg || typeof msg !== "object") {
    return JSON.stringify({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32600, message: "Invalid Request" },
    });
  }

  if (msg.method === "notifications/initialized" || msg.method === "initialized") {
    return null;
  }

  const id = msg.id !== undefined ? msg.id : null;
  const method = msg.method;
  const store = ctx?.store ?? defaultStore;

  if (method === "initialize") {
    return JSON.stringify({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: msg.params?.protocolVersion ?? "2024-11-05",
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: "publik-bridge",
          version: "0.1.0",
        },
      },
    });
  }

  if (method === "tools/list") {
    return JSON.stringify({
      jsonrpc: "2.0",
      id,
      result: {
        tools: [
          {
            name: "publik_get_rules",
            description: "Get the agent's spending rules, daily budget limits, and allowed recipients.",
            inputSchema: {
              type: "object",
              properties: {},
            },
          },
          {
            name: "publik_request_payment",
            description: "Request a USDC payment from the Publik wallet on Solana devnet.",
            inputSchema: {
              type: "object",
              properties: {
                amount: { type: "string", description: "Payment amount in USDC (e.g. '5.00')" },
                recipient: { type: "string", description: "Solana recipient address" },
                reason: { type: "string", description: "Reason for the payment request" },
                idempotencyKey: { type: "string", description: "Unique key to prevent duplicate payment requests" },
              },
              required: ["amount", "recipient"],
            },
          },
          {
            name: "publik_get_status",
            description: "Check the status of a previously requested payment by its ID.",
            inputSchema: {
              type: "object",
              properties: {
                id: { type: "string", description: "Payment request ID" },
              },
              required: ["id"],
            },
          },
          {
            name: "publik_get_balance",
            description: "Get agent balance info. Note: balances are read from devnet by Publik, not by this bridge holding a key.",
            inputSchema: {
              type: "object",
              properties: {},
            },
          },
        ],
      },
    });
  }

  if (method === "tools/call") {
    const toolName = msg.params?.name ?? msg.params?.tool;
    const rawArgs = msg.params?.arguments ?? msg.params?.input ?? msg.params?.args ?? {};

    if (toolName === "publik_get_rules") {
      const rules = getRules(ctx?.agent);
      return JSON.stringify({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: JSON.stringify(rules) }],
          ...rules,
        },
      });
    }

    if (toolName === "publik_request_payment") {
      const pausedArg = typeof rawArgs.paused === "boolean" ? rawArgs.paused : undefined;
      const ctxPaused =
        ctx?.paused ??
        (ctx?.agent?.paused || ctx?.agent?.status === "paused") ??
        false;
      const paused = pausedArg ?? ctxPaused;

      const amount = typeof rawArgs.amount === "string" || typeof rawArgs.amount === "number" ? rawArgs.amount : "";
      const recipient = typeof rawArgs.recipient === "string" ? rawArgs.recipient : "";
      const reason = typeof rawArgs.reason === "string" ? rawArgs.reason : undefined;
      const idempotencyKey = typeof rawArgs.idempotencyKey === "string" ? rawArgs.idempotencyKey : undefined;

      const res = requestPayment(store, {
        amount,
        recipient,
        reason,
        idempotencyKey,
        paused,
      });

      return JSON.stringify({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: JSON.stringify(res) }],
          ...res,
        },
      });
    }

    if (toolName === "publik_get_status") {
      const targetId = typeof rawArgs.id === "string" ? rawArgs.id : "";
      const status = getStatus(store, targetId);
      const payload = status ?? { id: targetId, status: "not_found" };
      return JSON.stringify({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: JSON.stringify(payload) }],
          ...payload,
        },
      });
    }

    if (toolName === "publik_get_balance") {
      if (ctx?.balance !== undefined && ctx?.balance !== null) {
        const balancePayload: Record<string, unknown> =
          typeof ctx.balance === "object"
            ? (ctx.balance as Record<string, unknown>)
            : { balance: ctx.balance };
        const text =
          typeof ctx.balance === "string"
            ? ctx.balance
            : JSON.stringify(balancePayload);
        return JSON.stringify({
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text }],
            ...balancePayload,
          },
        });
      }

      const note =
        "Balances are read from devnet by Publik, not by this bridge holding a key.";
      return JSON.stringify({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: note }],
          note,
        },
      });
    }

    return JSON.stringify({
      jsonrpc: "2.0",
      id,
      error: {
        code: -32601,
        message: `Unknown tool: ${toolName}`,
      },
    });
  }

  return JSON.stringify({
    jsonrpc: "2.0",
    id,
    error: {
      code: -32601,
      message: `Method not found: ${method}`,
    },
  });
}
export function startLocalBridge(port = 0): { port: number; stop: () => void } {
  const ctx: BridgeContext = { store: new Map() };
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    fetch(request) {
      if (request.method === "GET" && new URL(request.url).pathname === "/health") {
        return new Response("ok", { headers: { "Access-Control-Allow-Origin": "http://localhost:5174" } });
      }
      if (request.method === "POST") {
        return request.text().then((body) => {
          const result = handleMcp(body, ctx);
          return new Response(result ?? "", {
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "http://localhost:5174",
            },
          });
        });
      }
      return new Response("not found", { status: 404 });
    },
  });
  return { port: server.port ?? port, stop: () => server.stop(true) };
}

if (import.meta.main) {
  if (process.env.PUBLIK_BRIDGE_HTTP === "1") startLocalBridge(Number(process.env.PUBLIK_BRIDGE_PORT ?? 8787));
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  const ctx: BridgeContext = {
    store: new Map(),
  };

  rl.on("line", (line: string) => {
    const res = handleMcp(line, ctx);
    if (res !== null) {
      process.stdout.write(res + "\n");
    }
  });
}
