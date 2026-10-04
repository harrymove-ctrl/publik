import { describe, expect, test } from "bun:test";
import { startLocalBridge } from "./bridge";

describe("local bridge", () => {
  test("answers on 127.0.0.1 and lists tools", async () => {
    const bridge = startLocalBridge(0);
    try {
      const health = await fetch(`http://127.0.0.1:${bridge.port}/health`);
      expect(await health.text()).toBe("ok");
      const listed = await fetch(`http://127.0.0.1:${bridge.port}/`, {
        method: "POST",
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      const body = await listed.json() as { result: { tools: { name: string }[] } };
      expect(body.result.tools.map((tool) => tool.name)).toContain("publik_request_payment");
    } finally {
      bridge.stop();
    }
  });
});
