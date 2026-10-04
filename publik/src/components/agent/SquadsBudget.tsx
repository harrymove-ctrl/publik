import type { Transaction } from "@solana/web3.js";
import { useState } from "react";
import { DEVNET_USDC_MINT } from "@/domain/money";
import { isSolanaAddress } from "@/solana/adapter";
import { buildDailySpendingLimit } from "@/solana/squadsLimit";

export interface SquadsBudgetProps {
  agentAddress: string | null;
  dailyBase: string;
  destinations: string[];
  owner: string | null;
  send: (tx: Transaction) => Promise<string>;
  blockhash: () => Promise<string>;
}

export function SquadsBudget({
  agentAddress,
  dailyBase,
  destinations,
  owner,
  send,
  blockhash,
}: SquadsBudgetProps) {
  const [multisigAddress, setMultisigAddress] = useState("");
  const [reason, setReason] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handlePutLimit() {
    setReason(null);
    setSignature(null);

    const trimmed = multisigAddress.trim();
    const missing: string[] = [];
    if (!owner) missing.push("owner");
    if (!agentAddress) missing.push("agentAddress");
    if (!trimmed || !isSolanaAddress(trimmed)) missing.push("valid multisig address");

    if (missing.length > 0) {
      if (missing.length === 3) {
        setReason("Owner, agentAddress, and a valid multisig address are missing.");
      } else {
        setReason(`Missing: ${missing.join(", ")}.`);
      }
      return;
    }

    try {
      setSubmitting(true);
      const hash = await blockhash();
      const tx = buildDailySpendingLimit({
        owner: owner!,
        multisig: trimmed,
        agent: agentAddress!,
        mint: DEVNET_USDC_MINT,
        amountBase: BigInt(dailyBase),
        destinations,
        blockhash: hash,
        createKey: agentAddress!,
      });
      const sig = await send(tx);
      setSignature(sig);
    } catch (err) {
      setReason(err instanceof Error ? err.message : "Failed to put daily limit on Squads.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="grid gap-3 rounded-2xl border border-border bg-surface p-4 text-sm">
      <label className="grid gap-1">
        <span className="text-sm font-medium">Squads multisig address</span>
        <input
          aria-label="Squads multisig address"
          className="field font-mono text-xs"
          onChange={(event) => setMultisigAddress(event.target.value)}
          placeholder="Squads multisig address"
          type="text"
          value={multisigAddress}
        />
      </label>
      <button
        className="glass-quiet h-10 w-fit rounded-xl px-3 text-sm font-medium focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50"
        disabled={submitting}
        onClick={handlePutLimit}
        type="button"
      >
        Put the daily limit on Squads
      </button>
      <p className="text-xs text-muted-foreground">
        Solana enforces the daily amount and these destinations only after this confirms. Publik does not sign. This requires a Squads multisig whose config authority is your wallet.
      </p>
      {reason ? (
        <p className="text-sm text-destructive" role="alert">
          {reason}
        </p>
      ) : null}
      {signature ? (
        <p className="break-all font-mono text-xs text-muted-foreground">
          Signature: <span className="text-foreground">{signature}</span>
        </p>
      ) : null}
    </section>
  );
}

export default SquadsBudget;
