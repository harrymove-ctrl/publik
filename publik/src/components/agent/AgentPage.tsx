import type { ReactNode } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AgentAvatar } from "@/components/avatar/AgentAvatar";
import { Dialog } from "@/components/ui/dialog";
import { formatBase, formatGrouped, toBase } from "@/domain/money";
import { appearanceFor } from "@/domain/appearance";
import { formatWhen, holdingFiat, holdingQuantity, shortAddress, statusLabel, tokenName, usdcAmount } from "@/domain/format";
import { agentFace, remainingTodayUsdc, ruleVerdict } from "@/domain/product";
import type { Agent } from "@/domain/types";
import type { Permissions, SpendRequest } from "@/domain/policy";
import { explainRequest } from "@/domain/policy";
import { reservedUsdcBase } from "@/domain/apply";
import { devnetExplorerAddress, devnetExplorerTx, isSolanaAddress } from "@/solana/adapter";
import { useDevnetHoldings } from "@/solana/useDevnetHoldings";
import { useDevnetReceipts } from "@/solana/useDevnetReceipts";
import { configuredDemoMainnetAddress } from "@/solana/mainnetPortfolio";
import { useMainnetPortfolio } from "@/solana/useMainnetPortfolio";
import { MainnetPortfolioCard } from "./MainnetPortfolioCard";
import { AgentConnect } from "./AgentConnect";
import { SpendingChart } from "./SpendingChart";
import { useStore } from "@/state/store";
import { useToast } from "@/state/toast";
import { ModeBadge } from "./ModeBadge";
import { useAgentDelegation } from "./delegation/useAgentDelegation";
import { resolvedClusterLabel } from "@/solana/provider";

export function AgentPage() {
  const { agentId } = useParams();
  const store = useStore();
  const agent = store.state.agents.find((item) => item.id === (agentId ?? store.state.selectedId));
  const [requestId, setRequestId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [moneyOpen, setMoneyOpen] = useState(false);
  const [pauseAsk, setPauseAsk] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const toast = useToast();
  const live = useDevnetHoldings(agent?.address ?? null, agent?.walletMode === "readonly" || agent?.walletMode === "agent-key");
  const watching = agent?.walletMode === "readonly" || agent?.walletMode === "agent-key";
  const receipts = useDevnetReceipts(agent?.address ?? null, watching);
  const mainnetAddress = agent?.mainnetWatchAddress || (agent?.id === "alice" ? configuredDemoMainnetAddress() : null);
  const mainnet = useMainnetPortfolio(mainnetAddress);
  const delegation = useAgentDelegation(agent?.id ?? "");
  useEffect(() => {
    if (agent && agent.id !== store.state.selectedId) store.selectAgent(agent.id);
  }, [agent, store]);

  if (!agent) return <p className="p-8 text-sm text-muted-foreground">That agent is not in this workspace.</p>;

  const holdings = agent.walletMode === "readonly" || agent.walletMode === "agent-key" ? live.holdings : agent.holdings;
  const needs = agent.requests.filter((item) => item.status === "pending" || item.status === "blocked");
  const usdc = holdings.find((item) => item.symbol === "USDC");
  const spent = formatGrouped(formatBase(agent.spentTodayBase, 6, 2));
  const openRequest = agent.requests.find((item) => item.id === requestId) ?? null;

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-4 sm:px-8">
      <header className="flex flex-wrap items-start gap-4">
        <AgentAvatar appearance={agent.appearance} id={agent.id} name={agent.name} size={72} status={agent.status} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-medium tracking-tight">{agent.name}</h1>
            <span className="text-sm text-muted-foreground">{agentFace(agent)}</span>
            <ModeBadge mode={delegation.mode} size="sm" />
          </div>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">{agent.description}</p>
          <p className="mt-2 font-mono text-xs text-muted-foreground">{agent.address ? shortAddress(agent.address) : "No address yet"}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {agent.address ? <button className="glass-quiet h-9 rounded-lg px-3 text-sm focus-visible:ring-2 focus-visible:ring-focus" onClick={() => { void navigator.clipboard.writeText(agent.address ?? "").then(() => toast("Address copied")); }} type="button">Copy address</button> : null}
          <button className="glass-quiet h-9 rounded-lg px-3 text-sm focus-visible:ring-2 focus-visible:ring-focus" onClick={() => setPauseAsk(true)} type="button">{agent.status === "running" ? "Pause agent" : "Resume"}</button>
          <button className="glass-quiet h-9 rounded-lg px-3 text-sm focus-visible:ring-2 focus-visible:ring-focus" onClick={() => setPermissionsOpen(true)} type="button">Settings</button>
          <Link className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm" to={`/app/agents/${agent.id}/delegation`}>
            <span>{delegation.mode === "delegated" ? "Vault controls" : "Delegated payments"}</span>
          </Link>
        </div>
      </header>
      <details className="mt-4 rounded-[20px] border border-border bg-surface p-4 text-sm">
        <summary>Appearance</summary>
        <div className="mt-3 flex flex-wrap gap-2">
          {(["clover", "flower", "droid", "pebble"] as const).map((type) => (
            <button className="h-9 rounded-xl border border-border px-3" key={type} onClick={() => store.updateAgent(agent.id, { appearance: { ...appearanceFor(agent.id, agent.appearance), type } })} type="button">{type}</button>
          ))}
          {["#F28B82", "#C4B5E0", "#F3EDE4", "#C9D4DE"].map((color) => (
            <button aria-label={color} className="size-9 rounded-xl border border-border" key={color} onClick={() => store.updateAgent(agent.id, { appearance: { ...appearanceFor(agent.id, agent.appearance), color } })} style={{ background: color }} type="button" />
          ))}
          <button className="h-9 rounded-xl border border-border px-3" onClick={() => store.updateAgent(agent.id, { appearance: appearanceFor(agent.id) })} type="button">Reset</button>
        </div>
      </details>
      {pauseAsk ? (
        <div className="mt-3 rounded-xl border border-border bg-surface p-3 text-sm">
          <p>{agent.status === "running" ? "Pause stops new demo approvals. It does not revoke a token delegation already on Solana." : "Resume lets this agent request payments again. It does not restore a revoked budget."}</p>
          <div className="mt-2 flex gap-2">
            <button className="glass-quiet h-9 rounded-lg px-3 text-foreground focus-visible:ring-2 focus-visible:ring-focus" onClick={() => { store.setPaused(agent.id, agent.status === "running"); toast(agent.status === "running" ? "Agent paused" : "Agent resumed"); setPauseAsk(false); }} type="button">Confirm</button>
            <button className="glass-quiet h-9 rounded-lg px-3 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus" onClick={() => setPauseAsk(false)} type="button">Cancel</button>
          </div>
        </div>
      ) : null}
      <section aria-label="Budget" className="mt-4 rounded-2xl border border-border bg-surface p-4">
        <p className="text-sm text-muted-foreground">Available today</p>
        <p className="mt-1 text-3xl tabular-nums">{formatGrouped(Math.max(0, remainingTodayUsdc(agent).minus(Number(reservedUsdcBase(agent)) / 1_000_000).toNumber()).toFixed(2))} <span className="text-base font-normal text-muted-foreground">Test USDC</span></p>
        <p className="mt-2 text-sm text-muted-foreground">Daily limit {formatGrouped(formatBase(agent.permissions.dailyUsdcBase, 6, 2))} · Spent {spent} · Reserved {formatGrouped(formatBase(reservedUsdcBase(agent), 6, 2))} · Available {formatGrouped(Math.max(0, remainingTodayUsdc(agent).minus(Number(reservedUsdcBase(agent)) / 1_000_000).toNumber()).toFixed(2))}</p>
        <div aria-label="Spent, reserved, and available portions of the daily limit" className="mt-3 flex h-2 overflow-hidden rounded bg-black/10 dark:bg-white/10" role="img">
          <span className="bg-[#ff6b61]" style={{ width: `${budgetShare(agent.spentTodayBase, agent.permissions.dailyUsdcBase)}%` }} />
          <span className="bg-[#e2b15a]" style={{ width: `${budgetShare(reservedUsdcBase(agent), agent.permissions.dailyUsdcBase)}%` }} />
          <span className="bg-[#082b5c]" style={{ width: `${Math.max(0, 100 - budgetShare(agent.spentTodayBase, agent.permissions.dailyUsdcBase) - budgetShare(reservedUsdcBase(agent), agent.permissions.dailyUsdcBase))}%` }} />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Wallet balance {usdc ? holdingQuantity(usdc) : "—"} Test USDC. That balance is not the daily allowance. Demo Test USDC has no dollar price.</p>
      </section>

      {!agent.runtimeConnected ? <ConnectRuntime onSample={() => store.addSampleRequest(agent.id)} onDismiss={() => store.markRuntimeSeen(agent.id)} /> : null}

      <div className="mt-3 grid items-start gap-3 md:grid-cols-2">
        <Panel title="Balance" action="Add money" onAction={() => setMoneyOpen(true)}>
          {(agent.walletMode === "readonly" || agent.walletMode === "agent-key") && live.status === "loading" ? <p className="text-sm text-muted-foreground">Loading devnet balances…</p> : null}
          {(agent.walletMode === "readonly" || agent.walletMode === "agent-key") && live.status === "error" ? (
            <div className="text-sm">
              <p>Could not reach Solana devnet.</p>
              <button className="mt-2 h-10 rounded-xl border border-border px-3" onClick={live.retry} type="button">Try again</button>
            </div>
          ) : null}
          {(agent.walletMode !== "readonly" && agent.walletMode !== "agent-key") || live.status === "ready" ? (
            holdings.length === 0 ? (
              <p className="text-sm text-muted-foreground">{agent.address ? "No tokens found for this address yet." : "This agent has no wallet yet. Add money, or watch a devnet address."}</p>
            ) : (
              <ul className="divide-y divide-border">
                {holdings.map((holding) => {
                  const fiat = holdingFiat(holding);
                  return (
                    <li className="flex items-center gap-3 py-2" key={`${holding.symbol}-${holding.mint ?? "native"}`}>
                      <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-[10px] font-medium text-foreground dark:bg-[#3a3a3e] dark:text-[#f2f1ee]">
                        {(holding.label || holding.symbol).slice(0, 1)}
                      </span>
                      <p className="min-w-0 flex-1 text-sm">{holding.label || tokenName(holding.symbol)}</p>
                      <div className="text-right">
                        <p className="text-sm tabular-nums">{holdingQuantity(holding)}</p>
                        <p className="text-xs text-muted-foreground">{agent.walletMode === "demo" && holding.symbol === "USDC" ? "Demo balance. Not a dollar price." : holding.symbol === "SOL" && fiat ? `${fiat} · mainnet SOL price, for reference` : fiat ?? "Price unavailable"}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )
          ) : null}
          {agent.walletMode === "demo" && usdc && usdc.amountBase === "0" ? (
            <p className="text-sm text-muted-foreground">Add Test USDC before this agent can pay.</p>
          ) : null}
        </Panel>
        <Panel title="Pending requests">
          {needs.length === 0 ? <p className="text-sm text-muted-foreground">Nothing is waiting.</p> : null}
          <ul className="grid gap-3">
            {needs.map((request) => (
              <li className="flex items-start gap-3 rounded-lg border border-border bg-[var(--glass-card)] p-3" key={request.id}>
                <AgentAvatar appearance={agent.appearance} id={agent.id} name={agent.name} size={36} status={agent.status} />
                <div className="min-w-0 flex-1">
                <p className="text-sm tabular-nums">{usdcAmount(request.amountBase)} {request.token === "USDC" ? "Test USDC" : "SOL"} · {request.recipientLabel}</p>
                <p className="mt-1 text-sm text-muted-foreground">{request.memo || "No reason given."} · {formatWhen(request.createdAt)}</p>
                <p className="mt-1 text-sm">{ruleVerdict(agent, request)} · {request.cluster === "demo" ? "Demo" : "Devnet"}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {request.status === "pending" ? <button className="h-8 rounded-lg bg-brand px-3 text-xs font-medium text-[#2a100e] hover:brightness-105 active:brightness-95 transition-all focus-visible:ring-2 focus-visible:ring-focus shadow-xs" onClick={() => { setRequestId(request.id); }} type="button">Review</button> : null}
                  {request.status === "pending" ? <button className="glass-quiet h-8 rounded-lg px-2.5 text-xs focus-visible:ring-2 focus-visible:ring-focus" onClick={() => { store.decideRequest(agent.id, request.id, "rejected"); toast("Payment rejected"); }} type="button">Reject</button> : null}
                  <button className="glass-quiet h-8 rounded-lg px-2.5 text-xs focus-visible:ring-2 focus-visible:ring-focus" onClick={() => setRequestId(request.id)} type="button">Details</button>
                </div>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
      {mainnetAddress ? <MainnetPortfolioCard portfolio={mainnet.portfolio} status={mainnet.status} /> : null}
      {watching ? (
        <section className="mt-3 rounded-2xl border border-border bg-surface p-4 text-sm">
          <h2 className="text-base font-medium">Incoming Test USDC</h2>
          <p className="mt-1 text-muted-foreground">{resolvedClusterLabel} deposits only. These are not payment requests, and there is no send button.</p>
          {receipts.status === "loading" ? <p className="mt-2 text-muted-foreground">Reading {resolvedClusterLabel}…</p> : null}
          {receipts.status === "error" ? <p className="mt-2">Could not reach Solana {resolvedClusterLabel}.</p> : null}
          {receipts.status === "ready" && receipts.receipts.length === 0 ? <p className="mt-2 text-muted-foreground">No incoming Test USDC seen.</p> : null}
          <ul className="mt-2 grid gap-2">
            {receipts.receipts.map((receipt) => {
              const href = devnetExplorerTx(receipt.signature);
              return (
                <li key={receipt.signature} className="flex items-center justify-between gap-2">
                  {href ? <a className="underline" href={href} rel="noreferrer" target="_blank">{receipt.amountBase} base units</a> : <span>{receipt.amountBase} base units</span>}
                  <ModeBadge mode={delegation.mode === "delegated" ? "delegated" : "owner-signed"} size="sm" />
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      <section className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-4">
        <div>
          <h2 className="text-base font-medium">Connect your agent</h2>
          <p className="text-sm text-muted-foreground">Bring payment requests into Publik. Copy and paste is the current method.</p>
        </div>
        <button className="glass-quiet h-9 rounded-lg px-3 text-sm focus-visible:ring-2 focus-visible:ring-focus" onClick={() => setConnectOpen(true)} type="button">Set up connection</button>
      </section>
      {connectOpen ? (
        <Dialog onClose={() => setConnectOpen(false)} open title="Connect your agent">
          <AgentConnect agent={agent} />
        </Dialog>
      ) : null}

      <div className="mt-3 grid gap-3">

        <Panel title="Permissions" action="Edit permissions" onAction={() => setPermissionsOpen(true)}>
          <div className="mb-3 flex items-center justify-between rounded-xl border border-border bg-surface/50 p-3 text-sm">
            <div>
              <span className="font-medium">Execution mode</span>
              <p className="text-xs text-muted-foreground">
                {delegation.mode === "delegated"
                  ? "Autonomous vault execution active. Agent key signs payments within on-chain rules."
                  : "Owner-signed payments. Every transfer requires your wallet signature."}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <ModeBadge mode={delegation.mode} size="sm" />
              <Link className="text-xs underline text-brand" to={`/app/agents/${agent.id}/delegation`}>
                {delegation.mode === "delegated" ? "Controls" : "Configure"}
              </Link>
            </div>
          </div>
          <ul className="grid gap-2 text-sm">
            <li>Can spend up to {formatGrouped(formatBase(agent.permissions.dailyUsdcBase, 6, 2))} Test USDC a day.</li>
            <li>{recipientSentence(agent)}</li>
            <li>{agent.permissions.askBeforeNewRecipient ? "Ask me before paying someone new." : "New recipients are blocked."}</li>
          </ul>
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-muted-foreground">Details</summary>
            <div className="mt-2 grid gap-2 text-muted-foreground">
              <p>Pausing stops new payments from Publik. It cannot undo a payment already sent, or stop someone who holds the wallet key.</p>
              {agent.walletMode === "demo" ? <p>Prices here are sample values, not a live quote. Spending limits are checked in the demo only.</p> : <p>Watching a wallet does not let Publik sign for it.</p>}
              {agent.address ? <p className="break-all font-mono text-xs text-foreground">Wallet {agent.address}</p> : <p>No wallet address yet.</p>}
              <p>Created {formatWhen(agent.createdAt)}.</p>
              {agent.permissions.allowedRecipients.map((recipient) => (
                <p key={recipient.address}>
                  {recipient.label} <span className="font-mono text-xs">{recipient.address}</span>
                </p>
              ))}
            </div>
          </details>
        </Panel>

        <Panel title="Activity">
          <ActivityList agent={agent} onOpen={setRequestId} />
        </Panel>

        <Panel title="Spending">
          <SpendingChart history={agent.spendHistory} />
        </Panel>
      </div>

      <RequestDrawer
        agent={agent}
        onClose={() => setRequestId(null)}
        onEditPermissions={() => {
          setRequestId(null);
          setPermissionsOpen(true);
        }}
        request={openRequest}
      />
      <EditDialog agent={agent} onClose={() => setEditing(false)} open={editing} />
      <PermissionsDialog agent={agent} onClose={() => setPermissionsOpen(false)} open={permissionsOpen} />
      <AddMoneyDialog agent={agent} feeLamports={live.feeLamports} onClose={() => setMoneyOpen(false)} open={moneyOpen} />
    </div>
  );
}

function budgetShare(part: string, limit: string): number {
  const whole = Number(limit);
  if (!Number.isFinite(whole) || whole <= 0) return 0;
  return Math.max(0, Math.min(100, (Number(part) / whole) * 100));
}


function Panel({ title, action, onAction, children }: { title: string; action?: string; onAction?: () => void; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-base font-medium">{title}</h2>
        {action && onAction ? (
          <button className="glass-quiet h-8 rounded-lg px-2.5 text-xs focus-visible:ring-2 focus-visible:ring-focus" onClick={onAction} type="button">{action}</button>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function recipientSentence(agent: Agent): string {
  const labels = agent.permissions.allowedRecipients.map((item) => item.label);
  if (labels.length === 0) return "No recipients saved yet.";
  if (labels.length === 1) return `Can send to ${labels[0]}.`;
  return `Can send to ${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}.`;
}

function ConnectRuntime({ onSample, onDismiss }: { onSample: () => void; onDismiss: () => void }) {
  return (
    <section className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface px-3 py-3 text-sm">
      <p>This agent is not connected yet.</p>
      <div className="flex gap-2">
        <button className="glass-quiet h-9 rounded-lg px-3 text-sm focus-visible:ring-2 focus-visible:ring-focus" onClick={onSample} type="button">Sample request</button>
        <button className="glass-quiet h-9 rounded-lg px-2.5 text-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus" onClick={onDismiss} type="button">Hide</button>
      </div>
    </section>
  );
}

function ActivityList({ agent, onOpen }: { agent: Agent; onOpen: (id: string) => void }) {
  if (agent.requests.length === 0) return <p className="text-sm text-muted-foreground">No activity yet.</p>;
  return (
    <ul className="grid gap-2">
      {[...agent.requests].sort((left, right) => right.createdAt.localeCompare(left.createdAt)).map((request) => {
        const explorer = request.cluster === "devnet" && request.signature ? devnetExplorerTx(request.signature) : null;
        return (
          <li key={request.id}>
            <button className="flex w-full items-center justify-between gap-3 rounded-lg px-1 py-2 text-left hover:bg-muted" onClick={() => onOpen(request.id)} type="button">
              <span className="min-w-0">
                <span className="block truncate text-sm">Pay {request.recipientLabel}</span>
                <span className="block text-xs tabular-nums text-muted-foreground">{request.token === "USDC" ? `${usdcAmount(request.amountBase)} Test USDC` : "SOL"} · {formatWhen(request.createdAt)}</span>
              </span>
              <span className="shrink-0 text-sm">{statusLabel(request.status)}</span>
            </button>
            {explorer ? (
              <a className="px-1 text-sm text-brand" href={explorer} rel="noreferrer" target="_blank">View on explorer</a>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function RequestDrawer({
  agent,
  request,
  onClose,
  onEditPermissions,
}: {
  agent: Agent | undefined;
  request: SpendRequest | null;
  onClose: () => void;
  onEditPermissions: () => void;
}) {
  const { decideRequest } = useStore();
  const [message, setMessage] = useState<string | null>(null);
  const [approvedId, setApprovedId] = useState<string | null>(null);
  if (!agent || !request) return null;
  const explained = explainRequest({
    permissions: agent.permissions,
    paused: agent.status === "paused",
    request,
    reservedUsdcBase: reservedUsdcBase(agent, request.id),
    spentUsdcBase: agent.spentTodayBase,
  });
  const before = remainingBefore(agent, request.id);
  const amount = Number(request.amountBase) / 1_000_000;
  const after = Math.max(0, before - amount);
  const blocked = explained.decision.outcome === "block" || request.status === "blocked";
  const pending = request.status === "pending" && !blocked;
  return (
    <Dialog onClose={onClose} open title="Payment request" wide>
      <p className="text-xs text-muted-foreground">{request.cluster === "demo" ? "Demo" : "Devnet"}</p>
      <p className="mt-2 text-4xl tabular-nums text-[#ff6b61]">{usdcAmount(request.amountBase)}</p>
      <p className="text-sm text-muted-foreground">Test USDC</p>
      <p className="mt-4 text-sm">To {request.recipientLabel}</p>
      <p className="text-sm text-muted-foreground">Requested by {agent.name}</p>
      {request.memo ? <p className="mt-2 text-sm">“{request.memo}”</p> : null}
      <p className="mt-4 text-xs uppercase tracking-[0.14em] text-muted-foreground">Policy checks</p>
      <ul className="mt-4 grid gap-1 text-sm">
        {explained.checks.filter((check) => check.state !== "not-reached").map((check) => (
          <li key={check.id}>{mark(check.state)} {shortCheck(check)}</li>
        ))}
      </ul>
      {blocked ? <p className="mt-3 text-sm">Blocked. Requested {usdcAmount(request.amountBase)}. Available {before.toFixed(2)} Test USDC.</p> : null}
      <dl className="mt-4 grid gap-1 text-sm">
        <div className="flex justify-between"><dt className="text-muted-foreground">Available before</dt><dd className="tabular-nums">{before.toFixed(2)}</dd></div>
        <div className="flex justify-between"><dt className="text-muted-foreground">This request</dt><dd className="tabular-nums">−{amount.toFixed(2)}</dd></div>
        <div className="flex justify-between"><dt className="text-muted-foreground">Available after</dt><dd className="tabular-nums">{after.toFixed(2)} Test USDC</dd></div>
      </dl>
      {approvedId ? <p className="mt-3 text-sm">Demo payment completed — no funds sent.</p> : null}
      {message ? <p className="mt-3 text-sm text-danger">{message}</p> : null}
      <details className="mt-4 text-sm">
        <summary>Transaction details</summary>
        <p className="mt-2 break-all font-mono text-xs">{request.recipient}</p>
        <button className="mt-2 h-8 text-xs underline" onClick={() => { void navigator.clipboard.writeText(request.recipient); }} type="button">Copy address</button>
        <p className="mt-2 text-muted-foreground">Request {request.id}. {request.signature ? `Signature ${request.signature}` : "No signature."}</p>
      </details>
      <p className="mt-4 text-xs text-muted-foreground">{request.cluster === "demo" ? "Simulation only. No funds will be sent." : "Solana devnet. Your wallet must sign. This panel does not broadcast by itself."}</p>
      <div className="mt-4 flex justify-between gap-2">
        {pending ? <button className="glass-quiet h-10 rounded-lg px-3 text-sm focus-visible:ring-2 focus-visible:ring-focus" onClick={() => { decideRequest(agent.id, request.id, "rejected"); onClose(); }} type="button">Reject</button> : <span />}
        {pending ? <button className="h-10 rounded-lg bg-brand px-4 text-sm font-medium text-[#2a100e] hover:brightness-105 active:brightness-95 transition-all focus-visible:ring-2 focus-visible:ring-focus shadow-xs" onClick={() => { const result = decideRequest(agent.id, request.id, "approved"); if (result) setMessage(result); else setApprovedId(request.id); }} type="button">{request.cluster === "demo" ? "Approve demo payment" : "Review and sign"}</button> : null}
        {blocked ? <button className="glass-quiet h-10 rounded-lg px-3 text-sm focus-visible:ring-2 focus-visible:ring-focus" onClick={onEditPermissions} type="button">Review rules</button> : null}
      </div>
    </Dialog>
  );
}

function remainingBefore(agent: Agent, requestId: string): number {
  const limit = Number(agent.permissions.dailyUsdcBase) / 1_000_000;
  const spent = Number(agent.spentTodayBase) / 1_000_000;
  const reserved = Number(reservedUsdcBase(agent, requestId)) / 1_000_000;
  return Math.max(0, limit - spent - reserved);
}

function mark(state: string): string {
  if (state === "pass") return "✓";
  if (state === "fail") return "✕";
  if (state === "ask") return "!";
  return "·";
}

function shortCheck(check: { id: string; state: string }): string {
  if (check.id === "running") return check.state === "fail" ? "Agent paused" : "Agent active";
  if (check.id === "recipient") return check.state === "pass" ? "Recipient allowed" : check.state === "ask" ? "New recipient needs approval" : "Recipient not allowed";
  if (check.id === "limit") return check.state === "fail" ? "Over daily budget" : "Within daily budget";
  if (check.id === "amount") return check.state === "fail" ? "Invalid amount" : "Amount is valid";
  return check.state === "pass" ? "Test USDC" : "Not Test USDC";
}

function FeeNote({ mode, feeLamports }: { mode: Agent["walletMode"]; feeLamports: string | null }) {
  if (mode !== "readonly") {
    return <p className="text-muted-foreground">Demo payments are not broadcast, so there is no network fee and Publik is not covering one.</p>;
  }
  const estimate = feeLamports ? `${formatGrouped(formatBase(feeLamports, 9, 6))} SOL` : "unavailable";
  return (
    <p className="text-muted-foreground">
      SOL pays the network fee. Estimated fee for a simple transfer: {estimate}. The signing wallet pays it. Publik does not cover the fee, and watching this address cannot send the payment.
    </p>
  );
}

function EditDialog({ agent, open, onClose }: { agent: Agent; open: boolean; onClose: () => void }) {
  const { updateAgent } = useStore();
  const [name, setName] = useState(agent.name);
  const [description, setDescription] = useState(agent.description);
  useEffect(() => {
    setName(agent.name);
    setDescription(agent.description);
  }, [agent]);
  return (
    <Dialog onClose={onClose} open={open} title="Edit agent">
      <label className="grid gap-1 text-sm">
        Name
        <input className="field" onChange={(event) => setName(event.target.value)} value={name} />
      </label>
      <label className="mt-3 grid gap-1 text-sm">
        Description
        <input className="field" onChange={(event) => setDescription(event.target.value)} value={description} />
      </label>
      <button
        className="glass-quiet mt-4 h-10 rounded-xl px-4 text-sm font-medium focus-visible:ring-2 focus-visible:ring-focus"
        onClick={() => {
          if (name.trim().length === 0) return;
          updateAgent(agent.id, { name: name.trim(), description: description.trim() });
          onClose();
        }}
        type="button"
      >
        Save
      </button>
    </Dialog>
  );
}

function PermissionsDialog({ agent, open, onClose }: { agent: Agent; open: boolean; onClose: () => void }) {
  const { updatePermissions } = useStore();
  const [daily, setDaily] = useState(formatBase(agent.permissions.dailyUsdcBase, 6, 2));
  const [ask, setAsk] = useState(agent.permissions.askBeforeNewRecipient);
  const [rows, setRows] = useState(agent.permissions.allowedRecipients);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDaily(formatBase(agent.permissions.dailyUsdcBase, 6, 2));
    setAsk(agent.permissions.askBeforeNewRecipient);
    setRows(agent.permissions.allowedRecipients);
    setError(null);
  }, [agent, open]);

  const save = () => {
    let dailyUsdcBase: string;
    try {
      dailyUsdcBase = toBase(daily, 6).toFixed(0);
    } catch {
      setError("Enter a daily Test USDC amount with up to 6 decimal places.");
      return;
    }
    if (rows.some((row) => row.label.trim().length === 0 || !isSolanaAddress(row.address))) {
      setError("Each recipient needs a name and a valid address.");
      return;
    }
    const permissions: Permissions = {
      ...agent.permissions,
      dailyUsdcBase,
      askBeforeNewRecipient: ask,
      allowedRecipients: rows.map((row) => ({ label: row.label.trim(), address: row.address.trim() })),
    };
    updatePermissions(agent.id, permissions);
    onClose();
  };

  return (
    <Dialog description="These rules are checked again before a demo payment is approved. They are not wallet-level locks." onClose={onClose} open={open} title="Edit permissions" wide>
      <label className="grid gap-1 text-sm">
        Daily Test USDC
        <input className="field tabular-nums" onChange={(event) => setDaily(event.target.value)} value={daily} />
      </label>
      <label className="mt-3 flex gap-2 text-sm">
        <input checked={ask} onChange={(event) => setAsk(event.target.checked)} type="checkbox" />
        Ask me before sending to someone new
      </label>
      <div className="mt-3 grid gap-2">
        {rows.map((row, index) => (
          <div className="grid gap-2 sm:grid-cols-[1fr_1.4fr_auto]" key={`${row.address}-${index}`}>
            <input aria-label="Recipient name" className="field" onChange={(event) => setRows(rows.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item))} value={row.label} />
            <input aria-label="Recipient address" className="field font-mono text-xs" onChange={(event) => setRows(rows.map((item, itemIndex) => itemIndex === index ? { ...item, address: event.target.value } : item))} value={row.address} />
            <button className="h-10 rounded-xl px-2 text-sm text-muted-foreground" onClick={() => setRows(rows.filter((_, itemIndex) => itemIndex !== index))} type="button">Remove</button>
          </div>
        ))}
        <button className="glass-quiet h-10 rounded-xl px-3 text-sm focus-visible:ring-2 focus-visible:ring-focus" onClick={() => setRows([...rows, { label: "", address: "" }])} type="button">Add recipient</button>
      </div>
      {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
      <button className="glass-quiet mt-4 h-10 rounded-xl px-4 text-sm font-medium focus-visible:ring-2 focus-visible:ring-focus" onClick={save} type="button">Save permissions</button>
    </Dialog>
  );
}

function AddMoneyDialog({ agent, open, onClose, feeLamports }: { agent: Agent; open: boolean; onClose: () => void; feeLamports: string | null }) {
  const { addDemoFunds } = useStore();
  const [copied, setCopied] = useState(false);
  const address = agent.walletMode === "readonly" || agent.walletMode === "agent-key" ? agent.address : null;
  return (
    <Dialog description={address ? "Send devnet assets to this address from a devnet wallet. Publik cannot pull funds." : "Demo balances are simulated."} onClose={onClose} open={open} title="Add money">
      {agent.walletMode === "demo" ? (
        <div className="grid gap-3 text-sm">
          <p>Add 25 Test USDC to this demo balance. No transaction is sent.</p>
          <button className="glass-quiet h-10 rounded-xl px-4 text-sm font-medium focus-visible:ring-2 focus-visible:ring-focus" onClick={() => { addDemoFunds(agent.id); onClose(); }} type="button">Add 25 Test USDC</button>
          <FeeNote feeLamports={null} mode="demo" />
        </div>
      ) : address ? (
        <div className="grid gap-3 text-sm">
          <div className="mx-auto rounded-xl bg-white p-3">
            <QRCodeSVG aria-label="Deposit address QR code" size={148} value={address} />
          </div>
          <p className="break-all font-mono text-xs">{address}</p>
          <div className="flex flex-wrap gap-2">
            <button
              className="glass-quiet h-10 rounded-xl px-3 text-sm focus-visible:ring-2 focus-visible:ring-focus"
              onClick={() => {
                void navigator.clipboard.writeText(address).then(() => setCopied(true));
              }}
              type="button"
            >
              {copied ? "Copied" : "Copy address"}
            </button>
            <a className="glass-quiet inline-flex h-10 items-center rounded-xl px-3 text-sm focus-visible:ring-2 focus-visible:ring-focus" href={devnetExplorerAddress(address)} rel="noreferrer" target="_blank">Devnet explorer</a>
          </div>
          <p className="text-muted-foreground">Payments stay on devnet. Test USDC mint {shortAddress(holdingsMint())}. The mainnet portfolio, if you add one, is view only and cannot send.</p>
          <FeeNote feeLamports={feeLamports} mode="readonly" />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Choose a demo balance or a devnet address when you add an agent. This agent is not ready to receive money.</p>
      )}
    </Dialog>
  );
}

function holdingsMint(): string {
  return "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
}
