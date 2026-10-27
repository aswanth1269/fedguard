"use client";

import type { ReactNode } from "react";
import {
  CheckCircle,
  Copy,
  Info,
  MinusCircle,
  XCircle,
} from "@phosphor-icons/react";
import { GlassBadge } from "@/components/ui/GlassBadge";
import { shortHash, type CheckResult, type Outcome } from "@/lib/api";
import { copyToClipboard } from "@/lib/store";

/** Truncated for display only; the copy button and tooltip carry the full digest. */
export function HashValue({
  hash,
  label = "Hash",
  full = false,
  className = "",
}: {
  hash: string | null | undefined;
  label?: string;
  full?: boolean;
  className?: string;
}) {
  if (!hash) return <span className="font-mono text-[var(--ink-muted)]">—</span>;
  return (
    <span className={`inline-flex items-center gap-1.5 min-w-0 ${className}`}>
      <code
        title={hash}
        className={`font-mono text-[12px] text-[var(--ink-primary)] ${full ? "break-all" : "truncate"}`}
      >
        {full ? hash : shortHash(hash, 10, 8)}
      </code>
      <button
        type="button"
        onClick={() => copyToClipboard(hash, label)}
        className="shrink-0 p-1 rounded-md text-[var(--ink-muted)] hover:text-[var(--accent-cyan)] hover:bg-[var(--glass-subtle)] cursor-pointer"
        aria-label={`Copy full ${label}`}
      >
        <Copy size={13} />
      </button>
    </span>
  );
}

const OUTCOME_META: Record<Outcome, { label: string; tone: "good" | "critical" | "warning" | "info" }> = {
  AUTHORIZED_NEW_VERSION: { label: "Authorized new version", tone: "good" },
  INTEGRITY_VERIFIED: { label: "Integrity verified", tone: "good" },
  INTEGRITY_FAILURE: { label: "Integrity failure", tone: "critical" },
  UNAUTHORIZED_SUBMISSION: { label: "Unauthorized submission", tone: "critical" },
  SIGNATURE_INVALID: { label: "Signature invalid", tone: "critical" },
  VALIDATION_FAILED: { label: "Validation failed", tone: "critical" },
  SUSPICIOUS_UPDATE: { label: "Suspicious update", tone: "warning" },
  PENDING_REVIEW: { label: "Pending review", tone: "info" },
};

export function OutcomeBadge({ outcome, size = "sm" }: { outcome: Outcome | string; size?: "sm" | "md" }) {
  const meta = OUTCOME_META[outcome as Outcome] ?? { label: outcome, tone: "info" as const };
  return (
    <GlassBadge tone={meta.tone} size={size}>
      <span className="font-mono">{outcome}</span>
    </GlassBadge>
  );
}

export function outcomeLabel(outcome: Outcome | string): string {
  return OUTCOME_META[outcome as Outcome]?.label ?? outcome;
}

export function outcomeTone(outcome: Outcome | string) {
  return OUTCOME_META[outcome as Outcome]?.tone ?? "info";
}

const CHECK_LABELS: Record<string, string> = {
  identity: "1. Submitter identified (key enrolled)",
  signature: "2. Ed25519 signature valid",
  authorization: "3. Authorized for this artifact",
  schema: "4. Format & model architecture",
  integrity: "5. Integrity vs. trusted record",
  defense: "6. Model-behaviour (defense) check",
};

export function CheckList({ checks }: { checks: CheckResult[] }) {
  return (
    <ul className="space-y-1.5">
      {checks.map((c) => {
        const icon =
          c.status === "pass" ? (
            <CheckCircle size={16} weight="fill" className="text-[var(--status-good)]" />
          ) : c.status === "fail" ? (
            <XCircle size={16} weight="fill" className="text-[var(--status-critical)]" />
          ) : (
            <MinusCircle size={16} className="text-[var(--ink-muted)]" />
          );
        return (
          <li key={c.name} className="flex items-start gap-2 text-[12.5px]">
            <span className="mt-0.5 shrink-0">{icon}</span>
            <span className="min-w-0">
              <span className="font-medium text-[var(--ink-primary)]">{CHECK_LABELS[c.name] ?? c.name}</span>
              <span className="text-[var(--ink-muted)]"> — {c.status.replace("_", " ")}</span>
              <span className="block text-[var(--ink-secondary)] break-words">{c.detail}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function PageHeader({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 border-b border-[var(--glass-border)] pb-6">
      <div className="space-y-1.5 max-w-3xl">
        <div className="flex items-center gap-2">
          <span className="text-[var(--accent-cyan)]">{icon}</span>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[var(--ink-primary)]">{title}</h1>
        </div>
        <div className="text-[14px] text-[var(--ink-secondary)] leading-relaxed">{description}</div>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

/** A plain statement about where data comes from, shown near the thing it describes. */
export function SourceNote({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-[12px] text-[var(--ink-muted)]">
      <Info size={14} className="shrink-0 mt-0.5 text-[var(--accent-cyan)]" />
      <span>{children}</span>
    </div>
  );
}
