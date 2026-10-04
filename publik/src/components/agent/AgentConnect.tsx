import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useState } from "react";
import { reservedUsdcBase } from "@/domain/apply";
import { buildSetupPrompt, parsePastedRequest } from "@/domain/agentPrompt";
import { DEVNET_USDC_MINT, toBase } from "@/domain/money";
import { explainRequest } from "@/domain/policy";
import type { Agent } from "@/domain/types";
import { buildApproveBudget, buildRevokeBudget } from "@/solana/delegate";
import { SquadsBudget } from "./SquadsBudget";
import { useStore } from "@/state/store";

const CLIENTS = ["Claude Code", "Claude Desktop", "Cursor", "Codex CLI", "Grok", "ChatGPT", "Other"] as const;

export function AgentConnect({ agent }: { agent: Agent }) {
  const { addPastedRequest, updateAgent } = useStore();
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [paste, setPaste] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [persona, setPersona] = useState(agent.description);
  const [client, setClient] = useState<(typeof CLIENTS)[number]>("Grok");
  const [chainNote, setChainNote] = useState<string | null>(null);
  const [simAmount, setSimAmount] = useState("4");
  const [simRecipient, setSimRecipient] = useState(agent.permissions.allowedRecipients[0]?.address ?? "");
  const [sim, setSim] = useState<string | null>(null);
  const prompt = buildSetupPrompt(agent);

  async function signBudget() {
    if (!publicKey || !agent.address) {
      setChainNote("Connect your wallet and set the agent's devnet address first. Publik will not create a key.");
      return;
    }
    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    const tx = await buildApproveBudget({
      owner: publicKey.toBase58(),
      agent: agent.address,
      mint: DEVNET_USDC_MINT,
      amountBase: BigInt(agent.permissions.dailyUsdcBase),
      blockhash,
    });
    const signature = await sendTransaction(tx, connection);
    setChainNote(`Budget submitted on devnet. Signature ${signature}. Solana enforces the total only. The daily limit and recipients are not on chain yet.`);
  }

  async function signRevoke() {
    if (!publicKey) {
      setChainNote("Connect your wallet. Revoke is signed by you, not by Publik.");
      return;
    }
    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    const tx = await buildRevokeBudget({ owner: publicKey.toBase58(), mint: DEVNET_USDC_MINT, blockhash });
    const signature = await sendTransaction(tx, connection);
    setChainNote(`Revoke submitted. After it confirms, this agent cannot move your Test USDC. Signature ${signature}.`);
  }

  return (
    <section className="mt-3 grid gap-3 rounded-2xl border border-border bg-surface p-4 text-sm">
      <h2 className="text-base font-medium">Connect your agent</h2>
      <p className="text-muted-foreground">Copy this into Grok, Claude, GPT, or any other chat. The prompt is guidance, not a lock.</p>
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-xl bg-muted p-3 text-xs">{prompt}</pre>
      <button
        className="glass-quiet h-10 w-fit rounded-xl px-3 text-sm focus-visible:ring-2 focus-visible:ring-focus"
        onClick={() => void navigator.clipboard.writeText(prompt)}
        type="button"
      >
        Copy prompt
      </button>
      <label className="grid gap-1">
        Paste a request
        <textarea className="field min-h-20" onChange={(event) => setPaste(event.target.value)} value={paste} />
      </label>
      <button
        className="glass-quiet h-10 w-fit rounded-xl px-3 text-sm font-medium focus-visible:ring-2 focus-visible:ring-focus"
        onClick={() => {
          const parsed = parsePastedRequest(paste, agent.id);
          if ("error" in parsed) {
            setMessage(parsed.error);
            return;
          }
          addPastedRequest(agent.id, parsed);
          setMessage("Asked by your agent. Demo payment, nothing is sent.");
          setPaste("");
        }}
        type="button"
      >
        Add pasted request
      </button>
      {message ? <p>{message}</p> : null}
      <h2 className="text-base font-medium">Playground</h2>
      <p className="text-muted-foreground">Devnet: can request payments. {agent.mainnetWatchAddress ? "Mainnet: view only." : "No mainnet address."} This does not call a model.</p>
      <label className="grid gap-1">
        Client
        <select className="field" onChange={(event) => setClient(event.target.value as (typeof CLIENTS)[number])} value={client}>
          {CLIENTS.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
      </label>
      <p className="text-xs text-muted-foreground">Config for {client}: not tested yet. Phase A is copy and paste only.</p>
      <label className="grid gap-1">
        Persona
        <textarea className="field min-h-16" maxLength={600} onChange={(event) => setPersona(event.target.value)} value={persona} />
      </label>
      <button className="h-10 w-fit rounded-xl border border-border px-3" onClick={() => updateAgent(agent.id, { description: persona.slice(0, 600) })} type="button">
        Save persona
      </button>
      <div className="grid gap-2 sm:grid-cols-2">
        <input className="field" onChange={(event) => setSimAmount(event.target.value)} value={simAmount} />
        <input className="field font-mono text-xs" onChange={(event) => setSimRecipient(event.target.value)} value={simRecipient} />
      </div>
      <button
        className="glass-quiet h-10 w-fit rounded-xl px-3 text-sm focus-visible:ring-2 focus-visible:ring-focus"
        onClick={() => {
          try {
            const explained = explainRequest({
              permissions: agent.permissions,
              paused: agent.status === "paused",
              request: { token: "USDC", amountBase: toBase(simAmount, 6).toFixed(0), recipient: simRecipient },
              reservedUsdcBase: reservedUsdcBase(agent),
              spentUsdcBase: agent.spentTodayBase,
            });
            setSim(`Publik's rules would answer: ${explained.decision.outcome}. ${explained.decision.reason}`);
          } catch (error) {
            setSim(error instanceof Error ? error.message : "Could not read that amount.");
          }
        }}
        type="button"
      >
        Test against the rules
      </button>
      {sim ? <p>{sim}</p> : null}
      <h2 className="text-base font-medium">On-chain budget</h2>
      <p className="text-muted-foreground">Phase A: create the agent key on this machine with `bun agent/key.ts name`, then paste only the public key. Publik never sees the secret. That key is not enforced.</p>
      <p className="text-muted-foreground">Phase B: your wallet signs the total Test USDC budget. Revoke is the real pause. Phase C needs a Squads multisig you already control. Publik still does not sign.</p>
      <div className="flex flex-wrap gap-2">
        <button className="glass-quiet h-10 rounded-xl px-3 text-sm font-medium focus-visible:ring-2 focus-visible:ring-focus" onClick={() => void signBudget()} type="button">Give this agent a budget</button>
        <button className="glass-quiet h-10 rounded-xl px-3 text-sm focus-visible:ring-2 focus-visible:ring-focus" onClick={() => void signRevoke()} type="button">Pause on Solana</button>
      </div>
      {chainNote ? <p>{chainNote}</p> : null}
      <SquadsBudget
        agentAddress={agent.address}
        blockhash={async () => (await connection.getLatestBlockhash("confirmed")).blockhash}
        dailyBase={agent.permissions.dailyUsdcBase}
        destinations={agent.permissions.allowedRecipients.map((item) => item.address)}
        owner={publicKey?.toBase58() ?? null}
        send={(tx) => {
          if (!publicKey) return Promise.reject(new Error("Connect your wallet. Publik does not sign."));
          return sendTransaction(tx, connection);
        }}
      />
    </section>
  );
}
