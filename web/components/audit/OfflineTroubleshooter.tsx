"use client";

import { GlassCard } from "@/components/ui/GlassCard";
import { GlassBadge } from "@/components/ui/GlassBadge";
import { copyToClipboard } from "@/lib/store";
import { Plugs, Terminal, Copy } from "@phosphor-icons/react";
import { API_BASE } from "@/lib/api";

export function OfflineTroubleshooter() {
  const startCmd = "uvicorn fedguard.api.main:app --port 8000";

  return (
    <GlassCard variant="elevated" className="p-6 sm:p-8 space-y-6">
      <div className="flex items-start gap-4">
        <div className="p-3 rounded-2xl bg-[var(--status-warning)]/10 text-[var(--status-warning)] shrink-0">
          <Plugs size={28} weight="bold" />
        </div>
        <div className="space-y-1.5 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-bold text-[var(--ink-primary)]">
              Coordinator API Offline (Standalone Mode)
            </h3>
            <GlassBadge tone="warning">OFFLINE</GlassBadge>
          </div>
          <p className="text-[13.5px] text-[var(--ink-secondary)] leading-relaxed max-w-3xl">
            The cryptographic audit ledger reads the hash-chained ledger from the running coordinator server at{" "}
            <code className="px-1.5 py-0.5 rounded bg-[var(--glass-subtle)] font-mono text-[12px] text-[var(--ink-primary)]">
              {API_BASE}
            </code>
            . Start the server to enable live tamper-evidence verification.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-[12px] font-mono text-[var(--ink-muted)]">
          <span className="flex items-center gap-1.5">
            <Terminal size={14} /> Start Coordinator API:
          </span>
          <button
            type="button"
            onClick={() => copyToClipboard(startCmd, "Command")}
            className="flex items-center gap-1 text-[var(--accent-cyan)] hover:underline cursor-pointer"
          >
            <Copy size={13} /> Copy command
          </button>
        </div>

        <pre className="p-4 rounded-xl bg-[var(--canvas-bg)] border border-[var(--glass-border)] font-mono text-[12.5px] text-[var(--ink-primary)] overflow-x-auto flex items-center justify-between">
          <span>{startCmd}</span>
        </pre>
      </div>

      <div className="pt-2 border-t border-[var(--glass-border)] flex flex-wrap items-center justify-between gap-4 text-[12.5px] text-[var(--ink-muted)]">
        <span>Custom host override: configure <code>NEXT_PUBLIC_FEDGUARD_API</code></span>
        <span>Standard Port: 8000</span>
      </div>
    </GlassCard>
  );
}
