import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { ModeBadge } from "@/components/agent/ModeBadge";
import { ownerPost, ownerSession, signOwnerSession } from "@/components/connect/api";
import { useStore } from "@/state/store";
import { useToast } from "@/state/toast";
import { DelegationDashboard } from "./delegation/DelegationDashboard";
import { DelegationSetupWizard } from "./delegation/DelegationSetupWizard";
import { useAgentDelegation } from "./delegation/useAgentDelegation";

export function DelegationPage() {
  const { agentId = "" } = useParams();
  const { state } = useStore();
  const { publicKey, signMessage } = useWallet();
  const navigate = useNavigate();
  const toast = useToast();
  const agent = state.agents.find((item) => item.id === agentId);
  const live = useAgentDelegation(agentId);
  const [showWizardOverride, setShowWizardOverride] = useState(false);
  const [serverAgentExists, setServerAgentExists] = useState<boolean | null>(null);
  const [creatingProfile, setCreatingProfile] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function checkServer() {
      if (!publicKey) return;
      try {
        const session = await ownerSession().catch(() => ({ authenticated: false as const }));
        if (!session.authenticated) return;
        const res = await fetch("/api/v1/owner/agents", { credentials: "include" });
        if (res.ok) {
          const data = (await res.json()) as { agents?: Array<{ id: string }> };
          if (!cancelled && Array.isArray(data.agents)) {
            setServerAgentExists(data.agents.some((a) => a.id === agentId));
          }
        }
      } catch {
        // ignore
      }
    }
    void checkServer();
    return () => {
      cancelled = true;
    };
  }, [agentId, publicKey]);

  async function handleCreateProfile() {
    if (!publicKey || !signMessage || !agent) {
      toast("Connect your wallet first.");
      return;
    }
    setCreatingProfile(true);
    try {
      let session = await ownerSession().catch(() => ({ authenticated: false as const }));
      if (!session.authenticated) {
        session = await signOwnerSession(publicKey.toBase58(), signMessage);
      }
      if (!session.authenticated) {
        throw new Error("Could not authenticate owner session");
      }
      const created = await ownerPost<{ agent_id: string }>(
        "/api/v1/owner/agents",
        session.csrf,
        { name: agent.name, description: agent.description, agent_id: agent.id },
      );
      setServerAgentExists(true);
      toast(`Server profile registered for ${agent.name}!`);
      if (created.agent_id !== agent.id) {
        navigate(`/app/agents/${created.agent_id}/delegation`);
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
    } finally {
      setCreatingProfile(false);
    }
  }
  if (!agent) {
    return (
      <div className="mx-auto w-full max-w-[1120px] px-4 py-8 sm:px-8">
        <Link className="text-sm text-muted-foreground hover:text-foreground" to="/app/agents">
          ← Back to agents
        </Link>
        <p className="mt-4 text-sm text-muted-foreground">That agent is not in this workspace.</p>
      </div>
    );
  }
  if (live.loading && !live.vault) {
    return (
      <div className="mx-auto w-full max-w-[1120px] px-4 py-16 sm:px-8 text-center text-sm text-muted-foreground">
        <div className="inline-block size-6 animate-spin rounded-full border-2 border-primary border-t-transparent mb-3" />
        <p>Reading on-chain vault state from {live.clusterLabel}…</p>
      </div>
    );
  }

  const hasActiveVault = Boolean(live.vault);

  return (
    <div className="mx-auto w-full max-w-[1120px] px-4 py-6 sm:px-8 space-y-6">
      <div>
        <Link className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1" to={`/app/agents/${agent.id}`}>
          ← Back to {agent.name}
        </Link>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono uppercase tracking-[0.14em] text-muted-foreground">Mode</span>
              <ModeBadge mode={live.mode} size="sm" />
            </div>
            <h1 className="mt-1 text-3xl font-medium tracking-tight">Delegated payments</h1>
          </div>
          {hasActiveVault && (
            <button
              type="button"
              onClick={() => setShowWizardOverride((prev) => !prev)}
              className="glass-quiet h-8 rounded-lg px-3 text-xs text-muted-foreground hover:text-foreground"
            >
              {showWizardOverride ? "View Dashboard" : "Set up another vault"}
            </button>
          )}
        </div>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground leading-relaxed">
          {hasActiveVault && !showWizardOverride
            ? "Manage on-chain vault controls, monitor spend limits against real-time Solana Clock, and inspect executions."
            : "Owner-signed payments remain the default. Enabling delegation creates an isolated on-chain vault PDA. An agent execution key signs payments directly against on-chain program rules. Publik never holds private keys."}
        </p>
      </div>

      {serverAgentExists === false && (
        <div className="rounded-2xl border border-warning/40 bg-warning/10 p-5 text-xs space-y-3">
          <h2 className="text-sm font-medium text-foreground">Local Demo Profile</h2>
          <p className="text-muted-foreground leading-relaxed">
            {agent.name} is currently a local browser demo profile and does not exist in your server workspace.
            Before delegating on-chain spending, register {agent.name} with your workspace or connect the agent.
          </p>
          <button
            type="button"
            disabled={creatingProfile}
            onClick={handleCreateProfile}
            className="h-9 rounded-xl bg-primary px-4 text-xs font-medium text-primary-foreground focus-visible:ring-2 focus-visible:ring-focus shadow-xs"
          >
            {creatingProfile ? "Registering Profile…" : `Register ${agent.name} in Workspace`}
          </button>
        </div>
      )}

      {hasActiveVault && !showWizardOverride ? (
        <DelegationDashboard
          agent={agent}
          live={live}
          onResetSetup={() => setShowWizardOverride(true)}
        />
      ) : (
        <DelegationSetupWizard
          agent={agent}
          onCompleted={() => {
            setShowWizardOverride(false);
            void live.refresh();
          }}
          onCancel={hasActiveVault ? () => setShowWizardOverride(false) : undefined}
        />
      )}
    </div>
  );
}
