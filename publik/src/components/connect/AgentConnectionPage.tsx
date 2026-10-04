import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ownerPost, ownerSession, type OwnerSession } from "./api";
import { ModeBadge } from "@/components/agent/ModeBadge";
import { useAgentDelegation } from "@/components/agent/delegation/useAgentDelegation";
import { useStore } from "@/state/store";

type AgentRecord = {
  id: string;
  name: string;
  description: string;
  connection: string;
  paused: number;
  client_name: string | null;
  last_seen_at: string | null;
  credential_expires_at: string | null;
  capabilities: string[];
};

export function AgentConnectionPage() {
  const { agentId = "" } = useParams();
  const { state } = useStore();
  const storeAgent = state.agents.find((item) => item.id === agentId);
  const [session, setSession] = useState<OwnerSession>({ authenticated: false });
  const [agent, setAgent] = useState<AgentRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const delegation = useAgentDelegation(agentId);
  useEffect(() => {
    void ownerSession().then(async (next) => {
      setSession(next);
      if (!next.authenticated) return;
      const response = await fetch(`/api/v1/owner/agents/${agentId}`, { credentials: "include" });
      if (!response.ok) {
        setError("This profile is not in the signed-in workspace, or the API is not running.");
        return;
      }
      setAgent(await response.json() as AgentRecord);
    }).catch(() => setError("The connection API is not reachable."));
  }, [agentId]);

  async function disconnect() {
    if (!session.authenticated) return;
    await ownerPost(`/api/v1/owner/agents/${agentId}/disconnect`, session.csrf, {});
    setAgent((current) => current ? { ...current, connection: "disconnected" } : current);
    setConfirm(false);
  }

  const currentAgent = agent ?? (storeAgent ? {
    id: storeAgent.id,
    name: storeAgent.name,
    description: storeAgent.description,
    connection: storeAgent.runtimeConnected ? "connected" : "disconnected",
    paused: storeAgent.status === "paused" ? 1 : 0,
    client_name: storeAgent.runtimeConnected ? "Local Runtime" : null,
    last_seen_at: storeAgent.runtimeConnected ? "Just now" : null,
    credential_expires_at: null,
    capabilities: ["read_own_rules", "read_own_balances", "create_payment_requests"],
  } : null);

  const label = currentAgent?.connection === "connected" ? "Connected" : currentAgent?.connection === "disconnected" ? "Disconnected" : "Not connected";

  return (
    <div className="mx-auto w-full max-w-[1120px] px-4 py-6 sm:px-8">
      <Link className="text-sm text-muted-foreground" to={agentId ? `/app/agents/${agentId}` : "/app/agents"}>Back</Link>
      <h1 className="mt-3 text-3xl font-medium tracking-tight">{currentAgent?.name ?? "Connection"}</h1>
      <p className="mt-2 text-sm text-muted-foreground">Registration is not the same as being online. Connected means pairing finished.</p>
      {error && !storeAgent ? <p className="mt-4 text-sm text-danger">{error}</p> : null}
      {currentAgent ? (
        <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="grid gap-3 rounded-[20px] border border-border bg-surface p-5 text-sm">
            <div className="flex items-center justify-between pb-2 border-b border-border/60">
              <span className="font-medium text-foreground">Spending mode</span>
              <ModeBadge mode={delegation.mode} />
            </div>
            <p>Connection: {label}</p>
            <p>Spending: {currentAgent.paused ? "Paused" : "Enabled"}</p>
            <p>Method: {currentAgent.client_name ? `Device pairing, client ${currentAgent.client_name} (self-reported)` : "Profile only"}</p>
            <p>Last authenticated activity: {currentAgent.last_seen_at ?? "None"}</p>
            <p>Credential expiry: {currentAgent.credential_expires_at ?? "No active credential"}</p>
            <ul>{currentAgent.capabilities.map((item) => <li key={item}>{item}</li>)}</ul>
            <a className="underline" href="/skills/publik.md">Skill documentation</a>
            {agent ? <button className="h-10 w-fit rounded-xl border border-border px-3" onClick={() => setConfirm(true)} type="button">Disconnect</button> : null}
            {confirm ? (
              <div className="rounded-xl border border-border p-3">
                <p>This revokes API access. It does not revoke a separate blockchain delegation.</p>
                <button className="mt-2 h-9 rounded-xl bg-primary px-3 text-sm text-primary-foreground" onClick={() => void disconnect()} type="button">Confirm disconnect</button>
              </div>
            ) : null}
          </section>
          <aside className="rounded-[20px] border border-border bg-surface p-5 text-sm text-muted-foreground space-y-3">
            <p>A paused agent can still have a confirmed transaction that was already broadcast. Pause only blocks new requests.</p>
            <div className="pt-2 border-t border-border/60">
              <p className="text-xs font-medium text-foreground mb-1">API vs Blockchain Authority</p>
              <p className="text-xs">
                Pairing an agent or disconnecting API access does not grant or revoke on-chain vault authority.
                Autonomous execution is managed separately via on-chain smart contract rules.
              </p>
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
