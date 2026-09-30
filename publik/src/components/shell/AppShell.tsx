import { WalletReadyState } from "@solana/wallet-adapter-base";
import { useWallet } from "@solana/wallet-adapter-react";
import { Menu, Plus, Search, Settings } from "lucide-react";
import { useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { AgentAvatar } from "@/components/avatar/AgentAvatar";
import { Dialog } from "@/components/ui/dialog";
import { compactSpend, shortAddress } from "@/domain/format";
import { rejectedMainnetRpc } from "@/solana/provider";
import { useStore } from "@/state/store";
import type { Agent, ThemeChoice } from "@/domain/types";
import { AddAgentDialog } from "@/components/agent/AddAgentDialog";

export function AppShell() {
  const { state, setTheme, selectAgent, resetDemo } = useStore();
  const [query, setQuery] = useState("");
  const [navOpen, setNavOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const dark = state.theme === "dark" || (state.theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const agents = state.agents.filter((agent) => agent.name.toLowerCase().includes(query.trim().toLowerCase()));

  const openAgent = (id: string) => {
    selectAgent(id);
    setNavOpen(false);
    navigate(`/agents/${id}`);
  };

  return (
    <div className={`publik-canvas relative h-dvh overflow-hidden ${dark ? "dark-canvas" : ""}`}>
      <div className="relative mx-auto flex h-full w-full max-w-[1440px] p-2 sm:p-3">
        <div className="flex h-full min-h-0 w-full overflow-hidden rounded-[20px] border border-border bg-surface" style={{ boxShadow: "var(--shell-shadow)" }}>
        <aside className="hidden h-full w-[240px] shrink-0 border-r border-border md:block">
          <Sidebar
            agents={agents}
            onAdd={() => setAddOpen(true)}
            onQuery={setQuery}
            onSettings={() => setSettingsOpen(true)}
            onSelect={openAgent}
            onTheme={setTheme}
            pathname={location.pathname}
            query={query}
            selectedId={state.selectedId}
            theme={state.theme}
          />
        </aside>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="flex h-12 items-center gap-3 border-b border-border px-3 sm:px-5">
            <button
              aria-label="Open navigation"
              className="grid size-10 place-items-center rounded-xl hover:bg-muted md:hidden"
              onClick={() => setNavOpen(true)}
              type="button"
            >
              <Menu aria-hidden="true" size={18} />
            </button>
            <p className="truncate text-sm text-muted-foreground">
              Publik <span className="text-border">/</span> <span className="text-foreground">{titleFor(location.pathname, state.agents, state.selectedId)}</span>
            </p>
            <div className="ml-auto flex items-center gap-2">
              <span className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground" title="Sample data. No real money moves.">Demo</span>
              <button className="h-8 rounded-lg border border-border px-3 text-sm hover:bg-muted" onClick={() => setWalletOpen(true)} type="button">
                <WalletLabel />
              </button>
            </div>
          </header>
          {rejectedMainnetRpc ? (
            <p className="border-b border-border px-5 py-2 text-sm text-muted-foreground">
              Mainnet was ignored. Publik is using Solana devnet only.
            </p>
          ) : null}
          <main className="min-h-0 flex-1 overflow-auto">
            <Outlet />
          </main>
        </div>
        </div>
      </div>
      {navOpen ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <button aria-label="Close navigation" className="absolute inset-0 bg-black/40" onClick={() => setNavOpen(false)} type="button" />
          <div className="absolute inset-y-0 left-0 w-[min(100%,300px)] p-2">
            <Sidebar
              agents={agents}
              onAdd={() => {
                setNavOpen(false);
                setAddOpen(true);
              }}
              onQuery={setQuery}
              onSettings={() => {
                setNavOpen(false);
                setSettingsOpen(true);
              }}
              onSelect={openAgent}
              onTheme={setTheme}
              pathname={location.pathname}
              query={query}
              selectedId={state.selectedId}
              theme={state.theme}
            />
          </div>
        </div>
      ) : null}
      <AddAgentDialog onClose={() => setAddOpen(false)} open={addOpen} />
      <WalletDialog onClose={() => setWalletOpen(false)} open={walletOpen} />
      <SettingsDialog onClose={() => setSettingsOpen(false)} onReset={resetDemo} onTheme={setTheme} open={settingsOpen} theme={state.theme} />
    </div>
  );
}

function titleFor(pathname: string, agents: { id: string; name: string }[], selectedId: string): string {
  if (pathname === "/overview") return "Overview";
  if (pathname === "/activity") return "Activity";
  const id = pathname.startsWith("/agents/") ? pathname.split("/")[2] : selectedId;
  return agents.find((agent) => agent.id === id)?.name ?? "Agent";
}

function Sidebar({
  query,
  onQuery,
  agents,
  selectedId,
  pathname,
  onSelect,
  onAdd,
  theme,
  onTheme,
  onSettings,
}: {
  query: string;
  onQuery: (value: string) => void;
  agents: Agent[];
  selectedId: string;
  pathname: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  theme: ThemeChoice;
  onTheme: (theme: ThemeChoice) => void;
  onSettings: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col p-3">
      <div className="flex items-center gap-2 px-2 py-2">
        <AgentAvatar name="Publik" orb={2} size={28} />
        <span className="text-base font-medium tracking-tight">Publik</span>
      </div>
      <label className="mt-2 flex h-10 items-center gap-2 rounded-xl border border-border bg-surface px-3 text-sm">
        <Search aria-hidden="true" size={15} />
        <span className="sr-only">Search agents</span>
        <input
          className="w-full bg-transparent outline-none placeholder:text-muted-foreground"
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Search"
          value={query}
        />
      </label>
      <nav aria-label="Workspace" className="mt-4 grid gap-1">
        <ShellLink end label="Overview" to="/overview" active={pathname === "/overview"} />
        <ShellLink label="Activity" to="/activity" active={pathname === "/activity"} />
      </nav>
      <p className="mt-5 px-2 text-xs text-muted-foreground">Agents</p>
      <div className="mt-1 grid min-h-0 gap-1 overflow-auto">
        {agents.length === 0 ? <p className="px-2 py-2 text-sm text-muted-foreground">No matching agents.</p> : null}
        {agents.map((agent) => (
          <button
            aria-label={`${agent.name}, ${compactSpend(agent)} Test USDC available to spend`}
            className={`flex h-9 items-center gap-2 rounded-lg px-2 text-left ${agent.id === selectedId ? "bg-muted" : "hover:bg-muted"}`}
            key={agent.id}
            onClick={() => onSelect(agent.id)}
            type="button"
          >
            <AgentAvatar kind={agent.avatar} name={agent.name} orb={agent.orb} size={22} />
            <span className="min-w-0 flex-1 truncate text-[13px]">{agent.name}</span>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{compactSpend(agent)}</span>
          </button>
        ))}
      </div>
      <button className="mt-2 flex h-10 items-center gap-2 rounded-xl px-2 text-sm text-muted-foreground hover:bg-sidebar-accent" onClick={onAdd} type="button">
        <Plus aria-hidden="true" size={16} />
        Add agent
      </button>
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-3">
        <div aria-label="Theme" className="flex min-w-0 gap-0.5" role="radiogroup">
          {(["light", "dark", "system"] as const).map((option) => (
            <button
              aria-checked={theme === option}
              className={`h-8 rounded-md px-1.5 text-[11px] capitalize ${theme === option ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"}`}
              key={option}
              onClick={() => onTheme(option)}
              role="radio"
              type="button"
            >
              {option}
            </button>
          ))}
        </div>
        <button aria-label="Settings" className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted" onClick={onSettings} type="button">
          <Settings aria-hidden="true" size={15} />
        </button>
      </div>
    </div>
  );
}

function ShellLink({ to, label, active, end = false }: { to: string; label: string; active: boolean; end?: boolean }) {
  return (
    <NavLink
      className={`flex h-10 items-center rounded-xl px-2 text-sm ${active ? "bg-surface text-foreground" : "text-muted-foreground hover:bg-sidebar-accent"}`}
      end={end}
      to={to}
    >
      {label}
    </NavLink>
  );
}

function WalletLabel() {
  const { connected, publicKey } = useWallet();
  if (!connected || !publicKey) return "Connect wallet";
  return shortAddress(publicKey.toBase58());
}

function WalletDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { wallets, select, connect, disconnect, connected, connecting, publicKey, wallet } = useWallet();
  const [error, setError] = useState<string | null>(null);
  const choices = wallets.filter((item) => item.readyState === WalletReadyState.Installed || item.readyState === WalletReadyState.Loadable);

  return (
    <Dialog
      description="Connecting lets Publik see an address. It does not let Publik sign, and it does not enforce spending rules on that wallet."
      onClose={onClose}
      open={open}
      title="Devnet wallet"
    >
      {connected && publicKey ? (
        <div className="grid gap-3 text-sm">
          <p>
            Watching <span className="font-mono text-xs">{publicKey.toBase58()}</span>
          </p>
          <p className="text-muted-foreground">Read only. {wallet?.adapter.name ?? "Wallet"} is connected for balances, not for agent payments.</p>
          <button
            className="h-10 rounded-xl border border-border"
            onClick={() => {
              void disconnect();
            }}
            type="button"
          >
            Disconnect
          </button>
        </div>
      ) : (
        <div className="grid gap-2">
          {choices.length === 0 ? <p className="text-sm text-muted-foreground">No wallet extension found. You can still paste a devnet address when you add an agent.</p> : null}
          {choices.map((item) => (
            <button
              className="h-10 rounded-xl border border-border text-sm hover:bg-muted"
              key={item.adapter.name}
              onClick={() => {
                setError(null);
                select(item.adapter.name);
                void connect().catch(() => setError("The wallet request was declined or could not connect."));
              }}
              type="button"
            >
              {connecting ? "Connecting…" : item.adapter.name}
            </button>
          ))}
          {error ? <p className="text-sm text-danger">{error}</p> : null}
        </div>
      )}
    </Dialog>
  );
}

function SettingsDialog({
  open,
  onClose,
  onReset,
  theme,
  onTheme,
}: {
  open: boolean;
  onClose: () => void;
  onReset: () => void;
  theme: ThemeChoice;
  onTheme: (theme: ThemeChoice) => void;
}) {
  return (
    <Dialog description="Theme follows this browser. Reset only restores the sample agents." onClose={onClose} open={open} title="Settings">
      <p className="text-sm text-muted-foreground">Theme</p>
      <div aria-label="Theme" className="mt-2 flex gap-1" role="radiogroup">
        {(["light", "dark", "system"] as const).map((option) => (
          <button
            aria-checked={theme === option}
            className={`h-9 rounded-lg px-3 text-sm capitalize ${theme === option ? "bg-foreground text-background" : "border border-border"}`}
            key={option}
            onClick={() => onTheme(option)}
            role="radio"
            type="button"
          >
            {option}
          </button>
        ))}
      </div>
      <button
        className="mt-5 h-9 rounded-lg border border-border px-3 text-sm"
        onClick={() => {
          onReset();
          onClose();
        }}
        type="button"
      >
        Reset demo data
      </button>
    </Dialog>
  );
}
