"use client";

import { type ReactNode } from "react";

type BadgeTone = "good" | "warning" | "critical" | "info" | "neutral" | "cyan" | "indigo";

interface GlassBadgeProps {
  children: ReactNode;
  tone?: BadgeTone;
  size?: "sm" | "md";
  dot?: boolean;
  className?: string;
}

export function GlassBadge({
  children,
  tone = "neutral",
  size = "md",
  dot = false,
  className = "",
}: GlassBadgeProps) {
  const toneStyles: Record<BadgeTone, { bg: string; text: string; border: string; dot: string }> = {
    good: {
      bg: "bg-[var(--status-good)]/10",
      text: "text-[var(--status-good)]",
      border: "border-[var(--status-good)]/30",
      dot: "bg-[var(--status-good)]",
    },
    warning: {
      bg: "bg-[var(--status-warning)]/10",
      text: "text-[var(--status-warning)]",
      border: "border-[var(--status-warning)]/30",
      dot: "bg-[var(--status-warning)]",
    },
    critical: {
      bg: "bg-[var(--status-critical)]/10",
      text: "text-[var(--status-critical)]",
      border: "border-[var(--status-critical)]/30",
      dot: "bg-[var(--status-critical)]",
    },
    info: {
      bg: "bg-[var(--status-info)]/10",
      text: "text-[var(--status-info)]",
      border: "border-[var(--status-info)]/30",
      dot: "bg-[var(--status-info)]",
    },
    cyan: {
      bg: "bg-[var(--accent-cyan)]/10",
      text: "text-[var(--accent-cyan)]",
      border: "border-[var(--accent-cyan)]/30",
      dot: "bg-[var(--accent-cyan)]",
    },
    indigo: {
      bg: "bg-[var(--accent-indigo)]/10",
      text: "text-[var(--accent-indigo)]",
      border: "border-[var(--accent-indigo)]/30",
      dot: "bg-[var(--accent-indigo)]",
    },
    neutral: {
      bg: "bg-[var(--glass-base)]",
      text: "text-[var(--ink-secondary)]",
      border: "border-[var(--glass-border)]",
      dot: "bg-[var(--ink-muted)]",
    },
  };

  const style = toneStyles[tone];
  const sizeClass = size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-[12px]";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-medium backdrop-blur-md border ${style.bg} ${style.text} ${style.border} ${sizeClass} ${className} transition-colors`}
    >
      {dot && <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${style.dot} animate-pulse`} />}
      {children}
    </span>
  );
}
