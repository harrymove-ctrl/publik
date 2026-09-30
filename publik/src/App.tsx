import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ActivityPage } from "@/components/activity/ActivityPage";
import { AgentPage } from "@/components/agent/AgentPage";
import { OverviewPage } from "@/components/overview/OverviewPage";
import { AppShell } from "@/components/shell/AppShell";
import { SolanaProviders } from "@/solana/provider";
import { StoreProvider, useStore } from "@/state/store";

export default function App() {
  return (
    <StoreProvider>
      <SolanaProviders>
        <BrowserRouter>
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<HomeRedirect />} />
              <Route path="overview" element={<OverviewPage />} />
              <Route path="activity" element={<ActivityPage />} />
              <Route path="agents/:agentId" element={<AgentPage />} />
              <Route path="*" element={<HomeRedirect />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </SolanaProviders>
    </StoreProvider>
  );
}

function HomeRedirect() {
  const { state } = useStore();
  return <Navigate replace to={`/agents/${state.selectedId}`} />;
}
