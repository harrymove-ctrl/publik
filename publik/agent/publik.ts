import { Connection, PublicKey } from "@solana/web3.js";
import {
  VAULT_PROGRAM_ID,
  vaultTokenAccount,
  decodeVault,
  allowance,
  type VaultState,
} from "../src/solana/vault";
import { createAgentKey } from "./key";
import { dirname } from "node:path";
import { executeDelegatedPayment } from "./execute";

const origin = process.env.PUBLIK_PUBLIC_ORIGIN ?? "http://127.0.0.1:5173";
const [command, ...rest] = process.argv.slice(2);
const file = new URL("./.publik-credential", import.meta.url);

function parseArgs(args: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    }
  }
  return flags;
}

async function main() {
  if (command === "skill") {
    const response = await fetch(`${origin}/skills/publik.md`);
    console.log(await response.text());
    return;
  }

  if (command === "connect") {
    const name = rest[0] ?? "Agent";
    const response = await fetch(`${origin}/api/v1/agent-connections`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, description: rest[1] ?? "", client: { name: "publik-cli", version: "1" } }),
    });
    const body = (await response.json()) as {
      device_code: string;
      user_code: string;
      verification_uri: string;
      poll_interval_seconds: number;
    };
    console.log(`Open ${body.verification_uri}`);
    console.log(`Pairing code ${body.user_code}`);
    const token = await poll(body.device_code, body.poll_interval_seconds);
    await Bun.write(file, `${token}\n`);
    console.log("Credential stored in agent/.publik-credential. It was not printed.");
    return;
  }

  if (command === "delegation" && rest[0] === "key" && rest[1] === "create") {
    const name = rest[2] ?? "agent";
    const flags = parseArgs(rest.slice(3));
    const network = typeof flags.network === "string" ? flags.network : "solana-devnet";
    const created = createAgentKey(process.env.PUBLIK_KEY_DIR ?? `${process.env.HOME}/.publik/keys`, name, {
      origin,
      network,
    });
    console.log(created.publicKey);
    console.log(`Execution key stored at ${created.file}. Folder: ${dirname(created.file)}. The secret was not printed and is not sent to the API.`);
    return;
  }

  const validCommands = [
    "skill", "connect", "delegation", "payment", "rules", "me", "balance",
  ];
  if (!command || !validCommands.includes(command)) {
    console.log(
      "Commands: skill, connect <name>, me, rules, balance, delegation key create <name>, delegation status, delegation policy, payment execute --to <wallet> --amount <decimal> [--key <name>] [--execution-id <base58>], payment status <request_id>, payment watch <request_id>",
    );
    return;
  }

  // Commands below require paired agent credential
  const credentialFile = Bun.file(file);
  if (!(await credentialFile.exists())) {
    console.error("No paired credential found. Run \"publik connect <name>\" first.");
    process.exit(1);
  }
  const token = (await credentialFile.text()).trim();

  if (command === "delegation" && rest[0] === "status") {
    const response = await fetch(`${origin}/api/v1/agent/delegation`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const apiText = await response.text();
    let apiData: {
      mode?: string;
      deployed?: boolean;
      network?: string;
      vault?: {
        address: string;
        mint: string;
        version: string;
        paused: boolean;
        revoked: boolean;
        spendable_now_base: string;
      } | null;
    } | null = null;
    try {
      apiData = JSON.parse(apiText) as typeof apiData;
    } catch {
      console.log(apiText);
      return;
    }

    if (!apiData) return;
    console.log("=== API Delegation Status ===");
    console.log(JSON.stringify(apiData, null, 2));

    // Direct chain read
    const network = apiData.network ?? "solana-devnet";
    const rpcUrl =
      process.env.PUBLIK_SOLANA_RPC_URL ??
      (network === "solana-localnet" ? "http://127.0.0.1:8899" : "https://api.devnet.solana.com");
    const connection = new Connection(rpcUrl, "confirmed");

    console.log("\n=== Direct Chain Status ===");
    let chainDeployed = false;
    try {
      const progInfo = await connection.getAccountInfo(VAULT_PROGRAM_ID, "confirmed");
      chainDeployed = progInfo !== null && Boolean(progInfo.executable);
    } catch (err) {
      console.log(`Error reading program from chain: ${err}`);
    }
    console.log(`Program deployed on-chain: ${chainDeployed}`);

    let chainVaultState: VaultState | null = null;
    let chainSpendableNow = 0n;
    if (apiData.vault?.address) {
      try {
        const vaultPubkey = new PublicKey(apiData.vault.address);
        const vaultAcc = await connection.getAccountInfo(vaultPubkey, "confirmed");
        if (vaultAcc) {
          chainVaultState = decodeVault(vaultPubkey, vaultAcc.data, vaultAcc.owner);
          const vaultToken = vaultTokenAccount(vaultPubkey, new PublicKey(apiData.vault.mint));
          let balanceBase = 0n;
          try {
            const b = await connection.getTokenAccountBalance(vaultToken);
            balanceBase = BigInt(b.value.amount);
          } catch {
            // 0
          }
          const slot = await connection.getSlot("confirmed");
          let blockTime = BigInt(Math.floor(Date.now() / 1000));
          try {
            const bt = await connection.getBlockTime(slot);
            if (bt !== null && bt !== undefined) blockTime = BigInt(bt);
          } catch {
            // ignore
          }
          const allow = allowance(chainVaultState, blockTime, balanceBase);
          chainSpendableNow = allow.spendableNowBase;

          console.log(`Vault address: ${vaultPubkey.toBase58()}`);
          console.log(`Owner: ${chainVaultState.owner}`);
          console.log(`Execution key: ${chainVaultState.executionKey}`);
          console.log(`Policy version: ${chainVaultState.version.toString()}`);
          console.log(`Paused: ${chainVaultState.paused}`);
          console.log(`Revoked: ${chainVaultState.revoked}`);
          console.log(`Per-payment limit: ${chainVaultState.perBase.toString()}`);
          console.log(`Daily limit: ${chainVaultState.dailyBase.toString()}`);
          console.log(`Daily remaining: ${allow.dailyRemainingBase.toString()}`);
          console.log(`Lifetime limit: ${chainVaultState.lifetimeBase.toString()}`);
          console.log(`Lifetime remaining: ${allow.lifetimeRemainingBase.toString()}`);
          console.log(`Vault balance: ${balanceBase.toString()}`);
          console.log(`Spendable now: ${chainSpendableNow.toString()}`);
          console.log(`Recipients allowlist: ${chainVaultState.recipients.join(", ")}`);
        } else {
          console.log("Vault account not found on-chain.");
        }
      } catch (err) {
        console.log(`Error reading vault on-chain: ${err}`);
      }
    }

    // Flag any disagreement
    const disagreements: string[] = [];
    if (apiData.deployed !== chainDeployed) {
      disagreements.push(`Deployed status mismatch: API=${apiData.deployed}, Chain=${chainDeployed}`);
    }
    if (apiData.vault && chainVaultState) {
      if (apiData.vault.version !== chainVaultState.version.toString()) {
        disagreements.push(`Policy version mismatch: API=${apiData.vault.version}, Chain=${chainVaultState.version}`);
      }
      if (apiData.vault.paused !== chainVaultState.paused) {
        disagreements.push(`Paused mismatch: API=${apiData.vault.paused}, Chain=${chainVaultState.paused}`);
      }
      if (apiData.vault.revoked !== chainVaultState.revoked) {
        disagreements.push(`Revoked mismatch: API=${apiData.vault.revoked}, Chain=${chainVaultState.revoked}`);
      }
      if (apiData.vault.spendable_now_base !== chainSpendableNow.toString()) {
        disagreements.push(`Spendable now mismatch: API=${apiData.vault.spendable_now_base}, Chain=${chainSpendableNow}`);
      }
    }

    console.log("\n=== Reconciliation Audit ===");
    if (disagreements.length > 0) {
      console.log("DISAGREEMENT DETECTED:");
      for (const d of disagreements) console.log(` - ${d}`);
    } else {
      console.log("Agreement: API response and on-chain state are in sync.");
    }
    return;
  }

  if (command === "delegation" && rest[0] === "policy") {
    // Chain read only
    const response = await fetch(`${origin}/api/v1/agent/delegation`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const apiData = (await response.json()) as { network?: string; vault?: { address: string; mint: string } | null };
    if (!apiData.vault?.address) {
      console.log("No vault configured for this agent.");
      return;
    }

    const network = apiData.network ?? "solana-devnet";
    const rpcUrl =
      process.env.PUBLIK_SOLANA_RPC_URL ??
      (network === "solana-localnet" ? "http://127.0.0.1:8899" : "https://api.devnet.solana.com");
    const connection = new Connection(rpcUrl, "confirmed");

    const vaultPubkey = new PublicKey(apiData.vault.address);
    const vaultAcc = await connection.getAccountInfo(vaultPubkey, "confirmed");
    if (!vaultAcc) {
      console.log(`Vault ${vaultPubkey.toBase58()} not found on-chain.`);
      return;
    }

    const vaultState = decodeVault(vaultPubkey, vaultAcc.data, vaultAcc.owner);
    const vaultToken = vaultTokenAccount(vaultPubkey, new PublicKey(apiData.vault.mint));
    let balanceBase = 0n;
    try {
      const b = await connection.getTokenAccountBalance(vaultToken);
      balanceBase = BigInt(b.value.amount);
    } catch {
      // 0
    }

    const slot = await connection.getSlot("confirmed");
    let blockTime = BigInt(Math.floor(Date.now() / 1000));
    try {
      const bt = await connection.getBlockTime(slot);
      if (bt !== null && bt !== undefined) blockTime = BigInt(bt);
    } catch {
      // fallback
    }
    const allow = allowance(vaultState, blockTime, balanceBase);

    console.log("=== On-Chain Vault Policy (Direct Read) ===");
    console.log(`Vault: ${vaultPubkey.toBase58()}`);
    console.log(`Owner: ${vaultState.owner}`);
    console.log(`Execution Key: ${vaultState.executionKey}`);
    console.log(`Mint: ${vaultState.mint}`);
    console.log(`Policy Version: ${vaultState.version.toString()}`);
    console.log(`Status: ${vaultState.revoked ? "REVOKED" : vaultState.paused ? "PAUSED" : "ACTIVE"}`);
    console.log(`Per-Payment Limit: ${vaultState.perBase.toString()} base units`);
    console.log(`Daily Limit: ${vaultState.dailyBase.toString()} base units`);
    console.log(`Spent Today: ${vaultState.spentTodayBase.toString()} base units`);
    console.log(`Daily Remaining: ${allow.dailyRemainingBase.toString()} base units`);
    console.log(`Lifetime Limit: ${vaultState.lifetimeBase.toString()} base units`);
    console.log(`Lifetime Spent: ${vaultState.lifetimeSpentBase.toString()} base units`);
    console.log(`Lifetime Remaining: ${allow.lifetimeRemainingBase.toString()} base units`);
    console.log(`Vault Balance: ${balanceBase.toString()} base units`);
    console.log(`Spendable Now: ${allow.spendableNowBase.toString()} base units`);
    console.log(`Blocked By: ${allow.blockedBy ?? "none"}`);
    console.log(`Start Time: ${new Date(Number(vaultState.startTs) * 1000).toISOString()}`);
    console.log(`Expiry Time: ${new Date(Number(vaultState.expiryTs) * 1000).toISOString()}`);
    console.log(`Allowlisted Recipients (${vaultState.recipients.length}):`);
    for (const r of vaultState.recipients) console.log(`  - ${r}`);
    return;
  }

  if (command === "payment" && rest[0] === "execute") {
    const flags = parseArgs(rest.slice(1));
    const to = typeof flags.to === "string" ? flags.to : "";
    const amount = typeof flags.amount === "string" ? flags.amount : "";
    const keyName = typeof flags.key === "string" ? flags.key : undefined;
    const executionId = typeof flags["execution-id"] === "string" ? flags["execution-id"] : undefined;
    const skipPreflight = Boolean(flags["skip-preflight"]);
    const bypassApiPreflight = Boolean(flags["bypass-api-preflight"]);

    if (!to || !amount) {
      console.error(
        "Usage: publik payment execute --to <wallet> --amount <decimal> [--key <name>] [--execution-id <base58>]",
      );
      process.exit(1);
    }

    try {
      const res = await executeDelegatedPayment({
        to,
        amountDecimal: amount,
        keyName,
        executionId,
        origin,
        token,
        skipPreflight,
        bypassApiPreflight,
        log: (msg) => console.log(msg),
      });
      console.log(JSON.stringify(res, null, 2));
    } catch (err) {
      console.error(`Execution failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
    return;
  }

  if (command === "payment" && rest[0] === "status") {
    const requestId = rest[1];
    if (!requestId) {
      console.error("Usage: publik payment status <request_id>");
      process.exit(1);
    }
    const response = await fetch(`${origin}/api/v1/delegated-payment-requests/${requestId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    console.log(await response.text());
    return;
  }

  if (command === "payment" && rest[0] === "watch") {
    const requestId = rest[1];
    if (!requestId) {
      console.error("Usage: publik payment watch <request_id>");
      process.exit(1);
    }
    console.log(`Watching delegated payment request ${requestId}...`);
    while (true) {
      const response = await fetch(`${origin}/api/v1/delegated-payment-requests/${requestId}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const body = (await response.json()) as { status: string; reason?: string | null };
        console.log(`[${new Date().toISOString()}] Status: ${body.status}${body.reason ? ` (${body.reason})` : ""}`);
        if (body.status === "confirmed" || body.status === "failed") {
          break;
        }
      } else {
        console.log(`[${new Date().toISOString()}] HTTP error: ${response.status}`);
      }
      await Bun.sleep(2000);
    }
    return;
  }

  const path = command === "rules" ? "/api/v1/agent/rules" : command === "me" ? "/api/v1/agent/me" : command === "balance" ? "/api/v1/agent/balances" : "";
  if (!path) {
    console.log(
      "Commands: skill, connect <name>, me, rules, balance, delegation key create <name>, delegation status, delegation policy, payment execute --to <wallet> --amount <decimal> [--key <name>] [--execution-id <base58>], payment status <request_id>, payment watch <request_id>",
    );
    return;
  }
  const response = await fetch(`${origin}${path}`, { headers: { authorization: `Bearer ${token}` } });
  console.log(await response.text());
}

async function poll(device: string, seconds: number): Promise<string> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const response = await fetch(`${origin}/api/v1/agent-connections/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ device_code: device }),
    });
    const body = (await response.json()) as { status: string; access_token?: string };
    if (body.status === "authorized" && body.access_token) return body.access_token;
    if (body.status === "access_denied" || body.status === "expired_token") throw new Error(body.status);
    await Bun.sleep(seconds * 1000);
  }
  throw new Error("expired_token");
}

await main();
