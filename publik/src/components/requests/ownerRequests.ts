/** Payment requests that paired agents filed through the Publik API (owner-signed mode). */
export type AgentPaymentRequest = {
  id: string;
  agent_id: string;
  agent_name: string;
  mint: string;
  amount_base: string;
  recipient: string;
  reason: string;
  status: "pending_review" | "blocked" | "submitted" | "confirmed" | "rejected";
  policy_outcome: string;
  signature: string | null;
  created_at: string;
};

export type OwnerCallResult<T> =
  | { kind: "ok"; status: number; body: T }
  | { kind: "refused"; message: string }
  | { kind: "unreachable"; message: string };

export async function listAgentRequests(): Promise<AgentPaymentRequest[]> {
  const response = await fetch("/api/v1/owner/payment-requests", { credentials: "include" });
  if (!response.ok) throw new Error("Agent requests could not be read. Is the Publik API running?");
  return ((await response.json()) as { requests: AgentPaymentRequest[] }).requests;
}

/**
 * Owner POSTs that must tell "the API refused" apart from "the API never answered": after a transfer is
 * signed, only a refusal may release the signature; an unanswered call keeps it for a recheck.
 */
export async function ownerCall<T>(path: string, csrf: string, body: unknown): Promise<OwnerCallResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, { method: "POST", credentials: "include", headers: { "content-type": "application/json", "x-csrf-token": csrf }, body: JSON.stringify(body) });
  } catch (caught) {
    return { kind: "unreachable", message: caught instanceof Error ? caught.message : "The Publik API did not answer." };
  }
  const payload = (await response.json().catch(() => null)) as (T & { error?: { message?: string } }) | null;
  if (response.ok && payload) return { kind: "ok", status: response.status, body: payload };
  if (response.status >= 500 || !payload) return { kind: "unreachable", message: payload?.error?.message ?? `The Publik API answered ${response.status}.` };
  return { kind: "refused", message: payload.error?.message ?? "The request was refused." };
}

const PENDING_KEY = "publik.owner-review.signatures.v1";

/** Signatures sent to the chain but not yet accepted by the API, by request id. Prevents signing a request twice. */
export function pendingSignatures(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(PENDING_KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

export function setPendingSignature(id: string, signature: string | null): void {
  const next = pendingSignatures();
  if (signature) next[id] = signature;
  else delete next[id];
  localStorage.setItem(PENDING_KEY, JSON.stringify(next));
}
