import { useNavigate } from "react-router-dom";
import { AgentAvatar } from "@/components/avatar/AgentAvatar";
import { agentBalanceLabel } from "@/domain/format";
import { useStore } from "@/state/store";

export function OverviewPage() {
  const { state, selectAgent } = useStore();
  const navigate = useNavigate();
  const waiting = state.agents.reduce((sum, agent) => sum + agent.requests.filter((item) => item.status === "pending" || item.status === "blocked").length, 0);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-medium tracking-tight">Overview</h1>
      <p className="mt-2 max-w-xl text-sm text-muted-foreground">What your agents hold, what needs you, and what they are allowed to do.</p>
      <p className="mt-4 text-sm">{waiting === 0 ? "Nothing needs you right now." : `${waiting} item${waiting === 1 ? "" : "s"} need you.`}</p>
      <ul className="mt-4 grid gap-3">
        {state.agents.map((agent) => {
          const needs = agent.requests.filter((item) => item.status === "pending" || item.status === "blocked").length;
          return (
            <li key={agent.id}>
              <button
                className="flex w-full items-center gap-3 rounded-2xl border border-border p-3 text-left hover:bg-muted"
                onClick={() => {
                  selectAgent(agent.id);
                  navigate(`/agents/${agent.id}`);
                }}
                type="button"
              >
                <AgentAvatar kind={agent.avatar} name={agent.name} orb={agent.orb} size={40} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm">{agent.name}</span>
                  <span className="block text-xs text-muted-foreground">{agent.status === "running" ? "Running" : "Paused"} · {agentBalanceLabel(agent)}</span>
                </span>
                <span className="text-sm tabular-nums text-muted-foreground">{needs === 0 ? "Clear" : `${needs} waiting`}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
