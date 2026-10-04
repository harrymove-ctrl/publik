import { alignDemoAgent } from "./ledger";
import { appearanceFor } from "./appearance";
import { DEVNET_USDC_MINT, toBase } from "./money";
import type { SpendRequest } from "./policy";
import type { Agent } from "./types";

const ALICE = "BrovpXAVsrtypeeJcfMBDEfoQTQWj93oBTQrL58pREK5";
const RESEARCHER = "8uYBBJJCctcQWxXLXP7NGEbUDgrQSkvLc2MwhCCx1ymx";
const DESIGN_API = "CBNwBPJcYiBCuAPbzHsVDervgaiEim8rgzZBPowhdA8P";
const PAPER_HOST = "Fbxpzbij3K1TFQWn78svBnUZAt632siJu9MJxxCqmiqX";
const ARCHIVE = "DWkxvKN1dvxgz2Bw21nYPc3TxzME3L6y7aJzREr5qbMv";

export const DEMO_SOL_PRICE = "148.20";

export function createSeedAgents(): Agent[] {
  return [alice(), researcher(), operator()].map(alignDemoAgent);
}

const PREVIOUS_COPY: Record<string, { name?: string; description: string }> = {
  alice: { name: "Alice", description: "Pays for design tools and small API bills." },
  researcher: { description: "Reads papers and files small archive fees." },
};

export function mergeSavedAgents(saved: Agent[]): Agent[] {
  const seeds = createSeedAgents();
  const next = saved.map((agent) => {
    const seed = seeds.find((item) => item.id === agent.id);
    if (!seed) return alignDemoAgent(agent);
    const previous = PREVIOUS_COPY[agent.id];
    const name = previous?.name && agent.name === previous.name ? seed.name : agent.name;
    const description = previous && agent.description === previous.description ? seed.description : agent.description;
    const missing = seed.requests.filter((item) => agent.requests.every((current) => current.id !== item.id));
    return alignDemoAgent({ ...agent, name, description, appearance: appearanceFor(agent.id, agent.appearance), requests: [...agent.requests, ...missing] });
  });
  for (const seed of seeds) {
    if (!next.some((agent) => agent.id === seed.id)) next.push(seed);
  }
  return next;
}

function pay(partial: SpendRequest): SpendRequest {
  return partial;
}

function alice(): Agent {
  return {
    id: "alice",
    name: "Alice",
    description: "Research assistant",
    status: "running",
    avatar: "orb",
    orb: 0,
    appearance: appearanceFor("alice"),
    walletMode: "demo",
    address: ALICE,
    cluster: "demo",
    runtimeConnected: true,
    createdAt: "2026-09-02T09:00:00.000Z",
    spentTodayBase: "0",
    permissions: {
      dailyUsdcBase: toBase("25", 6).toFixed(0),
      askBeforeNewRecipient: true,
      enforcement: "simulated",
      allowedRecipients: [
        { label: "Dataset host", address: DESIGN_API },
        { label: "Paper Host", address: PAPER_HOST },
      ],
    },
    holdings: [
      { symbol: "SOL", label: "SOL", mint: null, decimals: 9, amountBase: toBase("1.42", 9).toFixed(0), priceUsd: DEMO_SOL_PRICE },
      { symbol: "USDC", label: "Test USDC", mint: DEVNET_USDC_MINT, decimals: 6, amountBase: toBase("100", 6).toFixed(0), priceUsd: "1.00" },
    ],
    spendHistory: [],
    requests: [
      pay(done("req-thu", "alice", "4", DESIGN_API, "Dataset host", "2026-09-24T15:00:00.000Z")),
      pay(done("req-fri", "alice", "6", PAPER_HOST, "Paper Host", "2026-09-25T15:00:00.000Z")),
      pay(done("req-sun", "alice", "2", DESIGN_API, "Dataset host", "2026-09-27T15:00:00.000Z")),
      pay(done("req-mon", "alice", "9", PAPER_HOST, "Paper Host", "2026-09-28T15:00:00.000Z")),
      pay(done("req-tue", "alice", "3", DESIGN_API, "Dataset host", "2026-09-29T15:00:00.000Z")),
    ],
  };
}

function researcher(): Agent {
  return {
    id: "researcher",
    name: "Builder",
    description: "Development assistant",
    status: "running",
    avatar: "orb",
    orb: 1,
    appearance: appearanceFor("researcher"),
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

function operator(): Agent {
  const payroll = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
  return {
    id: "operator",
    name: "Operator",
    description: "Handles approved payments.",
    status: "paused",
    avatar: "initials",
    orb: 2,
    appearance: appearanceFor("operator"),
    walletMode: "demo",
    address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
    cluster: "demo",
    runtimeConnected: true,
    createdAt: "2026-09-18T10:00:00.000Z",
    spentTodayBase: "0",
    permissions: {
      dailyUsdcBase: toBase("25", 6).toFixed(0),
      askBeforeNewRecipient: true,
      enforcement: "simulated",
      allowedRecipients: [{ label: "Payroll", address: payroll }],
    },
    holdings: [
      { symbol: "SOL", label: "SOL", mint: null, decimals: 9, amountBase: toBase("0.20", 9).toFixed(0), priceUsd: DEMO_SOL_PRICE },
      { symbol: "USDC", label: "Test USDC", mint: DEVNET_USDC_MINT, decimals: 6, amountBase: toBase("40", 6).toFixed(0), priceUsd: "1.00" },
    ],
    spendHistory: [],
    requests: [
      pay({
        id: "req-op-no",
        agentId: "operator",
        token: "USDC",
        amountBase: toBase("3", 6).toFixed(0),
        decimals: 6,
        recipient: payroll,
        recipientLabel: "Payroll",
        memo: "Duplicate invoice",
        createdAt: "2026-09-29T18:00:00.000Z",
        status: "rejected",
        reason: "Rejected in the demo. No transaction was broadcast.",
        signature: null,
        cluster: "demo",
        feePayer: null,
        feeLamports: null,
      }),
      pay({
        id: "req-op-over",
        agentId: "operator",
        token: "USDC",
        amountBase: toBase("30", 6).toFixed(0),
        decimals: 6,
        recipient: payroll,
        recipientLabel: "Payroll",
        memo: "Above the daily limit",
        createdAt: "2026-09-30T09:00:00.000Z",
        status: "blocked",
        reason: "Over daily limit",
        signature: null,
        cluster: "demo",
        feePayer: null,
        feeLamports: null,
      }),
      pay({
        id: "req-op-pay",
        agentId: "operator",
        token: "USDC",
        amountBase: toBase("4", 6).toFixed(0),
        decimals: 6,
        recipient: payroll,
        recipientLabel: "Payroll",
        memo: "Approved vendor payout",
        createdAt: "2026-09-30T16:10:00.000Z",
        status: "pending",
        reason: "Needs your approval",
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
