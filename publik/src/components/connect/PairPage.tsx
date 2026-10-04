import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { ownerPost, ownerSession, signOwnerSession, type OwnerSession } from "./api";

type Pairing = {
  name: string;
  description: string;
  client: { name: string; version: string };
  user_code: string;
  capabilities: string[];
  expires_at: string;
};

export function PairPage() {
  const [params] = useSearchParams();
  const { publicKey, signMessage } = useWallet();
  const [session, setSession] = useState<OwnerSession>({ authenticated: false });
  const [code, setCode] = useState(params.get("code") ?? "");
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [workspaceAgents, setWorkspaceAgents] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>("");
  useEffect(() => {
    void ownerSession().then(setSession).catch(() => setSession({ authenticated: false }));
  }, []);

  async function ensureSession() {
    if (session.authenticated) return session;
    if (!publicKey || !signMessage) throw new Error("Connect a wallet and sign the ownership challenge. That signature is not a payment.");
    const next = await signOwnerSession(publicKey.toBase58(), signMessage);
    setSession(next);
    return next;
  }

  async function lookup() {
    setError(null);
    setAgentId(null);
    const current = await ensureSession();
    if (!current.authenticated) return;
    const p = await ownerPost<Pairing>("/api/v1/owner/agent-connections/lookup", current.csrf, { user_code: code });
    setPairing(p);
    try {
      const res = await fetch("/api/v1/owner/agents", { credentials: "include" });
      if (res.ok) {
        const data = (await res.json()) as { agents?: Array<{ id: string; name: string }> };
        if (Array.isArray(data.agents)) {
          setWorkspaceAgents(data.agents);
          const match = data.agents.find((a) => a.name.toLowerCase() === p.name.toLowerCase());
          if (match) setSelectedAgentId(match.id);
        }
      }
    } catch {
      // ignore
    }
  }

  async function decide(path: "approve" | "reject") {
    if (!session.authenticated) return;
    const body: Record<string, string> = { user_code: code };
    if (selectedAgentId) body.agent_id = selectedAgentId;
    const result = await ownerPost<{ agent_id?: string }>(`/api/v1/owner/agent-connections/${path}`, session.csrf, body);
    if (path === "approve") setAgentId(result.agent_id ?? null);
    else setPairing(null);
  }

  return (
    <div className="mx-auto w-full max-w-[720px] px-4 py-6 sm:px-8">
      <h1 className="text-3xl font-medium tracking-tight">Verify pairing code</h1>
      <p className="mt-2 text-sm text-muted-foreground">The code alone does not sign you in. Your wallet confirms that you own this workspace.</p>
      <form className="mt-6 grid gap-3 rounded-[20px] border border-border bg-surface p-5" onSubmit={(event) => { event.preventDefault(); void lookup().catch((caught) => setError(caught instanceof Error ? caught.message : "Could not verify the code.")); }}>
        <label className="grid gap-1 text-sm">Pairing code<input className="field font-mono uppercase" onChange={(event) => setCode(event.target.value)} value={code} /></label>
        <button className="h-10 w-fit rounded-xl bg-primary px-3 text-sm text-primary-foreground" type="submit">Verify code</button>
      </form>
      {error ? <p className="mt-4 text-sm text-danger">{error}</p> : null}
      {pairing ? (
        <section className="mt-4 grid gap-2 rounded-[20px] border border-border bg-surface p-5 text-sm">
          <h2 className="text-base font-medium">{pairing.name}</h2>
          <p>{pairing.description || "No description."}</p>
          <p className="text-muted-foreground">Client {pairing.client.name} {pairing.client.version}, self-reported.</p>
          <p className="font-mono">{pairing.user_code}</p>
          <p>Expires {pairing.expires_at}</p>
          <ul>{pairing.capabilities.map((item) => <li key={item}>{item}</li>)}</ul>
          <p>This agent can read its own rules, submit payment requests, and check their status. It cannot sign payments or change your budget.</p>
          {workspaceAgents.length > 0 && (
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground block">Assign to workspace profile:</label>
              <select
                value={selectedAgentId}
                onChange={(e) => setSelectedAgentId(e.target.value)}
                className="h-9 rounded-xl border border-border bg-background px-2 text-xs w-full"
              >
                <option value="">Create new profile ({pairing.name})</option>
                {workspaceAgents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name} ({a.id})</option>
                ))}
              </select>
            </div>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <button className="h-10 rounded-xl bg-primary px-3 text-sm text-primary-foreground" onClick={() => void decide("approve").catch((caught) => setError(caught instanceof Error ? caught.message : "Could not approve."))} type="button">Approve connection</button>
            <button className="h-10 rounded-xl border border-border px-3 text-sm" onClick={() => void decide("reject").catch((caught) => setError(caught instanceof Error ? caught.message : "Could not reject."))} type="button">Reject</button>
          </div>
        </section>
      ) : null}
      {agentId ? (
        <section className="mt-4 rounded-[20px] border border-border bg-surface p-5 text-sm">
          <p>Agent connected.</p>
          <div className="mt-3 flex gap-3">
            <Link className="underline" to={`/app/agents/${agentId}`}>Open agent</Link>
            <Link className="underline" to={`/app/agents/${agentId}/connection`}>Set spending rules</Link>
          </div>
        </section>
      ) : null}
    </div>
  );
}
