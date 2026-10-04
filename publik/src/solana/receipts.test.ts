import { describe, expect, test } from "bun:test";
import type { Connection } from "@solana/web3.js";
import { DEVNET_USDC_MINT } from "@/domain/money";
import { fetchDevnetReceipts, type Parsed, receiptsFromParsed } from "./receipts";

describe("receiptsFromParsed", () => {
  const OWNER = "Agnt1111111111111111111111111111111111111111";
  const SENDER = "Send2222222222222222222222222222222222222222";
  const OTHER_MINT = "OtherMint11111111111111111111111111111111111";
  const USDC = DEVNET_USDC_MINT;

  test("an incoming USDC transfer is kept with the right amountBase", () => {
    const txs: Parsed[] = [
      {
        signature: "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUc",
        blockTime: 1727784000,
        transfers: [
          {
            mint: USDC,
            sourceOwner: SENDER,
            destinationOwner: OWNER,
            amountBase: "5000000",
          },
        ],
      },
    ];

    const receipts = receiptsFromParsed(OWNER, USDC, txs);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toEqual({
      signature: "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUc",
      amountBase: "5000000",
      from: SENDER,
      at: "2024-10-01T12:00:00.000Z",
    });
  });

  test("a different mint is ignored", () => {
    const txs: Parsed[] = [
      {
        signature: "sig-other-mint",
        blockTime: 1727784000,
        transfers: [
          {
            mint: OTHER_MINT,
            sourceOwner: SENDER,
            destinationOwner: OWNER,
            amountBase: "999999",
          },
        ],
      },
    ];

    const receipts = receiptsFromParsed(OWNER, USDC, txs);
    expect(receipts).toEqual([]);
  });

  test("an outgoing transfer is ignored", () => {
    const txs: Parsed[] = [
      {
        signature: "sig-outgoing",
        blockTime: 1727784000,
        transfers: [
          {
            mint: USDC,
            sourceOwner: OWNER,
            destinationOwner: SENDER,
            amountBase: "2000000",
          },
        ],
      },
    ];

    const receipts = receiptsFromParsed(OWNER, USDC, txs);
    expect(receipts).toEqual([]);
  });

  test("a self transfer is ignored as outgoing", () => {
    const txs: Parsed[] = [
      {
        signature: "sig-self",
        blockTime: 1727784000,
        transfers: [
          {
            mint: USDC,
            sourceOwner: OWNER,
            destinationOwner: OWNER,
            amountBase: "1000000",
          },
        ],
      },
    ];

    const receipts = receiptsFromParsed(OWNER, USDC, txs);
    expect(receipts).toEqual([]);
  });

  test("drops rows with no signature", () => {
    const txs: Parsed[] = [
      {
        signature: "",
        blockTime: 1727784000,
        transfers: [
          {
            mint: USDC,
            sourceOwner: SENDER,
            destinationOwner: OWNER,
            amountBase: "5000000",
          },
        ],
      },
      {
        signature: null,
        blockTime: 1727784000,
        transfers: [
          {
            mint: USDC,
            sourceOwner: SENDER,
            destinationOwner: OWNER,
            amountBase: "5000000",
          },
        ],
      },
    ];

    const receipts = receiptsFromParsed(OWNER, USDC, txs);
    expect(receipts).toEqual([]);
  });

  test("ignores transfer to a third party", () => {
    const txs: Parsed[] = [
      {
        signature: "sig-third-party",
        blockTime: 1727784000,
        transfers: [
          {
            mint: USDC,
            sourceOwner: SENDER,
            destinationOwner: "ThirdParty3333333333333333333333333333333333",
            amountBase: "4000000",
          },
        ],
      },
    ];

    const receipts = receiptsFromParsed(OWNER, USDC, txs);
    expect(receipts).toEqual([]);
  });

  test("handles null blockTime gracefully", () => {
    const txs: Parsed[] = [
      {
        signature: "sig-null-blocktime",
        blockTime: null,
        transfers: [
          {
            mint: USDC,
            sourceOwner: SENDER,
            destinationOwner: OWNER,
            amountBase: "1000000",
          },
        ],
      },
    ];

    const receipts = receiptsFromParsed(OWNER, USDC, txs);
    expect(receipts).toHaveLength(1);
    expect(receipts[0].at).toBe("");
    expect(receipts[0].amountBase).toBe("1000000");
  });

  test("handles multiple transfers across transactions and filters each accurately", () => {
    const txs: Parsed[] = [
      {
        signature: "tx-mixed",
        blockTime: 1727784000,
        transfers: [
          {
            mint: OTHER_MINT,
            sourceOwner: SENDER,
            destinationOwner: OWNER,
            amountBase: "100",
          },
          {
            mint: USDC,
            sourceOwner: SENDER,
            destinationOwner: OWNER,
            amountBase: "2500000",
          },
          {
            mint: USDC,
            sourceOwner: OWNER,
            destinationOwner: SENDER,
            amountBase: "990000",
          },
        ],
      },
      {
        signature: "tx-clean",
        blockTime: 1727785000,
        transfers: [
          {
            mint: USDC,
            sourceOwner: "AnotherSender444444444444444444444444444444",
            destinationOwner: OWNER,
            amountBase: "10000000",
          },
        ],
      },
    ];

    const receipts = receiptsFromParsed(OWNER, USDC, txs);
    expect(receipts).toEqual([
      {
        signature: "tx-mixed",
        amountBase: "2500000",
        from: SENDER,
        at: "2024-10-01T12:00:00.000Z",
      },
      {
        signature: "tx-clean",
        amountBase: "10000000",
        from: "AnotherSender444444444444444444444444444444",
        at: "2024-10-01T12:16:40.000Z",
      },
    ]);
  });
});

describe("fetchDevnetReceipts", () => {
  const OWNER = "Agnt1111111111111111111111111111111111111111";
  const SENDER = "Send2222222222222222222222222222222222222222";
  const USDC = DEVNET_USDC_MINT;

  test("reads signatures, parses transactions, and returns incoming receipts", async () => {
    const mockConnection = {
      getSignaturesForAddress: async () => [
        { signature: "sig-valid-1", err: null, blockTime: 1727784000 },
        { signature: "sig-failed", err: { InstructionError: [0, "Custom"] }, blockTime: 1727784100 },
      ],
      getParsedTransactions: async (sigs: string[]) => {
        expect(sigs).toEqual(["sig-valid-1"]);
        return [
          {
            transaction: {
              signatures: ["sig-valid-1"],
              message: { instructions: [] },
            },
            meta: {
              err: null,
              preTokenBalances: [
                {
                  accountIndex: 1,
                  mint: USDC,
                  owner: SENDER,
                  uiTokenAmount: { amount: "15000000", decimals: 6 },
                },
                {
                  accountIndex: 2,
                  mint: USDC,
                  owner: OWNER,
                  uiTokenAmount: { amount: "0", decimals: 6 },
                },
              ],
              postTokenBalances: [
                {
                  accountIndex: 1,
                  mint: USDC,
                  owner: SENDER,
                  uiTokenAmount: { amount: "10000000", decimals: 6 },
                },
                {
                  accountIndex: 2,
                  mint: USDC,
                  owner: OWNER,
                  uiTokenAmount: { amount: "5000000", decimals: 6 },
                },
              ],
            },
            blockTime: 1727784000,
          },
        ];
      },
    } as unknown as Connection;

    const receipts = await fetchDevnetReceipts(mockConnection, OWNER, USDC);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toEqual({
      signature: "sig-valid-1",
      amountBase: "5000000",
      from: SENDER,
      at: "2024-10-01T12:00:00.000Z",
    });
  });

  test("returns empty array for invalid address without calling connection", async () => {
    let called = false;
    const mockConnection = {
      getSignaturesForAddress: async () => {
        called = true;
        return [];
      },
    } as unknown as Connection;

    const receipts = await fetchDevnetReceipts(mockConnection, "not-a-solana-addr", USDC);
    expect(receipts).toEqual([]);
    expect(called).toBe(false);
  });
});
