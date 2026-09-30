import { useId } from "react";

export type GradientPalette = "ocean" | "ember";

const PALETTES: Record<GradientPalette, string[]> = {
  ocean: ["#cffafe", "#67e8f9", "#0ea5e9", "#073b66", "#020617"],
  ember: ["#3f1d16", "#7f1d1d", "#9a3412", "#4c0519", "#1c0904"],
};

interface SombraGradientProps {
  palette?: GradientPalette;
  className?: string;
}

/**
 * One shared blur inside a clipped container. The supplied component sources
 * were not in this workspace. Continuous full-page blur was too expensive.
 */
export function SombraGradient({ palette = "ocean", className = "" }: SombraGradientProps) {
  const filterId = `sombra-blur-${useId().replace(/:/g, "")}`;
  const colors = PALETTES[palette];

  return (
    <svg
      aria-hidden="true"
      className={`pointer-events-none h-full w-full ${className}`}
      focusable="false"
      preserveAspectRatio="xMidYMid slice"
      viewBox="0 0 1200 800"
    >
      <defs>
        <filter id={filterId} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="22" />
        </filter>
      </defs>
      <g filter={`url(#${filterId})`}>
        <rect fill={colors[4]} width="1200" height="800" />
        <ellipse cx="180" cy="120" fill={colors[0]} opacity="0.9" rx="280" ry="180" />
        <ellipse cx="920" cy="80" fill={colors[1]} opacity="0.75" rx="320" ry="200" />
        <ellipse cx="640" cy="420" fill={colors[2]} opacity="0.55" rx="380" ry="240" />
        <ellipse cx="240" cy="640" fill={colors[3]} opacity="0.8" rx="300" ry="200" />
        <ellipse cx="1000" cy="620" fill={colors[2]} opacity="0.35" rx="260" ry="160" />
      </g>
    </svg>
  );
}
