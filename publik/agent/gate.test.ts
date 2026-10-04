import { describe, expect, test } from "bun:test";
import { maySignDelegated } from "./gate";

describe("delegated signing gate", () => {
  test("does not sign when the program is not deployed, even if a transaction is attached", () => {
    expect(maySignDelegated({ deployed: false, transaction: { program: "vault" } })).toBe(false);
    expect(maySignDelegated({ deployed: false, transaction: null })).toBe(false);
    expect(maySignDelegated({ deployed: true, transaction: null })).toBe(false);
  });

  test("gates on chain-verified state and rejects server-provided transactions", () => {
    const validVault = {
      paused: false,
      revoked: false,
      executionKey: "exec111111111111111111111111111111111111111",
      owner: "owner11111111111111111111111111111111111111",
      recipients: ["recip1111111111111111111111111111111111111"],
    };

    // Allows when deployed and verified directly on chain
    expect(maySignDelegated({
      deployed: true,
      chainVerified: true,
      vault: validVault,
      agentKey: "exec111111111111111111111111111111111111111",
      recipient: "recip1111111111111111111111111111111111111",
    })).toBe(true);

    // Rejects server-provided transactions even if chain is verified
    expect(maySignDelegated({
      deployed: true,
      chainVerified: true,
      transaction: { programId: "vault" },
      vault: validVault,
    })).toBe(false);

    // Rejects when chainVerified is missing or false
    expect(maySignDelegated({
      deployed: true,
      chainVerified: false,
      vault: validVault,
    })).toBe(false);

    // Rejects when paused or revoked
    expect(maySignDelegated({
      deployed: true,
      chainVerified: true,
      vault: { ...validVault, paused: true },
    })).toBe(false);
    expect(maySignDelegated({
      deployed: true,
      chainVerified: true,
      vault: { ...validVault, revoked: true },
    })).toBe(false);

    // Rejects when execution key does not match or equals owner
    expect(maySignDelegated({
      deployed: true,
      chainVerified: true,
      vault: validVault,
      agentKey: "differentKey",
    })).toBe(false);
    expect(maySignDelegated({
      deployed: true,
      chainVerified: true,
      vault: validVault,
      agentKey: validVault.owner,
    })).toBe(false);

    // Rejects unallowlisted recipient
    expect(maySignDelegated({
      deployed: true,
      chainVerified: true,
      vault: validVault,
      recipient: "notOnAllowlist",
    })).toBe(false);
  });
});
