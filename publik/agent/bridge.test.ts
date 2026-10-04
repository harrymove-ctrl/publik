import { describe, expect, test } from "bun:test";
import {
  getRules,
  requestPayment,
  getStatus,
  handleMcp,
  type PaymentRequest,
} from "./bridge";

describe("agent bridge", () => {
  describe("getRules", () => {
    test("returns agent rules with formatted fields", () => {
      const agent = {
        name: "WorkerAgent",
        address: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
        dailyUsdc: "25.00",
        spentToday: "5.00",
        allowedRecipients: ["4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"],
        paused: false,
      };

      const rules = getRules(agent);
      expect(rules).toEqual({
        name: "WorkerAgent",
        address: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
        dailyUsdc: "25.00",
        spentToday: "5.00",
        allowedRecipients: ["4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"],
        paused: false,
      });
    });

    test("converts dailyUsdcBase and spentTodayBase from domain agent structure", () => {
      const domainAgent = {
        id: "ag-1",
        name: "DevnetRunner",
        address: "So11111111111111111111111111111111111111112",
        status: "paused",
        permissions: {
          dailyUsdcBase: "50000000",
          allowedRecipients: [{ address: "addr1", label: "Vendor" }],
          askBeforeNewRecipient: true,
          enforcement: "simulated" as const,
        },
        spentTodayBase: "12500000",
      };

      const rules = getRules(domainAgent);
      expect(rules.name).toBe("DevnetRunner");
      expect(rules.address).toBe("So11111111111111111111111111111111111111112");
      expect(rules.dailyUsdc).toBe("50.00");
      expect(rules.spentToday).toBe("12.50");
      expect(rules.allowedRecipients).toEqual([{ address: "addr1", label: "Vendor" }]);
      expect(rules.paused).toBe(true);
    });

    test("handles null or empty agent input gracefully", () => {
      const rules = getRules(null);
      expect(rules).toEqual({
        name: "",
        address: null,
        dailyUsdc: "0.00",
        spentToday: "0.00",
        allowedRecipients: [],
        paused: false,
      });
    });
  });

  describe("requestPayment & getStatus", () => {
    test("same idempotency key returns the same id", () => {
      const store = new Map<string, PaymentRequest>();
      const input = {
        amount: "10.00",
        recipient: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
        reason: "Compute payment",
        idempotencyKey: "idem-key-123",
      };

      const first = requestPayment(store, input);
      expect(first.status).toBe("pending");
      expect(first.id).toBeDefined();

      const second = requestPayment(store, input);
      expect(second.id).toBe(first.id);
      expect(second.status).toBe("pending");
      expect(store.size).toBe(1);
    });

    test("a paused agent does not queue", () => {
      const store = new Map<string, PaymentRequest>();
      const input = {
        amount: "5.00",
        recipient: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
        reason: "Refuel request",
        idempotencyKey: "idem-key-456",
        paused: true,
      };

      const result = requestPayment(store, input);
      expect(result.status).toBe("paused");
      expect(result.id).toBeUndefined();
      expect(store.size).toBe(0);
    });

    test("queues payment when not paused and gets status by id", () => {
      const store = new Map<string, PaymentRequest>();
      const res = requestPayment(store, {
        amount: "1.50",
        recipient: "RecipientPubkey11111111111111111111111111",
        reason: "Test fee",
      });

      expect(res.status).toBe("pending");
      expect(typeof res.id).toBe("string");

      const status = getStatus(store, res.id!);
      expect(status).not.toBeNull();
      expect(status?.id).toBe(res.id);
      expect(status?.status).toBe("pending");
      expect(status?.amount).toBe("1.50");
      expect(status?.recipient).toBe("RecipientPubkey11111111111111111111111111");
      expect(status?.reason).toBe("Test fee");
    });

    test("getStatus returns null for unknown id", () => {
      const store = new Map<string, PaymentRequest>();
      expect(getStatus(store, "non-existent-id")).toBeNull();
    });
  });

  describe("handleMcp", () => {
    test("tools/list includes the four names", () => {
      const req = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      });

      const raw = handleMcp(req);
      expect(raw).not.toBeNull();

      const parsed = JSON.parse(raw!) as {
        result: { tools: Array<{ name: string; description: string }> };
      };

      const names = parsed.result.tools.map((t) => t.name);
      expect(names).toContain("publik_get_rules");
      expect(names).toContain("publik_request_payment");
      expect(names).toContain("publik_get_status");
      expect(names).toContain("publik_get_balance");
      expect(names).toHaveLength(4);
    });

    test("initialize responds with server info and capabilities", () => {
      const req = JSON.stringify({
        jsonrpc: "2.0",
        id: "init-1",
        method: "initialize",
        params: { protocolVersion: "2024-11-05" },
      });

      const raw = handleMcp(req);
      expect(raw).not.toBeNull();

      const parsed = JSON.parse(raw!) as {
        id: string;
        result: { serverInfo: { name: string }; capabilities: unknown };
      };
      expect(parsed.id).toBe("init-1");
      expect(parsed.result.serverInfo.name).toBe("publik-bridge");
      expect(parsed.result.capabilities).toBeDefined();
    });

    test("tools/call publik_get_rules calls getRules with context agent", () => {
      const ctx = {
        agent: {
          name: "McpAgent",
          address: "Ag11111111111111111111111111111111111111111",
          dailyUsdc: "100.00",
          spentToday: "0.00",
          allowedRecipients: [],
          paused: false,
        },
      };

      const req = JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "publik_get_rules",
          arguments: {},
        },
      });

      const raw = handleMcp(req, ctx);
      expect(raw).not.toBeNull();

      const parsed = JSON.parse(raw!) as {
        id: number;
        result: { content: Array<{ text: string }>; name: string; dailyUsdc: string };
      };
      expect(parsed.id).toBe(2);
      expect(parsed.result.name).toBe("McpAgent");
      expect(parsed.result.dailyUsdc).toBe("100.00");
      expect(parsed.result.content[0].text).toContain("McpAgent");
    });

    test("tools/call publik_request_payment queues payment and respects idempotency", () => {
      const store = new Map<string, PaymentRequest>();
      const ctx = { store };

      const makeReq = (id: number) =>
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          method: "tools/call",
          params: {
            name: "publik_request_payment",
            arguments: {
              amount: "15.00",
              recipient: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
              reason: "LLM inference",
              idempotencyKey: "inference-task-1",
            },
          },
        });

      const raw1 = handleMcp(makeReq(10), ctx);
      const parsed1 = JSON.parse(raw1!) as { result: { id: string; status: string } };
      expect(parsed1.result.status).toBe("pending");
      const createdId = parsed1.result.id;

      const raw2 = handleMcp(makeReq(11), ctx);
      const parsed2 = JSON.parse(raw2!) as { result: { id: string; status: string } };
      expect(parsed2.result.id).toBe(createdId);
      expect(parsed2.result.status).toBe("pending");
      expect(store.size).toBe(1);
    });

    test("tools/call publik_request_payment does not queue when agent is paused in context", () => {
      const store = new Map<string, PaymentRequest>();
      const ctx = {
        store,
        agent: {
          name: "PausedAgent",
          status: "paused",
        },
      };

      const req = JSON.stringify({
        jsonrpc: "2.0",
        id: 12,
        method: "tools/call",
        params: {
          name: "publik_request_payment",
          arguments: {
            amount: "5.00",
            recipient: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
            reason: "Should not queue",
          },
        },
      });

      const raw = handleMcp(req, ctx);
      const parsed = JSON.parse(raw!) as { result: { status: string; id?: string } };
      expect(parsed.result.status).toBe("paused");
      expect(parsed.result.id).toBeUndefined();
      expect(store.size).toBe(0);
    });

    test("tools/call publik_get_status returns stored status", () => {
      const store = new Map<string, PaymentRequest>();
      const queued = requestPayment(store, {
        amount: "2.00",
        recipient: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
      });

      const ctx = { store };
      const req = JSON.stringify({
        jsonrpc: "2.0",
        id: 20,
        method: "tools/call",
        params: {
          name: "publik_get_status",
          arguments: { id: queued.id },
        },
      });

      const raw = handleMcp(req, ctx);
      const parsed = JSON.parse(raw!) as { result: { status: string; id: string } };
      expect(parsed.result.id).toBe(queued.id!);
      expect(parsed.result.status).toBe("pending");
    });

    test("tools/call publik_get_balance returns devnet note when balance not provided", () => {
      const req = JSON.stringify({
        jsonrpc: "2.0",
        id: 30,
        method: "tools/call",
        params: {
          name: "publik_get_balance",
          arguments: {},
        },
      });

      const raw = handleMcp(req, {});
      const parsed = JSON.parse(raw!) as {
        result: { content: Array<{ text: string }>; note: string };
      };
      expect(parsed.result.note).toContain("Balances are read from devnet by Publik, not by this bridge holding a key");
      expect(parsed.result.content[0].text).toContain("Balances are read from devnet by Publik, not by this bridge holding a key");
    });

    test("tools/call publik_get_balance returns balance when ctx.balance is provided", () => {
      const ctx = {
        balance: {
          usdc: "50.00",
          sol: "1.25",
        },
      };

      const req = JSON.stringify({
        jsonrpc: "2.0",
        id: 31,
        method: "tools/call",
        params: {
          name: "publik_get_balance",
          arguments: {},
        },
      });

      const raw = handleMcp(req, ctx);
      const parsed = JSON.parse(raw!) as {
        result: { content: Array<{ text: string }>; usdc: string; sol: string };
      };
      expect(parsed.result.usdc).toBe("50.00");
      expect(parsed.result.sol).toBe("1.25");
    });

    test("returns null for notification lines and empty lines", () => {
      expect(handleMcp("")).toBeNull();
      expect(handleMcp("   ")).toBeNull();
      expect(
        handleMcp(
          JSON.stringify({
            jsonrpc: "2.0",
            method: "notifications/initialized",
          })
        )
      ).toBeNull();
    });

    test("returns jsonrpc error for invalid JSON or unknown method", () => {
      const parseErr = handleMcp("{ invalid json");
      expect(parseErr).not.toBeNull();
      expect(JSON.parse(parseErr!).error.code).toBe(-32700);

      const unknownMethod = handleMcp(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 99,
          method: "non_existent_method",
        })
      );
      expect(unknownMethod).not.toBeNull();
      expect(JSON.parse(unknownMethod!).error.code).toBe(-32601);
    });
  });
});
