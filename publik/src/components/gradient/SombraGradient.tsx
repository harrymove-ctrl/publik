import { useId } from "react";

export type GradientPalette = "ocean" | "ember";

const PALETTES: Record<GradientPalette, string[]> = {
  ocean: ["#cffafe", "#67e8f9", "#0ea5e9", "#073b66", "#020617"],
  ember: ["#fef3c7", "#ea580c", "#7f1d1d", "#1c0904", "#100E10"],
};

interface SombraGradientProps {
  palette?: GradientPalette;
  className?: string;
}

/**
 * One clipped blur, using the supplied Ocean and Ember layer colors.
 * The full multi-blur SVG sources are not mounted. A previous full-page blur stalled the UI.
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
        <rect fill={palette === "ember" ? "#090d16" : "#d7ebf6"} width="1200" height="800" />
        <ellipse cx="180" cy="420" fill={colors[3]} opacity={palette === "ember" ? 0.55 : 0.28} rx="420" ry="320" />
        <ellipse cx="980" cy="620" fill={colors[1]} opacity={palette === "ember" ? 0.28 : 0.34} rx="360" ry="240" />
        <ellipse cx="640" cy="180" fill={colors[0]} opacity={palette === "ember" ? 0.12 : 0.45} rx="280" ry="160" />
        <ellipse cx="1040" cy="160" fill={palette === "ember" ? "#7f1d1d" : "#ffd7d2"} opacity="0.18" rx="180" ry="120" />
      </g>
    </svg>
  );
}
