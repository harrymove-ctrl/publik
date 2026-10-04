export type ChainPaymentState = "submitted" | "confirmed" | "failed" | "unknown";

export function chainPaymentState(input: {
  signature: string | null;
  err: unknown;
  confirmationStatus: string | null;
  timedOut: boolean;
}): ChainPaymentState {
  if (!input.signature) return "unknown";
  if (input.err) return "failed";
  if (input.confirmationStatus === "confirmed" || input.confirmationStatus === "finalized") return "confirmed";
  if (input.timedOut) return "unknown";
  return "submitted";
}

export function pendingDuplicate(
  payments: { state: string; recipient: string; amount: string }[],
  next: { recipient: string; amount: string },
): boolean {
  return payments.some((payment) => payment.state === "submitted" && payment.recipient === next.recipient && payment.amount === next.amount);
}

export async function reconcileSavedSignature(input: {
  signature: string;
  status: { err: unknown; confirmationStatus: string | null } | null;
  lookup: () => Promise<{ err: unknown } | null>;
}): Promise<ChainPaymentState> {
  if (input.status) {
    return chainPaymentState({
      signature: input.signature,
      err: input.status.err,
      confirmationStatus: input.status.confirmationStatus,
      timedOut: false,
    });
  }
  const historical = await input.lookup();
  if (!historical) return "submitted";
  return chainPaymentState({
    signature: input.signature,
    err: historical.err,
    confirmationStatus: historical.err ? "confirmed" : "finalized",
    timedOut: false,
  });
}
