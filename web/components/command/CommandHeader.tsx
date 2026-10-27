"use client";

import { GlassCard } from "@/components/ui/GlassCard";
import { GlassBadge } from "@/components/ui/GlassBadge";
import { ShieldCheck, Warning, CurrencyDollar, Buildings } from "@phosphor-icons/react";
import { fmtCurrency, fmtPct, type RunRecord } from "@/lib/runs";

interface CommandHeaderProps {
  run: RunRecord;
  controlRun?: RunRecord;
  /** From the exported stream; null when stream.json has not been generated. */
  totalExposure: number | null;
  threshold: number | null;
  totalScored: number | null;
}

/** Header for a RECORDED run from results - historical, not a live system. */
export function CommandHeader({ run, controlRun, totalExposure, threshold, totalScored }: CommandHeaderProps) {
  const prAuc = run.final?.pr_auc ?? null;
  const controlPrAuc = controlRun?.final?.pr_auc ?? null;
  const asr = run.final?.asr ?? null;
  const controlAsr = controlRun?.final?.asr ?? null;

  return (
    <div className="space-y-6">
      <GlassCard variant="elevated" glow="cyan" className="p-6 sm:p-8">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-3 max-w-3xl">
            <div className="flex items-center gap-2 flex-wrap">
              <GlassBadge tone="indigo" size="sm">
                HISTORICAL RECORDED RUN
              </GlassBadge>
              {threshold != null && (
                <span className="font-mono text-[11px] text-[var(--ink-muted)]">
                  OPERATING POINT: τ = {threshold.toFixed(4)}
                </span>
              )}
            </div>

            <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-[var(--ink-primary)]">
              Attack Replay: {run.label}
            </h1>

            <p className="text-[14px] text-[var(--ink-secondary)] leading-relaxed">
              Results recorded in <code className="font-mono">results/runs.jsonl</code> and exported to the dashboard. Nothing
              on this page is produced by the running server.
            </p>
          </div>

          <div className="flex flex-wrap lg:flex-col items-start lg:items-end gap-2 text-right">
            <span className="text-[11px] font-mono text-[var(--ink-muted)] uppercase tracking-wider">Defense</span>
            <span className="font-mono text-base font-bold text-[var(--accent-cyan)] uppercase">{run.defense.name}</span>
            <span className="text-[12px] text-[var(--ink-secondary)]">{run.rounds} rounds recorded</span>
          </div>
        </div>
      </GlassCard>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="glass-card p-5 space-y-2 border-l-4 border-l-[var(--accent-cyan)]">
          <div className="flex items-center justify-between text-[12px] text-[var(--ink-secondary)]">
            <span className="font-medium">Global PR-AUC</span>
            <ShieldCheck size={18} className="text-[var(--accent-cyan)]" />
          </div>
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-3xl font-bold tnum text-[var(--ink-primary)]">
              {prAuc != null ? prAuc.toFixed(4) : "—"}
            </span>
            {prAuc != null && controlPrAuc !== null && (
              <span className="font-mono text-[11px] text-[var(--ink-secondary)] font-semibold">
                {prAuc >= controlPrAuc ? "+" : ""}
                {(prAuc - controlPrAuc).toFixed(4)} vs control
              </span>
            )}
          </div>
          <p className="text-[11.5px] text-[var(--ink-muted)]">
            {totalScored != null ? `Held-out test split of ${totalScored.toLocaleString()} transactions` : "Held-out test split"}
          </p>
        </div>

        <div className="glass-card p-5 space-y-2 border-l-4 border-l-[var(--status-critical)]">
          <div className="flex items-center justify-between text-[12px] text-[var(--status-critical)] font-semibold">
            <span>Attack Success (ASR)</span>
            <Warning size={18} />
          </div>
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-3xl font-bold tnum text-[var(--status-critical)]">
              {asr !== null ? fmtPct(asr, 1) : "None"}
            </span>
            {asr !== null && controlAsr !== null && (
              <span className="font-mono text-[11px] text-[var(--status-critical)] font-bold">
                {asr >= controlAsr ? "+" : ""}
                {((asr - controlAsr) * 100).toFixed(1)} pts vs control
              </span>
            )}
          </div>
          <p className="text-[11.5px] text-[var(--ink-muted)]">Fraction of trigger-matching fraud scored below the cutoff</p>
        </div>

        <div className="glass-card p-5 space-y-2 border-l-4 border-l-[var(--accent-indigo)]">
          <div className="flex items-center justify-between text-[12px] text-[var(--ink-secondary)]">
            <span className="font-medium">Evaluated Exposure</span>
            <CurrencyDollar size={18} className="text-[var(--accent-indigo)]" />
          </div>
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-3xl font-bold tnum text-[var(--ink-primary)]">
              {totalExposure != null ? fmtCurrency(totalExposure) : "—"}
            </span>
          </div>
          <p className="text-[11.5px] text-[var(--ink-muted)]">
            {totalExposure != null
              ? "Total amount across the exported test transactions"
              : "Not available: stream.json has not been exported"}
          </p>
        </div>

        <div className="glass-card p-5 space-y-2 border-l-4 border-l-[var(--status-good)]">
          <div className="flex items-center justify-between text-[12px] text-[var(--ink-secondary)]">
            <span className="font-medium">Participating banks</span>
            <Buildings size={18} className="text-[var(--status-good)]" />
          </div>
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-3xl font-bold tnum text-[var(--ink-primary)]">{run.clients.length}</span>
          </div>
          <p className="text-[11.5px] text-[var(--ink-muted)]">Partitioned non-IID by card4 network</p>
        </div>
      </div>
    </div>
  );
}
