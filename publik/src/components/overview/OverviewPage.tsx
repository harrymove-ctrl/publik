import { Link } from "react-router-dom";
import { reservedUsdcBase } from "@/domain/apply";
import { formatBase, formatGrouped } from "@/domain/money";
import { awaitingReview, remainingTodayUsdc } from "@/domain/product";
import type { ScenarioId } from "@/domain/apply";
import { DevnetPay } from "@/components/wallet/DevnetPay";
import { resolvedClusterLabel } from "@/solana/provider";
import { useStore } from "@/state/store";
import { useToast } from "@/state/toast";

const SCENARIOS: { id: ScenarioId; label: string }[] = [
  { id: "allowed", label: "Allowed recipient, 4.00" },
  { id: "new-recipient", label: "New recipient, 3.00" },
  { id: "over-budget", label: "Over budget, 30.00" },
];

export function OverviewPage() {
  const { state, simulateScenario, setPaused } = useStore();
  const toast = useToast();
  const alice = state.agents.find((agent) => agent.id === "alice") ?? state.agents[0];
  if (!alice) return <p className="p-8 text-sm">Reset the demo to load Alice.</p>;
  const waiting = awaitingReview(state.workspaceMode === "demo" ? state.agents : []);
  const reserved = reservedUsdcBase(alice);
  const money = (base: string) => formatGrouped(formatBase(base, 6, 2));

  if (state.workspaceMode === "devnet") {
    return (
      <div className="mx-auto w-full max-w-3xl px-5 py-6 sm:px-8">
        <h1 className="text-3xl font-medium tracking-tight">{resolvedClusterLabel}</h1>
        <p className="mt-2 text-sm text-muted-foreground">This view does not use demo balances or demo approvals.</p>
        <div className="mt-6"><DevnetPay /></div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-6 sm:px-8">
      <p className="text-sm text-muted-foreground">Alice · Research assistant</p>
      <h1 className="mt-1 text-3xl font-medium tracking-tight">{alice.name}</h1>
      <p className="mt-2 max-w-xl text-sm text-muted-foreground">{alice.description}. Daily limit resets at 00:00 UTC. Demo payments are not sent on Solana.</p>
      <dl className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Balance" value={`${money(alice.holdings.find((item: { symbol: string; amountBase: string }) => item.symbol === "USDC")?.amountBase ?? "0")} Test USDC`} />
        <Stat label="Daily limit" value={`${money(alice.permissions.dailyUsdcBase)} Test USDC`} />
        <Stat label="Spent today" value={`${money(alice.spentTodayBase)} Test USDC`} />
        <Stat label="Reserved" value={`${money(reserved)} Test USDC`} />
        <Stat label="Available today" value={`${formatGrouped(remainingTodayUsdc(alice).toFixed(2))} Test USDC`} />
      </dl>
      <section className="mt-6">
        <h2 className="text-base font-medium">Demo scenarios</h2>
        <p className="mt-1 text-sm text-muted-foreground">Each button runs the real spending rules. It is not a separate animation.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {SCENARIOS.map((scenario) => (
            <button className="h-9 rounded-lg border border-border px-3 text-sm" key={scenario.id} onClick={() => { simulateScenario(alice.id, scenario.id); toast("Request added"); }} type="button">{scenario.label}</button>
          ))}
          <button className="h-9 rounded-lg border border-border px-3 text-sm" onClick={() => { setPaused(alice.id, true); simulateScenario(alice.id, "allowed"); toast(alice.status === "paused" ? "Alice is paused. The new request is blocked." : "Alice paused, then a request was checked."); }} type="button">Pause, then request</button>
        </div>
      </section>
      <section className="mt-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-medium">Needs review</h2>
          <Link className="text-sm underline" to="/app/requests">Open inbox</Link>
        </div>
        {waiting.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">Nothing is waiting. Run the 4.00 dataset scenario.</p> : null}
        <ul className="mt-2 grid gap-2">
          {waiting.map(({ agent, request }) => (
            <li className="rounded-xl border border-border bg-surface px-3 py-3 text-sm" key={request.id}>
              {agent.name} · {money(request.amountBase)} Test USDC · {request.recipientLabel}
              <span className="block text-xs text-muted-foreground">{request.memo} · Demo payment — no funds sent until you approve</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface px-3 py-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-lg tabular-nums">{value}</dd>
    </div>
  );
}
