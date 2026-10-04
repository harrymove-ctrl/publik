import { useEffect, useRef } from "react";
import { BrowserRouter, Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { ActivityPage } from "@/components/activity/ActivityPage";
import { DelegationPage } from "@/components/agent/DelegationPage";
import { AgentPage } from "@/components/agent/AgentPage";
import { AgentsPage } from "@/components/agents/AgentsPage";
import { AgentConnectionPage } from "@/components/connect/AgentConnectionPage";
import { ConnectPage } from "@/components/connect/ConnectPage";
import { PairPage } from "@/components/connect/PairPage";
import { LandingPage } from "@/components/landing/LandingPage";
import { OverviewPage } from "@/components/overview/OverviewPage";
import { PortfolioPage } from "@/components/portfolio/PortfolioPage";
import { RequestsPage } from "@/components/requests/RequestsPage";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { AppShell } from "@/components/shell/AppShell";
import { SolanaProviders } from "@/solana/provider";
import { StoreProvider, useStore } from "@/state/store";
import { ToastProvider } from "@/state/toast";

export default function App() {
  useEffect(() => {
    const sync = () => document.documentElement.toggleAttribute("data-page-hidden", document.hidden);
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);
  return (
    <StoreProvider>
      <SolanaProviders>
        <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/demo" element={<DemoEntry />} />
            <Route path="/app" element={<AppShell />}>
              <Route index element={<OverviewPage />} />
              <Route path="overview" element={<OverviewPage />} />
              <Route path="agents/connect" element={<ConnectPage />} />
              <Route path="agents/:agentId/delegation" element={<DelegationPage />} />
              <Route path="agents/:agentId/connection" element={<AgentConnectionPage />} />
              <Route path="connect" element={<PairPage />} />
              <Route path="agents" element={<AgentsPage />} />
              <Route path="requests" element={<RequestsPage />} />
              <Route path="activity" element={<ActivityPage />} />
              <Route path="portfolio" element={<PortfolioPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="agents/:agentId" element={<AgentPage />} />
            </Route>
            <Route path="/connect" element={<AppShell />}>
              <Route index element={<PairPage />} />
            </Route>
            <Route path="/overview" element={<Navigate replace to="/app" />} />
            <Route path="/agents" element={<Navigate replace to="/app/agents" />} />
            <Route path="/agents/:agentId" element={<LegacyAgent />} />
            <Route path="/requests" element={<Navigate replace to="/app/requests" />} />
            <Route path="/activity" element={<Navigate replace to="/app/activity" />} />
            <Route path="/portfolio" element={<Navigate replace to="/app/portfolio" />} />
            <Route path="/settings" element={<Navigate replace to="/app/settings" />} />
          </Routes>
        </BrowserRouter>
        </ToastProvider>
      </SolanaProviders>
    </StoreProvider>
  );
}


function LegacyAgent() {
  const { agentId } = useParams();
  return <Navigate replace to={`/app/agents/${agentId ?? ""}`} />;
}

function DemoEntry() {
  const { setWorkspaceMode } = useStore();
  const navigate = useNavigate();
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    setWorkspaceMode("demo");
    navigate("/app", { replace: true });
  }, [navigate, setWorkspaceMode]);
  return <p className="p-8 text-sm">Opening the labeled demo. It does not send a transaction.</p>;
}
