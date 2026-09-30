import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { StreakGrid, type StreakGridDay } from "@/components/streak-grid";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WarpTypeCard } from "@/components/warp-type/WarpTypeCard";
import { DEMO_TODAY } from "@/domain/ledger";
import { useStore } from "@/state/store";

const HACKATHON_ZONE = "America/Los_Angeles";

// Both commits are Sep 29 in Pacific time. The later one is Sep 30 only in +07.
const COMMITTED = "2026-09-29";

// One per scene, verb matched to the motion that scene runs on the type.
const PRELOADER = [
  ["Publik", "holds no keys"],
  ["Publik", "echoes intent"],
  ["Publik", "carries", "limits"],
  ["Publik", "turns requests"],
  ["Publik", "bends to you"],
  ["Publik", "sorts receipts"],
] as const;

export function LandingPage() {
  const { state } = useStore();
  const navigate = useNavigate();
  const data = useMemo(() => paymentsByDay(state.agents), [state.agents]);
  const [warping, setWarping] = useState(false);
  const workspace = `/agents/${state.selectedId}`;

  return (
    <main className="flex min-h-dvh items-center bg-background text-foreground">
      <div className="mx-auto w-full max-w-5xl px-6 py-16">
        <p className="text-sm text-muted-foreground">Publik</p>
        <h1 className="mt-2 text-2xl font-medium tracking-tight">What your agent did</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Crypto World's Fair is <span className="font-medium text-foreground">Sep 14–Oct 12, 2026</span>, Pacific time. Squares are completed Test USDC only. The repo was committed on Sep 29 Pacific.
        </p>
        <div className="mt-8 rounded-2xl border border-border bg-surface p-4 sm:p-5">
          <TooltipProvider>
            <StreakGrid data={data} emptyLabel="No payments yet." itemLabel="Test USDC" />
          </TooltipProvider>
        </div>
        <Link
          className="mt-6 inline-flex h-9 items-center rounded-lg bg-primary px-3 text-sm text-primary-foreground"
          onClick={(event) => {
            if (warping) {
              event.preventDefault();
              return;
            }
            if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
            event.preventDefault();
            setWarping(true);
          }}
          to={workspace}
        >
          Open workspace
        </Link>
      </div>
      {warping ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[#0b1a1f]">
          <WarpTypeCard
            bare
            className="w-[min(100vw,calc(100dvh*1080/608))]"
            phrases={PRELOADER}
            onLoop={() => navigate(workspace)}
          />
        </div>
      ) : null}
    </main>
  );
}

function paymentsByDay(agents: { requests: { status: string; token: string; amountBase: string; createdAt: string }[] }[]): StreakGridDay[] {
  const totals: Record<string, { count: number; label?: string }> = {};
  for (const agent of agents) {
    for (const request of agent.requests) {
      if (request.status !== "completed" || request.token !== "USDC") continue;
      const day = pacificDay(request.createdAt);
      const current = totals[day] ?? { count: 0 };
      current.count += Number(request.amountBase) / 1_000_000;
      totals[day] = current;
    }
  }
  const committed = totals[COMMITTED] ?? { count: 0 };
  committed.label = committed.count > 0 ? `${committed.count} Test USDC · Committed` : "Committed";
  totals[COMMITTED] = committed;
  const days = Object.keys(totals);
  if (days.length === 0) return [{ date: DEMO_TODAY.slice(0, 10), count: 0 }];
  return days.map((date) => ({ date, count: totals[date].count, label: totals[date].label }));
}

function pacificDay(iso: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: HACKATHON_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}
