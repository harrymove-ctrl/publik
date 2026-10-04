import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AgentAvatar } from "@/components/avatar/AgentAvatar";
import { appearanceFor } from "@/domain/appearance";
import { useWallet } from "@solana/wallet-adapter-react";
import { ownerPost, ownerSession, signOwnerSession, type OwnerSession } from "./api";

const origin = import.meta.env.VITE_PUBLIC_ORIGIN || (typeof window === "undefined" ? "" : window.location.origin);

export function ConnectPage() {
  const navigate = useNavigate();
  const { publicKey, signMessage } = useWallet();
  const [tab, setTab] = useState<"agent" | "manual">("agent");
  const [session, setSession] = useState<OwnerSession>({ authenticated: false });
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [skill, setSkill] = useState<string | null>(null);
  const [pairCode, setPairCode] = useState("");
  const command = `PUBLIK_PUBLIC_ORIGIN=${origin} bun agent/publik.ts connect Alice`;
  const instruction = `Read ${origin}/skills/publik.md and follow the instructions to connect to my Publik workspace.`;
  const local = origin.includes("localhost") || origin.includes("127.0.0.1");

  useEffect(() => {
    void ownerSession().then(setSession).catch(() => setSession({ authenticated: false }));
  }, []);

  async function signIn() {
    if (!publicKey || !signMessage) {
      setNote("Connect a wallet first. Signing this challenge does not send a payment.");
      return;
    }
    try {
      setSession(await signOwnerSession(publicKey.toBase58(), signMessage));
      setNote(null);
    } catch (caught) {
      setNote(caught instanceof Error ? caught.message : "The wallet did not sign.");
    }
  }

  async function createProfile() {
    if (!session.authenticated) return;
    const created = await ownerPost<{ agent_id: string }>(`/api/v1/owner/agents`, session.csrf, { name, description });
    navigate(`/app/agents/${created.agent_id}/connection`);
  }

  return (
    <div className="mx-auto w-full max-w-[1120px] px-4 py-6 sm:px-8">
      <Link className="text-sm text-muted-foreground" to="/app/agents">Back to agents</Link>
      <h1 className="mt-3 text-3xl font-medium tracking-tight">Connect your agent</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Bring your existing agent into Publik. Review every payment before your wallet signs.</p>
      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="rounded-[20px] border border-border bg-surface p-5 sm:p-6">
          <div className="flex gap-2" role="tablist">
            <button className={`h-10 rounded-xl px-3 text-sm ${tab === "agent" ? "bg-foreground text-background" : "border border-border"}`} onClick={() => setTab("agent")} type="button">I have an agent</button>
            <button className={`h-10 rounded-xl px-3 text-sm ${tab === "manual" ? "bg-foreground text-background" : "border border-border"}`} onClick={() => setTab("manual")} type="button">Set up manually</button>
          </div>
          {tab === "agent" ? (
            <div className="mt-6">
              <h2 className="text-base font-medium">Give this instruction to your agent</h2>
              <p className="mt-3 whitespace-pre-wrap break-words rounded-xl border border-border bg-background/40 p-4 text-sm leading-relaxed">{instruction}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button className="h-10 rounded-xl bg-primary px-3 text-sm text-primary-foreground" onClick={() => void navigator.clipboard.writeText(instruction)} type="button">Copy instructions</button>
                <button className="h-10 rounded-xl border border-border px-3 text-sm" onClick={() => void fetch("/skills/publik.md").then((response) => response.text()).then(setSkill)} type="button">Read skill document</button>
                <Link className="inline-flex h-10 items-center rounded-xl border border-border px-3 text-sm" to="/connect">Enter pairing code</Link>
              </div>
              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                <article className="rounded-2xl border border-border p-4">
                  <p className="text-xs uppercase tracking-[0.14em] text-[#ff6b61]">01</p>
                  <h3 className="mt-2 font-medium">The agent asks</h3>
                  <p className="mt-1 text-sm text-muted-foreground">It reads the skill and calls the pairing API. You get a short code. The device secret stays on that machine.</p>
                </article>
                <article className="rounded-2xl border border-border p-4">
                  <p className="text-xs uppercase tracking-[0.14em] text-[#ff6b61]">02</p>
                  <h3 className="mt-2 font-medium">You confirm</h3>
                  <p className="mt-1 text-sm text-muted-foreground">Open the pairing page, sign an ownership challenge, and approve that code. The signature is not a payment.</p>
                </article>
                <article className="rounded-2xl border border-border p-4">
                  <p className="text-xs uppercase tracking-[0.14em] text-[#ff6b61]">03</p>
                  <h3 className="mt-2 font-medium">You set the rules</h3>
                  <p className="mt-1 text-sm text-muted-foreground">Daily limit and recipients come after the connection. The agent can request. Only your wallet can send.</p>
                </article>
              </div>
              <h2 className="mt-8 text-base font-medium">On this machine</h2>
              <p className="mt-2 text-sm text-muted-foreground">Start <span className="font-mono">bun run api</span> in another terminal, then run this from the <span className="font-mono">publik</span> folder. It waits until you approve.</p>
              <pre className="mt-3 whitespace-pre-wrap break-all rounded-xl border border-border bg-background/40 p-4 font-mono text-sm leading-relaxed">{command}</pre>
              <button className="mt-3 h-10 rounded-xl border border-border px-3 text-sm" onClick={() => void navigator.clipboard.writeText(command)} type="button">Copy command</button>
              <form className="mt-8 grid gap-2" onSubmit={(event) => { event.preventDefault(); navigate(`/connect?code=${encodeURIComponent(pairCode.trim())}`); }}>
                <h2 className="text-base font-medium">Already have a code?</h2>
                <label className="grid gap-1 text-sm">Pairing code<input className="field font-mono uppercase" onChange={(event) => setPairCode(event.target.value)} value={pairCode} /></label>
                <button className="h-10 w-fit rounded-xl bg-primary px-3 text-sm text-primary-foreground" type="submit">Enter pairing code</button>
              </form>
              <p className="mt-4 text-xs text-muted-foreground">Connecting an agent does not grant access to your wallet or permission to send funds.</p>
              {skill ? (
                <div className="mt-6">
                  <div className="flex flex-wrap gap-2">
                    <button className="h-9 rounded-xl border border-border px-3 text-sm" onClick={() => void navigator.clipboard.writeText(skill)} type="button">Copy full document</button>
                    <a className="inline-flex h-9 items-center rounded-xl border border-border px-3 text-sm" href="/skills/publik.md" download="publik.md">Download Markdown</a>
                  </div>
                  <pre className="mt-3 whitespace-pre-wrap break-words font-mono text-sm leading-relaxed">{skill}</pre>
                </div>
              ) : null}
            </div>
          ) : (
            <form className="mt-6 grid gap-3" onSubmit={(event) => { event.preventDefault(); void createProfile().catch((caught) => setNote(caught instanceof Error ? caught.message : "Could not create the profile.")); }}>
              <p className="text-sm text-muted-foreground">Publik connects to an agent you run elsewhere. You can set up a profile now and connect it later.</p>
              <label className="grid gap-1 text-sm">Name<input className="field" onChange={(event) => setName(event.target.value)} value={name} /></label>
              <label className="grid gap-1 text-sm">Description, optional<input className="field" onChange={(event) => setDescription(event.target.value)} value={description} /></label>
              <button className="h-10 w-fit rounded-xl bg-primary px-3 text-sm text-primary-foreground" disabled={!session.authenticated} type="submit">Create connection profile</button>
            </form>
          )}
          {note ? <p className="mt-4 text-sm text-danger">{note}</p> : null}
          {!session.authenticated ? <button className="mt-4 h-10 rounded-xl border border-border px-3 text-sm" onClick={() => void signIn()} type="button">Sign ownership challenge</button> : <p className="mt-4 text-xs text-muted-foreground">Signed in as {session.wallet}. This signature is not a payment.</p>}
        </section>
        <aside className="grid content-start gap-4">
          <div className="rounded-[20px] border border-border bg-surface p-5">
            <AgentAvatar appearance={appearanceFor("alice")} id="alice" name="Alice" size={96} />
            <p className="mt-3 text-sm font-medium">Example look</p>
            <p className="mt-1 text-sm text-muted-foreground">Alice’s coral clover. A new agent keeps its own shape. This picture is not a live connection.</p>
          </div>
          <div className="grid gap-3 rounded-[20px] border border-border bg-surface p-5 text-sm">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">After you approve</p>
            <p>Status: ready to connect</p>
            <ul className="grid gap-1 text-muted-foreground">
              <li>Read its own rules and today’s remaining limit</li>
              <li>Submit a Test USDC request with a reason</li>
              <li>Read whether you approved, rejected, or are still reviewing</li>
            </ul>
            <p>It cannot sign, change the budget, or mark a payment confirmed.</p>
            <p className="text-muted-foreground">{local ? "This address is accessible only to agents that can reach this machine." : "Use the configured HTTPS origin for agents that are not on this machine."}</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
