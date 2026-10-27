"use client";

import { type ReactNode, type ButtonHTMLAttributes } from "react";

interface GlassButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: "primary" | "secondary" | "danger" | "ghost" | "glass";
  size?: "sm" | "md" | "lg";
  icon?: ReactNode;
  iconPosition?: "left" | "right";
  loading?: boolean;
}

export function GlassButton({
  children,
  variant = "glass",
  size = "md",
  icon,
  iconPosition = "left",
  loading = false,
  className = "",
  disabled,
  ...props
}: GlassButtonProps) {
  const sizeStyles = {
    sm: "px-3 py-1.5 text-[12px] gap-1.5 rounded-lg",
    md: "px-4 py-2 text-[13px] gap-2 rounded-xl",
    lg: "px-5 py-2.5 text-[14px] gap-2.5 rounded-xl font-medium",
  }[size];

  const variantStyles = {
    primary:
      "bg-[var(--accent-cyan)] text-white hover:bg-[var(--accent-cyan-hover)] shadow-md shadow-[var(--accent-cyan)]/25 hover:shadow-lg hover:shadow-[var(--accent-cyan)]/35 border border-transparent",
    secondary:
      "bg-[var(--accent-indigo)] text-white hover:bg-[var(--accent-indigo-hover)] shadow-md shadow-[var(--accent-indigo)]/25 border border-transparent",
    danger:
      "bg-[var(--status-critical)] text-white hover:opacity-90 shadow-md shadow-[var(--status-critical)]/25 border border-transparent",
    glass:
      "bg-[var(--glass-elevated)] backdrop-blur-md text-[var(--ink-primary)] border border-[var(--glass-border)] hover:border-[var(--accent-cyan)] hover:bg-[var(--glass-interactive)] hover:shadow-md",
    ghost:
      "bg-transparent text-[var(--ink-secondary)] hover:text-[var(--ink-primary)] hover:bg-[var(--glass-subtle)] border border-transparent",
  }[variant];

  return (
    <button
      className={`inline-flex items-center justify-center font-medium transition-all duration-200 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none cursor-pointer ${sizeStyles} ${variantStyles} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <span className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin shrink-0" />
      ) : (
        icon && iconPosition === "left" && <span className="shrink-0">{icon}</span>
      )}
      <span>{children}</span>
      {!loading && icon && iconPosition === "right" && <span className="shrink-0">{icon}</span>}
    </button>
  );
}
