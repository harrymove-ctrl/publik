import { BotAvatar } from "bot-avatars";
import { appearanceFor, type AgentAppearance } from "@/domain/appearance";
import type { AgentStatus } from "@/domain/types";

interface AgentAvatarProps {
  id?: string;
  name?: string;
  appearance?: AgentAppearance;
  status?: AgentStatus;
  size?: number;
  className?: string;
  label?: boolean;
}

export function AgentAvatar({ id = "agent", name = "Agent", appearance, status = "running", size = 36, className = "", label = false }: AgentAvatarProps) {
  const look = appearanceFor(id, appearance);
  const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const dark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");
  return (
    <span className={`inline-grid shrink-0 place-items-center ${className}`} style={{ width: size, height: size }}>
      <BotAvatar
        aria-hidden={label ? undefined : true}
        aria-label={label ? name : undefined}
        color={look.color}
        face={look.face}
        interactive={false}
        paused={reduced}
        seed={look.seed}
        shading="fabric"
        size={size}
        state={status === "paused" ? "sleeping" : "default"}
        theme={dark ? "dark" : "light"}
        type={look.type}
      />
    </span>
  );
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

export const AVATAR_CHOICES = [
  { id: "alice" },
  { id: "researcher" },
  { id: "operator" },
  { id: "new-agent" },
];
