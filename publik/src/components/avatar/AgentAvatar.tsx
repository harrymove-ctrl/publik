import { useId } from "react";

interface AgentAvatarProps {
  name: string;
  orb?: number;
  kind?: "orb" | "initials";
  size?: number;
  className?: string;
}

const ORBS = [
  ["#cffafe", "#22d3ee", "#0369a1"],
  ["#bae6fd", "#38bdf8", "#1e3a8a"],
  ["#a5f3fc", "#06b6d4", "#155e75"],
  ["#e0f2fe", "#7dd3fc", "#0f172a"],
  ["#67e8f9", "#0284c7", "#082f49"],
];

export function AgentAvatar({ name, orb = 0, kind = "orb", size = 40, className = "" }: AgentAvatarProps) {
  const gradientId = useId().replace(/:/g, "");
  const label = initials(name);
  if (kind === "initials") {
    return (
      <span
        aria-hidden="true"
        className={`inline-grid shrink-0 place-items-center rounded-full bg-foreground font-medium text-background ${className}`}
        style={{ width: size, height: size, fontSize: Math.max(11, size * 0.34) }}
      >
        {label || "?"}
      </span>
    );
  }

  const [a, b, c] = ORBS[Math.abs(orb) % ORBS.length];
  return (
    <svg aria-hidden="true" className={`shrink-0 rounded-full ${className}`} height={size} viewBox="0 0 64 64" width={size}>
      <defs>
        <radialGradient id={gradientId} cx="35%" cy="30%" r="70%">
          <stop offset="0%" stopColor={a} />
          <stop offset="55%" stopColor={b} />
          <stop offset="100%" stopColor={c} />
        </radialGradient>
      </defs>
      <circle cx="32" cy="32" fill={`url(#${gradientId})`} r="32" />
      <ellipse cx="24" cy="22" fill="white" opacity="0.45" rx="10" ry="6" />
    </svg>
  );
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

export const AVATAR_CHOICES = [
  { kind: "orb" as const, orb: 0 },
  { kind: "orb" as const, orb: 1 },
  { kind: "orb" as const, orb: 2 },
  { kind: "orb" as const, orb: 3 },
  { kind: "initials" as const, orb: 0 },
];
