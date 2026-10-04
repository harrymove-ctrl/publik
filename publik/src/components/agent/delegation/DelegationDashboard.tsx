import { useCallback, useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction } from "@solana/web3.js";
import { createTransferCheckedInstruction } from "@solana/spl-token";
import { ModeBadge } from "@/components/agent/ModeBadge";
import { Dialog } from "@/components/ui/dialog";
import { devnetExplorerAddress, devnetExplorerTx, isSolanaAddress, tokenDisplayUnit, tokenMintDescription } from "@/solana/adapter";
import { shortAddress } from "@/domain/format";
import {
  configurePolicyInstruction,
  MINT_DECIMALS,
  revokeDelegationInstruction,
  rotateExecutionKeyInstruction,
  setPausedInstruction,
  tokenAccount,
  vaultAuthority,
  vaultErrorCode,
  vaultErrorMessage,
  vaultTokenAccount,
  withdrawOwnerFundsInstruction,
} from "@/solana/vault";
import { useToast } from "@/state/toast";
import { formatBaseToToken, parseTokenAmountToBase, sleep } from "./delegationMath";
import { fetchAgentExecutions } from "./delegationApi";
import { TxReviewDialog, type AccountMetaRow } from "./TxReviewDialog";
import type { DelegationExecutionItem, DelegationLiveState, TxStepState } from "./delegationTypes";
import type { Agent } from "@/domain/types";

interface DashboardProps {
  agent: Agent;
  live: DelegationLiveState;
  onResetSetup?: () => void;
}

export function DelegationDashboard({ agent, live, onResetSetup }: DashboardProps) {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const toast = useToast();
  const vault = live.vault;

  // Off-chain executions fetched from server
  const [executions, setExecutions] = useState<DelegationExecutionItem[]>([]);
  const [loadingExecutions, setLoadingExecutions] = useState(false);

  const loadExecutions = useCallback(async () => {
    setLoadingExecutions(true);
    try {
      const data = await fetchAgentExecutions(agent.id);
      setExecutions(data);
    } catch {
      // Ignore
    } finally {
      setLoadingExecutions(false);
    }
  }, [agent.id]);

  useEffect(() => {
    void loadExecutions();
  }, [loadExecutions]);

  // Modal / Action states
  const [activeModal, setActiveModal] = useState<
    "fund" | "configure" | "pause" | "rotate" | "revoke" | "withdraw" | null
  >(null);

  // Tx review dialog state
  const [txDialogOpen, setTxDialogOpen] = useState(false);
  const [txTitle, setTxTitle] = useState("");
  const [txInstructionName, setTxInstructionName] = useState("");
  const [txAccounts, setTxAccounts] = useState<AccountMetaRow[]>([]);
  const [txExpectedVersion, setTxExpectedVersion] = useState<bigint | null>(null);
  const [txEffect, setTxEffect] = useState("");
  const [txStatus, setTxStatus] = useState<TxStepState>("idle");
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);
  const [pendingTxBuilder, setPendingTxBuilder] = useState<(() => Promise<Transaction>) | null>(null);

  // Form input states
  const [fundAmount, setFundAmount] = useState("10");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [newExecutionKey, setNewExecutionKey] = useState("");
  const [editPer, setEditPer] = useState(vault ? formatBaseToToken(vault.perBase) : "5");
  const [editDaily, setEditDaily] = useState(vault ? formatBaseToToken(vault.dailyBase) : "25");
  const [editLifetime, setEditLifetime] = useState(vault ? formatBaseToToken(vault.lifetimeBase) : "250");
  const [editRecipients, setEditRecipients] = useState<string[]>(vault?.recipients ?? []);
  const [newRecipientInput, setNewRecipientInput] = useState("");

  // Seed edit form only when opening configure modal, not on every 15s poll
  function openConfigureModal() {
    if (vault) {
      setEditPer(formatBaseToToken(vault.perBase));
      setEditDaily(formatBaseToToken(vault.dailyBase));
      setEditLifetime(formatBaseToToken(vault.lifetimeBase));
      setEditRecipients([...vault.recipients]);
      setNewRecipientInput("");
    }
    setActiveModal("configure");
  }

  // Transaction runner for all owner actions
  const executeOwnerTx = useCallback(
    async (buildTx: () => Promise<Transaction>, actionName: string) => {
      if (!publicKey) {
        toast("Connect wallet first");
        return;
      }
      setTxStatus("awaiting-signature");
      setTxError(null);
      setTxSignature(null);

      try {
        const tx = await buildTx();
        const sig = await sendTransaction(tx, connection);
        setTxSignature(sig);
        setTxStatus("submitted");

        const started = Date.now();
        let confirmed = false;
        let failed = false;
        let errorMsg: string | null = null;

        while (Date.now() - started < 35_000) {
          await sleep(2000);
          const res = await connection.getSignatureStatuses([sig]);
          const status = res.value[0];
          if (status) {
            if (status.err) {
              failed = true;
              const code = vaultErrorCode(status.err);
              errorMsg = code !== null ? vaultErrorMessage(code) : JSON.stringify(status.err);
              break;
            }
            if (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized") {
              confirmed = true;
              break;
            }
          }
        }

        if (confirmed) {
          setTxStatus("confirmed");
          toast(`${actionName} confirmed on Solana!`);
          await live.refresh();
          await loadExecutions();
        } else if (failed) {
          setTxStatus("failed");
          setTxError(errorMsg ?? "Transaction failed on chain");
        } else {
          // Timed out: check signature status
          const check = await connection.getSignatureStatus(sig);
          if (check.value?.confirmationStatus === "confirmed" || check.value?.confirmationStatus === "finalized") {
            setTxStatus("confirmed");
            toast(`${actionName} confirmed!`);
            await live.refresh();
          } else {
            setTxStatus("unresolved");
            setTxError("Confirmation timed out. Signature broadcast; re-check cluster before resubmitting.");
          }
        }
      } catch (err) {
        setTxStatus("failed");
        const code = vaultErrorCode(err);
        setTxError(code !== null ? vaultErrorMessage(code) : err instanceof Error ? err.message : String(err));
      }
    },
    [publicKey, sendTransaction, connection, toast, live, loadExecutions],
  );

  // Setup review dialog for FUND
  function prepareFund() {
    if (!vault) return;
    const amountBase = parseTokenAmountToBase(fundAmount);
    const ownerKey = publicKey ? publicKey.toBase58() : vault.owner;
    const ownerAta = tokenAccount(ownerKey, new PublicKey(vault.mint));
    const vaultAta = vaultTokenAccount(new PublicKey(vault.address), new PublicKey(vault.mint));

    setTxTitle("Deposit Test USDC to Vault");
    setTxInstructionName("spl_token::transfer_checked");
    setTxExpectedVersion(null);
    setTxEffect(
      `Transfers ${fundAmount} Test USDC from your wallet (${shortAddress(ownerAta.toBase58())}) into the vault token account (${shortAddress(vaultAta.toBase58())}). Supplying funds does not raise spending limits.`,
    );
    setTxAccounts([
      { name: "Source (Your ATA)", pubkey: ownerAta.toBase58(), isSigner: false, isWritable: true },
      { name: "Token Mint", pubkey: vault.mint, isSigner: false, isWritable: false },
      { name: "Destination (Vault ATA)", pubkey: vaultAta.toBase58(), isSigner: false, isWritable: true },
      { name: "Owner Authority", pubkey: ownerKey, isSigner: true, isWritable: false },
    ]);
    setTxStatus("idle");
    setTxSignature(null);
    setTxError(null);
    if (publicKey) {
      setPendingTxBuilder(() => async () => {
        const ix = createTransferCheckedInstruction(
          ownerAta,
          new PublicKey(vault.mint),
          vaultAta,
          publicKey,
          amountBase,
          MINT_DECIMALS,
          [],
        );
        const { blockhash } = await connection.getLatestBlockhash("confirmed");
        const tx = new Transaction({ feePayer: publicKey, recentBlockhash: blockhash });
        tx.add(ix);
        return tx;
      });
    } else {
      setPendingTxBuilder(null);
    }
    setTxDialogOpen(true);
  }

  // Setup review dialog for CONFIGURE
  function prepareConfigure() {
    if (!vault) return;
    const perBase = parseTokenAmountToBase(editPer);
    const dailyBase = parseTokenAmountToBase(editDaily);
    const lifetimeBase = parseTokenAmountToBase(editLifetime);
    const ownerKey = publicKey ? publicKey.toBase58() : vault.owner;

    setTxTitle("Update Vault Policy (Configure)");
    setTxInstructionName("publik_vault::configure");
    setTxExpectedVersion(vault.version);
    setTxEffect(
      `Replaces limits and allowlist. Limits will be: Per-payment ${editPer} USDC, Daily ${editDaily} USDC, Lifetime ${editLifetime} USDC, with ${editRecipients.length} allowlisted recipient(s). Spends accumulated today and lifetime are NOT reset. Version bumps from v${vault.version.toString()} to v${(vault.version + 1n).toString()}.`,
    );
    setTxAccounts([
      { name: "Owner Wallet", pubkey: ownerKey, isSigner: true, isWritable: true },
      { name: "Vault PDA", pubkey: vault.address, isSigner: false, isWritable: true },
    ]);
    setTxStatus("idle");
    setTxSignature(null);
    setTxError(null);
    if (publicKey) {
      setPendingTxBuilder(() => async () => {
        const ix = configurePolicyInstruction({
          owner: publicKey.toBase58(),
          vaultId: vault.vaultId,
          expectedVersion: vault.version,
          perBase,
          dailyBase,
          lifetimeBase,
          recipients: editRecipients,
        });
        const { blockhash } = await connection.getLatestBlockhash("confirmed");
        const tx = new Transaction({ feePayer: publicKey, recentBlockhash: blockhash });
        tx.add(ix);
        return tx;
      });
    } else {
      setPendingTxBuilder(null);
    }
    setTxDialogOpen(true);
  }

  // Setup review dialog for PAUSE / RESUME
  function preparePauseToggle() {
    if (!vault) return;
    const willPause = !vault.paused;
    const ownerKey = publicKey ? publicKey.toBase58() : vault.owner;

    setTxTitle(willPause ? "Pause Vault Spending" : "Resume Vault Spending");
    setTxInstructionName("publik_vault::set_paused");
    setTxExpectedVersion(vault.version);
    setTxEffect(
      willPause
        ? "Freezes all delegated spending from this vault. The agent will not be able to execute any payment while paused. Pause takes effect only once confirmed on Solana. A payment broadcast prior to confirmation can still land."
        : "Unfreezes the vault. Autonomous spending by the agent execution key will be permitted within remaining on-chain allowances.",
    );
    setTxAccounts([
      { name: "Owner Wallet", pubkey: ownerKey, isSigner: true, isWritable: true },
      { name: "Vault PDA", pubkey: vault.address, isSigner: false, isWritable: true },
    ]);
    setTxStatus("idle");
    setTxSignature(null);
    setTxError(null);
    if (publicKey) {
      setPendingTxBuilder(() => async () => {
        const ix = setPausedInstruction({
          owner: publicKey.toBase58(),
          vaultId: vault.vaultId,
          expectedVersion: vault.version,
          paused: willPause,
        });
        const { blockhash } = await connection.getLatestBlockhash("confirmed");
        const tx = new Transaction({ feePayer: publicKey, recentBlockhash: blockhash });
        tx.add(ix);
        return tx;
      });
    } else {
      setPendingTxBuilder(null);
    }
    setTxDialogOpen(true);
  }

  // Setup review dialog for ROTATE EXECUTION KEY
  function prepareRotate() {
    if (!vault || !publicKey) return;
    const trimmed = newExecutionKey.trim();
    if (!isSolanaAddress(trimmed)) {
      toast("Invalid public key");
      return;
    }
    if (trimmed === publicKey.toBase58()) {
      toast("Execution key cannot be owner wallet");
      return;
    }

    setTxTitle("Rotate Agent Execution Key");
    setTxInstructionName("publik_vault::rotate");
    setTxExpectedVersion(vault.version);
    setTxEffect(
      `Replaces the agent execution key with ${trimmed}. Once confirmed, the old key (${shortAddress(vault.executionKey)}) can no longer execute payments. The new key must sign future payments.`,
    );
    setTxAccounts([
      { name: "Owner Wallet", pubkey: publicKey.toBase58(), isSigner: true, isWritable: true },
      { name: "Vault PDA", pubkey: vault.address, isSigner: false, isWritable: true },
    ]);
    setTxStatus("idle");
    setTxSignature(null);
    setTxError(null);
    setPendingTxBuilder(() => async () => {
      const ix = rotateExecutionKeyInstruction({
        owner: publicKey.toBase58(),
        vaultId: vault.vaultId,
        expectedVersion: vault.version,
        executionKey: trimmed,
      });
      const { blockhash } = await connection.getLatestBlockhash("confirmed");
      const tx = new Transaction({ feePayer: publicKey, recentBlockhash: blockhash });
      tx.add(ix);
      return tx;
    });
    setTxDialogOpen(true);
  }

  // Setup review dialog for REVOKE (TERMINAL)
  function prepareRevoke() {
    if (!vault) return;
    const ownerKey = publicKey ? publicKey.toBase58() : vault.owner;

    setTxTitle("Revoke Vault Delegation (Terminal)");
    setTxInstructionName("publik_vault::revoke");
    setTxExpectedVersion(vault.version);
    setTxEffect(
      "PERMANENTLY REVOKES DELEGATION. The agent key will never be able to spend from this vault again. Policy cannot be modified or re-enabled. Revoke takes effect once confirmed; it cannot undo already completed transfers. You can still withdraw all remaining funds.",
    );
    setTxAccounts([
      { name: "Owner Wallet", pubkey: ownerKey, isSigner: true, isWritable: true },
      { name: "Vault PDA", pubkey: vault.address, isSigner: false, isWritable: true },
    ]);
    setTxStatus("idle");
    setTxSignature(null);
    setTxError(null);
    if (publicKey) {
      setPendingTxBuilder(() => async () => {
        const ix = revokeDelegationInstruction({
          owner: publicKey.toBase58(),
          vaultId: vault.vaultId,
          expectedVersion: vault.version,
        });
        const { blockhash } = await connection.getLatestBlockhash("confirmed");
        const tx = new Transaction({ feePayer: publicKey, recentBlockhash: blockhash });
        tx.add(ix);
        return tx;
      });
    } else {
      setPendingTxBuilder(null);
    }
    setTxDialogOpen(true);
  }

  // Setup review dialog for WITHDRAW
  function prepareWithdraw() {
    if (!vault || !publicKey) return;
    const amountBase = withdrawAmount ? parseTokenAmountToBase(withdrawAmount) : live.vaultBalanceBase;
    if (amountBase <= 0n) {
      toast("No balance to withdraw");
      return;
    }
    const ownerAta = tokenAccount(publicKey, new PublicKey(vault.mint));
    const vaultAuthorityPda = vaultAuthority(new PublicKey(vault.address));
    const vaultAta = vaultTokenAccount(new PublicKey(vault.address), new PublicKey(vault.mint));

    setTxTitle("Withdraw Vault Funds to Wallet");
    setTxInstructionName("publik_vault::withdraw");
    setTxExpectedVersion(null);
    setTxEffect(
      `Withdraws ${formatBaseToToken(amountBase)} Test USDC from the vault token account to your wallet (${shortAddress(ownerAta.toBase58())}). Owner withdrawals are permitted at all times, including while paused or revoked.`,
    );
    setTxAccounts([
      { name: "Owner Wallet", pubkey: publicKey.toBase58(), isSigner: true, isWritable: true },
      { name: "Vault PDA", pubkey: vault.address, isSigner: false, isWritable: false },
      { name: "Vault Authority PDA", pubkey: vaultAuthorityPda.toBase58(), isSigner: false, isWritable: false },
      { name: "Vault Token ATA", pubkey: vaultAta.toBase58(), isSigner: false, isWritable: true },
      { name: "Destination (Owner ATA)", pubkey: ownerAta.toBase58(), isSigner: false, isWritable: true },
      { name: "Mint", pubkey: vault.mint, isSigner: false, isWritable: false },
    ]);
    setTxStatus("idle");
    setTxSignature(null);
    setTxError(null);
    setPendingTxBuilder(() => async () => {
      const ix = withdrawOwnerFundsInstruction({
        owner: publicKey.toBase58(),
        vaultId: vault.vaultId,
        mint: vault.mint,
        amountBase,
      });
      const { blockhash } = await connection.getLatestBlockhash("confirmed");
      const tx = new Transaction({ feePayer: publicKey, recentBlockhash: blockhash });
      tx.add(ix);
      return tx;
    });
    setTxDialogOpen(true);
  }

  if (!vault) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-6 text-center text-sm space-y-3">
        <p className="text-muted-foreground">No active vault state decoded on {live.clusterLabel}.</p>
        {onResetSetup && (
          <button
            type="button"
            onClick={onResetSetup}
            className="h-9 rounded-xl bg-primary px-4 text-xs font-medium text-primary-foreground"
          >
            Launch Setup Wizard
          </button>
        )}
      </div>
    );
  }

  // Calculate percentages for progress bars
  const nowTs = BigInt(Math.floor(Date.now() / 1000));
  const currentUtcDay = nowTs >= 0n ? nowTs / 86400n : (nowTs - 86400n + 1n) / 86400n;
  const spentTodayBase = currentUtcDay === vault.dayIndex ? vault.spentTodayBase : 0n;

  const dailyTotal = Number(vault.dailyBase);
  const dailySpent = Number(spentTodayBase);
  const dailyPercent = dailyTotal > 0 ? Math.min(100, Math.round((dailySpent / dailyTotal) * 100)) : 0;

  const lifetimeTotal = Number(vault.lifetimeBase);
  const lifetimeSpent = Number(vault.lifetimeSpentBase);
  const lifetimePercent = lifetimeTotal > 0 ? Math.min(100, Math.round((lifetimeSpent / lifetimeTotal) * 100)) : 0;

  const unit = tokenDisplayUnit(vault.mint);
  return (
    <div className="space-y-6">
      {/* Top Banner / Status Overview */}
      <section className="rounded-2xl border border-border bg-surface p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <ModeBadge mode={live.mode} size="md" />
            <span className="font-mono text-xs text-muted-foreground">
              v{vault.version.toString()} · {live.clusterLabel}
            </span>
            {(() => {
              const blockedBy = live.allowanceInfo?.blockedBy ?? (vault.revoked ? "revoked" : vault.paused ? "paused" : null);
              if (blockedBy === "revoked") {
                return (
                  <span className="rounded-full bg-danger/15 text-danger border border-danger/30 px-2 py-0.5 text-xs font-medium">
                    Revoked (Terminal)
                  </span>
                );
              }
              if (blockedBy === "paused") {
                return (
                  <span className="rounded-full bg-warning/15 text-warning border border-warning/30 px-2 py-0.5 text-xs font-medium">
                    Paused
                  </span>
                );
              }
              if (blockedBy === "not_active") {
                return (
                  <span className="rounded-full bg-muted text-muted-foreground border border-border px-2 py-0.5 text-xs font-medium">
                    Not active yet
                  </span>
                );
              }
              if (blockedBy === "expired") {
                return (
                  <span className="rounded-full bg-danger/15 text-danger border border-danger/30 px-2 py-0.5 text-xs font-medium">
                    Expired
                  </span>
                );
              }
              return (
                <span className="rounded-full bg-brand/15 text-brand border border-brand/30 px-2 py-0.5 text-xs font-medium">
                  Active
                </span>
              );
            })()}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">
              {live.slot ? `Slot ${live.slot.toLocaleString()} · ` : ""}
              Synced {live.readAt ?? "just now"}
            </span>
            <button
              type="button"
              onClick={() => void live.refresh()}
              className="glass-quiet size-8 rounded-lg grid place-items-center text-xs text-muted-foreground hover:text-foreground"
              title="Refresh from Solana chain"
            >
              ↻
            </button>
          </div>
        </div>

        {/* Key Addresses */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-xs">
          <div className="rounded-xl border border-border/80 p-3 space-y-1 bg-background/50">
            <span className="text-muted-foreground font-mono">Vault Address (PDA)</span>
            <p className="font-mono text-foreground font-medium truncate" title={vault.address}>
              {shortAddress(vault.address)}
            </p>
            <a
              href={devnetExplorerAddress(vault.address)}
              target="_blank"
              rel="noreferrer"
              className="text-[11px] underline text-muted-foreground hover:text-foreground inline-block"
            >
              View on Explorer
            </a>
          </div>

          <div className="rounded-xl border border-border/80 p-3 space-y-1 bg-background/50">
            <span className="text-muted-foreground font-mono">Agent Execution Key</span>
            <p className="font-mono text-foreground font-medium truncate" title={vault.executionKey}>
              {shortAddress(vault.executionKey)}
            </p>
            <span className="text-[11px] text-muted-foreground block">
              Signs autonomous execute_payment
            </span>
          </div>

          <div className="rounded-xl border border-border/80 p-3 space-y-1 bg-background/50 sm:col-span-2 lg:col-span-1">
            <span className="text-muted-foreground font-mono">Test Token Mint</span>
            <p className="font-mono text-foreground font-medium truncate" title={vault.mint}>
              {shortAddress(vault.mint)}
            </p>
            <span className="text-[11px] text-muted-foreground block truncate" title={tokenMintDescription(vault.mint)}>
              {tokenMintDescription(vault.mint)}
            </span>
          </div>
        </div>

        {/* Quick Actions Row */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border/60">
          <button
            type="button"
            onClick={() => setActiveModal("fund")}
            className="h-9 rounded-xl bg-primary px-3 text-xs font-medium text-primary-foreground focus-visible:ring-2 focus-visible:ring-focus"
          >
            Deposit Funds
          </button>
          <button
            type="button"
            disabled={vault.revoked}
            onClick={openConfigureModal}
            className="glass-quiet h-9 rounded-xl px-3 text-xs font-medium text-foreground disabled:opacity-40"
          >
            Edit Controls
          </button>
          <button
            type="button"
            disabled={vault.revoked}
            onClick={preparePauseToggle}
            className="glass-quiet h-9 rounded-xl px-3 text-xs font-medium text-foreground disabled:opacity-40"
          >
            {vault.paused ? "Resume Spending" : "Pause Spending"}
          </button>
          <button
            type="button"
            disabled={vault.revoked}
            onClick={() => setActiveModal("rotate")}
            className="glass-quiet h-9 rounded-xl px-3 text-xs font-medium text-foreground disabled:opacity-40"
          >
            Rotate Key
          </button>
          <button
            type="button"
            onClick={() => setActiveModal("withdraw")}
            className="glass-quiet h-9 rounded-xl px-3 text-xs font-medium text-foreground"
          >
            Withdraw
          </button>
          {!vault.revoked && (
            <button
              type="button"
              onClick={prepareRevoke}
              className="h-9 rounded-xl border border-danger/40 bg-danger/10 px-3 text-xs font-medium text-danger hover:bg-danger/20 transition-colors ml-auto"
            >
              Revoke Authority
            </button>
          )}
        </div>
      </section>

      {/* PANEL 1: On-Chain Spend Counters */}
      <section className="rounded-2xl border border-border bg-surface p-6 space-y-5">
        <div>
          <h2 className="text-lg font-medium tracking-tight">On-Chain Policy & Spend Counters</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Read directly from Solana account storage. Enforced on-chain by program instructions.
          </p>
        </div>

        {/* Highlight Stats */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-border p-4 bg-surface/50">
            <span className="text-xs text-muted-foreground">Vault Balance</span>
            <p className="mt-1 text-2xl font-mono font-medium text-foreground">
              {formatBaseToToken(live.vaultBalanceBase)}{" "}
              <span className="text-xs font-normal text-muted-foreground">{unit}</span>
            </p>
            <span className="text-[11px] text-muted-foreground font-mono">
              {live.vaultBalanceBase.toString()} base units
            </span>
          </div>

          <div className="rounded-xl border border-border p-4 bg-surface/50">
            <span className="text-xs text-muted-foreground">Spendable Right Now</span>
            <p className="mt-1 text-2xl font-mono font-medium text-brand">
              {live.allowanceInfo ? formatBaseToToken(live.allowanceInfo.spendableNowBase) : "0"}{" "}
              <span className="text-xs font-normal text-muted-foreground">{unit}</span>
            </p>
            <span className="text-[11px] text-muted-foreground">
              Min(per-payment, daily remaining, lifetime remaining, balance)
            </span>
          </div>

          <div className="rounded-xl border border-border p-4 bg-surface/50">
            <span className="text-xs text-muted-foreground">Per-Payment Maximum</span>
            <p className="mt-1 text-2xl font-mono font-medium text-foreground">
              {formatBaseToToken(vault.perBase)}{" "}
              <span className="text-xs font-normal text-muted-foreground">{unit}</span>
            </p>
            <span className="text-[11px] text-muted-foreground font-mono">
              {vault.perBase.toString()} base units
            </span>
          </div>

          <div className="rounded-xl border border-border p-4 bg-surface/50">
            <span className="text-xs text-muted-foreground">Policy Expiry</span>
            <p className="mt-1 text-sm font-medium text-foreground">
              {new Date(Number(vault.expiryTs) * 1000).toLocaleDateString()}
            </p>
            <span className="text-[11px] text-muted-foreground">
              {new Date(Number(vault.expiryTs) * 1000).toLocaleTimeString()}
            </span>
          </div>
        </div>

        {/* Progress Bars for Daily & Lifetime Limits */}
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Daily Limit Bar */}
          <div className="rounded-xl border border-border p-4 space-y-2 bg-surface/50">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-foreground">Daily Allowance (UTC Day #{currentUtcDay.toString()})</span>
              <span className="font-mono text-muted-foreground">{dailyPercent}% spent</span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-brand transition-all duration-300"
                style={{ width: `${dailyPercent}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-muted-foreground font-mono">
              <span>Spent today: {formatBaseToToken(spentTodayBase)} {unit}</span>
              <span>Limit: {formatBaseToToken(vault.dailyBase)} {unit}</span>
            </div>
            <p className="text-[11px] text-muted-foreground pt-1 border-t border-border/40">
              Resets at UTC 00:00:00 (Unix epoch timestamp / 86,400) from Solana Clock.
            </p>
          </div>

          {/* Lifetime Limit Bar */}
          <div className="rounded-xl border border-border p-4 space-y-2 bg-surface/50">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-foreground">Lifetime Allowance</span>
              <span className="font-mono text-muted-foreground">{lifetimePercent}% spent</span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-warning transition-all duration-300"
                style={{ width: `${lifetimePercent}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-muted-foreground font-mono">
              <span>Lifetime spent: {formatBaseToToken(vault.lifetimeSpentBase)} {unit}</span>
              <span>Limit: {formatBaseToToken(vault.lifetimeBase)} {unit}</span>
            </div>
            <p className="text-[11px] text-muted-foreground pt-1 border-t border-border/40">
              Counters persist across policy updates; configuring limits does NOT reset spent totals.
            </p>
          </div>
        </div>

        {/* Recipient Allowlist Display */}
        <div className="rounded-xl border border-border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-medium text-foreground">
              Allowed Recipients ({vault.recipients.length}/8)
            </h3>
            {vault.recipients.length === 0 && (
              <span className="text-[11px] text-danger font-medium">Empty allowlist: nobody can be paid</span>
            )}
          </div>
          {vault.recipients.length > 0 ? (
            <div className="grid gap-2 sm:grid-cols-2 font-mono text-xs">
              {vault.recipients.map((rec) => (
                <div key={rec} className="flex items-center justify-between p-2 rounded-lg border border-border/60 bg-background/50">
                  <span className="truncate pr-2">{rec}</span>
                  <a
                    href={devnetExplorerAddress(rec)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[10px] text-muted-foreground hover:text-foreground shrink-0 underline"
                  >
                    Explorer
                  </a>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground italic">
              No recipients allowlisted. Any payment attempt by {agent.name} will be rejected on chain by the program.
            </p>
          )}
        </div>
      </section>

      {/* PANEL 2: Off-chain Queued Requests */}
      <section className="rounded-2xl border border-border bg-surface p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-medium tracking-tight">Queued Payment Requests</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Payments requested off-chain via the Publik agent protocol waiting for execution or approval.
            </p>
          </div>
          <span className="text-xs text-muted-foreground font-mono">
            {agent.requests.length} total request(s)
          </span>
        </div>

        {agent.requests.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="py-2 font-mono uppercase tracking-wider font-normal">Created</th>
                  <th className="py-2 font-mono uppercase tracking-wider font-normal">Amount</th>
                  <th className="py-2 font-mono uppercase tracking-wider font-normal">Recipient</th>
                  <th className="py-2 font-mono uppercase tracking-wider font-normal">Reason</th>
                  <th className="py-2 font-mono uppercase tracking-wider font-normal">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {agent.requests.map((req) => (
                  <tr key={req.id} className="hover:bg-muted/30">
                    <td className="py-2.5 font-mono text-muted-foreground">
                      {new Date(req.createdAt).toLocaleTimeString()}
                    </td>
                    <td className="py-2.5 font-mono font-medium">
                      {(Number(req.amountBase) / 1e6).toFixed(2)} Test USDC
                    </td>
                    <td className="py-2.5 font-mono text-muted-foreground truncate max-w-40" title={req.recipient}>
                      {shortAddress(req.recipient)}
                    </td>
                    <td className="py-2.5 text-muted-foreground truncate max-w-48">
                      {req.reason || "Payment"}
                    </td>
                    <td className="py-2.5">
                      <span
                        className={`inline-block rounded px-2 py-0.5 text-[11px] font-medium capitalize ${
                          req.status === "approved" || req.status === "completed"
                            ? "bg-brand/15 text-brand"
                            : req.status === "blocked"
                            ? "bg-warning/15 text-warning"
                            : req.status === "rejected"
                            ? "bg-danger/15 text-danger"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {req.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground italic rounded-xl border border-dashed border-border p-4 text-center">
            No payment requests queued for {agent.name}.
          </p>
        )}
      </section>

      {/* PANEL 3: Executions and Attempts (from /executions route) */}
      <section className="rounded-2xl border border-border bg-surface p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-medium tracking-tight">On-Chain Executions & Attempts</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Receipt records from <code className="font-mono bg-muted px-1 py-0.5 rounded">execute_payment</code>. Direct on-chain executions show &quot;No Publik request&quot;.
            </p>
          </div>
          <button
            type="button"
            onClick={loadExecutions}
            disabled={loadingExecutions}
            className="text-xs text-muted-foreground hover:text-foreground underline"
          >
            {loadingExecutions ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        {executions.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="py-2 font-mono uppercase tracking-wider font-normal">Execution ID</th>
                  <th className="py-2 font-mono uppercase tracking-wider font-normal">Request</th>
                  <th className="py-2 font-mono uppercase tracking-wider font-normal">Amount</th>
                  <th className="py-2 font-mono uppercase tracking-wider font-normal">Recipient</th>
                  <th className="py-2 font-mono uppercase tracking-wider font-normal">Status</th>
                  <th className="py-2 font-mono uppercase tracking-wider font-normal">Signature</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60 font-mono">
                {executions.map((item, idx) => (
                  <tr key={item.id ?? item.execution_id ?? idx} className="hover:bg-muted/30">
                    <td className="py-2.5 font-medium truncate max-w-32" title={item.execution_id}>
                      {shortAddress(item.execution_id)}
                    </td>
                    <td className="py-2.5 font-sans text-muted-foreground">
                      {item.request_id ? `Req #${item.request_id}` : "No Publik request"}
                    </td>
                    <td className="py-2.5">
                      {(Number(item.amount_base) / 1e6).toFixed(2)} USDC
                    </td>
                    <td className="py-2.5 text-muted-foreground truncate max-w-32" title={item.recipient}>
                      {shortAddress(item.recipient)}
                    </td>
                    <td className="py-2.5 font-sans">
                      <span
                        className={`inline-block rounded px-2 py-0.5 text-[11px] font-medium capitalize ${
                          item.status === "confirmed"
                            ? "bg-brand/15 text-brand"
                            : item.status === "failed"
                            ? "bg-danger/15 text-danger"
                            : item.status === "unresolved"
                            ? "bg-warning/15 text-warning"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {item.status}
                      </span>
                    </td>
                    <td className="py-2.5">
                      {item.signature ? (
                        <a
                          href={devnetExplorerTx(item.signature) ?? "#"}
                          target="_blank"
                          rel="noreferrer"
                          className="underline text-brand font-mono"
                        >
                          {shortAddress(item.signature)}
                        </a>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground italic rounded-xl border border-dashed border-border p-4 text-center">
            No on-chain executions recorded yet for this vault.
          </p>
        )}
      </section>

      {/* Trust, Safety, and Authority Disclaimers */}
      <section className="rounded-2xl border border-border/80 bg-muted/20 p-5 text-xs text-muted-foreground space-y-2">
        <h3 className="font-medium text-foreground text-sm">Security & Enforcement Disclaimers:</h3>
        <ul className="list-disc pl-5 space-y-1.5 leading-relaxed">
          <li><strong>Pause and revoke take effect only once confirmed on Solana.</strong> Unconfirmed or inflight transactions are not blocked.</li>
          <li><strong>A payment processed before revocation can still succeed.</strong> Revoke is not retroactive.</li>
          <li><strong>Revoke cannot reverse a completed transfer.</strong> Transferred tokens remain with the recipient.</li>
          <li><strong>Disconnecting API access does not revoke on-chain authority.</strong> An agent with the execution key could still sign directly against Solana unless the vault is revoked on chain.</li>
          <li><strong>A compromised execution key can spend within its remaining authority.</strong> Rotate the key immediately if compromised.</li>
          <li><strong>The upgrade authority is a trust dependency.</strong> The program upgrade key can change bytecode rules.</li>
          <li><strong>Program not audited.</strong> This contract is experimental and intended for devnet and local testing only.</li>
        </ul>
      </section>

      {/* FUND MODAL */}
      <Dialog
        open={activeModal === "fund"}
        onClose={() => setActiveModal(null)}
        title="Deposit Test USDC"
        description="Transfer test tokens from your wallet to the vault token account."
      >
        <div className="space-y-4 text-sm">
          <div>
            <label className="text-xs font-medium text-foreground block mb-1">
              Deposit amount (Test USDC)
            </label>
            <input
              type="text"
              value={fundAmount}
              onChange={(e) => setFundAmount(e.target.value)}
              className="w-full h-10 rounded-xl border border-border bg-background px-3 font-mono text-xs"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Funding supplies spendable balance for payments, but never increases the per-payment, daily, or lifetime limits.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setActiveModal(null)}
              className="glass-quiet h-9 rounded-lg px-3 text-xs"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveModal(null);
                prepareFund();
              }}
              className="h-9 rounded-lg bg-primary px-4 text-xs font-medium text-primary-foreground"
            >
              Review Transaction →
            </button>
          </div>
        </div>
      </Dialog>

      {/* CONFIGURE MODAL */}
      <Dialog
        open={activeModal === "configure"}
        onClose={() => setActiveModal(null)}
        title="Configure Policy Limits"
        description="Edit limits and allowlisted recipients for this vault."
        wide
      >
        <div className="space-y-4 text-sm">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="text-xs font-medium text-foreground block mb-1">Per-payment (USDC)</label>
              <input
                type="text"
                value={editPer}
                onChange={(e) => setEditPer(e.target.value)}
                className="w-full h-9 rounded-xl border border-border bg-background px-2.5 font-mono text-xs"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-foreground block mb-1">Daily limit (USDC)</label>
              <input
                type="text"
                value={editDaily}
                onChange={(e) => setEditDaily(e.target.value)}
                className="w-full h-9 rounded-xl border border-border bg-background px-2.5 font-mono text-xs"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-foreground block mb-1">Lifetime limit (USDC)</label>
              <input
                type="text"
                value={editLifetime}
                onChange={(e) => setEditLifetime(e.target.value)}
                className="w-full h-9 rounded-xl border border-border bg-background px-2.5 font-mono text-xs"
              />
            </div>
          </div>

          {/* Edit allowlist */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-foreground block">
              Recipients ({editRecipients.length}/8)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={newRecipientInput}
                onChange={(e) => setNewRecipientInput(e.target.value)}
                placeholder="Solana address"
                className="flex-1 h-9 rounded-xl border border-border bg-background px-2.5 font-mono text-xs"
              />
              <button
                type="button"
                onClick={() => {
                  const key = newRecipientInput.trim();
                  if (key && isSolanaAddress(key) && !editRecipients.includes(key) && editRecipients.length < 8) {
                    setEditRecipients((r) => [...r, key]);
                    setNewRecipientInput("");
                  }
                }}
                className="glass-quiet h-9 rounded-xl px-3 text-xs"
              >
                Add
              </button>
            </div>
            {editRecipients.length > 0 && (
              <ul className="max-h-32 overflow-y-auto rounded-xl border border-border divide-y divide-border/60 font-mono text-xs">
                {editRecipients.map((rec) => (
                  <li key={rec} className="flex items-center justify-between p-2">
                    <span className="truncate pr-2">{rec}</span>
                    <button
                      type="button"
                      onClick={() => setEditRecipients((r) => r.filter((item) => item !== rec))}
                      className="text-danger hover:underline text-xs"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setActiveModal(null)}
              className="glass-quiet h-9 rounded-lg px-3 text-xs"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveModal(null);
                prepareConfigure();
              }}
              className="h-9 rounded-lg bg-primary px-4 text-xs font-medium text-primary-foreground"
            >
              Review Transaction →
            </button>
          </div>
        </div>
      </Dialog>

      {/* ROTATE KEY MODAL */}
      <Dialog
        open={activeModal === "rotate"}
        onClose={() => setActiveModal(null)}
        title="Rotate Execution Key"
        description="Bind a new public key for this agent."
      >
        <div className="space-y-4 text-sm">
          <div>
            <label className="text-xs font-medium text-foreground block mb-1">
              New agent execution public key
            </label>
            <input
              type="text"
              value={newExecutionKey}
              onChange={(e) => setNewExecutionKey(e.target.value.trim())}
              placeholder="Base58 Solana public key"
              className="w-full h-10 rounded-xl border border-border bg-background px-3 font-mono text-xs"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            The old key will be immediately invalidated once confirmed on chain.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setActiveModal(null)}
              className="glass-quiet h-9 rounded-lg px-3 text-xs"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!newExecutionKey || !isSolanaAddress(newExecutionKey)}
              onClick={() => {
                setActiveModal(null);
                prepareRotate();
              }}
              className="h-9 rounded-lg bg-primary px-4 text-xs font-medium text-primary-foreground disabled:opacity-40"
            >
              Review Transaction →
            </button>
          </div>
        </div>
      </Dialog>

      {/* WITHDRAW MODAL */}
      <Dialog
        open={activeModal === "withdraw"}
        onClose={() => setActiveModal(null)}
        title="Withdraw Funds"
        description="Transfer test tokens from the vault back to your wallet."
      >
        <div className="space-y-4 text-sm">
          <div>
            <label className="text-xs font-medium text-foreground block mb-1">
              Amount to withdraw (Test USDC)
            </label>
            <input
              type="text"
              value={withdrawAmount}
              onChange={(e) => setWithdrawAmount(e.target.value)}
              placeholder={`Max: ${formatBaseToToken(live.vaultBalanceBase)}`}
              className="w-full h-10 rounded-xl border border-border bg-background px-3 font-mono text-xs"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Leaving empty or clicking below will withdraw all {formatBaseToToken(live.vaultBalanceBase)} Test USDC.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setActiveModal(null)}
              className="glass-quiet h-9 rounded-lg px-3 text-xs"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveModal(null);
                prepareWithdraw();
              }}
              className="h-9 rounded-lg bg-primary px-4 text-xs font-medium text-primary-foreground"
            >
              Review Transaction →
            </button>
          </div>
        </div>
      </Dialog>

      {/* TRANSACTION REVIEW DIALOG */}
      <TxReviewDialog
        open={txDialogOpen}
        onClose={() => setTxDialogOpen(false)}
        title={txTitle}
        instructionName={txInstructionName}
        accounts={txAccounts}
        expectedVersion={txExpectedVersion}
        effect={txEffect}
        status={txStatus}
        signature={txSignature}
        errorMessage={txError}
        onConfirm={() => {
          if (pendingTxBuilder) {
            void executeOwnerTx(pendingTxBuilder, txTitle);
          }
        }}
      />
    </div>
  );
}
