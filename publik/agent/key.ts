import { existsSync, mkdirSync, writeFileSync, chmodSync, readFileSync, unlinkSync, linkSync, renameSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { Keypair } from "@solana/web3.js";

export function resolveKeyPath(
  dir: string,
  name: string,
  scope?: { origin: string; network: string },
): { keyFile: string; stateFile: string; folder: string } {
  const safe = name.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40);
  if (!safe) throw new Error("Give the key a name made of letters, numbers, or dashes.");
  const folder = scope
    ? join(dir, scope.origin.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 80), scope.network.replace(/[^a-z0-9-]/gi, ""))
    : dir;
  const keyFile = join(folder, `${safe}.json`);
  const stateFile = join(folder, `${safe}.pending.json`);
  return { keyFile, stateFile, folder };
}

export function createAgentKey(
  dir: string,
  name: string,
  scope?: { origin: string; network: string },
): { publicKey: string; file: string } {
  const { keyFile, folder } = resolveKeyPath(dir, name, scope);
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  if (existsSync(keyFile)) throw new Error("That execution key already exists.");
  const key = Keypair.generate();
  // Write a private temp file, then hard-link it into place: the key file appears complete or not at all,
  // and linkSync fails instead of overwriting if another process created the same name meanwhile.
  const temp = `${keyFile}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(Array.from(key.secretKey)), { mode: 0o600, flag: "wx" });
  try {
    chmodSync(temp, 0o600);
    linkSync(temp, keyFile);
  } catch {
    throw new Error("That execution key already exists.");
  } finally {
    unlinkSync(temp);
  }
  return { publicKey: key.publicKey.toBase58(), file: keyFile };
}

export function loadAgentKey(
  dir: string,
  name: string,
  scope?: { origin: string; network: string },
): { keypair: Keypair; publicKey: string; keyFile: string; stateFile: string } {
  const { keyFile, stateFile } = resolveKeyPath(dir, name, scope);
  if (!existsSync(keyFile)) {
    throw new Error(`Execution key file not found: ${keyFile}. Create one with "publik delegation key create ${name}".`);
  }
  const raw = readFileSync(keyFile, "utf-8");
  const bytes = JSON.parse(raw);
  if (!Array.isArray(bytes) || bytes.length !== 64) {
    throw new Error(`Invalid execution key file: ${keyFile}`);
  }
  const keypair = Keypair.fromSecretKey(new Uint8Array(bytes));
  return { keypair, publicKey: keypair.publicKey.toBase58(), keyFile, stateFile };
}

export type PendingExecution = {
  executionId: string;
  recipient: string;
  amountBase: string;
  createdAt: string;
  /** Set once a transaction was built. After this height passes without a receipt, it can never land. */
  lastValidBlockHeight?: number;
};

export function getPendingExecution(stateFile: string): PendingExecution | null {
  try {
    if (!existsSync(stateFile)) return null;
    const raw = readFileSync(stateFile, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.executionId === "string") {
      return parsed as PendingExecution;
    }
  } catch {
    // ignore
  }
  return null;
}

export function savePendingExecution(stateFile: string, pending: PendingExecution): void {
  const temp = `${stateFile}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(pending), { mode: 0o600 });
  renameSync(temp, stateFile);
}

export function clearPendingExecution(stateFile: string): void {
  try {
    if (existsSync(stateFile)) {
      unlinkSync(stateFile);
    }
  } catch {
    // ignore
  }
}

if (import.meta.main) {
  const name = process.argv[2] ?? "agent";
  const dir = process.env.PUBLIK_KEY_DIR ?? join(homedir(), ".publik", "keys");
  const created = createAgentKey(dir, name);
  process.stdout.write(`${created.publicKey}\n`);
}
