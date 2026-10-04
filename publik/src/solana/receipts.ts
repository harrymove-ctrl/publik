import type { Connection, ParsedTransactionWithMeta } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import { isSolanaAddress } from "./adapter";

export type Receipt = {
  signature: string;
  amountBase: string;
  from: string;
  at: string;
};

export type TokenTransfer = {
  mint: string;
  sourceOwner?: string | null;
  destinationOwner?: string | null;
  amountBase: string;
};

export type Parsed = {
  signature?: string | null;
  blockTime: number | null;
  transfers?: TokenTransfer[];
  tokenTransfers?: TokenTransfer[];
  at?: string;
};

/**
 * Filter and map parsed transactions to incoming receipts for the given owner and mint.
 *
 * Rules:
 * - Keep a transfer only when destinationOwner is owner and mint is the given mint.
 * - Drop outgoing transfers (sourceOwner is owner).
 * - Drop other mints.
 * - Drop rows with no signature.
 */
export function receiptsFromParsed(
  owner: string,
  mint: string,
  txs: Parsed[],
): Receipt[] {
  const targetOwner = owner.trim();
  const targetMint = mint.trim();
  const receipts: Receipt[] = [];

  for (const tx of txs) {
    if (!tx || !tx.signature || typeof tx.signature !== "string" || tx.signature.trim() === "") {
      continue;
    }
    const sig = tx.signature.trim();
    const transfers = tx.transfers ?? tx.tokenTransfers ?? [];
    if (!Array.isArray(transfers) || transfers.length === 0) {
      continue;
    }

    const at =
      typeof tx.at === "string" && tx.at.length > 0
        ? tx.at
        : tx.blockTime != null
        ? new Date(tx.blockTime > 1e11 ? tx.blockTime : tx.blockTime * 1000).toISOString()
        : "";

    for (const transfer of transfers) {
      if (!transfer) continue;

      const tMint = transfer.mint?.trim();
      const tDest = transfer.destinationOwner?.trim();
      const tSource = transfer.sourceOwner?.trim();

      // Drop other mints.
      if (tMint !== targetMint) {
        continue;
      }

      // Drop outgoing transfers (sourceOwner is owner).
      if (tSource === targetOwner) {
        continue;
      }

      // Keep a transfer only when destinationOwner is owner and mint is the given mint.
      if (tDest !== targetOwner) {
        continue;
      }

      receipts.push({
        signature: sig,
        amountBase: String(transfer.amountBase ?? "0"),
        from: tSource ?? "",
        at,
      });
    }
  }

  return receipts;
}

/**
 * Fetch devnet receipts for an address and mint.
 * Uses @solana/web3.js Connection only. Does not sign or send.
 */
export async function fetchDevnetReceipts(
  connection: Connection,
  address: string,
  mint: string,
): Promise<Receipt[]> {
  if (!address || !isSolanaAddress(address)) {
    return [];
  }

  const ownerPubkey = new PublicKey(address.trim());
  const signaturesInfo = await connection.getSignaturesForAddress(
    ownerPubkey,
    { limit: 50 },
    "confirmed",
  );

  if (!signaturesInfo || signaturesInfo.length === 0) {
    return [];
  }

  const validSigs: string[] = [];
  for (const info of signaturesInfo) {
    if (info && !info.err && typeof info.signature === "string" && info.signature.length > 0) {
      validSigs.push(info.signature);
    }
  }

  if (validSigs.length === 0) {
    return [];
  }

  let parsedTxs: (ParsedTransactionWithMeta | null)[] = [];
  if (typeof connection.getParsedTransactions === "function") {
    parsedTxs = await connection.getParsedTransactions(validSigs, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    });
  } else if (typeof connection.getParsedTransaction === "function") {
    parsedTxs = await Promise.all(
      validSigs.map((sig) =>
        connection.getParsedTransaction(sig, {
          maxSupportedTransactionVersion: 0,
          commitment: "confirmed",
        }),
      ),
    );
  }

  const parsedList: Parsed[] = [];

  for (let i = 0; i < parsedTxs.length; i++) {
    const tx = parsedTxs[i];
    if (!tx) continue;
    if (tx.meta?.err) continue;

    const signature = tx.transaction?.signatures?.[0] ?? validSigs[i] ?? "";
    const blockTime = tx.blockTime ?? null;

    const transfers: TokenTransfer[] = [];

    // Method 1: preTokenBalances and postTokenBalances
    const preBalances = tx.meta?.preTokenBalances ?? [];
    const postBalances = tx.meta?.postTokenBalances ?? [];

    if (preBalances.length > 0 || postBalances.length > 0) {
      const preMap = new Map<string, { amount: bigint; owner?: string; mint: string }>();
      for (const b of preBalances) {
        if (b && b.mint) {
          preMap.set(`${b.accountIndex}:${b.mint}`, {
            amount: BigInt(b.uiTokenAmount?.amount ?? "0"),
            owner: b.owner,
            mint: b.mint,
          });
        }
      }

      const postMap = new Map<string, { amount: bigint; owner?: string; mint: string }>();
      for (const b of postBalances) {
        if (b && b.mint) {
          postMap.set(`${b.accountIndex}:${b.mint}`, {
            amount: BigInt(b.uiTokenAmount?.amount ?? "0"),
            owner: b.owner,
            mint: b.mint,
          });
        }
      }

      const allKeys = new Set([...preMap.keys(), ...postMap.keys()]);
      const increases: { mint: string; owner?: string; amount: bigint }[] = [];
      const decreases: { mint: string; owner?: string; amount: bigint }[] = [];

      for (const key of allKeys) {
        const pre = preMap.get(key);
        const post = postMap.get(key);
        const tokenMint = post?.mint ?? pre?.mint ?? "";
        const owner = post?.owner ?? pre?.owner;
        const preAmt = pre?.amount ?? 0n;
        const postAmt = post?.amount ?? 0n;
        const diff = postAmt - preAmt;

        if (diff > 0n) {
          increases.push({ mint: tokenMint, owner, amount: diff });
        } else if (diff < 0n) {
          decreases.push({ mint: tokenMint, owner, amount: -diff });
        }
      }

      for (const inc of increases) {
        const matchIdx = decreases.findIndex(
          (dec) => dec.mint === inc.mint && dec.amount === inc.amount,
        );
        let senderOwner: string | undefined;
        if (matchIdx !== -1) {
          senderOwner = decreases[matchIdx].owner;
          decreases.splice(matchIdx, 1);
        } else {
          const anyIdx = decreases.findIndex((dec) => dec.mint === inc.mint);
          if (anyIdx !== -1) {
            senderOwner = decreases[anyIdx].owner;
          }
        }

        transfers.push({
          mint: inc.mint,
          sourceOwner: senderOwner ?? "",
          destinationOwner: inc.owner ?? "",
          amountBase: inc.amount.toString(),
        });
      }
    }

    // Method 2: Fallback to parsed instructions
    if (transfers.length === 0) {
      type ParsedInstructionLike = {
        parsed?: {
          type?: string;
          info?: {
            mint?: string;
            amount?: string | number;
            tokenAmount?: { amount?: string };
            source?: string;
            sourceOwner?: string;
            destination?: string;
            destinationOwner?: string;
            authority?: string;
          };
        };
      };

      const allInstructions: ParsedInstructionLike[] = [];
      if (Array.isArray(tx.transaction?.message?.instructions)) {
        allInstructions.push(...(tx.transaction.message.instructions as ParsedInstructionLike[]));
      }
      if (Array.isArray(tx.meta?.innerInstructions)) {
        for (const inner of tx.meta.innerInstructions) {
          if (Array.isArray(inner.instructions)) {
            allInstructions.push(...(inner.instructions as ParsedInstructionLike[]));
          }
        }
      }

      for (const ix of allInstructions) {
        if (!ix || !ix.parsed) continue;
        const parsed = ix.parsed;
        if (parsed.type === "transfer" || parsed.type === "transferChecked") {
          const info = parsed.info ?? {};
          const transferMint = info.mint ?? "";
          const amount =
            info.tokenAmount?.amount ??
            (info.amount != null ? String(info.amount) : "0");
          const sourceOwner =
            info.sourceOwner ?? info.authority ?? info.source ?? "";
          const destinationOwner =
            info.destinationOwner ?? info.destination ?? "";

          transfers.push({
            mint: transferMint,
            sourceOwner,
            destinationOwner,
            amountBase: amount,
          });
        }
      }
    }

    parsedList.push({
      signature,
      blockTime,
      transfers,
    });
  }

  return receiptsFromParsed(address, mint, parsedList);
}
