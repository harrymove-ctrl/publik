import { getAccount, getAssociatedTokenAddress, getMint, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useEffect, useState } from "react";
import { toBase } from "@/domain/money";
import { assertDevnetCluster, devnetExplorerTx, devnetUsdcMint, isSolanaAddress } from "@/solana/adapter";
import { pendingDuplicate, reconcileSavedSignature, waitForConfirmation, type ChainPaymentState } from "@/solana/confirm";
import { buildOwnerUsdcPayment } from "@/solana/ownerPay";
import { mintProblem, tokenLabel } from "@/solana/mintCheck";
import { useToast } from "@/state/toast";
import { resolvedClusterLabel } from "@/solana/provider";

const STORAGE_KEY = "publik.devnet.payments.v1";

type SavedPayment = {
  id: string;
  signature: string | null;
  state: ChainPaymentState | "rejected";
  amount: string;
  recipient: string;
  reason: string;
  note: string;
};

function loadPayments(): SavedPayment[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as SavedPayment[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function DevnetPay() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const toast = useToast();
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("1.00");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [walletNote, setWalletNote] = useState("Connect a devnet wallet. Nothing is read until you do.");
  const [tokenName, setTokenName] = useState("Test USDC");
  const [balances, setBalances] = useState<{ sol: string; token: string } | null>(null);
  const [payments, setPayments] = useState<SavedPayment[]>(() => loadPayments());
  const [balanceEpoch, setBalanceEpoch] = useState(0);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payments));
  }, [payments]);

  useEffect(() => {
    if (!publicKey) {
      setBalances(null);
      setWalletNote("Connect a devnet wallet. Nothing is read until you do.");
      return;
    }
    let cancel = false;
    setWalletNote("Reading devnet…");
    void (async () => {
      try {
        await assertDevnetCluster(connection);
        const mint = devnetUsdcMint();
        const mintAccount = await getMint(connection, new PublicKey(mint), "confirmed", TOKEN_PROGRAM_ID);
        const problem = mintProblem(TOKEN_PROGRAM_ID.toBase58(), mintAccount.decimals);
        if (problem) throw new Error(problem);
        if (cancel) return;
        const label = tokenLabel(mint);
        setTokenName(label);
        const sol = await connection.getBalance(publicKey, "confirmed");
        const ata = await getAssociatedTokenAddress(new PublicKey(mint), publicKey, false, TOKEN_PROGRAM_ID);
        let token = "0.00";
        try {
          const account = await getAccount(connection, ata, "confirmed", TOKEN_PROGRAM_ID);
          token = (Number(account.amount) / 1_000_000).toFixed(2);
        } catch {
          token = "0.00";
        }
        if (cancel) return;
        setBalances({ sol: (sol / 1_000_000_000).toFixed(4), token });
        if (sol === 0) setWalletNote("No devnet SOL. A SOL airdrop does not include this token. You need SOL for the fee and tokens to send.");
        else if (token === "0.00") setWalletNote(`No ${label} in this wallet. A SOL airdrop does not mint it.`);
        else setWalletNote("These balances are from devnet. Signing is an owner-approved payment, not an agent acting alone.");
      } catch (caught) {
        if (!cancel) {
          setBalances(null);
          setWalletNote(caught instanceof Error ? caught.message : "Could not read devnet.");
        }
      }
    })();
    return () => {
      cancel = true;
    };
  }, [balanceEpoch, connection, publicKey]);

  useEffect(() => {
    let cancel = false;
    const pending = loadPayments().filter((payment) => payment.state === "submitted" && payment.signature);
    if (pending.length === 0) return;
    void (async () => {
      for (const payment of pending) {
        if (cancel || !payment.signature) return;
        const status = await connection.getSignatureStatuses([payment.signature]);
        const value = status.value[0];
        const signature = payment.signature;
        const state = await reconcileSavedSignature({
          signature,
          status: value ? { err: value.err, confirmationStatus: value.confirmationStatus ?? null } : null,
          lookup: async () => {
            const found = await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
            if (!found) return null;
            return { err: found.meta?.err ?? null };
          },
        });
        if (!cancel && state !== "submitted") {
          setPayments((current) => current.map((item) => (item.id === payment.id ? { ...item, state } : item)));
        }
      }
    })();
    return () => {
      cancel = true;
    };
  }, [connection]);

  async function pay() {
    setError(null);
    if (busy || pendingDuplicate(payments, { recipient: recipient.trim(), amount })) {
      setError("A matching payment is still waiting for confirmation. It was not sent again.");
      return;
    }
    if (!publicKey) {
      setError("Connect a devnet wallet. Publik does not hold a key.");
      return;
    }
    if (!isSolanaAddress(recipient)) {
      setError("Enter a valid recipient address.");
      return;
    }
    let amountBase: bigint;
    try {
      amountBase = BigInt(toBase(amount, 6).toFixed(0));
    } catch {
      setError("Enter a Test USDC amount with at most 6 decimal places.");
      return;
    }
    setBusy(true);
    const id = `devnet-${crypto.randomUUID()}`;
    const destOwner = recipient.trim();
    try {
      await assertDevnetCluster(connection);
      const mint = devnetUsdcMint();
      const mintAccount = await getMint(connection, new PublicKey(mint), "confirmed", TOKEN_PROGRAM_ID);
      const problem = mintProblem(TOKEN_PROGRAM_ID.toBase58(), mintAccount.decimals);
      if (problem) throw new Error(problem);
      setTokenName(tokenLabel(mint));
      const destination = await getAssociatedTokenAddress(new PublicKey(mint), new PublicKey(destOwner), false, TOKEN_PROGRAM_ID);
      const existing = await connection.getAccountInfo(destination);
      const { blockhash } = await connection.getLatestBlockhash("confirmed");
      const tx = await buildOwnerUsdcPayment({
        owner: publicKey.toBase58(),
        destinationOwner: destOwner,
        mint,
        amountBase,
        blockhash,
        createDestination: !existing,
      });
      const signature = await sendTransaction(tx, connection);
      const note = existing ? "Submitted. Waiting for confirmation." : "Creates the recipient token account. Your wallet pays that fee.";
      setPayments((current) => [{ id, signature, state: "submitted", amount, recipient: destOwner, reason, note }, ...current]);
      const state = await waitForConfirmation(connection, signature);
      setPayments((current) => current.map((item) => (item.id === id ? { ...item, state } : item)));
      toast(state === "confirmed" ? "Devnet payment confirmed" : state === "failed" ? "Devnet payment failed" : "Confirmation pending");
      if (state === "confirmed") setBalanceEpoch((value) => value + 1);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "The wallet did not send this payment.";
      setPayments((current) => [{ id, signature: null, state: "rejected", amount, recipient: destOwner, reason, note: message }, ...current]);
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-surface p-4">
      <h2 className="text-base font-medium">Owner-approved {resolvedClusterLabel.toLowerCase()} payment</h2>
      <p className="mt-1 text-sm text-muted-foreground">{walletNote} Rules in Publik do not stop the wallet outside this app.</p>
      <p className="mt-1 text-xs text-muted-foreground">Network: Solana {resolvedClusterLabel.toLowerCase()}. You pay the SOL fee. If the recipient has no token account, the wallet also pays to create it. A SOL airdrop does not include {tokenName}.</p>
      {balances ? <p className="mt-3 text-sm tabular-nums">{balances.sol} SOL · {balances.token} {tokenName}</p> : null}
      <button className="glass-quiet mt-3 h-10 rounded-lg px-3 text-sm focus-visible:ring-2 focus-visible:ring-focus" onClick={() => { setAmount("1.00"); setReason("Owner-approved test payment"); }} type="button">Create sample request</button>
      <p className="mt-1 text-xs text-muted-foreground">This only fills the form. It does not create a balance, a signature, or a result.</p>
      <div className="mt-3 grid gap-2">
        <label className="grid gap-1 text-sm">Recipient<input className="field font-mono text-xs" onChange={(event) => setRecipient(event.target.value)} value={recipient} /></label>
        <label className="grid gap-1 text-sm">Amount, {tokenName}<input className="field tabular-nums" inputMode="decimal" onChange={(event) => setAmount(event.target.value)} value={amount} /></label>
        <label className="grid gap-1 text-sm">Reason<input className="field" onChange={(event) => setReason(event.target.value)} value={reason} /></label>
      </div>
      {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
      <button className="mt-3 h-10 rounded-lg bg-brand px-4 text-sm font-medium text-[#2a100e] hover:brightness-105 active:brightness-95 transition-all focus-visible:ring-2 focus-visible:ring-focus shadow-xs disabled:opacity-50" disabled={busy} onClick={() => void pay()} type="button">{busy ? "Waiting for the wallet" : "Review and sign"}</button>
      <ul className="mt-4 grid gap-2 text-sm">
        {payments.length === 0 ? <li className="text-muted-foreground">No devnet payments from this browser yet.</li> : null}
        {payments.map((payment) => {
          const href = payment.signature ? devnetExplorerTx(payment.signature) : null;
          return (
            <li key={payment.id}>
              <span className="tabular-nums">{payment.amount} {tokenName}</span> · {payment.state}
              {href ? <> · <a className="underline" href={href} rel="noreferrer" target="_blank">Explorer</a></> : null}
              <span className="block text-xs text-muted-foreground">{payment.note}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
