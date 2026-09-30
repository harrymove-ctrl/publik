import type { ReactNode } from "react";
import { Pause, Play } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { AgentAvatar } from "@/components/avatar/AgentAvatar";
import { Dialog } from "@/components/ui/dialog";
import { formatBase, formatGrouped, toBase } from "@/domain/money";
import { formatWhen, holdingFiat, holdingQuantity, requestTitle, shortAddress, statusLabel, tokenName, usdcAmount } from "@/domain/format";
import type { Agent } from "@/domain/types";
import type { Permissions, SpendRequest } from "@/domain/policy";
import { devnetExplorerAddress, devnetExplorerTx, isSolanaAddress } from "@/solana/adapter";
import { useDevnetHoldings } from "@/solana/useDevnetHoldings";
import { useStore } from "@/state/store";
import { SpendingChart } from "./SpendingChart";

export function AgentPage() {
  const { agentId } = useParams();
  const store = useStore();
  const agent = store.state.agents.find((item) => item.id === (agentId ?? store.state.selectedId));
  const [requestId, setRequestId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [moneyOpen, setMoneyOpen] = useState(false);
  const live = useDevnetHoldings(agent?.address ?? null, agent?.walletMode === "readonly");

  useEffect(() => {
    if (agent && agent.id !== store.state.selectedId) store.selectAgent(agent.id);
  }, [agent, store]);

  if (!agent) return <p className="p-8 text-sm text-muted-foreground">That agent is not in this workspace.</p>;

  const holdings = agent.walletMode === "readonly" ? live.holdings : agent.holdings;
  const needs = agent.requests.filter((item) => item.status === "pending" || item.status === "blocked");
  const usdc = holdings.find((item) => item.symbol === "USDC");
  const spent = formatGrouped(formatBase(agent.spentTodayBase, 6, 2));
  const openRequest = agent.requests.find((item) => item.id === requestId) ?? null;

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-4 sm:px-8">
      <header className="flex flex-col items-center text-center">
        <AgentAvatar className="max-sm:hidden" kind={agent.avatar} name={agent.name} orb={agent.orb} size={64} />
        <AgentAvatar className="sm:hidden" kind={agent.avatar} name={agent.name} orb={agent.orb} size={52} />
        <h1 className="mt-2 text-2xl font-medium tracking-tight">{agent.name}</h1>
        <p className="mt-1 max-w-md text-[13px] text-muted-foreground">{agent.description}</p>
        <p className="mt-2 text-[13px]">
          <StatusDot running={agent.status === "running"} /> {agent.status === "running" ? "Running" : "Paused"}
          {agent.walletMode === "readonly" ? <span className="text-muted-foreground"> · Watching</span> : null}
          {agent.walletMode === "unconnected" ? <span className="text-muted-foreground"> · No wallet</span> : null}
        </p>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          <button className="h-9 rounded-lg border border-border bg-surface px-3 text-sm" onClick={() => store.setPaused(agent.id, agent.status === "running")} type="button">
            {agent.status === "running" ? <Pause aria-hidden="true" className="mr-1 inline" size={14} /> : <Play aria-hidden="true" className="mr-1 inline" size={14} />}
            {agent.status === "running" ? "Pause agent" : "Resume"}
          </button>
          <button className="h-9 rounded-lg bg-primary px-3 text-sm text-primary-foreground" onClick={() => setEditing(true)} type="button">
            Edit
          </button>
        </div>
      </header>

      <section aria-label="Summary" className="mt-3 grid grid-cols-3 gap-2">
        <Summary label="Available to spend" value={usdc ? `${holdingQuantity(usdc)}` : agent.walletMode === "readonly" && live.status === "loading" ? "…" : "—"} hint="Test USDC" />
        <Summary label="Spent today" value={spent} hint="Test USDC" />
        <Summary label="Needs you" value={String(needs.length)} hint={needs.length === 1 ? "item" : "items"} />
      </section>

      {!agent.runtimeConnected ? <ConnectRuntime onSample={() => store.addSampleRequest(agent.id)} onDismiss={() => store.markRuntimeSeen(agent.id)} /> : null}

      <div className="mt-3 grid items-start gap-3 md:grid-cols-2">
        <Panel title="Balance" action="Add money" onAction={() => setMoneyOpen(true)}>
          {agent.walletMode === "readonly" && live.status === "loading" ? <p className="text-sm text-muted-foreground">Loading devnet balances…</p> : null}
          {agent.walletMode === "readonly" && live.status === "error" ? (
            <div className="text-sm">
              <p>Could not reach Solana devnet.</p>
              <button className="mt-2 h-10 rounded-xl border border-border px-3" onClick={live.retry} type="button">Try again</button>
            </div>
          ) : null}
          {agent.walletMode !== "readonly" || live.status === "ready" ? (
            holdings.length === 0 ? (
              <p className="text-sm text-muted-foreground">{agent.address ? "No tokens found for this address yet." : "This agent has no wallet yet. Add money, or watch a devnet address."}</p>
            ) : (
              <ul className="divide-y divide-border">
                {holdings.map((holding) => {
                  const fiat = holdingFiat(holding);
                  return (
                    <li className="flex items-center gap-3 py-2" key={`${holding.symbol}-${holding.mint ?? "native"}`}>
                      <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-[10px] font-medium">
                        {(holding.label || holding.symbol).slice(0, 1)}
                      </span>
                      <p className="min-w-0 flex-1 text-sm">{holding.label || tokenName(holding.symbol)}</p>
                      <div className="text-right">
                        <p className="text-sm tabular-nums">{holdingQuantity(holding)}</p>
                        <p className="text-xs text-muted-foreground">{fiat ?? "Price unavailable"}</p>
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

        <Panel title="Needs you">
          {needs.length === 0 ? <p className="text-sm text-muted-foreground">You're all caught up.</p> : null}
          <ul className="grid gap-1">
            {needs.map((request) => (
              <li key={request.id}>
                <button className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-left hover:bg-muted" onClick={() => setRequestId(request.id)} type="button">
                  <span className="text-sm">{request.status === "blocked" ? "Send to a new recipient" : `Pay ${request.recipientLabel}`}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{request.status === "blocked" ? "Blocked — recipient not allowed" : `${usdcAmount(request.amountBase)} Test USDC · Needs approval`}</span>
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <div className="mt-3 grid gap-3">

        <Panel title="Permissions" action="Edit permissions" onAction={() => setPermissionsOpen(true)}>
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
        feeLamports={live.feeLamports}
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

function StatusDot({ running }: { running: boolean }) {
  return <span aria-hidden="true" className={`mr-1 inline-block size-2 rounded-full ${running ? "bg-success" : "bg-muted-foreground"}`} />;
}

function Summary({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border px-3 py-2.5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg tabular-nums leading-none">{value}</p>
      {hint ? <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Panel({ title, action, onAction, children }: { title: string; action?: string; onAction?: () => void; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-base font-medium">{title}</h2>
        {action && onAction ? (
          <button className="h-9 rounded-lg px-2 text-sm text-foreground" onClick={onAction} type="button">{action}</button>
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
    <section className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border px-3 py-3 text-sm">
      <p>This agent is not connected yet.</p>
      <div className="flex gap-2">
        <button className="h-9 rounded-lg bg-primary px-3 text-sm text-primary-foreground" onClick={onSample} type="button">Sample request</button>
        <button className="h-9 rounded-lg px-2 text-sm text-muted-foreground" onClick={onDismiss} type="button">Hide</button>
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
  feeLamports,
  onClose,
  onEditPermissions,
}: {
  agent: Agent | undefined;
  request: SpendRequest | null;
  feeLamports: string | null;
  onClose: () => void;
  onEditPermissions: () => void;
}) {
  const { decideRequest, recheckRequest } = useStore();
  const [message, setMessage] = useState<string | null>(null);
  if (!agent || !request) return null;
  const blocked = request.status === "blocked";
  const pending = request.status === "pending";
  return (
    <Dialog description={request.reason} onClose={onClose} open title={requestTitle(request)}>
      <dl className="grid gap-2 text-sm">
        <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Status</dt><dd>{statusLabel(request.status)}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Recipient</dt><dd className="text-right">{request.recipientLabel}</dd></div>
        <div className="font-mono text-xs text-muted-foreground">{request.recipient}</div>
        <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Note</dt><dd>{request.memo}</dd></div>
        <FeeNote feeLamports={feeLamports} mode={agent.walletMode} />
      </dl>
      {message ? <p className="mt-3 text-sm text-danger">{message}</p> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        {pending ? (
          <>
            <button
              className="h-10 rounded-xl bg-primary px-4 text-sm text-primary-foreground"
              onClick={() => setMessage(decideRequest(agent.id, request.id, "approved"))}
              type="button"
            >
              Approve
            </button>
            <button className="h-10 rounded-xl border border-border px-4 text-sm" onClick={() => { decideRequest(agent.id, request.id, "rejected"); onClose(); }} type="button">
              Reject
            </button>
          </>
        ) : null}
        {blocked ? (
          <>
            <button className="h-10 rounded-xl border border-border px-4 text-sm" onClick={onEditPermissions} type="button">Review permissions</button>
            <button className="h-10 rounded-xl px-3 text-sm text-muted-foreground" onClick={() => recheckRequest(agent.id, request.id)} type="button">Check again</button>
          </>
        ) : null}
      </div>
      <details className="mt-4 text-sm text-muted-foreground">
        <summary>Details</summary>
        <p className="mt-2">Request {request.id}. {request.signature ? "Signature recorded." : "No transaction signature."}</p>
        {request.status === "failed" ? <p>A failure means the send did not go through. A block means the spending rules stopped it first.</p> : null}
      </details>
    </Dialog>
  );
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
        className="mt-4 h-10 rounded-xl bg-primary px-4 text-sm text-primary-foreground"
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
        <button className="h-10 rounded-xl border border-border text-sm" onClick={() => setRows([...rows, { label: "", address: "" }])} type="button">Add recipient</button>
      </div>
      {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
      <button className="mt-4 h-10 rounded-xl bg-primary px-4 text-sm text-primary-foreground" onClick={save} type="button">Save permissions</button>
    </Dialog>
  );
}

function AddMoneyDialog({ agent, open, onClose, feeLamports }: { agent: Agent; open: boolean; onClose: () => void; feeLamports: string | null }) {
  const { addDemoFunds } = useStore();
  const [copied, setCopied] = useState(false);
  const address = agent.walletMode === "readonly" ? agent.address : null;
  return (
    <Dialog description={address ? "Send devnet assets to this address from a devnet wallet. Publik cannot pull funds." : "Demo balances are simulated."} onClose={onClose} open={open} title="Add money">
      {agent.walletMode === "demo" ? (
        <div className="grid gap-3 text-sm">
          <p>Add 25 Test USDC to this demo balance. No transaction is sent.</p>
          <button className="h-10 rounded-xl bg-primary px-4 text-sm text-primary-foreground" onClick={() => { addDemoFunds(agent.id); onClose(); }} type="button">Add 25 Test USDC</button>
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
              className="h-10 rounded-xl border border-border px-3"
              onClick={() => {
                void navigator.clipboard.writeText(address).then(() => setCopied(true));
              }}
              type="button"
            >
              {copied ? "Copied" : "Copy address"}
            </button>
            <a className="inline-flex h-10 items-center rounded-xl border border-border px-3" href={devnetExplorerAddress(address)} rel="noreferrer" target="_blank">Devnet explorer</a>
          </div>
          <p className="text-muted-foreground">Use devnet only. Test USDC mint {shortAddress(holdingsMint())}. A mainnet USDC mint will not show up here.</p>
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
