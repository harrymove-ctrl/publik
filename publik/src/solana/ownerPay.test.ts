import { describe, expect, test } from "bun:test";
import { DEVNET_USDC_MINT } from "@/domain/money";
import { buildOwnerUsdcPayment } from "./ownerPay";

const OWNER = "BrovpXAVsrtypeeJcfMBDEfoQTQWj93oBTQrL58pREK5";
const DEST = "CBNwBPJcYiBCuAPbzHsVDervgaiEim8rgzZBPowhdA8P";

describe("owner devnet payment", () => {
  test("builds a devnet transfer and refuses the mainnet mint", async () => {
    const tx = await buildOwnerUsdcPayment({
      owner: OWNER,
      destinationOwner: DEST,
      mint: DEVNET_USDC_MINT,
      amountBase: 4_000_000n,
      blockhash: "11111111111111111111111111111111",
      createDestination: false,
    });
    expect(tx.feePayer?.toBase58()).toBe(OWNER);
    expect(tx.instructions).toHaveLength(1);
    await expect(buildOwnerUsdcPayment({
      owner: OWNER,
      destinationOwner: DEST,
      mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      amountBase: 1n,
      blockhash: "11111111111111111111111111111111",
      createDestination: false,
    })).rejects.toThrow(/mainnet|devnet/i);
  });
});
