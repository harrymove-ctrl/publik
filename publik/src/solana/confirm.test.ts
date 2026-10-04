import { describe, expect, test } from "bun:test";
import { chainPaymentState, pendingDuplicate, reconcileSavedSignature } from "./confirm";

describe("devnet confirmation", () => {
  test("does not call a missing or timed-out signature confirmed", () => {
    expect(chainPaymentState({ signature: null, err: null, confirmationStatus: null, timedOut: false })).toBe("unknown");
    expect(chainPaymentState({ signature: "sig", err: null, confirmationStatus: null, timedOut: false })).toBe("submitted");
    expect(chainPaymentState({ signature: "sig", err: null, confirmationStatus: "processed", timedOut: true })).toBe("unknown");
    expect(chainPaymentState({ signature: "sig", err: { InstructionError: [0, "Custom"] }, confirmationStatus: null, timedOut: false })).toBe("failed");
    expect(chainPaymentState({ signature: "sig", err: { InstructionError: [0, "Custom"] }, confirmationStatus: "confirmed", timedOut: false })).toBe("failed");
    expect(chainPaymentState({ signature: "sig", err: null, confirmationStatus: "confirmed", timedOut: false })).toBe("confirmed");
  });

  test("keeps an old signature unresolved until history finds it", async () => {
    expect(await reconcileSavedSignature({
      signature: "sig",
      status: null,
      lookup: async () => null,
    })).toBe("submitted");
    expect(await reconcileSavedSignature({
      signature: "sig",
      status: null,
      lookup: async () => ({ err: null }),
    })).toBe("confirmed");
    expect(await reconcileSavedSignature({
      signature: "sig",
      status: null,
      lookup: async () => ({ err: { InstructionError: [0, "Custom"] } }),
    })).toBe("failed");
    expect(pendingDuplicate([{ state: "submitted", recipient: "A", amount: "1.00" }], { recipient: "A", amount: "1.00" })).toBe(true);
    expect(pendingDuplicate([{ state: "confirmed", recipient: "A", amount: "1.00" }], { recipient: "A", amount: "1.00" })).toBe(false);
  });
});
