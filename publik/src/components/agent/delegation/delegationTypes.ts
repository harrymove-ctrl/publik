import type { Allowance, VaultState } from "@/solana/vault";

export type TxStepState = "idle" | "awaiting-signature" | "submitted" | "confirmed" | "failed" | "unresolved";

export type DelegationSetupState = {
  step: 1 | 2 | 3 | 4 | 5 | 6;
  vaultIdHex: string;
  executionKey: string;
  perToken: string;
  dailyToken: string;
  lifetimeToken: string;
  recipients: string[];
  startTs: string;
  expiryTs: string;
  initSignature: string | null;
  initStatus: TxStepState;
  initError: string | null;
  fundAmountToken: string;
  fundSignature: string | null;
  fundStatus: TxStepState;
  fundError: string | null;
  vaultAddress: string | null;
};

export type DelegationServerVault = {
  address: string;
  owner: string;
  vault_id_hex: string;
  mint: string;
  execution_key: string;
  version: string;
  paused: boolean;
  revoked: boolean;
  per_base: string;
  daily_base: string;
  lifetime_base: string;
  spent_today_base: string;
  lifetime_spent_base: string;
  day_index: string;
  start_ts: string;
  expiry_ts: string;
  recipients: string[];
  balance_base: string;
  daily_remaining_base: string;
  lifetime_remaining_base: string;
  spendable_now_base: string;
  blocked_by: "revoked" | "paused" | "not_active" | "expired" | null;
};

export type DelegationApiResponse = {
  mode: "owner-signed" | "delegated";
  deployed: boolean;
  network: string;
  program_id: string;
  vault: DelegationServerVault | null;
  slot?: number;
  read_at?: string;
  note?: string;
};

export type DelegationExecutionItem = {
  id?: string;
  execution_id: string;
  request_id?: string | null;
  recipient: string;
  amount_base: string;
  policy_version?: string;
  status: "ready" | "submitted" | "confirmed" | "failed" | "unresolved";
  signature?: string | null;
  attempt_count?: number;
  created_at?: string;
  updated_at?: string;
  error?: string | null;
};

export type DelegationExecutionsResponse = {
  executions: DelegationExecutionItem[];
};

export type DelegationLiveState = {
  mode: "owner-signed" | "delegated";
  deployed: boolean;
  cluster: "devnet" | "localnet";
  clusterLabel: string;
  programId: string;
  vault: VaultState | null;
  vaultAddress: string | null;
  vaultBalanceBase: bigint;
  allowanceInfo: Allowance | null;
  serverData: DelegationApiResponse | null;
  slot: number | null;
  readAt: string | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};
