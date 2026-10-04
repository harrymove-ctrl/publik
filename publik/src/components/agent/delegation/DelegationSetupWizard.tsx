import { useCallback, useEffect, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction } from "@solana/web3.js";
import { createTransferCheckedInstruction } from "@solana/spl-token";
import { AgentAvatar } from "@/components/avatar/AgentAvatar";
import { currentRpcConfig, devnetExplorerTx, devnetUsdcMint, isSolanaAddress, tokenDisplayUnit } from "@/solana/adapter";
import {
  DAY_SECONDS,
  decodeVault,
  initializeVaultInstructions,
  MINT_DECIMALS,
  tokenAccount,
  VAULT_LEN,
  VAULT_PROGRAM_ID,
  vaultAddress,
  vaultAuthority,
  type VaultState,
} from "@/solana/vault";
import { useToast } from "@/state/toast";
import { bytesToHex, generateRandomVaultIdHex, hexToBytes32, parseTokenAmountToBase, safeParseTokenAmountToBase, sleep } from "./delegationMath";
import { ownerPost, ownerSession, signOwnerSession } from "@/components/connect/api";
import { linkAgentDelegation } from "./delegationApi";
import { storeVaultAddress } from "./useAgentDelegation";
import type { DelegationSetupState } from "./delegationTypes";
import type { Agent } from "@/domain/types";

const STORAGE_PREFIX = "publik.delegation.setup.";

interface WizardProps {
  agent: Agent;
  onCompleted: (vault: VaultState) => void;
  onCancel?: () => void;
}

export function DelegationSetupWizard({ agent, onCompleted, onCancel }: WizardProps) {
  const { connection } = useConnection();
  const { publicKey, sendTransaction, signMessage } = useWallet();
  const toast = useToast();
  const rpcConfig = currentRpcConfig();

  // Load / initialize persistent setup state
  const [setup, setSetup] = useState<DelegationSetupState>(() => {
    try {
      const saved = localStorage.getItem(`${STORAGE_PREFIX}${agent.id}`);
      if (saved) {
        return JSON.parse(saved) as DelegationSetupState;
      }
    } catch {
      // Ignore
    }
    const defaultStart = Math.floor(Date.now() / 1000);
    const defaultExpiry = defaultStart + 30 * DAY_SECONDS;
    return {
      step: 1,
      vaultIdHex: generateRandomVaultIdHex(),
      executionKey: "",
      perToken: "5",
      dailyToken: "25",
      lifetimeToken: "250",
      recipients: [],
      startTs: defaultStart.toString(),
      expiryTs: defaultExpiry.toString(),
      initSignature: null,
      initStatus: "idle",
      initError: null,
      fundAmountToken: "10",
      fundSignature: null,
      fundStatus: "idle",
      fundError: null,
      vaultAddress: null,
    };
  });

  // Save to localStorage on change
  useEffect(() => {
    try {
      localStorage.setItem(`${STORAGE_PREFIX}${agent.id}`, JSON.stringify(setup));
    } catch {
      // Ignore
    }
  }, [agent.id, setup]);
  // Check pending signatures on mount/reload with searchTransactionHistory: true
  const checkPendingInitStatus = useCallback(async () => {
    if (!setup.initSignature) return;
    try {
      const res = await connection.getSignatureStatuses([setup.initSignature], { searchTransactionHistory: true });
      const status = res.value[0];
      if (status) {
        if (status.err) {
          setSetup((prev) => ({ ...prev, initStatus: "failed", initError: JSON.stringify(status.err) }));
        } else if (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized") {
          setSetup((prev) => ({ ...prev, initStatus: "confirmed", step: Math.max(prev.step, 5) as 1 | 2 | 3 | 4 | 5 | 6 }));
        } else {
          setSetup((prev) => ({ ...prev, initStatus: "unresolved", initError: "Transaction broadcast; confirmation not finalized yet." }));
        }
      } else {
        setSetup((prev) => ({ ...prev, initStatus: "unresolved", initError: "Transaction signature not found on cluster history yet." }));
      }
    } catch (e) {
      setSetup((prev) => ({ ...prev, initStatus: "unresolved", initError: e instanceof Error ? e.message : "Error checking signature status" }));
    }
  }, [connection, setup.initSignature]);

  const checkPendingFundStatus = useCallback(async () => {
    if (!setup.fundSignature) return;
    try {
      const res = await connection.getSignatureStatuses([setup.fundSignature], { searchTransactionHistory: true });
      const status = res.value[0];
      if (status) {
        if (status.err) {
          setSetup((prev) => ({ ...prev, fundStatus: "failed", fundError: JSON.stringify(status.err) }));
        } else if (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized") {
          setSetup((prev) => ({ ...prev, fundStatus: "confirmed", step: Math.max(prev.step, 6) as 1 | 2 | 3 | 4 | 5 | 6 }));
        } else {
          setSetup((prev) => ({ ...prev, fundStatus: "unresolved", fundError: "Transaction broadcast; confirmation not finalized yet." }));
        }
      } else {
        setSetup((prev) => ({ ...prev, fundStatus: "unresolved", fundError: "Transaction signature not found on cluster history yet." }));
      }
    } catch (e) {
      setSetup((prev) => ({ ...prev, fundStatus: "unresolved", fundError: e instanceof Error ? e.message : "Error checking signature status" }));
    }
  }, [connection, setup.fundSignature]);

  useEffect(() => {
    if (setup.initStatus === "submitted" || setup.initStatus === "unresolved") {
      void checkPendingInitStatus();
    }
    if (setup.fundStatus === "submitted" || setup.fundStatus === "unresolved") {
      void checkPendingFundStatus();
    }
  }, [checkPendingInitStatus, checkPendingFundStatus, setup.initStatus, setup.fundStatus]);


  // Live program check
  const [checkingProgram, setCheckingProgram] = useState(true);
  const [programDeployed, setProgramDeployed] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function checkDeployment() {
      setCheckingProgram(true);
      try {
        const info = await connection.getAccountInfo(VAULT_PROGRAM_ID, "confirmed");
        if (!cancelled) {
          setProgramDeployed(Boolean(info && info.executable));
        }
      } catch {
        if (!cancelled) setProgramDeployed(false);
      } finally {
        if (!cancelled) setCheckingProgram(false);
      }
    }
    void checkDeployment();
    return () => {
      cancelled = true;
    };
  }, [connection]);

  // Derived addresses
  const mintAddress = devnetUsdcMint();
  const vaultIdBytes = useMemo(() => {
    try {
      return hexToBytes32(setup.vaultIdHex);
    } catch {
      return new Uint8Array(32);
    }
  }, [setup.vaultIdHex]);

  const computedVaultPubkey = useMemo(() => {
    if (!publicKey) return null;
    try {
      return vaultAddress(publicKey, vaultIdBytes);
    } catch {
      return null;
    }
  }, [publicKey, vaultIdBytes]);

  const computedVaultAuthority = useMemo(() => {
    if (!computedVaultPubkey) return null;
    return vaultAuthority(computedVaultPubkey);
  }, [computedVaultPubkey]);

  const computedVaultAta = useMemo(() => {
    if (!computedVaultAuthority) return null;
    return tokenAccount(computedVaultAuthority, new PublicKey(mintAddress));
  }, [computedVaultAuthority, mintAddress]);

  // Owner balances for step 4/5
  const [ownerSolBalance, setOwnerSolBalance] = useState<number | null>(null);
  const [ownerTokenBalance, setOwnerTokenBalance] = useState<string | null>(null);
  const [estimatedFeeLamports, setEstimatedFeeLamports] = useState<{ total: number; rentVault: number; rentAta: number; txFee: number } | null>(null);

  useEffect(() => {
    if (!publicKey) return;
    let cancelled = false;
    const ownerKey = publicKey;
    async function loadBalancesAndFees() {
      try {
        const lamports = await connection.getBalance(ownerKey, "confirmed");
        if (!cancelled) setOwnerSolBalance(lamports);

        const ownerAta = tokenAccount(ownerKey, new PublicKey(mintAddress));
        try {
          const bal = await connection.getTokenAccountBalance(ownerAta, "confirmed");
          if (!cancelled) setOwnerTokenBalance(bal.value.uiAmountString ?? "0");
        } catch {
          if (!cancelled) setOwnerTokenBalance("0");
        }

        // Fee calculations
        const rentVault = await connection.getMinimumBalanceForRentExemption(VAULT_LEN);
        const rentAta = await connection.getMinimumBalanceForRentExemption(165);
        const txFee = 5000;
        if (!cancelled) {
          setEstimatedFeeLamports({
            rentVault,
            rentAta,
            txFee,
            total: rentVault + rentAta + txFee,
          });
        }
      } catch (e) {
        console.warn("Error loading fee estimates:", e);
      }
    }
    void loadBalancesAndFees();
    return () => {
      cancelled = true;
    };
  }, [connection, publicKey, mintAddress]);

  // Recipient input state in Step 3
  const [newRecipientInput, setNewRecipientInput] = useState("");
  const [recipientError, setRecipientError] = useState<string | null>(null);

  function handleAddRecipient() {
    setRecipientError(null);
    const key = newRecipientInput.trim();
    if (!key) return;
    if (!isSolanaAddress(key)) {
      setRecipientError("Invalid Solana address");
      return;
    }
    if (setup.recipients.includes(key)) {
      setRecipientError("Recipient already added");
      return;
    }
    if (setup.recipients.length >= 8) {
      setRecipientError("Maximum 8 recipients allowed");
      return;
    }
    setSetup((prev) => ({ ...prev, recipients: [...prev.recipients, key] }));
    setNewRecipientInput("");
  }

  function handleRemoveRecipient(key: string) {
    setSetup((prev) => ({ ...prev, recipients: prev.recipients.filter((r) => r !== key) }));
  }

  // Step 2 validation
  const executionKeyError = useMemo(() => {
    const key = setup.executionKey.trim();
    if (!key) return null;
    if (!isSolanaAddress(key)) return "Invalid Solana base58 public key";
    if (publicKey && key === publicKey.toBase58()) {
      return "The execution key cannot be your owner wallet. Use a key created with 'delegation key create'.";
    }
    return null;
  }, [setup.executionKey, publicKey]);

  // Step 3 validation
  const rulesError = useMemo(() => {
    try {
      const perBase = parseTokenAmountToBase(setup.perToken);
      const dailyBase = parseTokenAmountToBase(setup.dailyToken);
      const lifetimeBase = parseTokenAmountToBase(setup.lifetimeToken);
      if (perBase <= 0n) return "Per-payment limit must be greater than zero";
      if (dailyBase <= 0n) return "Daily limit must be greater than zero";
      if (lifetimeBase <= 0n) return "Lifetime limit must be greater than zero";
      if (perBase > dailyBase) return "Per-payment limit cannot exceed the daily limit";
      if (dailyBase > lifetimeBase) return "Daily limit cannot exceed the lifetime limit";
      const start = BigInt(setup.startTs);
      const expiry = BigInt(setup.expiryTs);
      if (expiry <= start) return "Expiry time must be after start time";
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "Invalid rule values";
    }
  }, [setup.perToken, setup.dailyToken, setup.lifetimeToken, setup.startTs, setup.expiryTs]);

  // Execute Step 4: Initialize Vault
  const handleInitializeVault = useCallback(async () => {
    if (!publicKey || !computedVaultPubkey) {
      toast("Connect your wallet first");
      return;
    }
    if (programDeployed !== true) {
      toast("Vault program is not deployed on this cluster");
      return;
    }

    setSetup((prev) => ({
      ...prev,
      initStatus: "awaiting-signature",
      initError: null,
    }));

    try {
      const perBase = parseTokenAmountToBase(setup.perToken);
      const dailyBase = parseTokenAmountToBase(setup.dailyToken);
      const lifetimeBase = parseTokenAmountToBase(setup.lifetimeToken);
      const startTs = BigInt(setup.startTs);
      const expiryTs = BigInt(setup.expiryTs);

      const instructions = initializeVaultInstructions({
        owner: publicKey.toBase58(),
        vaultId: vaultIdBytes,
        executionKey: setup.executionKey.trim(),
        mint: mintAddress,
        perBase,
        dailyBase,
        lifetimeBase,
        startTs,
        expiryTs,
        recipients: setup.recipients,
      });

      const { blockhash } = await connection.getLatestBlockhash("confirmed");
      const tx = new Transaction({ feePayer: publicKey, recentBlockhash: blockhash });
      tx.add(...instructions);

      const sig = await sendTransaction(tx, connection);
      setSetup((prev) => ({
        ...prev,
        initSignature: sig,
        initStatus: "submitted",
        vaultAddress: computedVaultPubkey.toBase58(),
      }));

      // Poll confirmation
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
            errorMsg = JSON.stringify(status.err);
            break;
          }
          if (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized") {
            confirmed = true;
            break;
          }
        }
      }

      if (confirmed) {
        setSetup((prev) => ({
          ...prev,
          initStatus: "confirmed",
          step: 5,
        }));
        toast("Vault initialized on Solana!");
      } else if (failed) {
        setSetup((prev) => ({
          ...prev,
          initStatus: "failed",
          initError: errorMsg ?? "Initialization transaction failed on chain",
        }));
        toast("Initialization failed on chain");
      } else {
        // Timed out: verify signature on chain before declaring
        const check = await connection.getSignatureStatus(sig);
        if (check.value?.confirmationStatus === "confirmed" || check.value?.confirmationStatus === "finalized") {
          setSetup((prev) => ({ ...prev, initStatus: "confirmed", step: 5 }));
        } else {
          setSetup((prev) => ({
            ...prev,
            initStatus: "unresolved",
            initError: "Transaction submitted but confirmation timed out. Check signature.",
          }));
        }
      }
    } catch (err) {
      setSetup((prev) => ({
        ...prev,
        initStatus: "failed",
        initError: err instanceof Error ? err.message : String(err),
      }));
    }
  }, [publicKey, computedVaultPubkey, programDeployed, setup.perToken, setup.dailyToken, setup.lifetimeToken, setup.startTs, setup.expiryTs, vaultIdBytes, setup.executionKey, mintAddress, setup.recipients, connection, sendTransaction, toast]);

  // Execute Step 5: Fund Vault
  const handleFundVault = useCallback(async () => {
    if (!publicKey || !computedVaultPubkey || !computedVaultAta) {
      toast("Missing vault details");
      return;
    }

    setSetup((prev) => ({
      ...prev,
      fundStatus: "awaiting-signature",
      fundError: null,
    }));

    try {
      const fundAmountBase = parseTokenAmountToBase(setup.fundAmountToken);
      if (fundAmountBase <= 0n) throw new Error("Amount must be positive");

      const ownerAta = tokenAccount(publicKey, new PublicKey(mintAddress));
      const ix = createTransferCheckedInstruction(
        ownerAta,
        new PublicKey(mintAddress),
        computedVaultAta,
        publicKey,
        fundAmountBase,
        MINT_DECIMALS,
        [],
      );

      const { blockhash } = await connection.getLatestBlockhash("confirmed");
      const tx = new Transaction({ feePayer: publicKey, recentBlockhash: blockhash });
      tx.add(ix);

      const sig = await sendTransaction(tx, connection);
      setSetup((prev) => ({
        ...prev,
        fundSignature: sig,
        fundStatus: "submitted",
      }));

      // Poll confirmation
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
            errorMsg = JSON.stringify(status.err);
            break;
          }
          if (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized") {
            confirmed = true;
            break;
          }
        }
      }

      if (confirmed) {
        setSetup((prev) => ({
          ...prev,
          fundStatus: "confirmed",
          step: 6,
        }));
        toast("Vault funded with Test USDC!");
      } else if (failed) {
        setSetup((prev) => ({
          ...prev,
          fundStatus: "failed",
          fundError: errorMsg ?? "Funding transaction failed on chain",
        }));
      } else {
        setSetup((prev) => ({
          ...prev,
          fundStatus: "unresolved",
          fundError: "Funding transaction confirmation timed out. Check signature.",
        }));
      }
    } catch (err) {
      setSetup((prev) => ({
        ...prev,
        fundStatus: "failed",
        fundError: err instanceof Error ? err.message : String(err),
      }));
    }
  }, [publicKey, computedVaultPubkey, computedVaultAta, setup.fundAmountToken, mintAddress, connection, sendTransaction, toast]);

  // Execute Step 6: Verify and Link
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifiedVault, setVerifiedVault] = useState<VaultState | null>(null);

  const handleVerifyAndLink = useCallback(async () => {
    const targetAddress = setup.vaultAddress || computedVaultPubkey?.toBase58();
    if (!targetAddress || !publicKey) {
      setVerifyError("No vault address to verify");
      return;
    }
    setVerifying(true);
    setVerifyError(null);

    try {
      const pubkey = new PublicKey(targetAddress);
      const acc = await connection.getAccountInfo(pubkey, "confirmed");
      if (!acc) throw new Error("Vault account not found on chain");

      const decoded = decodeVault(pubkey, acc.data, acc.owner);

      // Verify on-chain fields match reviewed values
      if (decoded.owner !== publicKey.toBase58()) {
        throw new Error("Vault owner on chain does not match connected wallet");
      }
      if (decoded.executionKey !== setup.executionKey.trim()) {
        throw new Error("Execution key on chain does not match reviewed key");
      }
      if (bytesToHex(decoded.vaultId) !== setup.vaultIdHex.toLowerCase()) {
        throw new Error("Vault ID on chain does not match reviewed seeds");
      }

      // Ensure owner session before linking
      let session = await ownerSession().catch(() => ({ authenticated: false as const }));
      if (!session.authenticated) {
        if (!signMessage) throw new Error("Connect your wallet and sign the ownership challenge first.");
        session = await signOwnerSession(publicKey.toBase58(), signMessage);
      }
      if (!session.authenticated) {
        throw new Error("Could not authenticate owner session");
      }

      // Ensure agent exists on server; if local demo profile, provision via existing createProfile route
      const checkRes = await fetch(`/api/v1/owner/agents/${agent.id}`, { credentials: "include" });
      if (checkRes.status === 404) {
        await ownerPost("/api/v1/owner/agents", session.csrf, {
          name: agent.name,
          description: agent.description,
          agent_id: agent.id,
        });
      }

      // Call server API to link
      const linkRes = await linkAgentDelegation(agent.id, {
        vault: decoded.address,
        owner: decoded.owner,
        vault_id_hex: setup.vaultIdHex,
        execution_key: decoded.executionKey,
        mint: decoded.mint,
        network: rpcConfig.cluster === "localnet" ? "solana-localnet" : "solana-devnet",
      });

      if (!linkRes.ok) {
        throw new Error(linkRes.message ?? "Server failed to link vault record");
      }

      // Persist local store only after server link succeeds
      storeVaultAddress(agent.id, {
        vaultAddress: decoded.address,
        owner: decoded.owner,
        vaultIdHex: setup.vaultIdHex,
        executionKey: decoded.executionKey,
        mint: decoded.mint,
      });

      setVerifiedVault(decoded);
      toast("Delegation verified and active!");
      onCompleted(decoded);
    } catch (e) {
      setVerifyError(e instanceof Error ? e.message : "Verification failed");
    } finally {
      setVerifying(false);
    }
  }, [setup.vaultAddress, setup.executionKey, setup.vaultIdHex, computedVaultPubkey, publicKey, connection, agent.id, rpcConfig.cluster, toast, onCompleted]);

  // Stepper labels
  const steps = [
    { num: 1, title: "Authority" },
    { num: 2, title: "Execution Key" },
    { num: 3, title: "Rules" },
    { num: 4, title: "Initialize" },
    { num: 5, title: "Fund" },
    { num: 6, title: "Verify" },
  ];

  return (
    <div className="space-y-6">
      {/* Step navigation bar */}
      <div className="flex items-center justify-between border-b border-border pb-4 overflow-x-auto">
        <ol className="flex items-center gap-2 sm:gap-4 min-w-max">
          {steps.map((s) => {
            const isActive = setup.step === s.num;
            const isDone = setup.step > s.num;
            return (
              <li key={s.num} className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={s.num > setup.step}
                  onClick={() => setSetup((prev) => ({ ...prev, step: s.num as 1 | 2 | 3 | 4 | 5 | 6 }))}
                  className={`flex items-center gap-2 text-xs font-medium rounded-lg px-2.5 py-1.5 transition-all ${
                    isActive
                      ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                      : isDone
                      ? "border border-border/80 bg-surface/80 text-foreground hover:bg-muted"
                      : "text-muted-foreground opacity-40 cursor-not-allowed"
                  }`}
                >
                  <span
                    className={`size-4 rounded-full flex items-center justify-center text-[10px] font-mono ${
                      isActive
                        ? "bg-primary-foreground text-primary font-bold"
                        : isDone
                        ? "bg-brand/20 text-brand font-bold"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {isDone ? "✓" : s.num}
                  </span>
                  <span>{s.title}</span>
                </button>
                {s.num < steps.length && <span className="text-muted-foreground/40 text-xs">/</span>}
              </li>
            );
          })}
        </ol>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="text-xs text-muted-foreground hover:text-foreground underline ml-4 shrink-0"
          >
            Cancel setup
          </button>
        )}
      </div>

      {/* Step 1: Understand authority */}
      {setup.step === 1 && (
        <section className="space-y-5 rounded-2xl border border-border bg-surface p-6">
          <div>
            <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Step 1</span>
            <h2 className="text-xl font-medium tracking-tight mt-1">Understand spending authority</h2>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
              Delegated execution lets {agent.name}&apos;s execution key sign payments from an isolated on-chain vault without asking you each time.
              Publik never holds the signing key. The vault program checks every payment against the rules you set.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 text-xs">
            <div className="rounded-xl border border-border p-3.5 space-y-1">
              <span className="text-muted-foreground font-mono">Cluster</span>
              <p className="font-medium text-foreground">{rpcConfig.clusterLabel} ({rpcConfig.endpoint})</p>
            </div>
            <div className="rounded-xl border border-border p-3.5 space-y-1">
              <span className="text-muted-foreground font-mono">Vault Program ID</span>
              <p className="font-mono text-foreground break-all" title={VAULT_PROGRAM_ID.toBase58()}>
                {VAULT_PROGRAM_ID.toBase58()}
              </p>
            </div>
            <div className="rounded-xl border border-border p-3.5 space-y-1 sm:col-span-2">
              <span className="text-muted-foreground font-mono">Program Deployment Status</span>
              <div className="flex items-center gap-2 mt-1">
                {checkingProgram ? (
                  <span className="text-muted-foreground">Checking cluster deployment…</span>
                ) : programDeployed ? (
                  <span className="inline-flex items-center gap-1.5 font-medium text-brand">
                    <span className="size-2 rounded-full bg-brand animate-pulse" />
                    Deployed and executable on {rpcConfig.clusterLabel}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 font-medium text-danger">
                    <span className="size-2 rounded-full bg-danger" />
                    Not deployed on {rpcConfig.clusterLabel}. All send buttons will be disabled.
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border/80 bg-muted/30 p-4 text-xs space-y-2 text-muted-foreground">
            <h3 className="font-medium text-foreground">What the vault program enforces</h3>
            <ul className="list-disc pl-4 space-y-1">
              <li>The agent can only spend from this vault, never from your wallet or other token accounts.</li>
              <li>Every payment must fit the per-payment, UTC-day, and lifetime limits, the allowlist, and the active window.</li>
              <li>An empty allowlist allows nobody. Payments to other addresses fail on-chain.</li>
              <li>If the execution key is stolen, whoever holds it can spend what remains within these limits until you pause or revoke.</li>
              <li>The program is upgradeable and has not been audited. Its upgrade authority could change these rules.</li>
            </ul>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="button"
              disabled={programDeployed !== true}
              onClick={() => setSetup((prev) => ({ ...prev, step: 2 }))}
              className="h-10 rounded-xl bg-brand px-5 text-sm font-medium text-[#2a100e] hover:brightness-105 active:brightness-95 disabled:opacity-40 transition-all focus-visible:ring-2 focus-visible:ring-focus shadow-xs"
            >
              Continue to Execution Key →
            </button>
          </div>
        </section>
      )}

      {/* Step 2: Bind execution key */}
      {setup.step === 2 && (
        <section className="space-y-5 rounded-2xl border border-border bg-surface p-6">
          <div>
            <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Step 2</span>
            <h2 className="text-xl font-medium tracking-tight mt-1">Bind agent execution key</h2>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
              Pairing an agent or creating an API credential does NOT grant spending power. Enter the execution public key
              created on the agent&apos;s runtime machine.
            </p>
          </div>

          <div className="flex items-center gap-3 rounded-xl border border-border p-3.5 bg-surface/50">
            <AgentAvatar appearance={agent.appearance} id={agent.id} name={agent.name} size={40} />
            <div className="min-w-0 flex-1 text-xs">
              <p className="font-medium text-foreground">{agent.name}</p>
              <p className="text-muted-foreground truncate">{agent.description}</p>
            </div>
            <span className="text-[11px] font-mono bg-muted/60 px-2 py-0.5 rounded text-muted-foreground">
              Paired agent
            </span>
          </div>

          <div className="rounded-xl border border-border/80 bg-muted/20 p-4 text-xs text-muted-foreground space-y-2">
            <p className="font-medium text-foreground">API Credential vs Execution Key:</p>
            <p>
              The API token allows {agent.name} to poll requests and read status via HTTP, but has ZERO signing capability.
              The execution key is a standalone Solana ed25519 keypair saved locally on the agent host (e.g. via{" "}
              <code className="font-mono text-foreground bg-muted px-1 py-0.5 rounded">bun agent/key.ts {agent.name.toLowerCase()}</code>).
              Publik never handles the execution private key.
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-foreground block">
              Agent execution public key
            </label>
            <input
              type="text"
              value={setup.executionKey}
              onChange={(e) => setSetup((prev) => ({ ...prev, executionKey: e.target.value.trim() }))}
              placeholder="e.g. 7q8t... or paste execution key from 'delegation key create'"
              className="w-full h-11 rounded-xl border border-border bg-background px-3 font-mono text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-focus"
            />
            {executionKeyError ? (
              <p className="text-xs text-danger">{executionKeyError}</p>
            ) : setup.executionKey && isSolanaAddress(setup.executionKey) ? (
              <div className="rounded-xl border border-brand/30 bg-brand/10 p-3 text-xs font-mono text-brand break-all">
                Key validated: {setup.executionKey}
              </div>
            ) : null}
          </div>

          <div className="flex justify-between pt-2">
            <button
              type="button"
              onClick={() => setSetup((prev) => ({ ...prev, step: 1 }))}
              className="glass-quiet h-10 rounded-xl px-4 text-sm"
            >
              ← Back
            </button>
            <button
              type="button"
              disabled={Boolean(executionKeyError) || !setup.executionKey || !isSolanaAddress(setup.executionKey)}
              onClick={() => setSetup((prev) => ({ ...prev, step: 3 }))}
              className="h-10 rounded-xl bg-brand px-5 text-sm font-medium text-[#2a100e] hover:brightness-105 active:brightness-95 disabled:opacity-40 transition-all focus-visible:ring-2 focus-visible:ring-focus shadow-xs"
            >
              Configure Policy Rules →
            </button>
          </div>
        </section>
      )}

      {/* Step 3: Rules */}
      {setup.step === 3 && (
        <section className="space-y-5 rounded-2xl border border-border bg-surface p-6">
          <div>
            <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Step 3</span>
            <h2 className="text-xl font-medium tracking-tight mt-1">Configure vault policy rules</h2>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
              These rules are compiled directly into the vault account bytes and enforced by the Solana runtime.
              Amounts are converted to 6-decimal base units using exact integer arithmetic.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground block">
                Per-payment max ({tokenDisplayUnit(mintAddress)})
              </label>
              <input
                type="text"
                value={setup.perToken}
                onChange={(e) => setSetup((prev) => ({ ...prev, perToken: e.target.value }))}
                className="w-full h-10 rounded-xl border border-border bg-background px-3 font-mono text-xs"
              />
              <span className="text-[11px] text-muted-foreground font-mono">
                {(() => {
                  const parsed = safeParseTokenAmountToBase(setup.perToken);
                  return parsed !== null ? `${parsed.toString()} base units` : "invalid amount";
                })()}
              </span>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground block">
                Daily max ({tokenDisplayUnit(mintAddress)})
              </label>
              <input
                type="text"
                value={setup.dailyToken}
                onChange={(e) => setSetup((prev) => ({ ...prev, dailyToken: e.target.value }))}
                className="w-full h-10 rounded-xl border border-border bg-background px-3 font-mono text-xs"
              />
              <span className="text-[11px] text-muted-foreground font-mono">
                {(() => {
                  const parsed = safeParseTokenAmountToBase(setup.dailyToken);
                  return parsed !== null ? `${parsed.toString()} base units` : "invalid amount";
                })()}
              </span>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground block">
                Lifetime max ({tokenDisplayUnit(mintAddress)})
              </label>
              <input
                type="text"
                value={setup.lifetimeToken}
                onChange={(e) => setSetup((prev) => ({ ...prev, lifetimeToken: e.target.value }))}
                className="w-full h-10 rounded-xl border border-border bg-background px-3 font-mono text-xs"
              />
              <span className="text-[11px] text-muted-foreground font-mono">
                {(() => {
                  const parsed = safeParseTokenAmountToBase(setup.lifetimeToken);
                  return parsed !== null ? `${parsed.toString()} base units` : "invalid amount";
                })()}
              </span>
            </div>
          </div>

          <div className="rounded-xl border border-border/80 bg-muted/20 p-3.5 text-xs text-muted-foreground space-y-1">
            <span className="font-medium text-foreground">UTC Calendar Day Reset:</span>
            <p>
              The daily limit resets at UTC 00:00:00 (Unix timestamp / 86,400) according to the Solana chain Clock,
              NOT a rolling 24-hour window. Spending just before and after midnight UTC allows consecutive payments across the day boundary.
            </p>
          </div>

          {/* Allowlist */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-foreground">
                Recipient Allowlist ({setup.recipients.length}/8)
              </label>
              <span className="text-[11px] text-muted-foreground">Empty allowlist permits NO transfers</span>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={newRecipientInput}
                onChange={(e) => setNewRecipientInput(e.target.value)}
                placeholder="Solana wallet address (e.g. CBNwB...)"
                className="flex-1 h-10 rounded-xl border border-border bg-background px-3 font-mono text-xs"
              />
              <button
                type="button"
                onClick={handleAddRecipient}
                className="glass-quiet h-10 rounded-xl px-4 text-xs font-medium"
              >
                Add
              </button>
            </div>
            {recipientError && <p className="text-xs text-danger">{recipientError}</p>}

            {setup.recipients.length > 0 ? (
              <ul className="rounded-xl border border-border divide-y divide-border/60 font-mono text-xs">
                {setup.recipients.map((rec) => (
                  <li key={rec} className="flex items-center justify-between p-2.5">
                    <span className="truncate pr-2">{rec}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveRecipient(rec)}
                      className="text-danger hover:underline text-xs shrink-0"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="rounded-xl border border-warning/35 bg-warning/10 p-3.5 text-xs text-warning space-y-1">
                <p className="font-medium">⚠️ Empty allowlist warning</p>
                <p>
                  Nobody can be paid until the owner adds an allowlisted recipient, which requires an owner-signed configure transaction.
                  You can proceed with setup now, but the vault will reject all payment executions until recipients are added.
                </p>
              </div>
            )}
          </div>

          {/* Time window */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Start date (Unix epoch)</label>
              <input
                type="text"
                value={setup.startTs}
                onChange={(e) => setSetup((prev) => ({ ...prev, startTs: e.target.value }))}
                className="w-full h-9 rounded-xl border border-border bg-background px-3 font-mono text-xs"
              />
              <span className="text-[10px] text-muted-foreground">
                {new Date(Number(setup.startTs) * 1000).toLocaleString()}
              </span>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Expiry date (Unix epoch)</label>
              <input
                type="text"
                value={setup.expiryTs}
                onChange={(e) => setSetup((prev) => ({ ...prev, expiryTs: e.target.value }))}
                className="w-full h-9 rounded-xl border border-border bg-background px-3 font-mono text-xs"
              />
              <span className="text-[10px] text-muted-foreground">
                {new Date(Number(setup.expiryTs) * 1000).toLocaleString()}
              </span>
            </div>
          </div>

          {rulesError && <p className="text-xs text-danger">{rulesError}</p>}

          <div className="flex justify-between pt-2">
            <button
              type="button"
              onClick={() => setSetup((prev) => ({ ...prev, step: 2 }))}
              className="glass-quiet h-10 rounded-xl px-4 text-sm"
            >
              ← Back
            </button>
            <button
              type="button"
              disabled={Boolean(rulesError)}
              onClick={() => setSetup((prev) => ({ ...prev, step: 4 }))}
              className="h-10 rounded-xl bg-brand px-5 text-sm font-medium text-[#2a100e] hover:brightness-105 active:brightness-95 disabled:opacity-40 transition-all focus-visible:ring-2 focus-visible:ring-focus shadow-xs"
            >
              Review & Initialize →
            </button>
          </div>
        </section>
      )}

      {/* Step 4: Review & Initialize */}
      {setup.step === 4 && (
        <section className="space-y-5 rounded-2xl border border-border bg-surface p-6">
          <div>
            <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Step 4</span>
            <h2 className="text-xl font-medium tracking-tight mt-1">Review & initialize vault</h2>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
              Verify the exact on-chain policy and derived account seeds. Your connected wallet signs this transaction
              and pays the required rent-exempt state allocation.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 text-xs">
            <div className="rounded-xl border border-border p-3 space-y-1">
              <span className="text-muted-foreground font-mono">Vault Address (PDA)</span>
              <p className="font-mono text-foreground break-all">
                {computedVaultPubkey ? computedVaultPubkey.toBase58() : "Connect wallet"}
              </p>
              {!publicKey && (
                <p className="text-[11px] text-muted-foreground">
                  The vault PDA address derives from seeds [&quot;vault&quot;, owner_wallet, vault_id] and depends on your connected owner wallet.
                </p>
              )}
            </div>
            <div className="rounded-xl border border-border p-3 space-y-1">
              <span className="text-muted-foreground font-mono">Vault Authority PDA</span>
              <p className="font-mono text-foreground break-all">
                {computedVaultAuthority ? computedVaultAuthority.toBase58() : "Connect wallet"}
              </p>
              {!publicKey && (
                <p className="text-[11px] text-muted-foreground">
                  The authority PDA derives from the vault address seeds.
                </p>
              )}
            </div>
            <div className="rounded-xl border border-border p-3 space-y-1 sm:col-span-2">
              <span className="text-muted-foreground font-mono">Vault Token Account (ATA)</span>
              <p className="font-mono text-foreground break-all">
                {computedVaultAta ? computedVaultAta.toBase58() : "Connect wallet"}
              </p>
              {!publicKey && (
                <p className="text-[11px] text-muted-foreground">
                  The token account is owned by the vault authority PDA and depends on the owner wallet.
                </p>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-border p-4 text-xs space-y-2">
            <h3 className="font-medium text-foreground">Policy Summary:</h3>
            <div className="grid grid-cols-2 gap-2 font-mono">
              <p>
                Per-payment: {setup.perToken} {tokenDisplayUnit(mintAddress)} (
                {(() => {
                  const parsed = safeParseTokenAmountToBase(setup.perToken);
                  return parsed !== null ? `${parsed.toString()} base units` : "invalid amount";
                })()}
                )
              </p>
              <p>
                Daily limit: {setup.dailyToken} {tokenDisplayUnit(mintAddress)} (
                {(() => {
                  const parsed = safeParseTokenAmountToBase(setup.dailyToken);
                  return parsed !== null ? `${parsed.toString()} base units` : "invalid amount";
                })()}
                )
              </p>
              <p>
                Lifetime limit: {setup.lifetimeToken} {tokenDisplayUnit(mintAddress)} (
                {(() => {
                  const parsed = safeParseTokenAmountToBase(setup.lifetimeToken);
                  return parsed !== null ? `${parsed.toString()} base units` : "invalid amount";
                })()}
                )
              </p>
              <p>Recipients: {setup.recipients.length} allowlisted</p>
            </div>
            {setup.recipients.length === 0 && (
              <div className="rounded-xl border border-warning/35 bg-warning/10 p-3 text-xs text-warning space-y-1 mt-2">
                <p className="font-medium">⚠️ Empty allowlist: Nobody can be paid</p>
                <p>
                  The vault will be initialized with no allowed recipients. The agent cannot execute payments until you submit an owner-signed configure transaction with at least one recipient address.
                </p>
              </div>
            )}
          </div>

          {/* Fee estimate breakdown */}
          <div className="rounded-xl border border-border/80 bg-muted/20 p-4 text-xs space-y-2">
            <h3 className="font-medium text-foreground">Estimated initialization fee:</h3>
            {estimatedFeeLamports ? (
              <div className="space-y-1 text-muted-foreground">
                <p>Vault state rent ({VAULT_LEN} bytes): {(estimatedFeeLamports.rentVault / 1e9).toFixed(5)} SOL</p>
                <p>Vault token ATA rent (165 bytes): {(estimatedFeeLamports.rentAta / 1e9).toFixed(5)} SOL</p>
                <p>Transaction fee: {(estimatedFeeLamports.txFee / 1e9).toFixed(5)} SOL</p>
                <p className="font-medium text-foreground pt-1 border-t border-border">
                  Total required: {(estimatedFeeLamports.total / 1e9).toFixed(5)} SOL (Your balance: {ownerSolBalance !== null ? (ownerSolBalance / 1e9).toFixed(4) : "…"} SOL)
                </p>
              </div>
            ) : (
              <p className="text-muted-foreground">Calculating fees…</p>
            )}
          </div>

          {/* Status box */}
          {setup.initStatus !== "idle" && (
            <div className={`rounded-xl border p-4 text-xs space-y-2 ${
              setup.initStatus === "confirmed"
                ? "border-brand/40 bg-brand/10 text-brand"
                : setup.initStatus === "failed"
                ? "border-danger/40 bg-danger/10 text-danger"
                : setup.initStatus === "unresolved"
                ? "border-warning/40 bg-warning/10 text-warning"
                : "border-border bg-surface text-foreground"
            }`}>
              <div className="flex items-center justify-between font-medium">
                <span>Initialization Status:</span>
                <span className="capitalize">{setup.initStatus.replace("-", " ")}</span>
              </div>
              {setup.initSignature && (
                <div className="font-mono text-[11px] break-all">
                  Signature: {setup.initSignature}
                  {devnetExplorerTx(setup.initSignature) && (
                    <a className="ml-2 underline font-sans text-brand" href={devnetExplorerTx(setup.initSignature)!} rel="noreferrer" target="_blank">
                      View on explorer
                    </a>
                  )}
                </div>
              )}
              {setup.initError && <p className="text-danger font-sans">{setup.initError}</p>}
              {(setup.initStatus === "unresolved" || setup.initStatus === "failed") && (
                <div className="flex gap-2 pt-1.5">
                  <button
                    type="button"
                    onClick={checkPendingInitStatus}
                    className="h-7 rounded-lg border border-border bg-surface px-2.5 text-[11px] font-medium hover:bg-muted"
                  >
                    Check status on chain
                  </button>
                  <button
                    type="button"
                    onClick={() => setSetup((prev) => ({ ...prev, initStatus: "idle", initError: null, initSignature: null }))}
                    className="h-7 rounded-lg border border-border bg-surface px-2.5 text-[11px] font-medium hover:bg-muted text-muted-foreground hover:text-foreground"
                  >
                    Retry signature
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="flex justify-between pt-2">
            <button
              type="button"
              disabled={setup.initStatus === "awaiting-signature" || setup.initStatus === "submitted"}
              onClick={() => setSetup((prev) => ({ ...prev, step: 3 }))}
              className="glass-quiet h-10 rounded-xl px-4 text-sm"
            >
              ← Back
            </button>
            <button
              type="button"
              disabled={
                !publicKey ||
                programDeployed !== true ||
                rulesError !== null ||
                safeParseTokenAmountToBase(setup.perToken) === null ||
                safeParseTokenAmountToBase(setup.dailyToken) === null ||
                safeParseTokenAmountToBase(setup.lifetimeToken) === null ||
                setup.initStatus === "awaiting-signature" ||
                setup.initStatus === "submitted"
              }
              onClick={handleInitializeVault}
              className="h-10 rounded-xl bg-brand px-5 text-sm font-medium text-[#2a100e] hover:brightness-105 active:brightness-95 disabled:opacity-40 transition-all focus-visible:ring-2 focus-visible:ring-focus shadow-xs"
            >
              {setup.initStatus === "awaiting-signature"
                ? "Awaiting Wallet Signature…"
                : setup.initStatus === "submitted"
                ? "Confirming on Solana…"
                : "Sign & Initialize Vault"}
            </button>
          </div>
        </section>
      )}

      {/* Step 5: Fund */}
      {setup.step === 5 && (
        <section className="space-y-5 rounded-2xl border border-border bg-surface p-6">
          <div>
            <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Step 5</span>
            <h2 className="text-xl font-medium tracking-tight mt-1">Fund vault with Test USDC</h2>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
              Deposit test tokens into the vault&apos;s associated token account.
            </p>
          </div>

          <div className="rounded-xl border border-warning/35 bg-warning/10 p-4 text-xs text-warning space-y-1">
            <p className="font-medium">Important: Funding does NOT raise spending limits</p>
            <p>
              Depositing funds supplies balance for payments, but the agent can never exceed the per-payment, daily,
              or lifetime limits configured on chain.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 text-xs">
            <div className="rounded-xl border border-border p-3.5 space-y-1">
              <span className="text-muted-foreground">Source (Your token account)</span>
              <p className="font-mono text-foreground truncate">
                {publicKey ? tokenAccount(publicKey, new PublicKey(mintAddress)).toBase58() : "—"}
              </p>
              <p className="text-[11px] text-muted-foreground">
                Your available balance: {ownerTokenBalance !== null ? `${ownerTokenBalance} Test USDC` : "Loading…"}
              </p>
            </div>

            <div className="rounded-xl border border-border p-3.5 space-y-1">
              <span className="text-muted-foreground">Destination (Vault token account)</span>
              <p className="font-mono text-foreground truncate">
                {computedVaultAta ? computedVaultAta.toBase58() : "—"}
              </p>
              <p className="text-[11px] text-muted-foreground">
                Owned by program authority PDA
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-foreground block">
              Transfer amount (Test USDC)
            </label>
            <input
              type="text"
              value={setup.fundAmountToken}
              onChange={(e) => setSetup((prev) => ({ ...prev, fundAmountToken: e.target.value }))}
              className="w-full h-10 rounded-xl border border-border bg-background px-3 font-mono text-xs"
            />
          </div>

          {/* Status box */}
          {setup.fundStatus !== "idle" && (
            <div className={`rounded-xl border p-4 text-xs space-y-2 ${
              setup.fundStatus === "confirmed"
                ? "border-brand/40 bg-brand/10 text-brand"
                : setup.fundStatus === "failed"
                ? "border-danger/40 bg-danger/10 text-danger"
                : setup.fundStatus === "unresolved"
                ? "border-warning/40 bg-warning/10 text-warning"
                : "border-border bg-surface text-foreground"
            }`}>
              <div className="flex items-center justify-between font-medium">
                <span>Funding Status:</span>
                <span className="capitalize">{setup.fundStatus.replace("-", " ")}</span>
              </div>
              {setup.fundSignature && (
                <div className="font-mono text-[11px] break-all">
                  Signature: {setup.fundSignature}
                  {devnetExplorerTx(setup.fundSignature) && (
                    <a className="ml-2 underline font-sans text-brand" href={devnetExplorerTx(setup.fundSignature)!} rel="noreferrer" target="_blank">
                      View on explorer
                    </a>
                  )}
                </div>
              )}
              {setup.fundError && <p className="text-danger font-sans">{setup.fundError}</p>}
              {(setup.fundStatus === "unresolved" || setup.fundStatus === "failed") && (
                <div className="flex gap-2 pt-1.5">
                  <button
                    type="button"
                    onClick={checkPendingFundStatus}
                    className="h-7 rounded-lg border border-border bg-surface px-2.5 text-[11px] font-medium hover:bg-muted"
                  >
                    Check status on chain
                  </button>
                  <button
                    type="button"
                    onClick={() => setSetup((prev) => ({ ...prev, fundStatus: "idle", fundError: null, fundSignature: null }))}
                    className="h-7 rounded-lg border border-border bg-surface px-2.5 text-[11px] font-medium hover:bg-muted text-muted-foreground hover:text-foreground"
                  >
                    Retry signature
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="flex justify-between pt-2">
            <button
              type="button"
              onClick={() => setSetup((prev) => ({ ...prev, step: 6 }))}
              className="glass-quiet h-10 rounded-xl px-4 text-xs text-muted-foreground hover:text-foreground"
            >
              Skip funding for now →
            </button>
            <button
              type="button"
              disabled={
                setup.fundStatus === "awaiting-signature" ||
                setup.fundStatus === "submitted" ||
                !setup.fundAmountToken
              }
              onClick={handleFundVault}
              className="h-10 rounded-xl bg-brand px-5 text-sm font-medium text-[#2a100e] hover:brightness-105 active:brightness-95 disabled:opacity-40 transition-all focus-visible:ring-2 focus-visible:ring-focus shadow-xs"
            >
              {setup.fundStatus === "awaiting-signature"
                ? "Awaiting Wallet Signature…"
                : setup.fundStatus === "submitted"
                ? "Transferring on Solana…"
                : "Transfer Test USDC"}
            </button>
          </div>
        </section>
      )}

      {/* Step 6: Verify & Link */}
      {setup.step === 6 && (
        <section className="space-y-5 rounded-2xl border border-border bg-surface p-6">
          <div>
            <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Step 6</span>
            <h2 className="text-xl font-medium tracking-tight mt-1">Verify on-chain vault</h2>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
              Read and decode the vault account directly from Solana. &quot;Active&quot; is only declared once the on-chain bytes
              are confirmed and match reviewed parameters.
            </p>
          </div>

          <div className="rounded-xl border border-border p-4 text-xs space-y-2 font-mono">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Vault address:</span>
              <span className="text-foreground">{setup.vaultAddress || computedVaultPubkey?.toBase58()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Execution key:</span>
              <span className="text-foreground">{setup.executionKey}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Per-payment:</span>
              <span className="text-foreground">{setup.perToken} USDC</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Daily limit:</span>
              <span className="text-foreground">{setup.dailyToken} USDC</span>
            </div>
          </div>

          {verifyError && (
            <div className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-xs text-danger">
              Verification check failed: {verifyError}
            </div>
          )}

          {verifiedVault && (
            <div className="rounded-xl border border-brand/40 bg-brand/10 p-4 text-xs space-y-2 text-brand">
              <div className="flex items-center gap-2 font-medium text-sm">
                <span className="size-2.5 rounded-full bg-brand animate-pulse" />
                Active on {rpcConfig.clusterLabel}
              </div>
              <p className="text-foreground/90 font-sans">
                Vault successfully verified from chain bytes. Spending limits and execution authority are now active.
              </p>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            {!verifiedVault ? (
              <button
                type="button"
                disabled={verifying}
                onClick={handleVerifyAndLink}
                className="h-10 rounded-xl bg-brand px-6 text-sm font-medium text-[#2a100e] hover:brightness-105 active:brightness-95 disabled:opacity-50 transition-all focus-visible:ring-2 focus-visible:ring-focus shadow-xs"
              >
                {verifying ? "Verifying on Solana…" : "Verify On-Chain State"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onCompleted(verifiedVault)}
                className="h-10 rounded-xl bg-primary px-6 text-sm font-medium text-primary-foreground focus-visible:ring-2 focus-visible:ring-focus"
              >
                Open Delegated Dashboard →
              </button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
