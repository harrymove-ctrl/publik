import { MINT_DECIMALS } from "@/solana/vault";

export function parseTokenAmountToBase(value: string, decimals = MINT_DECIMALS): bigint {
  const trimmed = value.trim();
  if (!trimmed || !/^\d+(\.\d+)?$/.test(trimmed)) throw new Error("Invalid token amount");
  const [whole, rawFrac = ""] = trimmed.split(".");
  if (rawFrac.length > decimals) throw new Error(`Maximum ${decimals} decimal places allowed`);
  const paddedFrac = rawFrac.padEnd(decimals, "0");
  const combined = `${whole}${paddedFrac}`.replace(/^0+(?=\d)/, "") || "0";
  return BigInt(combined);
}
export function safeParseTokenAmountToBase(value: string, decimals = MINT_DECIMALS): bigint | null {
  try {
    return parseTokenAmountToBase(value, decimals);
  } catch {
    return null;
  }
}


export function formatBaseToToken(base: bigint | string, decimals = MINT_DECIMALS): string {
  const b = typeof base === "string" ? BigInt(base) : base;
  const divisor = 10n ** BigInt(decimals);
  const whole = b / divisor;
  const rem = b % divisor;
  if (rem === 0n) return whole.toString();
  const remStr = rem.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole}.${remStr}`;
}

export function generateRandomVaultIdHex(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function hexToBytes32(hex: string): Uint8Array {
  const cleaned = hex.trim().replace(/^0x/, "");
  if (cleaned.length !== 64) throw new Error("Vault ID must be exactly 32 bytes (64 hex characters)");
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = parseInt(cleaned.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
type WithResolvers = {
  withResolvers<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason?: unknown) => void };
};

export function sleep(ms: number): Promise<void> {
  const p = Promise as unknown as WithResolvers;
  if (typeof p.withResolvers === "function") {
    const { promise, resolve } = p.withResolvers<void>();
    setTimeout(resolve, ms);
    return promise;
  }
  let res: () => void = () => {};
  const promise = new Promise<void>((r) => { res = r; });
  setTimeout(res, ms);
  return promise;
}
