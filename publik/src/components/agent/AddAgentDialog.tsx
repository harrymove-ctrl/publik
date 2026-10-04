import type { ReactNode } from "react";
import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useNavigate } from "react-router-dom";
import { appearanceFor } from "@/domain/appearance";
import { AgentAvatar, AVATAR_CHOICES } from "@/components/avatar/AgentAvatar";
import { Dialog } from "@/components/ui/dialog";
import { DEVNET_USDC_MINT, toBase } from "@/domain/money";
import { DEMO_SOL_PRICE } from "@/domain/seed";
import type { Agent } from "@/domain/types";
import { isSolanaAddress } from "@/solana/adapter";
import { useStore } from "@/state/store";
import { useToast } from "@/state/toast";

const STEPS = ["Name", "Type", "Limit", "Recipients", "Key", "Review"] as const;
const WEEK = ["Thu", "Fri", "Sat", "Sun", "Mon", "Tue", "Wed"].map((label) => ({ label, usdc: 0 }));
const TYPES = [
  ["Researcher", "Finds and summarizes information."],
  ["Builder", "Manages development tasks."],
  ["Operator", "Handles approved payments."],
] as const;

export function AddAgentDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { addAgent } = useStore();
  const toast = useToast();
  const { publicKey } = useWallet();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [avatarIndex, setAvatarIndex] = useState(0);
  const [walletChoice, setWalletChoice] = useState<"demo" | "watch" | "connected" | "agent-key">("demo");
  const [address, setAddress] = useState("");
  const [mainnetAddress, setMainnetAddress] = useState("");
  const [daily, setDaily] = useState("25");
  const [recipientLabel, setRecipientLabel] = useState("");
  const [recipientAddress, setRecipientAddress] = useState("");
  const [ask, setAsk] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setStep(0);
    setError(null);
    onClose();
  };

  const recipients = () => {
    if (!recipientLabel.trim() && !recipientAddress.trim()) return [] as { label: string; address: string }[];
    if (recipientLabel.trim().length === 0 || !isSolanaAddress(recipientAddress)) return null;
    return [{ label: recipientLabel.trim(), address: recipientAddress.trim() }];
  };

  const next = () => {
    setError(null);
    if (step === 0 && name.trim().length === 0) {
      setError("Give the agent a name.");
      return;
    }
    if (step === 2) {
      try {
        toBase(daily.trim() || "0", 6);
      } catch {
        setError("Enter a daily amount in Test USDC, with up to 6 decimal places.");
        return;
      }
    }
    if (step === 3 && recipients() === null) {
      setError("A recipient needs a name and a valid Solana address.");
      return;
    }
    if (step === 4) {
      if ((walletChoice === "watch" || walletChoice === "agent-key") && !isSolanaAddress(address)) {
        setError(walletChoice === "agent-key" ? "Paste the public key printed by bun agent/key.ts. Do not paste the secret." : "Enter a valid Solana address. This will be watched only.");
        return;
      }
      if (mainnetAddress.trim() && !isSolanaAddress(mainnetAddress)) {
        setError("The mainnet address must be a public key. Do not paste a seed phrase or a private key.");
        return;
      }
      if (walletChoice === "connected" && !publicKey) {
        setError("Connect a wallet first, or choose another option.");
        return;
      }
    }
    setStep((value) => Math.min(5, value + 1));
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
    const allowed = recipients();
    if (!allowed) {
      setError("A recipient needs a name and a valid Solana address.");
      return;
    }
    const watched = walletChoice === "connected" ? publicKey?.toBase58() ?? null : walletChoice === "watch" || walletChoice === "agent-key" ? address.trim() : null;
    const id = crypto.randomUUID();
    const choice = AVATAR_CHOICES[avatarIndex] ?? AVATAR_CHOICES[0];
    const agent: Agent = {
      id,
      name: name.trim(),
      description: description.trim() || "A new agent with no payments yet.",
      status: "running",
      avatar: "orb",
      orb: 0,
      appearance: appearanceFor(id, appearanceFor(choice.id)),
      walletMode: walletChoice === "demo" ? "demo" : walletChoice === "agent-key" ? "agent-key" : "readonly",
      address: watched,
      mainnetWatchAddress: mainnetAddress.trim() || null,
      cluster: walletChoice === "demo" ? "demo" : "devnet",
      runtimeConnected: false,
      createdAt: new Date().toISOString(),
      spentTodayBase: "0",
      permissions: { dailyUsdcBase: dailyBase, allowedRecipients: allowed, askBeforeNewRecipient: ask, enforcement: "simulated" },
      holdings: walletChoice === "demo"
        ? [
            { symbol: "SOL", label: "SOL", mint: null, decimals: 9, amountBase: "0", priceUsd: DEMO_SOL_PRICE },
            { symbol: "USDC", label: "Test USDC", mint: DEVNET_USDC_MINT, decimals: 6, amountBase: "0", priceUsd: "1.00" },
          ]
        : [],
      spendHistory: WEEK,
      requests: [],
    };
    addAgent(agent);
    toast(`${agent.name} created. Demo rules are not a lock on a wallet.`);
    navigate(`/app/agents/${agent.id}`);
    close();
  };

  return (
    <Dialog description="Publik never asks for a private key." onClose={close} open={open} title="Create agent" wide>
      <ol className="mb-4 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {STEPS.map((label, index) => (
          <li className={index === step ? "text-foreground" : ""} key={label}>{index + 1}. {label}</li>
        ))}
      </ol>
      {step === 0 ? (
        <div className="grid gap-3">
          <Field label="Agent name"><input className="field" onChange={(event) => setName(event.target.value)} value={name} /></Field>
          <Field label="Description"><input className="field" onChange={(event) => setDescription(event.target.value)} value={description} /></Field>
        </div>
      ) : null}
      {step === 1 ? (
        <div className="grid gap-3">
          <div className="flex flex-wrap gap-2">
            {TYPES.map(([label, copy]) => (
              <button className="h-9 rounded-lg border border-border px-3 text-sm" key={label} onClick={() => { setName(label); setDescription(copy); }} type="button">{label}</button>
            ))}
          </div>
          <div className="flex gap-2" role="radiogroup" aria-label="Avatar">
            {AVATAR_CHOICES.map((choice, index) => (
              <button aria-checked={avatarIndex === index} className={`rounded-full p-1 ${avatarIndex === index ? "ring-2 ring-focus" : ""}`} key={choice.id} onClick={() => setAvatarIndex(index)} role="radio" type="button">
                <AgentAvatar id={choice.id} name={name || "Agent"} size={40} />
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {step === 2 ? (
        <Field label="Daily spending amount, Test USDC">
          <input className="field tabular-nums" inputMode="decimal" onChange={(event) => setDaily(event.target.value)} value={daily} />
        </Field>
      ) : null}
      {step === 3 ? (
        <div className="grid gap-3">
          <Field label="Allowed recipient name, optional"><input className="field" onChange={(event) => setRecipientLabel(event.target.value)} value={recipientLabel} /></Field>
          <Field label="Allowed recipient address, optional"><input className="field font-mono text-xs" onChange={(event) => setRecipientAddress(event.target.value)} value={recipientAddress} /></Field>
          <label className="flex items-start gap-2 text-sm">
            <input checked={ask} className="mt-1" onChange={(event) => setAsk(event.target.checked)} type="checkbox" />
            <span>Ask me before paying someone new. This is checked in the demo. It does not control a private key.</span>
          </label>
        </div>
      ) : null}
      {step === 4 ? (
        <div className="grid gap-3 text-sm">
          <Choice checked={walletChoice === "demo"} onSelect={() => setWalletChoice("demo")} title="Use a demo balance">Simulated Test USDC. Nothing is sent on Solana.</Choice>
          <Choice checked={walletChoice === "connected"} onSelect={() => setWalletChoice("connected")} title="Watch the connected wallet">{publicKey ? `Read only: ${publicKey.toBase58()}` : "Connect a wallet from the top bar first."} Publik cannot sign for it.</Choice>
          <Choice checked={walletChoice === "watch"} onSelect={() => setWalletChoice("watch")} title="Watch an address">Paste a devnet address. This is monitoring only.</Choice>
          <Choice checked={walletChoice === "agent-key"} onSelect={() => setWalletChoice("agent-key")} title="Agent key on this machine">Run bun agent/key.ts name. Paste only the public key. The secret stays on disk.</Choice>
          {walletChoice === "watch" || walletChoice === "agent-key" ? (
            <Field label={walletChoice === "agent-key" ? "Agent public key" : "Address"}>
              <input className="field font-mono text-xs" onChange={(event) => setAddress(event.target.value)} value={address} />
            </Field>
          ) : null}
          <Field label="Mainnet address to watch, optional">
            <input className="field font-mono text-xs" onChange={(event) => setMainnetAddress(event.target.value)} placeholder="View only. No payments." value={mainnetAddress} />
          </Field>
          <button className="h-10 rounded-lg border border-border px-3 text-left" onClick={() => { setWalletChoice("demo"); setStep(5); }} type="button">Use demo agent</button>
        </div>
      ) : null}
      {step === 5 ? (
        <div className="grid gap-2 text-sm">
          <p>{name.trim() || "Unnamed"} · {description.trim() || "No description"}</p>
          <p>Daily limit {daily || "0"} Test USDC. {recipientLabel.trim() || "No recipient yet"}.</p>
          <p>Wallet: {walletChoice}. {walletChoice === "demo" ? "Simulated. Nothing is sent." : "Publik will not hold the secret key."}</p>
        </div>
      ) : null}
      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
      <div className="mt-5 flex justify-between gap-2">
        <button className="glass-quiet h-10 rounded-xl px-3 text-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus" onClick={step === 0 ? close : () => setStep((value) => value - 1)} type="button">{step === 0 ? "Cancel" : "Back"}</button>
        {step < 5 ? (
          <button className="glass-quiet h-10 rounded-xl px-4 text-sm font-medium focus-visible:ring-2 focus-visible:ring-focus" onClick={next} type="button">Continue</button>
        ) : (
          <button className="glass-quiet h-10 rounded-xl px-4 text-sm font-medium focus-visible:ring-2 focus-visible:ring-focus" onClick={create} type="button">Create agent</button>
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
