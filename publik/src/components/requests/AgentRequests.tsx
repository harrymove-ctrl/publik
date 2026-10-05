import { getAssociatedTokenAddress, getMint, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useCallback, useEffect, useState } from "react";
import { ModeBadge } from "@/components/agent/ModeBadge";
import { ownerSession, signOwnerSession, type OwnerSession } from "@/components/connect/api";
import { formatWhen, shortAddress, usdcAmount } from "@/domain/format";
import { assertDevnetCluster, devnetExplorerTx } from "@/solana/adapter";
import { waitForConfirmation } from "@/solana/confirm";
import { mintProblem, tokenLabel } from "@/solana/mintCheck";
import { buildOwnerUsdcPayment } from "@/solana/ownerPay";
import { resolvedClusterLabel } from "@/solana/provider";
import { useToast } from "@/state/toast";
import { listAgentRequests, ownerCall, pendingSignatures, setPendingSignature, type AgentPaymentRequest } from "./ownerRequests";

const WAITING: AgentPaymentRequest["status"][] = ["pending_review", "blocked", "submitted"];

type SignatureReply = { status: AgentPaymentRequest["status"]; signature?: string; detail?: string };

/**
 * Requests that paired agents filed through the API (for example over the MCP bridge). Approving signs a
 * devnet transfer with the connected owner wallet; the API marks it confirmed only after reading it on chain.
 */
export function AgentRequests() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction, signMessage } = useWallet();
  const toast = useToast();
  const [session, setSession] = useState<OwnerSession | null>(null);
  const [rows, setRows] = useState<AgentPaymentRequest[]>([]);
  const [local, setLocal] = useState<Record<string, string>>(() => pendingSignatures());
  const [busy, setBusy] = useState<{ id: string; label: string } | null>(null);
  const [error, setError] = useState<{ id: string | null; message: string } | null>(null);
  const [last, setLast] = useState<{ id: string; signature: string } | null>(null);

  const reload = useCallback(async () => {
    try {
      setRows(await listAgentRequests());
      setLocal(pendingSignatures());
    } catch (caught) {
      setError({ id: null, message: caught instanceof Error ? caught.message : "Agent requests could not be read." });
    }
  }, []);

  useEffect(() => {
    void ownerSession().then(setSession).catch(() => setSession({ authenticated: false }));
  }, []);

  useEffect(() => {
    if (!session?.authenticated) return;
    void reload();
    const timer = window.setInterval(() => void reload(), 10_000);
    return () => window.clearInterval(timer);
  }, [reload, session]);

  async function signIn() {
    setError(null);
    if (!publicKey || !signMessage) {
      setError({ id: null, message: "Connect the owner wallet first. The sign-in signature is not a payment." });
      return;
    }
    try {
      setSession(await signOwnerSession(publicKey.toBase58(), signMessage));
    } catch (caught) {
      setError({ id: null, message: caught instanceof Error ? caught.message : "The ownership challenge was not signed." });
    }
  }

  /** Hands a chain signature to the API. Only an API refusal releases it; an unanswered call keeps it for a recheck. */
  async function record(row: AgentPaymentRequest, signature: string, csrf: string) {
    setBusy({ id: row.id, label: "Checking on devnet" });
    const result = await ownerCall<SignatureReply>(`/api/v1/owner/payment-requests/${row.id}/signature`, csrf, { signature });
    if (result.kind === "unreachable") {
      setError({ id: row.id, message: `${result.message} The signature is kept here. Recheck before signing anything else.` });
      return;
    }
    setPendingSignature(row.id, null);
    if (result.kind === "refused") {
      setError({ id: row.id, message: result.message });
    } else if (result.body.status === "confirmed") {
      setLast({ id: row.id, signature });
      toast(`Paid ${usdcAmount(row.amount_base)} to ${shortAddress(row.recipient)} on devnet`);
    } else {
      setError({ id: row.id, message: result.body.detail ?? "Submitted. Devnet has not confirmed it yet. Recheck in a moment." });
    }
  }

  async function approve(row: AgentPaymentRequest) {
    if (!session?.authenticated) return;
    setError(null);
    setLast(null);
    if (!publicKey || !sendTransaction) {
      setError({ id: row.id, message: "Connect the owner wallet to sign this payment. Publik does not sign." });
      return;
    }
    if (publicKey.toBase58() !== session.wallet) {
      setError({ id: row.id, message: `Connect ${shortAddress(session.wallet)}, the wallet that signed in. Publik checks the payment came from it.` });
      return;
    }
    setBusy({ id: row.id, label: "Waiting for the wallet" });
    try {
      await assertDevnetCluster(connection);
      const mint = new PublicKey(row.mint);
      const mintAccount = await getMint(connection, mint, "confirmed", TOKEN_PROGRAM_ID);
      const problem = mintProblem(TOKEN_PROGRAM_ID.toBase58(), mintAccount.decimals);
      if (problem) throw new Error(problem);
      const destination = await getAssociatedTokenAddress(mint, new PublicKey(row.recipient), true, TOKEN_PROGRAM_ID);
      const existing = await connection.getAccountInfo(destination);
      const { blockhash } = await connection.getLatestBlockhash("confirmed");
      const tx = await buildOwnerUsdcPayment({
        owner: publicKey.toBase58(),
        destinationOwner: row.recipient,
        mint: row.mint,
        amountBase: BigInt(row.amount_base),
        blockhash,
        createDestination: !existing,
      });
      const signature = await sendTransaction(tx, connection);
      setPendingSignature(row.id, signature);
      setLocal(pendingSignatures());
      setBusy({ id: row.id, label: "Waiting for devnet" });
      await waitForConfirmation(connection, signature);
      await record(row, signature, session.csrf);
    } catch (caught) {
      setError({ id: row.id, message: caught instanceof Error ? caught.message : "The wallet did not send this payment." });
    } finally {
      setBusy(null);
      await reload();
    }
  }

  async function recheck(row: AgentPaymentRequest, signature: string) {
    if (!session?.authenticated) return;
    setError(null);
    try {
      await record(row, signature, session.csrf);
    } finally {
      setBusy(null);
      await reload();
    }
  }

  async function reject(row: AgentPaymentRequest) {
    if (!session?.authenticated) return;
    setError(null);
    const result = await ownerCall(`/api/v1/owner/payment-requests/${row.id}/reject`, session.csrf, {});
    if (result.kind !== "ok") setError({ id: row.id, message: result.message });
    await reload();
  }

  if (session === null) return null;

  if (!session.authenticated) {
    return (
      <section className="mt-6 rounded-2xl border border-border bg-surface p-4">
        <h2 className="text-base font-medium">Connected agents</h2>
        <p className="mt-1 text-sm text-muted-foreground">Requests from paired agents (for example over the MCP bridge) wait here. Sign in with the owner wallet to read them. That signature is not a payment.</p>
        {error ? <p className="mt-2 text-sm text-danger">{error.message}</p> : null}
        <button className="mt-3 h-9 rounded-lg bg-primary px-3 text-sm text-primary-foreground" onClick={() => void signIn()} type="button">Sign in with owner wallet</button>
      </section>
    );
  }

  const waiting = rows.filter((row) => WAITING.includes(row.status));
  const confirmed = last ? rows.find((row) => row.id === last.id && row.status === "confirmed") : undefined;

  return (
    <section className="mt-6">
      <h2 className="text-base font-medium">Connected agents · {resolvedClusterLabel}</h2>
      <p className="mt-1 text-sm text-muted-foreground">Approving signs a real {resolvedClusterLabel.toLowerCase()} transfer from {shortAddress(session.wallet)}. Publik marks it paid only after reading it on chain.</p>
      {error && error.id === null ? <p className="mt-2 text-sm text-danger">{error.message}</p> : null}
      {confirmed && last ? (
        <p className="mt-2 text-sm text-success">
          Confirmed on devnet. <a className="underline" href={devnetExplorerTx(last.signature) ?? undefined} rel="noreferrer" target="_blank">Explorer</a>
        </p>
      ) : null}
      {waiting.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">No agent requests are waiting.</p> : null}
      <ul className="mt-3 grid gap-3">
        {waiting.map((row) => {
          const kept = row.status === "submitted" ? row.signature : local[row.id] ?? null;
          const working = busy?.id === row.id;
          return (
            <li className="rounded-2xl border border-border bg-surface p-4" data-request-id={row.id} key={row.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-lg tabular-nums">{usdcAmount(row.amount_base)} {tokenLabel(row.mint)}</p>
                  <p className="mt-1 font-mono text-xs">{row.recipient}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{row.reason || "No reason given."}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <p className="text-xs text-muted-foreground">{row.agent_name} · {formatWhen(row.created_at)} · {resolvedClusterLabel}</p>
                    <ModeBadge mode="owner-signed" size="sm" />
                  </div>
                </div>
                <p className={row.status === "blocked" ? "text-danger" : "text-warning"}>
                  {row.status === "blocked" ? (row.policy_outcome === "paused" ? "Blocked: agent paused" : "Blocked: over the daily limit") : kept ? "Signed, not confirmed" : "Needs you"}
                </p>
              </div>
              {error?.id === row.id ? <p className="mt-2 text-sm text-danger">{error.message}</p> : null}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {row.status === "pending_review" && !kept ? (
                  <button className="h-9 rounded-lg bg-brand px-3 text-sm font-medium text-[#2a100e] disabled:opacity-50" disabled={busy !== null} onClick={() => void approve(row)} type="button">
                    {working ? busy.label : "Approve and sign"}
                  </button>
                ) : null}
                {kept ? (
                  <>
                    <button className="h-9 rounded-lg bg-primary px-3 text-sm text-primary-foreground disabled:opacity-50" disabled={busy !== null} onClick={() => void recheck(row, kept)} type="button">
                      {working ? busy.label : "Recheck on devnet"}
                    </button>
                    <a className="text-sm underline" href={devnetExplorerTx(kept) ?? undefined} rel="noreferrer" target="_blank">Explorer</a>
                  </>
                ) : null}
                {(row.status === "pending_review" && !kept) || row.status === "blocked" ? (
                  <button className="glass-quiet h-9 rounded-lg px-3 text-sm disabled:opacity-50" disabled={busy !== null} onClick={() => void reject(row)} type="button">Reject</button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
