# Delegated vault

## Decision

Publik uses its own narrowly scoped vault program, `program/vault` (native `solana-program` 2.3, no Anchor). Owner-signed transfers stay the default mode. Delegated mode is separate, and pairing an agent never enables it.

- **Mechanism.** One vault per owner and vault id. A program-derived authority owns the vault's token account. The agent's execution key signs `execute_payment`, and the program performs one `TransferChecked` CPI into the legacy SPL Token program.
- **Network and token.** Devnet only. Legacy Token program only, one six-decimal test-token mint per vault, and exact base units. Token-2022, SOL spending, arbitrary CPI, swaps, and mainnet are out of scope. The program rejects them.
- **Program id.** `4Z9q35j8kamid7FECpF3kcU4bgtd7gYxAXg24MRHkzXx`. The keypair is `target/deploy-keypair.json`, which is gitignored. Do not deploy with `target/deploy/publik_vault-keypair.json`, because that file holds a different key.

### Why not Squads spending limits

`src/solana/squadsLimit.ts` can add a Squads spending limit: one mint, a period amount, member keys, and a destination list. Squads controls that program and can upgrade it. It lacks several of the required on-chain controls:

- a per-execution cap that is separate from the period amount
- a lifetime cap that a new period does not reset
- an activation time and an expiry
- pause without deleting the limit
- a terminal revoke
- an execution-id receipt that cannot be closed and replayed

Covering those gaps in the API would not be on-chain enforcement. An ordinary SPL `approve` delegate cannot enforce them either. It caps only a total and gives the agent direct authority over the owner's token account.

## Accounts and seeds

| Account | Seeds / derivation | Owner | Notes |
|---|---|---|---|
| Vault state (472 bytes) | `["vault", owner, vault_id(32)]` | vault program | Created by `initialize_vault`. The owner pays rent. |
| Token authority | `["authority", vault]` | none (PDA) | The only signer for the vault token account, via `invoke_signed`. |
| Vault token account | ATA(authority, mint) | SPL Token | Created idempotently in the initialize transaction. |
| Receipt (128 bytes) | `["receipt", vault, execution_id(32)]` | vault program | Created by `execute_payment`. The execution key pays rent. No instruction closes it. |

Vault layout: `PUBLIKV1` · owner · mint · vault_id · execution_key · flags(paused@137, revoked@138) · version u64@140 · per/daily/lifetime/spent_today/lifetime_spent u64 @148..188 · day_index i64@188 · start i64@196 · expiry i64@204 · recipient count@212 · 8 × 32-byte recipient wallets @216.

Receipt layout: `RECEIPT1` · recipient wallet · amount u64 · policy version u64 · unix time i64 · execution key · mint.

## Instructions

| # | Instruction | Signer | Accounts | Data | Effect |
|---|---|---|---|---|---|
| 0 | `initialize_vault` | owner (writable, pays rent) | owner, vault, authority, vault token, mint, Token program, System program | vault_id, execution_key, per, daily, lifetime, start, expiry, n, recipients | Creates the vault PDA at version 1. It works even if someone pre-funded the address. |
| 1 | `configure_policy` | owner | owner, vault | expected_version, per, daily, lifetime, n, recipients | Replaces limits and the allowlist, then increments the version. Counters are not reset. |
| 2 | `set_paused` | owner | owner, vault | expected_version, 0/1 | Pauses or resumes, then increments the version. |
| 3 | `rotate_execution_key` | owner | owner, vault | expected_version, new_key | Replaces the key, then increments the version. The old key fails from then on. |
| 4 | `revoke_delegation` | owner | owner, vault | expected_version | Terminal. Every later edit and execution fails, but withdraw still works. |
| 5 | `execute_payment` | execution key (writable, pays fee and receipt rent) | agent, vault, authority, vault token, recipient ATA, mint, Token program, System program, receipt | execution_id, amount, expected_version | Runs the checks below, then creates the receipt, transfers, and updates counters atomically. |
| 6 | `withdraw_owner_funds` | owner | owner, vault, authority, vault token, destination token account, mint, Token program | amount | Owner only. Works while paused or revoked. Counters and limits do not change. |

Each instruction emits a `sol_log_data` event (`publik:initialize`, `publik:configure`, `publik:set_paused`, `publik:rotate`, `publik:revoke`, `publik:execute`, `publik:withdraw`). Events support display and reconciliation only. The receipt PDA is the replay guard.

### `execute_payment` checks

All of these run inside the program, in this order:

1. The signer is the stored execution key.
2. The vault is not revoked, then not paused.
3. The expected policy version equals the current one.
4. The current time is within the window, `start ≤ Clock.unix_timestamp < expiry`.
5. The amount is greater than 0 and no more than the per-execution limit.
6. The recipient wallet is on the allowlist, and the destination is that wallet's canonical ATA for the vault mint. The program rejects any other token account owned by the recipient, and it rejects paying back into the vault.
7. The vault token balance covers the amount.
8. On a new UTC day the daily counter resets, and only that counter.
9. The daily and lifetime totals, computed with checked addition, stay within their limits.
10. The receipt PDA is canonical and not yet initialized.
11. The program checks every account it relies on: the Token program id, the System program id, the stored mint, the vault PDA derived from its stored owner and id, the authority PDA, and the canonical vault ATA owned by the Token program.

### Error codes

`0` unauthorized signer · `1` paused · `2` revoked · `3` not yet active · `4` expired · `5` zero amount · `6` over per-payment · `7` over daily · `8` over lifetime · `9` vault balance too low · `10` recipient not allowed · `11` stale policy version · `12` overflow · `13` too many recipients · `14` invalid policy (zero limit, expiry ≤ start, duplicate or default recipient, mint not six decimals, execution key equal to owner). A replayed execution id fails with `AccountAlreadyInitialized`. TS mirror: `VAULT_ERRORS` in `src/solana/vault.ts`.

## Policy semantics

- **Daily limit.** The program computes `floor(Clock.unix_timestamp / 86400)`, a fixed UTC calendar day. It is not a rolling 24 hours, so spending just before and just after 00:00 UTC can use two days of allowance.
- **Lifetime limit.** This caps cumulative spend for the vault. If an owner lowers it below recorded spend, the remaining allowance is zero, and the counter does not underflow.
- **No resets.** Funding, configure, pause and resume, and rotation never reset counters. Only a new UTC day resets the daily counter.
- **Allowlist.** An empty allowlist allows nobody. It holds at most 8 recipients, with no duplicates. Recipient token accounts must exist before an execution. The owner or the recipient creates them, and the cost is not hidden in the payment amount.
- **Concurrency.** Every execution write-locks the vault account, so the runtime serializes executions. Two payments built from the same stale view cannot together exceed a shared limit.
- **Spendable now.** One execution can move the minimum of the per-payment limit, the daily remainder, the lifetime remainder, and the vault balance. Fees (SOL, paid by the execution key) are separate from token amounts.
- **Off-chain reservations.** Queued Publik requests do not reserve on-chain allowance. A direct RPC caller holding the execution key can spend anything that remains.

## Authority matrix

| Capability | Owner wallet | Execution key | Publik API credential | Publik server | Upgrade authority |
|---|---|---|---|---|---|
| Initialize vault and set the first policy | ✅ signs | — | — | — | — |
| Fund vault | ✅ plain SPL transfer | — | — | — | — |
| Configure, pause or resume, rotate, revoke | ✅ signs, with expected version | — | — | — | — |
| Withdraw | ✅ also while paused or revoked | — | — | — | — |
| Execute payment within policy | — | ✅ signs | ❌ cannot sign | ❌ never signs | — |
| Change program behavior | — | — | — | — | ⚠️ can replace the program |
| Read state | ✅ | ✅ | ✅ via API | ✅ chain reads | ✅ |

## Threat model

| Event | Outcome |
|---|---|
| API bypassed, agent submits straight to RPC | The program enforces every rule, and the server later discovers the execution through vault signatures and receipts, labeled "direct chain". |
| API wrongly reports a request as allowed | The program still rejects it. Server preflight affects only the UX. |
| Execution key stolen | The attacker can spend up to the remaining authority: per-payment, daily, and lifetime limits, the vault balance, allowlisted recipients only, until expiry. The owner should pause or revoke and withdraw. Revoke cannot reverse completed transfers. |
| API credential stolen | The attacker can read status and create off-chain requests, but cannot sign. Disconnecting the API does not remove on-chain authority. |
| Two agent processes race | The vault write lock serializes them, and the counters hold. A duplicate execution id fails. |
| Stale UI edits policy | The expected-version check returns error 11. |
| Pre-funded PDA griefing (vault or receipt) | Creation tops up, allocates, and assigns, so it still succeeds. |
| Upgrade authority compromised or malicious | It can change everything. This is a trust dependency, not a non-custodial guarantee. |
| Publik server compromised | It cannot sign for the owner or the agent. It can mislead the UI, so the UI and CLI read the chain directly for authoritative state. |

**Upgrade authority.** The program is deployed as upgradeable. The upgrade authority is a separate operator key, `q1PXcaFRxeFKHCB8KzQYx6LqVvvKvAftmfPnUuhNX2L`, stored outside the repository at `~/.config/publik/devnet-deployer.json`. It is never the agent key, never the owner key, and never used in any request path. Mainnet would need a separate decision: a multisig or immutable upgrade authority, and an independent audit.

**Audit.** This program has not been audited.

## Testing

- `cargo test --lib` covers 7 policy unit tests.
- `cargo test --test svm` runs 14 tests that execute the compiled `target/deploy/publik_vault.so` in Mollusk against the real SPL Token program. They cover:
  - an allowed transfer and its receipt contents
  - initialize rules: signer, zero limits, time window, duplicate recipients, non-six-decimal mint, pre-funded PDA, double init
  - wrong execution key; a stranger trying to configure, pause, revoke, or withdraw; the agent trying to rotate itself
  - substituted Token program, mint, recipient token account, vault, and receipt
  - destination equal to the vault
  - non-allowlisted recipient, zero amount, and the per-payment, daily, and lifetime limits
  - UTC day rollover
  - concurrent payments built from the same view
  - insufficient balance leaving counters unchanged
  - not-yet-active and expired windows
  - a replayed execution id, plus a pre-funded receipt address
  - pause, a stale-version resume, a stale-version execution, rotation where the old key fails and the new key succeeds, terminal revoke, and withdraw after revoke
  - funding and configure leaving counters unchanged
  - a lifetime below spend
  - an empty allowlist
  - u64 overflow
  - a failed token CPI (frozen account) leaving no receipt and no spend
  - withdraw while paused
- `bun scripts/delegation-demo.ts --rpc <url>` runs the 11-step demo with real transactions against a validator. On mainnet it refuses to run.

Build: `cargo-build-sbf --arch v2` in `program/vault` (Solana CLI 4.3, `~/.local/share/solana/install/active_release/bin`).

## Deployment

Local validator:

```sh
solana-test-validator --reset --ledger /tmp/publik-ledger \
  --upgradeable-program 4Z9q35j8kamid7FECpF3kcU4bgtd7gYxAXg24MRHkzXx \
  program/vault/target/deploy/publik_vault.so q1PXcaFRxeFKHCB8KzQYx6LqVvvKvAftmfPnUuhNX2L
```

Devnet needs about 0.65 SOL at peak on the deployer: program data rent is 0.324 SOL for a 63,656-byte `.so`, the buffer holds about the same while deploying, and that buffer is reclaimed afterward. Fund it with 1 SOL to be safe.

```sh
solana program deploy program/vault/target/deploy/publik_vault.so \
  --program-id program/vault/target/deploy-keypair.json \
  --upgrade-authority ~/.config/publik/devnet-deployer.json \
  --keypair ~/.config/publik/devnet-deployer.json -u devnet
solana program show 4Z9q35j8kamid7FECpF3kcU4bgtd7gYxAXg24MRHkzXx -u devnet
```

Then run `bun scripts/delegation-demo.ts --rpc https://api.devnet.solana.com --funder ~/.config/publik/devnet-deployer.json`.

## Status (4 Oct 2026)

| Stage | State |
|---|---|
| Implemented | Yes |
| Locally verified | Yes. 7 unit tests, 14 SVM tests, and the 11-step demo on `solana-test-validator` |
| Deployed to devnet | Yes. Program `4Z9q35j8kamid7FECpF3kcU4bgtd7gYxAXg24MRHkzXx`, program data `2fLhFM2KabSk5AfZiTdqAwBCMEawYaoJoXKKfWQxRceQ`, deploy tx `65csKVvZPFVuBrjDBHrtbkSZsdxbTYFe95ZUvfLoMr9HgTNBy9XMFUZan4fHtzmvjrAF9jTFBME8Mm5UvCeophye`, slot 507304475. Upgrade authority `q1PXcaFRxeFKHCB8KzQYx6LqVvvKvAftmfPnUuhNX2L`. The dumped on-chain bytecode sha256 `5aa55db8…4693a71` equals the tested `.so` |
| Live devnet verified | Yes. The 11-step demo passed with test mint `GgGgBJw7QZFwwiMuHo43bwfRdGjku2WpqADyqEVHMVHR` and vault `Hr8UnFt4rU2BzFRXizLU6N2wDu4jKr9XtHFycJw9f1GB` |
| Independently audited | No |

Live devnet transactions (`https://explorer.solana.com/tx/<sig>?cluster=devnet`):

| Step | Signature | Result |
|---|---|---|
| Initialize vault | `5UQ7GR5Ec7YZuiTDH1rCJUJFrwH7pw6s237ynD7oTSe53rxhGZMJoSN3sF8k8Lr1SCKxm6WLoTcW9SFdnhz6vvuJ` | version 1 |
| Fund 10 test tokens | `4hzb8uX84YiidTC25x7MVwdaKCoDM5NjPq68L8WdLACMwUDG2d99W2YfeMpWgJwy1Fgbdb4TURLk9aE4qTyfFQMq` | counters unchanged |
| Agent pays 1.5 (agent signature only) | `5gJTaS1rwvgDqwPtbmRk1zZzB5JEpzUB86532227Apo1V88jU9tCSaQ3muyWfXPDuVGS7bXcYPxyf2YFFMZNuzem` | receipt `GhAYyyu9zvTouoNmMYi6m2LeeNoeGjp71SfJDUbZ792B` verified |
| Over per-payment limit | `2i8Km8sHyyPbk3RpBrLJV56omyy53eYmYzTXzorAFRKWtoYcKKMx3n78GcgyQh9MqaRtFZag7BEE5fcdf5cHMMUQ` | failed, error 6 |
| Recipient not on allowlist | `4o4C44ZX2yJNJETfaFcU1vWA9HSgmfPihN3rLSWiujJQnEzrpKoCngjk8zzBUCw3pLn8uZDaYeBJr8v1zF5uWLK5` | failed, error 10 |
| Pause | `66ZWRNTNHbVYzEUg4Cz7Momsjds5FX61Xh619CKwv9GKQr8vuJmhejzn5kZXrWEyY2WoMYc6rvNWcxxKg6Q7HtDf` | version 2 |
| Revoke | `5qKba1Mb4rvqukokYAdXqZmwYQL9bdjtVT2nYkY3uugM3QwEVMLm14Yff5oYnWzhi28szxJFeZqErNhyPKtXHqaG` | version 3 |
| Agent pays after revoke | `LHeaMunbByt5LZuoeHrYChbbNMeGoWY3cVMjy9wqhq1ZRivuoC9RT5cVhGrWZsUx1MJSmyezNEd92Yfr3roJivM` | failed, error 2 |
| Owner withdraws 8.5 | `2BcEb4ttXFwtFbSGZvuGFNnJfMdZWCkCA57mwzUTadgAJ3t1evN59uqfzCwnSUaiFdTefJypSF6BGd9CuhhSuWUa` | vault balance 0 |

Mainnet is a separate decision. It needs an independent audit, a multisig or immutable upgrade authority, and operational procedures. Nothing in this repository deploys to mainnet.
