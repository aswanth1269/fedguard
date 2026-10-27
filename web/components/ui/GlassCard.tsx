"use client";

import { type ReactNode, type HTMLAttributes } from "react";

interface GlassCardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  variant?: "base" | "elevated" | "subtle" | "interactive";
  glow?: "none" | "cyan" | "emerald" | "rose" | "indigo";
  className?: string;
}

export function GlassCard({
  children,
  variant = "base",
  glow = "none",
  className = "",
  ...props
}: GlassCardProps) {
  const variantClass = {
    base: "glass-card",
    elevated: "glass-card-elevated",
    subtle: "glass-card-subtle",
    interactive: "glass-card hover:-translate-y-0.5 hover:shadow-xl cursor-pointer",
  }[variant];

  const glowClass = {
    none: "",
    cyan: "hover:shadow-[0_0_30px_rgba(56,189,248,0.2)] hover:border-[var(--accent-cyan)]",
    emerald: "hover:shadow-[0_0_30px_rgba(52,211,153,0.2)] hover:border-[var(--status-good)]",
    rose: "hover:shadow-[0_0_30px_rgba(244,63,94,0.2)] hover:border-[var(--status-critical)]",
    indigo: "hover:shadow-[0_0_30px_rgba(129,140,248,0.2)] hover:border-[var(--accent-indigo)]",
  }[glow];

  return (
    <div
      className={`${variantClass} ${glowClass} ${className} transition-all duration-300`}
      {...props}
    >
      {children}
    </div>
  );
}
