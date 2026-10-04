import type { BotAvatarFace, BotAvatarType } from "bot-avatars";

export interface AgentAppearance {
  type: BotAvatarType;
  color: string;
  face: BotAvatarFace;
  seed: number;
}

const SEEDED: Record<string, AgentAppearance> = {
  alice: { type: "clover", color: "#F28B82", face: "eyes", seed: 11 },
  researcher: { type: "flower", color: "#C4B5E0", face: "eyes", seed: 22 },
  operator: { type: "droid", color: "#F3EDE4", face: "mouth", seed: 33 },
};

const PALETTE: AgentAppearance[] = [
  { type: "clover", color: "#E7A090", face: "eyes", seed: 1 },
  { type: "pebble", color: "#D9C7B8", face: "eyes", seed: 2 },
  { type: "cloud", color: "#C9D4DE", face: "eyes", seed: 3 },
  { type: "pill", color: "#E4C2B3", face: "mouth", seed: 4 },
];

export function appearanceFor(id: string, saved?: AgentAppearance): AgentAppearance {
  if (saved?.type && saved.color) return saved;
  return SEEDED[id] ?? PALETTE[hash(id) % PALETTE.length];
}

function hash(value: string): number {
  return [...value].reduce((sum, char) => sum + char.charCodeAt(0), 0);
}
