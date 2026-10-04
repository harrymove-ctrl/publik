import { WalletReadyState } from "@solana/wallet-adapter-base";
import { useWallet } from "@solana/wallet-adapter-react";
import { Menu, Plus, Search, Settings } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { AgentAvatar } from "@/components/avatar/AgentAvatar";
import { FeltMark } from "@/components/avatar/FeltMark";
import { SombraGradient } from "@/components/gradient/SombraGradient";
import { CommandPalette } from "./CommandPalette";
import { Dialog } from "@/components/ui/dialog";
import { compactSpend, shortAddress } from "@/domain/format";
import { rejectedMainnetRpc, resolvedClusterLabel } from "@/solana/provider";
import { useStore } from "@/state/store";
import type { Agent, ThemeChoice } from "@/domain/types";

export function AppShell() {
  const { state, setTheme, selectAgent, resetDemo, setWorkspaceMode } = useStore();
  const [navOpen, setNavOpen] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const dark = state.theme === "dark" || (state.theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const agents = state.agents;
  const { publicKey } = useWallet();
  const devnetLocked = state.workspaceMode === "devnet" && !publicKey && !location.pathname.includes("/delegation");

  const openAgent = (id: string) => {
    selectAgent(id);
    setNavOpen(false);
    navigate(`/app/agents/${id}`);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className={`publik-canvas relative h-dvh overflow-hidden ${dark ? "dark-canvas" : ""}`}>
      <div aria-hidden="true" className="publik-atmosphere pointer-events-none absolute inset-0">
        <SombraGradient palette={dark ? "ember" : "ocean"} />
      </div>
      <div className="relative mx-auto flex h-full w-full max-w-[1440px] p-2.5 sm:p-6 md:p-8">
        <div className="glass-shell flex h-full min-h-0 w-full overflow-hidden">
        <aside className="glass-sidebar hidden h-full w-52 shrink-0 border-r border-border md:block">
          <Sidebar
            agents={agents}
            onAdd={() => navigate("/app/agents/connect")}
            onSettings={() => setSettingsOpen(true)}
            onCommand={() => setCommandOpen(true)}
            onSelect={openAgent}
            onTheme={setTheme}
            pathname={location.pathname}
            selectedId={state.selectedId}
            theme={state.theme}
          />
        </aside>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="glass-header flex h-14 items-center gap-3 border-b border-border px-6">
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
              <div className="flex rounded-lg border border-border bg-[var(--glass-input)] p-0.5 text-xs" role="group" aria-label="Mode">
                <button className={`h-7 rounded-md px-2 transition-colors ${state.workspaceMode === "demo" ? "bg-[var(--glass-card-hover)] text-foreground font-medium" : "text-muted-foreground hover:text-foreground"}`} onClick={() => setWorkspaceMode("demo")} type="button">Demo</button>
                <button className={`h-7 rounded-md px-2 transition-colors ${state.workspaceMode === "devnet" ? "bg-[var(--glass-card-hover)] text-foreground font-medium" : "text-muted-foreground hover:text-foreground"}`} onClick={() => setWorkspaceMode("devnet")} type="button">{resolvedClusterLabel}</button>
              </div>
              <button className="glass-quiet h-8 rounded-lg px-3 text-sm focus-visible:ring-2 focus-visible:ring-focus" onClick={() => setWalletOpen(true)} type="button">
                <WalletLabel />
              </button>
            </div>
          </header>
          {rejectedMainnetRpc ? (
            <p className="border-b border-border px-5 py-2 text-sm text-muted-foreground">
              Mainnet was ignored. Publik is using Solana {resolvedClusterLabel.toLowerCase()} only.
            </p>
          ) : null}
          <div className="relative min-h-0 flex-1">
            <main className={`min-h-full overflow-auto pb-16 md:pb-0 ${devnetLocked ? "pointer-events-none select-none blur-md" : ""}`} aria-hidden={devnetLocked}>
              <Outlet />
            </main>
            {devnetLocked ? (
              <div className="absolute inset-0 z-20 grid place-items-center bg-[#141213]/20 p-4 backdrop-blur-md">
                <div className="glass-overlay max-w-md rounded-[20px] border border-border p-6 text-center">
                  <h2 className="text-xl font-medium">Connect a {resolvedClusterLabel.toLowerCase()} wallet</h2>
                  <p className="mt-2 text-sm text-muted-foreground">The workspace stays blurred until a wallet is connected. Connecting does not send a payment or share a secret key.</p>
                  <button className="mt-4 h-10 rounded-xl bg-primary px-4 text-sm text-primary-foreground" onClick={() => setWalletOpen(true)} type="button">Connect wallet</button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
        </div>
      </div>
      {navOpen ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <button aria-label="Close navigation" className="absolute inset-0 bg-black/40 backdrop-blur-xs" onClick={() => setNavOpen(false)} type="button" />
          <div className="glass-sidebar absolute inset-y-0 left-0 w-[min(100%,300px)] p-2">
            <Sidebar
              agents={agents}
              onAdd={() => {
                setNavOpen(false);
                navigate("/app/agents/connect");
              }}
              onSettings={() => {
                setNavOpen(false);
                setSettingsOpen(true);
              }}
              onCommand={() => { setNavOpen(false); setCommandOpen(true); }}
              onSelect={openAgent}
              onTheme={setTheme}
              pathname={location.pathname}
              selectedId={state.selectedId}
              theme={state.theme}
            />
          </div>
        </div>
      ) : null}
      <nav aria-label="Mobile" className="glass-header fixed inset-x-3 bottom-3 z-30 grid grid-cols-3 gap-1 rounded-xl border border-border p-1 md:hidden">
        <Link className="flex h-10 items-center justify-center rounded-lg text-xs" to="/app">Overview</Link>
        <Link className="flex h-10 items-center justify-center rounded-lg text-xs" to="/app/agents">Agents</Link>
        <Link className="flex h-10 items-center justify-center rounded-lg text-xs" to="/app/requests">Requests</Link>
      </nav>
      <WalletDialog onClose={() => setWalletOpen(false)} open={walletOpen} />
      <SettingsDialog onClose={() => setSettingsOpen(false)} onReset={resetDemo} onTheme={setTheme} open={settingsOpen} theme={state.theme} />
      <CommandPalette onClose={() => setCommandOpen(false)} open={commandOpen} />
    </div>
  );
}

function titleFor(pathname: string, agents: { id: string; name: string }[], selectedId: string): string {
  if (pathname === "/app" || pathname === "/app/overview") return "Overview";
  if (pathname === "/app/agents") return "Agents";
  if (pathname === "/app/requests") return "Requests";
  if (pathname === "/app/activity") return "Activity";
  if (pathname === "/app/portfolio") return "Portfolio";
  if (pathname === "/app/settings") return "Settings";
  const id = pathname.startsWith("/app/agents/") ? pathname.split("/")[3] : selectedId;
  return agents.find((agent) => agent.id === id)?.name ?? "Agent";
}

function Sidebar({
  agents,
  selectedId,
  pathname,
  onSelect,
  onAdd,
  theme,
  onTheme,
  onSettings,
  onCommand,
}: {
  agents: Agent[];
  selectedId: string;
  pathname: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  theme: ThemeChoice;
  onTheme: (theme: ThemeChoice) => void;
  onSettings: () => void;
  onCommand: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col p-3">
      <Link className="flex items-center gap-2 rounded-xl px-2 py-2 hover:bg-sidebar-accent" to="/app">
        <FeltMark />
        <span className="text-base font-medium tracking-tight">Publik</span>
      </Link>
      <button className="glass-input mt-2 flex h-10 w-full items-center gap-2 rounded-xl border border-border px-3 text-left text-sm text-foreground" onClick={onCommand} type="button">
        <Search aria-hidden="true" size={15} />
        Search
        <span className="ml-auto text-xs">⌘K</span>
      </button>
      <nav aria-label="Workspace" className="mt-4 grid gap-1">
        <ShellLink end label="Overview" to="/app" active={pathname === "/app" || pathname === "/app/overview"} />
        <ShellLink end label="Agents" to="/app/agents" active={pathname === "/app/agents"} />
        <ShellLink label="Requests" to="/app/requests" active={pathname === "/app/requests"} />
        <ShellLink label="Activity" to="/app/activity" active={pathname === "/app/activity"} />
        <ShellLink label="Portfolio" to="/app/portfolio" active={pathname === "/app/portfolio"} />
        <ShellLink label="Settings" to="/app/settings" active={pathname === "/app/settings"} />
      </nav>
      <p className="mt-5 px-2 text-xs text-muted-foreground">Agents</p>
      <div className="mt-1 grid min-h-0 gap-1 overflow-auto">
        {agents.length === 0 ? <p className="px-2 py-2 text-sm text-muted-foreground">No matching agents.</p> : null}
        {agents.map((agent) => (
          <button
            aria-label={`${agent.name}, ${compactSpend(agent)} Test USDC available to spend`}
            className={`flex min-h-12 items-center gap-2.5 rounded-[14px] px-2.5 text-left transition-colors ${agent.id === selectedId ? "border border-border bg-[var(--selected-glass)] text-foreground font-medium" : "border border-transparent text-muted-foreground hover:bg-white/5 hover:text-foreground"}`}
            key={agent.id}
            onClick={() => onSelect(agent.id)}
            type="button"
          >
            <AgentAvatar appearance={agent.appearance} id={agent.id} name={agent.name} size={36} status={agent.status} />
            <span className="min-w-0 flex-1 truncate text-[13px]">{agent.name}</span>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{compactSpend(agent)}</span>
          </button>
        ))}
      </div>
      <button className="mt-2 flex h-10 items-center gap-2 rounded-xl px-2 text-sm text-muted-foreground hover:bg-[var(--glass-card)] hover:text-foreground transition-colors focus-visible:ring-2 focus-visible:ring-focus" onClick={onAdd} type="button">
        <Plus aria-hidden="true" size={16} />
        Connect agent
      </button>
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-3">
        <div aria-label="Theme" className="flex min-w-0 gap-0.5" role="radiogroup">
          {(["light", "dark", "system"] as const).map((option) => (
            <button
              aria-checked={theme === option}
              className={`h-8 rounded-md px-1.5 text-[11px] capitalize transition-colors ${theme === option ? "bg-[var(--glass-card-hover)] text-foreground font-medium shadow-xs" : "text-muted-foreground hover:bg-[var(--glass-card)] hover:text-foreground"}`}
              key={option}
              onClick={() => onTheme(option)}
              role="radio"
              type="button"
            >
              {option}
            </button>
          ))}
        </div>
        <button aria-label="Settings" className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-[var(--glass-card)] hover:text-foreground transition-colors focus-visible:ring-2 focus-visible:ring-focus" onClick={onSettings} type="button">
          <Settings aria-hidden="true" size={15} />
        </button>
      </div>
    </div>
  );
}

function ShellLink({ to, label, active, end = false }: { to: string; label: string; active: boolean; end?: boolean }) {
  return (
    <NavLink
      className={`flex h-10 items-center rounded-xl px-2 text-sm transition-colors ${active ? "bg-[var(--glass-card-hover)] text-foreground font-medium" : "text-muted-foreground hover:bg-[var(--glass-card)] hover:text-foreground"}`}
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
