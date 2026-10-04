import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AgentAvatar } from "@/components/avatar/AgentAvatar";
import { filterCommands, type CommandItem } from "@/domain/commands";
import type { Agent } from "@/domain/types";
import { useStore } from "@/state/store";

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, selectAgent, simulateScenario } = useStore();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const items = useMemo(() => catalog(state.agents), [state.agents]);
  const results = filterCommands(query, items);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    input.current?.focus();
  }, [open]);

  useEffect(() => {
    if (active >= results.length) setActive(0);
  }, [active, results.length]);

  if (!open) return null;

  const choose = (item: CommandItem) => {
    if (item.id.startsWith("request:")) {
      const [, agentId, requestId] = item.id.split(":");
      selectAgent(agentId);
      navigate(`/app/agents/${agentId}?request=${requestId}`);
    } else if (item.id.startsWith("agent:")) {
      const id = item.id.slice(6);
      selectAgent(id);
      navigate(`/app/agents/${id}`);
    } else if (item.id === "scenario-allowed") {
      simulateScenario("alice", "allowed");
      navigate("/app/requests");
    } else if (item.id === "create") {
      navigate("/app/agents/connect");
    } else if (item.id === "rules") {
      navigate(`/app/agents/${state.selectedId}`);
    } else if (item.id === "overview") navigate("/app");
    else if (item.id === "requests") navigate("/app/requests");
    else if (item.id === "activity") navigate("/app/activity");
    else if (item.id === "wallet") navigate("/app/portfolio");
    else if (item.id === "agents") navigate("/app/agents");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-start justify-center bg-black/40 backdrop-blur-xs px-3 pt-[12vh]" role="presentation">
      <button aria-label="Close command search" className="absolute inset-0" onClick={onClose} type="button" />
      <div aria-label="Command search" className="glass-overlay relative z-10 w-full max-w-[640px] overflow-hidden rounded-2xl border border-border text-foreground shadow-2xl" role="dialog">
        <input
          ref={input}
          aria-controls="command-results"
          aria-label="Search agents, requests, and actions"
          className="h-12 w-full border-b border-border bg-transparent px-4 text-sm text-foreground outline-none placeholder:text-muted-foreground"
          onChange={(event) => { setQuery(event.target.value); setActive(0); }}
          onKeyDown={(event) => {
            if (event.key === "Escape") onClose();
            if (event.key === "ArrowDown") { event.preventDefault(); setActive((value) => Math.min(results.length - 1, value + 1)); }
            if (event.key === "ArrowUp") { event.preventDefault(); setActive((value) => Math.max(0, value - 1)); }
            if (event.key === "Enter" && results[active]) choose(results[active]);
          }}
          placeholder="Search agents, requests, and actions…"
          value={query}
        />
        <ul className="max-h-[50vh] overflow-auto p-2" id="command-results" role="listbox">
          {results.length === 0 ? <li className="px-3 py-6 text-sm text-muted-foreground">No matches. Try budget, Alice, or a request id.</li> : null}
          {results.map((item, index) => (
            <li key={item.id}>
              {index === 0 || results[index - 1]?.group !== item.group ? <p className="px-3 pt-3 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{item.group}</p> : null}
              <button
                aria-selected={index === active}
                className={`flex h-11 w-full items-center justify-between rounded-lg px-3 text-left text-sm transition-colors ${index === active ? "bg-[var(--glass-card-hover)] text-foreground font-medium" : "text-foreground hover:bg-[var(--glass-card)]"}`}
                onClick={() => choose(item)}
                onMouseEnter={() => setActive(index)}
                role="option"
                type="button"
              >
                <span className="flex min-w-0 items-center gap-2">{item.id.startsWith("agent:") ? <AgentAvatar id={item.id.slice(6)} name={item.label} size={28} /> : null}<span className="truncate">{item.label}</span></span>
                <span className="text-xs text-muted-foreground">{item.hint ?? (item.run === "review" ? "Opens review" : "")}</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">Enter opens the screen. It does not send a payment.</p>
      </div>
    </div>
  );
}

function catalog(agents: Agent[]): CommandItem[] {
  return [
    { id: "overview", group: "Navigate", label: "Overview", run: "navigate" },
    { id: "agents", group: "Navigate", label: "Agents", run: "navigate" },
    { id: "requests", group: "Navigate", label: "Requests", run: "navigate" },
    { id: "activity", group: "Navigate", label: "Activity", run: "navigate" },
    { id: "wallet", group: "Navigate", label: "Wallet", aliases: ["devnet", "portfolio"], run: "navigate" },
    ...agents.map((agent) => ({ id: `agent:${agent.id}`, group: "Agents", label: agent.name, hint: agent.description, run: "navigate" as const })),
    ...agents.flatMap((agent) => agent.requests.map((request) => ({
      id: `request:${agent.id}:${request.id}`,
      group: "Requests",
      label: request.recipientLabel,
      hint: request.memo || request.id,
      aliases: [request.id, request.recipient, request.memo],
      run: "review" as const,
    }))),
    { id: "create", group: "Actions", label: "Connect agent", run: "navigate" },
    { id: "rules", group: "Actions", label: "Edit rules", aliases: ["budget", "limits"], hint: "Opens the agent. It does not change a limit by itself.", run: "review" },
    { id: "scenario-allowed", group: "Actions", label: "Simulate 4.00 dataset request", aliases: ["demo", "scenario"], run: "review" },
  ];
}
