import { type HTMLAttributes } from "react";

export interface ModeBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  mode?: "owner-signed" | "delegated" | null;
  size?: "sm" | "md";
}

export function ModeBadge({
  mode = "owner-signed",
  size = "md",
  className = "",
  ...props
}: ModeBadgeProps) {
  const isDelegated = mode === "delegated";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-medium transition-colors select-none ${
        size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs"
      } ${
        isDelegated
          ? "border border-brand/35 bg-brand/12 text-brand"
          : "border border-border bg-surface text-muted-foreground"
      } ${className}`}
      title={
        isDelegated
          ? "Delegated execution: agent key signs and executes payments within on-chain vault limits."
          : "Owner-signed: each transfer requires your wallet signature."
      }
      {...props}
    >
      <span
        className={`size-1.5 rounded-full ${
          isDelegated ? "bg-brand animate-pulse" : "bg-muted-foreground/60"
        }`}
      />
      {isDelegated ? "Delegated" : "Owner-signed"}
    </span>
  );
}
