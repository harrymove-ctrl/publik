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

## Devnet is the payment path

Open `/` for the public landing. Open `/app` for the Devnet workspace. Demo mode is a separate switch and does not create a signature. Old paths such as `/agents` redirect into `/app`.

1. Connect a wallet from the top bar. Publik never asks for the secret key.
2. Get devnet SOL from [https://faucet.solana.com](https://faucet.solana.com). That airdrop is only SOL. It does not include the test token.
3. The default mint is `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`, labeled Test USDC. RPC shows it is an SPL token with 6 decimals. Publik does not claim a Circle issuer from that account data alone. A different mint is labeled Publik Test USD after the same mint check.
4. Create sample request only fills the form. Review and sign asks the wallet to sign. The payment is completed only when confirmation is confirmed or finalized and the transaction error is null. The explorer link uses `?cluster=devnet`.

The Requests inbox flow (agent request over the MCP bridge, owner signature, on-chain verification) was run on devnet from this machine with a test-harness Wallet Standard wallet holding the demo owner key. It has not been run with a Phantom or Solflare extension. The standalone Review and sign panel uses the same transfer builder and confirmation wait, but was not run live.

## Three-minute demo

1. Open `/`. Read the three scenes: Arrival, Control, and Proof. Open workspace goes to `/app` in Devnet. Explore demo, in the footer, is the only link that opens the simulation.
2. On `/app`, connect a devnet wallet. The panel reads SOL and the configured test token from RPC. No devnet SOL means you cannot pay the fee. A faucet airdrop does not include the test token.
3. Create sample request only fills the amount and reason. Enter a recipient you control, review the amount, and sign in the wallet. The row stays submitted until `getSignatureStatuses` reports confirmed or finalized and `err` is null. A timeout stays unresolved. A rejection is not completed.
4. Reload the page. A saved signature is checked again. If it has left the status cache, Publik looks up the transaction before changing the row.
5. Optional: open `/demo`. Alice’s 4.00 request is a simulation. Approving it changes the demo balance only. There is no signature.

For a live owner-signed receipt, use the agent request flow under Agent requests over MCP below.

## Status

| Area | Status |
| --- | --- |
| Demo scenarios, approve, reject, pause, reset | Verified by tests and the running app |
| Owner-signed devnet transfer | Live-verified on devnet through the Requests inbox with a test-harness wallet, and by `bun run demo:review`. Not yet run with a browser extension |
| Landing scenes | Implemented. The plush laurel and mascot are generated art in `public/art/`. Later scenes appear only once you scroll |
| Paste an agent request | Implemented on the agent page |
| Local MCP bridge | Forwards to the Publik API with the paired credential. Requests appear in the Requests inbox. Stdio, plus `127.0.0.1:8788` when `PUBLIK_BRIDGE_HTTP=1` |
| Mainnet portfolio | Read-only. Example data unless `VITE_DEMO_MAINNET_WATCH_ADDRESS` is set |
| Token delegate and Squads limit | Builders verified on devnet by `bun run demo:limits`: in-budget spends land, over-budget, post-revoke, over-limit, and off-allowlist spends fail on chain. Not part of the app's payment path |
| Delegated payments (vault program) | Deployed on devnet (`4Z9q35j8kamid7FECpF3kcU4bgtd7gYxAXg24MRHkzXx`). All 11 demo steps verified live on devnet. The owner UI was verified end to end on a local validator with a test-harness wallet: setup, link, pay, edit, pause, rotate, revoke, withdraw, and stale-version handling. Not yet run with a real browser extension. Not audited |

## What is real

- Wallet connection through the Solana wallet adapter, read only.
- Devnet SOL balance and the configured SPL test mint (`4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`, 6 decimals), labeled Test USDC. The mint account does not by itself prove a Circle issuer.
- Deposit address, copy, and QR for a watched devnet address.
- Devnet explorer links for that address.
- A fee estimate for a simple transfer, paid by the signing wallet. Publik does not sponsor fees.
- Mainnet RPC URLs and the mainnet USDC mint are refused.

Connecting a wallet does not let Publik sign and does not enforce spending rules on that wallet. Creating a keypair in the browser is intentionally unavailable.

On 1 Oct 2026 one `getHealth` and one `getBalance` to `https://api.mainnet-beta.solana.com` both returned HTTP 200 in under 0.3s. That is not a token-account load test. Do not point the portfolio at the public RPC for many wallets.

`PUBLIK_BRIDGE_HTTP=1 bun agent/bridge.ts` also listens on `127.0.0.1:8788` (`PUBLIK_BRIDGE_PORT`) only. It does not bind other interfaces.

## What is simulated

The demo agents, balances, approvals, blocks, and spending chart. Approving a demo payment updates the local demo balance only. There is no transaction signature and no explorer link.

Pause stops new demo approvals. It cannot reverse a broadcast transaction or stop a key Publik does not hold. That limit is written under Details.

Permission checks (daily Test USDC limit, allowed recipients, new-recipient approval, pause, concurrent pending amounts, and a second check at approval time) run in the client. They are not a secure autonomous-payment backend.

`submitRuntimePayment` always returns `signature: null`.

## Agent requests over MCP

An agent pairs once, then asks for payments through the MCP bridge. Each request waits in Requests → Connected agents. The owner signs in with the owner wallet (a challenge signature, not a payment), then approves by signing a devnet transfer or rejects it. The API marks a request confirmed only after it reads a successful transfer of that amount to that recipient's token account, signed by the signed-in wallet. Once a request has a signature it can only be rechecked, never signed again. The agent reads the result with `publik_get_status`.

```bash
bun run api                                          # Publik API on 8787 (Vite proxies /api)
bun agent/publik.ts connect "<agent name>"           # prints a pairing code; approve it at /connect
bun agent/bridge.ts                                  # MCP server on stdio for the agent runtime
bun run demo:review -- --rpc https://api.devnet.solana.com   # 12-step owner review loop with real transactions
bun run demo:limits -- --rpc https://api.devnet.solana.com   # token delegate + Squads spending limit on devnet
```

Bridge tools: `publik_get_rules`, `publik_request_payment`, `publik_get_status`, `publik_get_balance`. An unpaired bridge lists them but refuses calls. API errors come back as tool errors with the API code. The API enforces pause and the daily limit when the request is created. Those checks are server-side, not on-chain. Design: `docs/design/owner-review-loop.md`.

## Substitutions

- Typography: the Kugiri page is a text-splitting demo, not a font. Its specimen uses Geist and Geist Mono. Publik loads those variable fonts through `@fontsource-variable/geist` and `@fontsource-variable/geist-mono` (OFL). Body text stays unsplit so it remains readable.
- Chart: Bklit bar chart, installed from the documented registry command `shadcn add @bklit/bar-chart` (`BarChart`, `Bar`, `Grid`, `BarXAxis`, `ChartTooltip`).
- Gradient: the supplied `SombraGradient` sources were not in this workspace. `src/components/gradient/SombraGradient.tsx` uses one shared blur, unique ids, `aria-hidden`, and `pointer-events: none`. It is clipped behind the agent avatar. A full-page blurred SVG froze the browser, so the outer wash is CSS in the same palettes. Ember drops the bright yellow and orange. Reduced motion is handled globally.
- Avatars are local SVG orbs and initials, not photographs.

## Delegated payments

This is a separate mode, enabled per agent under Agent → Delegated payments. Owner-signed stays the default, and pairing never turns delegation on. The owner signs vault setup, funding, and every policy change. The agent's execution key signs `execute_payment`, and the Publik vault program (`program/vault`) enforces these rules on-chain:

- per-payment, UTC-day, and lifetime limits
- the recipient allowlist
- the active window
- pause and terminal revoke
- the policy version
- one receipt per execution id

Publik never signs and never sees a private key.

```bash
bun agent/publik.ts delegation key create <name>     # execution key on the agent machine (0600, never printed or sent)
bun agent/publik.ts delegation status                # API view and direct chain read, with disagreements flagged
bun agent/publik.ts delegation policy                # chain only
bun agent/publik.ts payment execute --to <wallet> --amount 1.5 --key <name>
bun agent/publik.ts payment status <request_id>
bun agent/publik.ts payment watch <request_id>
bun run demo:delegation -- --rpc http://127.0.0.1:8899   # 11-step chain demo with real transactions
```

Limits to know:

- A stolen execution key can spend whatever authority remains.
- Revoke cannot undo a completed transfer.
- Disconnecting API access does not revoke on-chain authority.
- The program's upgrade authority is a trust dependency.

Design, authority matrix, threat model, tests, and deployment are in `program/vault/ARCHITECTURE.md`.

## Still needed

- A run of the owner setup flow with a real Phantom or Solflare extension on devnet. Linking needs the owner wallet to sign the ownership challenge.
- An independent audit, plus a multisig or immutable upgrade authority, before any mainnet decision.
- Owner-signed agent requests are checked by the API (pause, daily limit), not on chain. The demo and pasted requests still check in the client.

## Environment

| Name | Purpose |
| --- | --- |
| `VITE_SOLANA_RPC_URL` | Devnet RPC, or `http://127.0.0.1:8899` for a labeled Localnet. Mainnet URLs are ignored. |
| `PUBLIK_SOLANA_RPC_URL` | RPC the API and CLI use for chain reads and reconciliation. Defaults to devnet. Localnet is accepted. |
| `VITE_DEVNET_USDC_MINT` | Optional devnet test mint. Defaults to `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`. |
| `PUBLIK_DEVNET_USDC_MINT` | Test mint the API accepts for agent payment requests. Defaults to `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`. |
| `PUBLIK_PUBLIC_ORIGIN` | Origin the CLI and MCP bridge call. Defaults to `http://127.0.0.1:5173`. |
