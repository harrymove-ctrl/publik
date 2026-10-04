import { ownerSession } from "@/components/connect/api";
import type { DelegationApiResponse, DelegationExecutionItem, DelegationExecutionsResponse } from "./delegationTypes";

const JSON_HEADERS = { "content-type": "application/json" };

export async function fetchAgentDelegation(agentId: string): Promise<DelegationApiResponse | null> {
  if (!agentId) return null;
  try {
    const res = await fetch(`/api/v1/agents/${agentId}/delegation`, { credentials: "include" });
    if (res.ok) {
      return (await res.json()) as DelegationApiResponse;
    }
    // Fallback to /api/v1/owner/agents/:id/delegation if routed there
    const fallback = await fetch(`/api/v1/owner/agents/${agentId}/delegation`, { credentials: "include" });
    if (fallback.ok) {
      return (await fallback.json()) as DelegationApiResponse;
    }
    return null;
  } catch {
    return null;
  }
}

export async function linkAgentDelegation(
  agentId: string,
  payload: {
    vault: string;
    owner: string;
    vault_id_hex: string;
    execution_key: string;
    mint: string;
    network: "solana-devnet" | "solana-localnet";
  },
): Promise<{ ok: boolean; message?: string }> {
  const session = await ownerSession().catch(() => ({ authenticated: false as const }));
  const headers: Record<string, string> = { ...JSON_HEADERS };
  if (session.authenticated && session.csrf) {
    headers["x-csrf-token"] = session.csrf;
  }

  const paths = [
    `/api/v1/agents/${agentId}/delegation`,
    `/api/v1/owner/agents/${agentId}/delegation`,
  ];

  let lastError = "Could not register vault with server";
  for (const path of paths) {
    try {
      const res = await fetch(path, {
        method: "PUT",
        headers,
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (res.ok) return { ok: true };
      const body = (await res.json().catch(() => ({}))) as { error?: { message: string }; message?: string };
      lastError = body.error?.message ?? body.message ?? `HTTP ${res.status}`;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }

  return { ok: false, message: lastError };
}

export async function unlinkAgentDelegation(agentId: string): Promise<{ ok: boolean; message?: string }> {
  const session = await ownerSession().catch(() => ({ authenticated: false as const }));
  const headers: Record<string, string> = { ...JSON_HEADERS };
  if (session.authenticated && session.csrf) {
    headers["x-csrf-token"] = session.csrf;
  }

  const paths = [
    `/api/v1/agents/${agentId}/delegation`,
    `/api/v1/owner/agents/${agentId}/delegation`,
  ];

  for (const path of paths) {
    try {
      const res = await fetch(path, {
        method: "DELETE",
        headers,
        credentials: "include",
      });
      if (res.ok) return { ok: true };
    } catch {
      // try fallback path
    }
  }

  return { ok: false, message: "Unlink failed or route not found" };
}

export async function fetchAgentExecutions(agentId: string): Promise<DelegationExecutionItem[]> {
  if (!agentId) return [];
  const paths = [
    `/api/v1/agents/${agentId}/delegation/executions`,
    `/api/v1/owner/agents/${agentId}/delegation/executions`,
  ];

  for (const path of paths) {
    try {
      const res = await fetch(path, { credentials: "include" });
      if (res.ok) {
        const body = (await res.json()) as DelegationExecutionsResponse | DelegationExecutionItem[];
        if (Array.isArray(body)) return body;
        if (body && Array.isArray(body.executions)) return body.executions;
      }
    } catch {
      // continue
    }
  }
  return [];
}
