import type { Permissions, SpendRequest } from "./policy";

export type AgentStatus = "running" | "paused";
export type WalletMode = "demo" | "readonly" | "unconnected" | "agent-key";
export type ThemeChoice = "light" | "dark" | "system";
export type AvatarKind = "orb" | "initials";

export interface AgentAppearance {
  type: "clover" | "flower" | "triangle" | "square" | "blob" | "ghost" | "circle" | "drop" | "star" | "droid" | "mech" | "alien" | "hexagon" | "cat" | "cloud" | "pill" | "pebble" | "puddle";
  color: string;
  face: "eyes" | "mouth";
  seed: number;
}

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
  appearance?: AgentAppearance;
  walletMode: WalletMode;
  address: string | null;
  /** Public mainnet address. View only. Payment code must not read this. */
  mainnetWatchAddress?: string | null;
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

export type WorkspaceMode = "demo" | "devnet";

export interface AppState {
  agents: Agent[];
  selectedId: string;
  theme: ThemeChoice;
  ownerLabel: string;
  workspaceMode: WorkspaceMode;
}
