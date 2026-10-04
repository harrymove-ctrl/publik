import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AgentAvatar } from "@/components/avatar/AgentAvatar";
import { formatWhen, shortAddress } from "@/domain/format";
import { formatBase, formatGrouped } from "@/domain/money";
import { agentFace, type AgentFace } from "@/domain/product";
import { useStore } from "@/state/store";

const FILTERS = ["All", "Active", "Needs review", "Paused"] as const;

export function AgentsPage() {
  const { state } = useStore();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All");
  const rows = state.agents.filter((agent) => {
    const face = agentFace(agent);
    if (filter === "All") return true;
    if (filter === "Paused") return agent.status === "paused";
    return face === filter;
  });

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-6 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-medium tracking-tight">Agents</h1>
          <p className="mt-2 text-sm text-muted-foreground">Who can spend, how much is left today, and who is waiting.</p>
        </div>
        <button className="glass-quiet h-10 rounded-lg px-4 text-sm font-medium focus-visible:ring-2 focus-visible:ring-focus" onClick={() => navigate("/app/agents/connect")} type="button">Connect agent</button>
      </div>
      <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label="Filter agents">
        {FILTERS.map((item) => (
          <button className={`h-8 rounded-lg px-3 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-focus ${filter === item ? "bg-[var(--glass-card-hover)] text-foreground font-medium" : "glass-quiet text-muted-foreground hover:text-foreground"}`} key={item} onClick={() => setFilter(item)} type="button">{item}</button>
        ))}
      </div>
      {rows.length === 0 ? <p className="mt-6 text-sm text-muted-foreground">No agents in this filter.</p> : null}
      <ul className="mt-4 grid gap-3">
        {rows.map((agent) => {
          const face = agentFace(agent);
          const pending = agent.requests.filter((item) => item.status === "pending").length;
          const last = [...agent.requests].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
          return (
            <li className="rounded-2xl border border-border bg-surface p-4" key={agent.id}>
              <div className="flex flex-wrap items-start gap-3">
                <AgentAvatar appearance={agent.appearance} id={agent.id} name={agent.name} size={48} status={agent.status} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-medium">{agent.name}</h2>
                    <Face face={face} />
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{agent.description}</p>
                  <p className="mt-2 font-mono text-xs text-muted-foreground">{agent.address ? shortAddress(agent.address) : "No address"}</p>
                </div>
                <Link className="glass-quiet inline-flex h-9 items-center rounded-lg px-3 text-sm focus-visible:ring-2 focus-visible:ring-focus" to={`/app/agents/${agent.id}`}>View agent</Link>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <Stat label="Daily limit" value={`${money(agent.permissions.dailyUsdcBase)} Test USDC`} />
                <Stat label="Spent today" value={`${money(agent.spentTodayBase)} Test USDC`} />
                <Stat label="Pending" value={String(pending)} />
                <Stat label="Last activity" value={last ? formatWhen(last.createdAt) : "None yet"} />
              </dl>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function money(base: string) {
  return formatGrouped(formatBase(base, 6, 2));
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 tabular-nums">{value}</dd>
    </div>
  );
}

function Face({ face }: { face: AgentFace }) {
  const tone = face === "Active" ? "text-success" : face === "Not connected" ? "text-muted-foreground" : "text-warning";
  return <span className={`text-xs ${tone}`}>{face}</span>;
}
