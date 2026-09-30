# Publik

A quiet workspace for seeing what an agent holds, what needs you, and what it is allowed to do. Solana work stays on devnet. Demo payments are labeled as demos and never pretend to be transactions.

## Run

```bash
cd publik
bun install
bun run dev
```

Open the URL Vite prints (usually http://localhost:5173).

```bash
bun test
bun run build
```

Copy `.env.example` to `.env` if you want a custom devnet RPC. No secret values are required.

## What is real

- Wallet connection through the Solana wallet adapter, read only.
- Devnet SOL balance and SPL token balances, including Circle devnet USDC (`4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`, 6 decimals), labeled Test USDC.
- Deposit address, copy, and QR for a watched devnet address.
- Devnet explorer links for that address.
- A fee estimate for a simple transfer, paid by the signing wallet. Publik does not sponsor fees.
- Mainnet RPC URLs and the mainnet USDC mint are refused.

Connecting a wallet does not let Publik sign and does not enforce spending rules on that wallet. Creating a keypair in the browser is intentionally unavailable.

## What is simulated

The demo agents, balances, approvals, blocks, and spending chart. Approving a demo payment updates the local demo balance only. There is no transaction signature and no explorer link.

Pause stops new demo approvals. It cannot reverse a broadcast transaction or stop a key Publik does not hold. That limit is written under Details.

Permission checks (daily Test USDC limit, allowed recipients, new-recipient approval, pause, concurrent pending amounts, and a second check at approval time) run in the client. They are not a secure autonomous-payment backend.

`submitRuntimePayment` always returns `signature: null`.

## Substitutions

- Typography: the Kugiri page is a text-splitting demo, not a font. Its specimen uses Geist and Geist Mono. Publik loads those variable fonts through `@fontsource-variable/geist` and `@fontsource-variable/geist-mono` (OFL). Body text stays unsplit so it remains readable.
- Chart: Bklit bar chart, installed from the documented registry command `shadcn add @bklit/bar-chart` (`BarChart`, `Bar`, `Grid`, `BarXAxis`, `ChartTooltip`).
- Gradient: the supplied `SombraGradient` sources were not in this workspace. `src/components/gradient/SombraGradient.tsx` uses one shared blur, unique ids, `aria-hidden`, and `pointer-events: none`. It is clipped behind the agent avatar. A full-page blurred SVG froze the browser, so the outer wash is CSS in the same palettes. Ember drops the bright yellow and orange. Reduced motion is handled globally.
- Avatars are local SVG orbs and initials, not photographs.

## Still needed for secure autonomous payments

- A signer Publik controls, or a wallet session that can enforce rules before sign. Not a key in browser storage.
- Authenticated owner and agent identities, with requests bound to one agent.
- Server-side policy checks, including concurrent in-flight spends, idempotency keys, and a second check of token, amount, and destination at execution.
- Real devnet submission, fee payer selection, and signature status. Only then should an explorer link appear.
- Pause that the signer actually honors.

## Environment

| Name | Purpose |
| --- | --- |
| `VITE_SOLANA_RPC_URL` | Devnet RPC. Mainnet URLs are ignored. |
| `VITE_DEVNET_USDC_MINT` | Optional devnet test mint. Defaults to Circle devnet USDC. |
