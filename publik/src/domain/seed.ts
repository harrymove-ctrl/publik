import { alignDemoAgent } from "./ledger";
import { DEVNET_USDC_MINT, toBase } from "./money";
import type { SpendRequest } from "./policy";
import type { Agent } from "./types";

const ALICE = "BrovpXAVsrtypeeJcfMBDEfoQTQWj93oBTQrL58pREK5";
const RESEARCHER = "8uYBBJJCctcQWxXLXP7NGEbUDgrQSkvLc2MwhCCx1ymx";
const DESIGN_API = "CBNwBPJcYiBCuAPbzHsVDervgaiEim8rgzZBPowhdA8P";
const PAPER_HOST = "Fbxpzbij3K1TFQWn78svBnUZAt632siJu9MJxxCqmiqX";
const NEW_ADDRESS = "5G46y8WrbfodWUxExHdT9eH6SCYJ5qeeQNGTzDvCApJQ";
const ARCHIVE = "DWkxvKN1dvxgz2Bw21nYPc3TxzME3L6y7aJzREr5qbMv";

export const DEMO_SOL_PRICE = "148.20";

export function createSeedAgents(): Agent[] {
  return [alice(), researcher()].map(alignDemoAgent);
}

function pay(partial: SpendRequest): SpendRequest {
  return partial;
}

function alice(): Agent {
  return {
    id: "alice",
    name: "Alice",
    description: "Pays for design tools and small API bills.",
    status: "running",
    avatar: "orb",
    orb: 0,
    walletMode: "demo",
    address: ALICE,
    cluster: "demo",
    runtimeConnected: true,
    createdAt: "2026-09-02T09:00:00.000Z",
    spentTodayBase: "0",
    permissions: {
      dailyUsdcBase: toBase("20", 6).toFixed(0),
      askBeforeNewRecipient: true,
      enforcement: "simulated",
      allowedRecipients: [
        { label: "Design API", address: DESIGN_API },
        { label: "Paper Host", address: PAPER_HOST },
      ],
    },
    holdings: [
      { symbol: "SOL", label: "SOL", mint: null, decimals: 9, amountBase: toBase("1.42", 9).toFixed(0), priceUsd: DEMO_SOL_PRICE },
      { symbol: "USDC", label: "Test USDC", mint: DEVNET_USDC_MINT, decimals: 6, amountBase: toBase("86.40", 6).toFixed(0), priceUsd: "1.00" },
    ],
    spendHistory: [],
    requests: [
      pay(done("req-thu", "alice", "4", DESIGN_API, "Design API", "2026-09-24T15:00:00.000Z")),
      pay(done("req-fri", "alice", "6", PAPER_HOST, "Paper Host", "2026-09-25T15:00:00.000Z")),
      pay(done("req-sun", "alice", "2", DESIGN_API, "Design API", "2026-09-27T15:00:00.000Z")),
      pay(done("req-mon", "alice", "9", PAPER_HOST, "Paper Host", "2026-09-28T15:00:00.000Z")),
      pay(done("req-tue", "alice", "3", DESIGN_API, "Design API", "2026-09-29T15:00:00.000Z")),
      pay(done("req-paper", "alice", "8", PAPER_HOST, "Paper Host", "2026-09-30T11:20:00.000Z")),
      pay({
        id: "req-design",
        agentId: "alice",
        token: "USDC",
        amountBase: toBase("12", 6).toFixed(0),
        decimals: 6,
        recipient: DESIGN_API,
        recipientLabel: "Design API",
        memo: "September design API invoice",
        createdAt: "2026-09-30T14:12:00.000Z",
        status: "pending",
        reason: "Needs your approval",
        signature: null,
        cluster: "demo",
        feePayer: null,
        feeLamports: null,
      }),
      pay({
        id: "req-new",
        agentId: "alice",
        token: "USDC",
        amountBase: toBase("40", 6).toFixed(0),
        decimals: 6,
        recipient: NEW_ADDRESS,
        recipientLabel: "a new address",
        memo: "First payment to an unknown vendor",
        createdAt: "2026-09-30T15:04:00.000Z",
        status: "blocked",
        reason: "Blocked — this recipient is not allowed",
        signature: null,
        cluster: "demo",
        feePayer: null,
        feeLamports: null,
      }),
    ],
  };
}

function researcher(): Agent {
  return {
    id: "researcher",
    name: "Researcher",
    description: "Reads papers and files small archive fees.",
    status: "paused",
    avatar: "orb",
    orb: 1,
    walletMode: "demo",
    address: RESEARCHER,
    cluster: "demo",
    runtimeConnected: true,
    createdAt: "2026-09-09T16:40:00.000Z",
    spentTodayBase: "0",
    permissions: {
      dailyUsdcBase: toBase("50", 6).toFixed(0),
      askBeforeNewRecipient: true,
      enforcement: "simulated",
      allowedRecipients: [{ label: "Archive", address: ARCHIVE }],
    },
    holdings: [
      { symbol: "SOL", label: "SOL", mint: null, decimals: 9, amountBase: toBase("0.08", 9).toFixed(0), priceUsd: DEMO_SOL_PRICE },
      { symbol: "USDC", label: "Test USDC", mint: DEVNET_USDC_MINT, decimals: 6, amountBase: toBase("12", 6).toFixed(0), priceUsd: "1.00" },
    ],
    spendHistory: [],
    requests: [
      pay(done("req-arch-thu", "researcher", "1", ARCHIVE, "Archive", "2026-09-24T15:00:00.000Z")),
      pay(done("req-arch-mon", "researcher", "5", ARCHIVE, "Archive", "2026-09-28T15:00:00.000Z")),
      pay({
        id: "req-archive-fail",
        agentId: "researcher",
        token: "USDC",
        amountBase: toBase("2", 6).toFixed(0),
        decimals: 6,
        recipient: ARCHIVE,
        recipientLabel: "Archive",
        memo: "A demo payment that failed before broadcast",
        createdAt: "2026-09-29T16:00:00.000Z",
        status: "failed",
        reason: "The send failed before it reached the network. This is not a spending-rule block, and there is no explorer link.",
        signature: null,
        cluster: "demo",
        feePayer: null,
        feeLamports: null,
      }),
    ],
  };
}

function done(id: string, agentId: string, amount: string, recipient: string, label: string, createdAt: string): SpendRequest {
  return {
    id,
    agentId,
    token: "USDC",
    amountBase: toBase(amount, 6).toFixed(0),
    decimals: 6,
    recipient,
    recipientLabel: label,
    memo: "",
    createdAt,
    status: "completed",
    reason: "Completed in the demo. No transaction was broadcast.",
    signature: null,
    cluster: "demo",
    feePayer: null,
    feeLamports: null,
  };
}
