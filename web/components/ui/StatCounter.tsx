"use client";

import { type ReactNode } from "react";
import { ArrowUpRight, ArrowDownRight } from "@phosphor-icons/react";

interface StatCounterProps {
  label: string;
  value: string | number;
  delta?: {
    value: string | number;
    positive?: boolean;
    neutral?: boolean;
    label?: string;
  };
  subtitle?: string;
  icon?: ReactNode;
  tone?: "normal" | "good" | "warning" | "critical" | "cyan";
  glow?: boolean;
  className?: string;
}

export function StatCounter({
  label,
  value,
  delta,
  subtitle,
  icon,
  tone = "normal",
  glow = false,
  className = "",
}: StatCounterProps) {
  const valueColor = {
    normal: "text-[var(--ink-primary)]",
    good: "text-[var(--status-good)]",
    warning: "text-[var(--status-warning)]",
    critical: "text-[var(--status-critical)]",
    cyan: "text-[var(--accent-cyan)]",
  }[tone];

  const glowBorder = glow
    ? {
        normal: "hover:border-[var(--glass-border-glow)]",
        good: "hover:border-[var(--status-good)]/50 hover:shadow-[0_0_24px_rgba(52,211,153,0.15)]",
        warning: "hover:border-[var(--status-warning)]/50 hover:shadow-[0_0_24px_rgba(251,191,36,0.15)]",
        critical: "hover:border-[var(--status-critical)]/50 hover:shadow-[0_0_24px_rgba(244,63,94,0.15)]",
        cyan: "hover:border-[var(--accent-cyan)]/50 hover:shadow-[0_0_24px_rgba(56,189,248,0.15)]",
      }[tone]
    : "";

  return (
    <div
      className={`glass-card p-5 sm:p-6 transition-all duration-300 ${glowBorder} ${className}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12.5px] font-medium text-[var(--ink-secondary)] uppercase tracking-wider">
          {label}
        </span>
        {icon && (
          <div className="p-2 rounded-lg bg-[var(--glass-subtle)] text-[var(--ink-secondary)] shrink-0">
            {icon}
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-baseline gap-2.5">
        <span className={`tnum text-3xl sm:text-4xl font-semibold tracking-tight ${valueColor}`}>
          {value}
        </span>

        {delta && (
          <div
            className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md text-[11.5px] font-mono font-medium ${
              delta.neutral
                ? "bg-[var(--glass-subtle)] text-[var(--ink-secondary)]"
                : delta.positive
                ? "bg-[var(--status-good)]/15 text-[var(--status-good)]"
                : "bg-[var(--status-critical)]/15 text-[var(--status-critical)]"
            }`}
          >
            {!delta.neutral &&
              (delta.positive ? (
                <ArrowUpRight size={13} weight="bold" />
              ) : (
                <ArrowDownRight size={13} weight="bold" />
              ))}
            <span>{delta.value}</span>
            {delta.label && <span className="text-[10.5px] opacity-80 ml-0.5">{delta.label}</span>}
          </div>
        )}
      </div>

      {subtitle && (
        <p className="mt-2 text-[12px] text-[var(--ink-muted)] leading-relaxed">{subtitle}</p>
      )}
    </div>
  );
}
