import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatWhen, requestTitle, statusLabel } from "@/domain/format";
import { devnetExplorerTx } from "@/solana/adapter";
import { useStore } from "@/state/store";

export function ActivityPage() {
  const { state } = useStore();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<"all" | "needs" | "done">("all");
  const rows = state.agents
    .flatMap((agent) => agent.requests.map((request) => ({ agent, request })))
    .sort((left, right) => right.request.createdAt.localeCompare(left.request.createdAt));
  const visible = rows.filter(({ request }) => {
    if (filter === "needs") return request.status === "pending" || request.status === "blocked";
    if (filter === "done") return request.status === "completed" || request.status === "rejected" || request.status === "failed";
    return true;
  });

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-medium tracking-tight">Activity</h1>
      <p className="mt-1 text-sm text-muted-foreground">Completed, waiting, rejected, blocked, and failed payments. A block is a rule. A failure is a send that did not go through.</p>
      <div className="mt-4 flex gap-2" role="tablist" aria-label="Activity filter">
        {(["all", "needs", "done"] as const).map((item) => (
          <button aria-selected={filter === item} className={`h-10 rounded-xl px-3 text-sm ${filter === item ? "bg-foreground text-background" : "border border-border"}`} key={item} onClick={() => setFilter(item)} role="tab" type="button">
            {item === "all" ? "All" : item === "needs" ? "Needs you" : "Finished"}
          </button>
        ))}
      </div>
      {visible.length === 0 ? <p className="mt-6 text-sm text-muted-foreground">Nothing in this view.</p> : null}
      <ul className="mt-4 divide-y divide-border">
        {visible.map(({ agent, request }) => {
          const explorer = request.cluster === "devnet" && request.signature ? devnetExplorerTx(request.signature) : null;
          return (
            <li className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between" key={request.id}>
              <button className="text-left" onClick={() => navigate(`/agents/${agent.id}`)} type="button">
                <span className="block text-sm">{requestTitle(request)}</span>
                <span className="block text-xs text-muted-foreground">{agent.name} · {formatWhen(request.createdAt)} · {request.reason}</span>
              </button>
              <span className="text-sm">{statusLabel(request.status)}</span>
              {explorer ? <a className="text-sm text-brand" href={explorer} rel="noreferrer" target="_blank">Explorer</a> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
