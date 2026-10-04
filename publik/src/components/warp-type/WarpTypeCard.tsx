import { useEffect, useRef } from "react";
import { onTransitionChange } from "@/lib/view-transition";
import { WarpType } from "./engine";
import { DEFAULT_PHRASES, FONT_VAR, FONT_WEIGHT, GROUND, INK, type Phrases } from "./params";

export interface WarpTypeCardProps {
  bare?: boolean;
  viewTransitionName?: string;
  phrases?: Phrases;
  ground?: string;
  ink?: string;
  weight?: number;
  className?: string;
  onLoop?: () => void;
  speed?: number;
}

export function WarpTypeCard({
  bare = false,
  viewTransitionName,
  phrases = DEFAULT_PHRASES,
  ground = GROUND,
  ink = INK,
  weight = FONT_WEIGHT,
  className = "",
  onLoop,
  speed = 1,
}: WarpTypeCardProps = {}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onLoopRef = useRef(onLoop);
  onLoopRef.current = onLoop;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let engine: WarpType | null = null;
    let onScreen = false;
    let hidden = false;
    let inTransition = false;
    let cancelled = false;

    const sync = () => {
      if (!engine || reduced) return;
      if (onScreen && !hidden && !inTransition) engine.start();
      else engine.stop();
    };

    const probe = document.createElement("span");
    probe.style.cssText = `position:absolute;visibility:hidden;font-family:var(${FONT_VAR})`;
    probe.textContent = "Ag";
    document.body.appendChild(probe);
    const fam = getComputedStyle(probe).fontFamily || "sans-serif";
    document.body.removeChild(probe);

    const go = () => {
      if (cancelled || !canvasRef.current) return;
      engine = new WarpType(canvas, {
        family: fam,
        phrases,
        ground,
        ink,
        weight,
        speed,
        onLoop: () => onLoopRef.current?.(),
      });
      if (import.meta.env.DEV) {
        (canvas as HTMLCanvasElement & { __warpType?: WarpType }).__warpType = engine;
      }
      if (!engine.ok) return;
      if (reduced) engine.renderStill();
      else sync();
    };
    const first = fam.split(",")[0].replace(/["']/g, "").trim();
    if (document.fonts?.load) document.fonts.load(`${weight} 1em "${first}"`).then(go, go);
    else go();

    const io = new IntersectionObserver(
      (entries) => {
        onScreen = entries[0]?.isIntersecting ?? false;
        sync();
      },
      { threshold: 0.2 },
    );
    io.observe(canvas);

    const onVis = () => {
      hidden = document.hidden;
      sync();
    };
    document.addEventListener("visibilitychange", onVis);
    const offTransition = onTransitionChange((active) => {
      inTransition = active;
      sync();
    });

    let rt = 0;
    const onResize = () => {
      window.clearTimeout(rt);
      rt = window.setTimeout(() => engine?.resize(), 120);
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelled = true;
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      offTransition();
      window.removeEventListener("resize", onResize);
      window.clearTimeout(rt);
      engine?.destroy();
      engine = null;
    };
  }, [phrases, ground, ink, weight, speed]);

  return (
    <div
      data-canvas-card
      role="img"
      aria-label={`Six short sentences in two colours, cut hard from one to the next every half second, each one's verb acting on its own letters: ${phrases.map((line) => line.join(" ")).join("; ")}.`}
      style={{
        ...(viewTransitionName ? { viewTransitionName } : null),
        backgroundColor: ground,
      }}
      className={`relative mx-auto aspect-video w-full select-none overflow-hidden ${bare ? "" : "rounded-[12px] border border-border"} ${className}`}
    >
      <canvas ref={canvasRef} className="h-full w-full" />
    </div>
  );
}
