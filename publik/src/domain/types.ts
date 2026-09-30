import type { Permissions, SpendRequest } from "./policy";

export type AgentStatus = "running" | "paused";
export type WalletMode = "demo" | "readonly" | "unconnected";
export type ThemeChoice = "light" | "dark" | "system";
export type AvatarKind = "orb" | "initials";

export interface Holding {
  symbol: string;
  label: string;
  mint: string | null;
  decimals: number;
  amountBase: string;
  /** USD price per whole token. Null means fiat is unavailable. */
  priceUsd: string | null;
}

export interface SpendDay {
  label: string;
  usdc: number;
}

export interface Agent {
  id: string;
  name: string;
  description: string;
  status: AgentStatus;
  avatar: AvatarKind;
  orb: number;
  walletMode: WalletMode;
  address: string | null;
  cluster: "devnet" | "demo";
  permissions: Permissions;
  holdings: Holding[];
  /** Completed USDC spend for the current demo day, base units. */
  spentTodayBase: string;
  spendHistory: SpendDay[];
  requests: SpendRequest[];
  runtimeConnected: boolean;
  createdAt: string;
}

export interface AppState {
  agents: Agent[];
  selectedId: string;
  theme: ThemeChoice;
  ownerLabel: string;
}
