import { activityRows } from "@/domain/product";
import { formatWhen } from "@/domain/format";
import { useStore } from "@/state/store";
import { ModeBadge } from "@/components/agent/ModeBadge";

export function ActivityPage() {
  const { state } = useStore();
  const rows = activityRows(state.agents);
  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-6 sm:px-8">
      <h1 className="text-3xl font-medium tracking-tight">Activity</h1>
      <p className="mt-2 text-sm text-muted-foreground">Each row says whether it happened in the demo or on devnet. Mainnet is view-only and does not appear here as a payment.</p>
      {rows.length === 0 ? <p className="mt-6 text-sm text-muted-foreground">No activity yet.</p> : null}
      <ol className="mt-4 grid gap-2">
        {rows.map((row) => (
          <li className="grid gap-1 rounded-xl border border-border bg-surface px-3 py-3 sm:grid-cols-[9rem_1fr_auto] sm:items-center" key={row.id}>
            <time className="text-xs text-muted-foreground">{formatWhen(row.at)}</time>
            <p className="text-sm"><span className="text-muted-foreground">{row.agentName} · </span>{row.title}</p>
            <div className="flex items-center gap-2 sm:justify-end">
              <p className="text-xs text-muted-foreground">{row.cluster}</p>
              <ModeBadge mode={row.mode ?? "owner-signed"} size="sm" />
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
