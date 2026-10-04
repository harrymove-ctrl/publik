import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { appendPastedRequest, appendSample, appendScenario, applyDecision, reevaluateRequest, type ScenarioId } from "@/domain/apply";
import { DEMO_TODAY } from "@/domain/ledger";
import { createSeedAgents, mergeSavedAgents } from "@/domain/seed";
import type { Permissions } from "@/domain/policy";
import type { Agent, AppState, ThemeChoice, WorkspaceMode } from "@/domain/types";

const STORAGE_KEY = "publik.demo.v1";
const THEME_KEY = "publik.theme";

interface Store {
  state: AppState;
  selected: Agent;
  setTheme: (theme: ThemeChoice) => void;
  selectAgent: (id: string) => void;
  addAgent: (agent: Agent) => void;
  updateAgent: (id: string, patch: Partial<Agent>) => void;
  updatePermissions: (id: string, permissions: Permissions) => void;
  setPaused: (id: string, paused: boolean) => void;
  decideRequest: (agentId: string, requestId: string, decision: "approved" | "rejected") => string | null;
  addSampleRequest: (agentId: string) => void;
  addPastedRequest: (agentId: string, input: { amount: string; recipient: string; reason: string }) => void;
  recheckRequest: (agentId: string, requestId: string) => void;
  markRuntimeSeen: (agentId: string) => void;
  addDemoFunds: (agentId: string) => void;
  resetDemo: () => void;
  setWorkspaceMode: (mode: WorkspaceMode) => void;
  simulateScenario: (agentId: string, scenario: ScenarioId) => void;
}

const StoreContext = createContext<Store | null>(null);

function loadState(): AppState {
  const theme = readTheme();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fresh(theme);
    const parsed = JSON.parse(raw) as AppState;
    if (!Array.isArray(parsed.agents) || parsed.agents.length === 0) return fresh(theme);
    const selectedId = parsed.agents.some((agent) => agent.id === parsed.selectedId)
      ? parsed.selectedId
      : parsed.agents[0].id;
    return { ...parsed, agents: mergeSavedAgents(parsed.agents), selectedId, theme, ownerLabel: parsed.ownerLabel || "You", workspaceMode: parsed.workspaceMode === "demo" ? "demo" : "devnet" };
  } catch {
    return fresh(theme);
  }
}

function fresh(theme: ThemeChoice): AppState {
  return { agents: createSeedAgents(), selectedId: "alice", theme, ownerLabel: "You", workspaceMode: "devnet" };
}

function readTheme(): ThemeChoice {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === "light" || stored === "dark" || stored === "system") return stored;
  return "system";
}

function applyTheme(theme: ThemeChoice) {
  const dark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(loadState);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    localStorage.setItem(THEME_KEY, state.theme);
    applyTheme(state.theme);
  }, [state]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (state.theme === "system") applyTheme("system");
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [state.theme]);

  const api = useMemo<Store>(() => {
    const selected = state.agents.find((agent) => agent.id === state.selectedId) ?? state.agents[0];

    const changeAgent = (id: string, recipe: (agent: Agent) => Agent) => {
      setState((current) => ({
        ...current,
        agents: current.agents.map((agent) => (agent.id === id ? recipe(agent) : agent)),
      }));
    };

    return {
      state,
      selected,
      setTheme: (theme) => setState((current) => ({ ...current, theme })),
      setWorkspaceMode: (mode) => setState((current) => ({ ...current, workspaceMode: mode })),
      simulateScenario: (agentId, scenario) =>
        changeAgent(agentId, (agent) => appendScenario(agent, scenario, `scenario-${crypto.randomUUID()}`, DEMO_TODAY)),
      selectAgent: (id) => setState((current) => ({ ...current, selectedId: id })),
      addAgent: (agent) =>
        setState((current) => ({ ...current, agents: [...current.agents, agent], selectedId: agent.id })),
      updateAgent: (id, patch) => changeAgent(id, (agent) => ({ ...agent, ...patch })),
      updatePermissions: (id, permissions) => changeAgent(id, (agent) => ({ ...agent, permissions })),
      setPaused: (id, paused) =>
        changeAgent(id, (agent) => ({ ...agent, status: paused ? "paused" : "running" })),
      decideRequest: (agentId, requestId, decision) => {
        let error: string | null = null;
        setState((current) => {
          const agent = current.agents.find((item) => item.id === agentId);
          if (!agent) {
            error = "That agent is not in this workspace.";
            return current;
          }
          const result = applyDecision(agent, requestId, decision);
          error = result.error;
          return {
            ...current,
            agents: current.agents.map((item) => (item.id === agentId ? result.agent : item)),
          };
        });
        return error;
      },
      addSampleRequest: (agentId) =>
        changeAgent(agentId, (agent) => appendSample(agent, `sample-${crypto.randomUUID()}`, new Date().toISOString())),
      addPastedRequest: (agentId, input) =>
        changeAgent(agentId, (agent) => appendPastedRequest(agent, input, `paste-${crypto.randomUUID()}`, new Date().toISOString())),
      recheckRequest: (agentId, requestId) =>
        changeAgent(agentId, (agent) => reevaluateRequest(agent, requestId)),
      markRuntimeSeen: (agentId) => changeAgent(agentId, (agent) => ({ ...agent, runtimeConnected: true })),
      addDemoFunds: (agentId) =>
        changeAgent(agentId, (agent) => {
          if (agent.walletMode !== "demo") return agent;
          return {
            ...agent,
            holdings: agent.holdings.map((holding) =>
              holding.symbol === "USDC"
                ? { ...holding, amountBase: (BigInt(holding.amountBase) + 25_000_000n).toString() }
                : holding,
            ),
          };
        }),
      resetDemo: () => setState((current) => fresh(current.theme)),
    };
  }, [state]);

  return <StoreContext.Provider value={api}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const value = useContext(StoreContext);
  if (!value) throw new Error("Store missing");
  return value;
}
