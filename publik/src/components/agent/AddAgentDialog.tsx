import type { ReactNode } from "react";
import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useNavigate } from "react-router-dom";
import { AgentAvatar, AVATAR_CHOICES } from "@/components/avatar/AgentAvatar";
import { Dialog } from "@/components/ui/dialog";
import { DEVNET_USDC_MINT, toBase } from "@/domain/money";
import { DEMO_SOL_PRICE } from "@/domain/seed";
import type { Agent } from "@/domain/types";
import { isSolanaAddress } from "@/solana/adapter";
import { useStore } from "@/state/store";

const WEEK = ["Thu", "Fri", "Sat", "Sun", "Mon", "Tue", "Wed"].map((label) => ({ label, usdc: 0 }));

export function AddAgentDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { addAgent } = useStore();
  const { publicKey } = useWallet();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [avatarIndex, setAvatarIndex] = useState(0);
  const [walletChoice, setWalletChoice] = useState<"demo" | "watch" | "connected">("demo");
  const [address, setAddress] = useState("");
  const [daily, setDaily] = useState("20");
  const [recipientLabel, setRecipientLabel] = useState("");
  const [recipientAddress, setRecipientAddress] = useState("");
  const [ask, setAsk] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setStep(0);
    setError(null);
    onClose();
  };

  const next = () => {
    setError(null);
    if (step === 0 && name.trim().length === 0) {
      setError("Give the agent a name.");
      return;
    }
    if (step === 1) {
      if (walletChoice === "watch" && !isSolanaAddress(address)) {
        setError("Enter a valid Solana address. This will be watched only.");
        return;
      }
      if (walletChoice === "connected" && !publicKey) {
        setError("Connect a wallet first, or choose another option.");
        return;
      }
    }
    setStep((value) => Math.min(2, value + 1));
  };

  const create = () => {
    setError(null);
    let dailyBase: string;
    try {
      dailyBase = toBase(daily.trim() || "0", 6).toFixed(0);
    } catch {
      setError("Enter a daily amount in Test USDC, with up to 6 decimal places.");
      return;
    }
    const recipients: { label: string; address: string }[] = [];
    if (recipientLabel.trim() || recipientAddress.trim()) {
      if (recipientLabel.trim().length === 0 || !isSolanaAddress(recipientAddress)) {
        setError("A recipient needs a name and a valid Solana address.");
        return;
      }
      recipients.push({ label: recipientLabel.trim(), address: recipientAddress.trim() });
    }
    const watched = walletChoice === "connected" ? publicKey?.toBase58() ?? null : walletChoice === "watch" ? address.trim() : null;
    const choice = AVATAR_CHOICES[avatarIndex] ?? AVATAR_CHOICES[0];
    const agent: Agent = {
      id: crypto.randomUUID(),
      name: name.trim(),
      description: description.trim() || "A new agent with no payments yet.",
      status: "running",
      avatar: choice.kind,
      orb: choice.orb,
      walletMode: walletChoice === "demo" ? "demo" : "readonly",
      address: watched,
      cluster: walletChoice === "demo" ? "demo" : "devnet",
      runtimeConnected: false,
      createdAt: new Date().toISOString(),
      spentTodayBase: "0",
      permissions: {
        dailyUsdcBase: dailyBase,
        allowedRecipients: recipients,
        askBeforeNewRecipient: ask,
        enforcement: "simulated",
      },
      holdings:
        walletChoice === "demo"
          ? [
              { symbol: "SOL", label: "SOL", mint: null, decimals: 9, amountBase: "0", priceUsd: DEMO_SOL_PRICE },
              { symbol: "USDC", label: "Test USDC", mint: DEVNET_USDC_MINT, decimals: 6, amountBase: "0", priceUsd: "1.00" },
            ]
          : [],
      spendHistory: WEEK,
      requests: [],
    };
    addAgent(agent);
    navigate(`/agents/${agent.id}`);
    close();
  };

  return (
    <Dialog description="Give your agent a name." onClose={close} open={open} title="Add agent" wide>
      <ol className="mb-4 flex gap-3 text-xs text-muted-foreground">
        {["Name", "Wallet", "Budget"].map((label, index) => (
          <li className={index === step ? "text-foreground" : ""} key={label}>
            {index + 1}. {label}
          </li>
        ))}
      </ol>
      {step === 0 ? (
        <div className="grid gap-3">
          <Field label="Agent name">
            <input className="field" onChange={(event) => setName(event.target.value)} value={name} />
          </Field>
          <Field label="Short description, optional">
            <input className="field" onChange={(event) => setDescription(event.target.value)} value={description} />
          </Field>
          <div className="flex gap-2" role="radiogroup" aria-label="Avatar">
            {AVATAR_CHOICES.map((choice, index) => (
              <button
                aria-checked={avatarIndex === index}
                aria-label={choice.kind === "initials" ? "Initials" : `Orb ${index + 1}`}
                className={`rounded-full p-1 ${avatarIndex === index ? "ring-2 ring-focus" : ""}`}
                key={`${choice.kind}-${choice.orb}`}
                onClick={() => setAvatarIndex(index)}
                role="radio"
                type="button"
              >
                <AgentAvatar kind={choice.kind} name={name || "A"} orb={choice.orb} size={40} />
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {step === 1 ? (
        <div className="grid gap-3 text-sm">
          <Choice checked={walletChoice === "demo"} onSelect={() => setWalletChoice("demo")} title="Use a demo balance">
            Simulated Test USDC. Nothing is sent on Solana.
          </Choice>
          <Choice checked={walletChoice === "connected"} onSelect={() => setWalletChoice("connected")} title="Watch the connected wallet">
            {publicKey ? `Read only: ${publicKey.toBase58()}` : "Connect a wallet from the top bar first."} Publik cannot sign for it.
          </Choice>
          <Choice checked={walletChoice === "watch"} onSelect={() => setWalletChoice("watch")} title="Watch an address">
            Paste a devnet address. This is monitoring only.
          </Choice>
          {walletChoice === "watch" ? (
            <Field label="Address">
              <input className="field font-mono text-xs" onChange={(event) => setAddress(event.target.value)} value={address} />
            </Field>
          ) : null}
          <p className="text-muted-foreground">Creating a new wallet here is not available. Publik does not keep private keys in the browser.</p>
        </div>
      ) : null}
      {step === 2 ? (
        <div className="grid gap-3">
          <Field label="Daily spending amount, Test USDC">
            <input className="field tabular-nums" inputMode="decimal" onChange={(event) => setDaily(event.target.value)} value={daily} />
          </Field>
          <Field label="Allowed recipient name, optional">
            <input className="field" onChange={(event) => setRecipientLabel(event.target.value)} value={recipientLabel} />
          </Field>
          <Field label="Allowed recipient address, optional">
            <input className="field font-mono text-xs" onChange={(event) => setRecipientAddress(event.target.value)} value={recipientAddress} />
          </Field>
          <label className="flex items-start gap-2 text-sm">
            <input checked={ask} className="mt-1" onChange={(event) => setAsk(event.target.checked)} type="checkbox" />
            <span>Ask me before sending to someone new. These limits are checked in the demo before a payment is approved. They do not control a wallet’s private key.</span>
          </label>
        </div>
      ) : null}
      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
      <div className="mt-5 flex justify-between gap-2">
        <button className="h-10 rounded-xl px-3 text-sm text-muted-foreground" onClick={step === 0 ? close : () => setStep((value) => value - 1)} type="button">
          {step === 0 ? "Cancel" : "Back"}
        </button>
        {step < 2 ? (
          <button className="h-10 rounded-xl bg-primary px-4 text-sm text-primary-foreground" onClick={next} type="button">
            Continue
          </button>
        ) : (
          <button className="h-10 rounded-xl bg-primary px-4 text-sm text-primary-foreground" onClick={create} type="button">
            Create agent
          </button>
        )}
      </div>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Choice({ checked, title, children, onSelect }: { checked: boolean; title: string; children: ReactNode; onSelect: () => void }) {
  return (
    <button className={`rounded-xl border p-3 text-left ${checked ? "border-foreground" : "border-border"}`} onClick={onSelect} type="button">
      <span className="block font-medium">{title}</span>
      <span className="mt-1 block text-muted-foreground">{children}</span>
    </button>
  );
}
