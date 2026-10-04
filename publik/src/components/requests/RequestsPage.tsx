import { useState } from "react";
import { Link } from "react-router-dom";
import { Dialog } from "@/components/ui/dialog";
import { ModeBadge } from "@/components/agent/ModeBadge";
import { resolvedClusterLabel } from "@/solana/provider";
import { formatWhen, requestTitle, statusLabel, usdcAmount } from "@/domain/format";
import { reservedUsdcBase } from "@/domain/apply";
import { explainRequest } from "@/domain/policy";
import type { Agent } from "@/domain/types";
import type { SpendRequest } from "@/domain/policy";
import { useStore } from "@/state/store";

export function RequestsPage() {
  const { state, decideRequest } = useStore();
  const [open, setOpen] = useState<{ agent: Agent; request: SpendRequest } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rows = state.agents.flatMap((agent) => agent.requests.map((request) => ({ agent, request })));
  const waiting = rows.filter((row) => row.request.status === "pending" || row.request.status === "blocked");

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-6 sm:px-8">
      <h1 className="text-3xl font-medium tracking-tight">Requests</h1>
      <p className="mt-2 text-sm text-muted-foreground">Approve, reject, or read why a rule stopped a payment. Demo payments are not broadcast.</p>
      {waiting.length === 0 ? <p className="mt-6 text-sm text-muted-foreground">Nothing is waiting.</p> : null}
      <ul className="mt-4 grid gap-3">
        {waiting.map(({ agent, request }) => {
          const verdict = verdictFor(agent, request);
          return (
            <li className="rounded-2xl border border-border bg-surface p-4" key={request.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-lg tabular-nums">{usdcAmount(request.amountBase)} {request.token === "USDC" ? "Test USDC" : "SOL"}</p>
                  <p className="mt-1 text-sm">{request.recipientLabel}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{request.memo || "No reason given."}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <p className="text-xs text-muted-foreground">{agent.name} · {formatWhen(request.createdAt)} · {request.cluster === "demo" ? "Demo" : resolvedClusterLabel}</p>
                    <ModeBadge mode="owner-signed" size="sm" />
                  </div>
                </div>
                <p className={verdict === "Needs approval" ? "text-warning" : verdict === "Allowed" ? "text-success" : "text-danger"}>{verdict}</p>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {request.status === "pending" ? (
                  <button className="h-9 rounded-lg bg-primary px-3 text-sm text-primary-foreground" onClick={() => { setError(null); setDone(null); setOpen({ agent, request }); }} type="button">Approve</button>
                ) : null}
                {request.status === "pending" ? (
                  <button className="glass-quiet h-9 rounded-lg px-3 text-sm focus-visible:ring-2 focus-visible:ring-focus" onClick={() => decideRequest(agent.id, request.id, "rejected")} type="button">Reject</button>
                ) : null}
                <Link className="glass-quiet inline-flex h-9 items-center rounded-lg px-3 text-sm focus-visible:ring-2 focus-visible:ring-focus" to={`/app/agents/${agent.id}`}>Details</Link>
              </div>
            </li>
          );
        })}
      </ul>
      <Dialog
        description={open ? (open.request.cluster === "demo" ? "Demo payment. No transaction will be broadcast." : "Solana devnet. Wallet signature required. Publik does not sign from this screen.") : undefined}
        onClose={() => setOpen(null)}
        open={open !== null}
        title={open ? requestTitle(open.request) : "Approve"}
      >
        {open ? (
          <div className="grid gap-3 text-sm">
            <div className="flex items-center gap-2 pb-1 border-b border-border/60">
              <ModeBadge mode="owner-signed" size="sm" />
              <span className="text-xs text-muted-foreground">Owner-signed review mode</span>
            </div>
            <p>{verdictFor(open.agent, open.request)}. {open.request.cluster === "demo" ? "Approving updates the demo balance only." : `This screen cannot broadcast. Connect the owner wallet on ${resolvedClusterLabel}.`}</p>
            <ul className="grid gap-1">
              {explainRequest({
                permissions: open.agent.permissions,
                paused: open.agent.status === "paused",
                request: open.request,
                reservedUsdcBase: reservedUsdcBase(open.agent, open.request.id),
                spentUsdcBase: open.agent.spentTodayBase,
              }).checks.map((check) => (
                <li key={check.id}>{check.label}: {check.state}. {check.detail}</li>
              ))}
            </ul>
            {error ? <p className="text-danger">{error}</p> : null}
            {done ? <p>Approved. Request {done}. {open.request.cluster === "demo" ? "No signature, because nothing was broadcast." : statusLabel(open.request.status)}</p> : null}
            <div className="flex gap-2">
              <button
                className="h-10 rounded-lg bg-brand px-4 text-sm font-medium text-[#2a100e] hover:brightness-105 active:brightness-95 transition-all focus-visible:ring-2 focus-visible:ring-focus shadow-xs"
                onClick={() => {
                  const result = decideRequest(open.agent.id, open.request.id, "approved");
                  if (result) setError(result);
                  else setDone(open.request.id);
                }}
                type="button"
              >
                Approve
              </button>
              <button className="glass-quiet h-10 rounded-lg px-3 text-sm focus-visible:ring-2 focus-visible:ring-focus" onClick={() => setOpen(null)} type="button">Cancel</button>
            </div>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}

function verdictFor(agent: Agent, request: SpendRequest): string {
  const explained = explainRequest({
    permissions: agent.permissions,
    paused: agent.status === "paused",
    request,
    reservedUsdcBase: reservedUsdcBase(agent, request.id),
    spentUsdcBase: agent.spentTodayBase,
  });
  if (explained.decision.outcome === "allow") return "Allowed";
  if (explained.decision.outcome === "needs-approval") return "Needs approval";
  const fail = explained.checks.find((check) => check.state === "fail");
  if (fail?.id === "running") return "Agent paused";
  if (fail?.id === "limit") return "Over daily limit";
  if (fail?.id === "recipient") return "Recipient not allowed";
  return "Invalid request";
}
