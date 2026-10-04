import { useState } from "react";
import type { ThemeChoice } from "@/domain/types";
import { useStore } from "@/state/store";
import { useToast } from "@/state/toast";

export function SettingsPage() {
  const { state, setTheme, resetDemo } = useStore();
  const toast = useToast();
  const [confirmReset, setConfirmReset] = useState(false);
  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-6 sm:px-8">
      <h1 className="text-3xl font-medium tracking-tight">Settings</h1>
      <section className="mt-6 rounded-2xl border border-border bg-surface p-4">
        <h2 className="text-base font-medium">Theme</h2>
        <div className="mt-3 flex gap-2" role="radiogroup" aria-label="Theme">
          {(["light", "dark", "system"] as ThemeChoice[]).map((option) => (
            <button aria-checked={state.theme === option} className={`h-9 rounded-lg px-3 text-sm capitalize ${state.theme === option ? "bg-foreground text-background" : "border border-border"}`} key={option} onClick={() => setTheme(option)} role="radio" type="button">{option}</button>
          ))}
        </div>
      </section>
      <section className="mt-3 rounded-2xl border border-border bg-surface p-4 text-sm">
        <h2 className="text-base font-medium">What Publik can and cannot do</h2>
        <ul className="mt-3 grid gap-2 text-muted-foreground">
          <li>Demo rules run in this browser. Approving a demo payment does not broadcast a transaction.</li>
          <li>A devnet budget or revoke needs your wallet signature. Publik does not hold that key.</li>
          <li>An agent key created with bun agent/key.ts stays on your machine. Publik only stores the public key.</li>
          <li>The mainnet portfolio is read-only.</li>
          <li>Revoke is the real pause for delegated token access. Pausing in the demo only stops new demo approvals.</li>
        </ul>
      </section>
      <section className="mt-3 rounded-2xl border border-border bg-surface p-4">
        <h2 className="text-base font-medium">Reset demo</h2>
        <p className="mt-1 text-sm text-muted-foreground">Restores Alice, Builder, and Operator. This does not delete devnet payment records or touch a real wallet.</p>
        <button className="mt-3 h-10 rounded-lg border border-destructive px-3 text-sm text-destructive" onClick={() => setConfirmReset(true)} type="button">Reset demo</button>
        {confirmReset ? (
          <div className="mt-3 flex gap-2">
            <button className="glass-quiet h-9 rounded-lg px-3 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-focus" onClick={() => { resetDemo(); toast("Demo restored"); setConfirmReset(false); }} type="button">Confirm reset</button>
            <button className="glass-quiet h-9 rounded-lg px-3 text-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus" onClick={() => setConfirmReset(false)} type="button">Cancel</button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
