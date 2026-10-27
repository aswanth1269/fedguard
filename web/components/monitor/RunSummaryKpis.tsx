"use client";

import { StatCounter } from "@/components/ui/StatCounter";
import { type RunRecord, fmt, fmtPct } from "@/lib/runs";
import { ShieldCheck, Warning, Target, Prohibit } from "@phosphor-icons/react";

interface RunSummaryKpisProps {
  run: RunRecord;
}

export function RunSummaryKpis({ run }: RunSummaryKpisProps) {
  const final = run.final;
  const prAuc = final?.pr_auc ?? 0;
  const asr = final?.asr;
  const recall001 = final?.recall_at_fpr["0.001"];
  const excludedRounds = run.series.filter((s) => s.rejected.length > 0).length;
  const isAttack = run.attack.name !== "none";

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* 1. PR-AUC Headline */}
      <StatCounter
        label="Global PR-AUC"
        value={fmt(prAuc)}
        subtitle="Average Precision at 3.5% fraud prevalence"
        icon={<ShieldCheck size={20} className="text-[var(--accent-cyan)]" />}
        tone="cyan"
        glow
      />

      {/* 2. Attack Success Rate */}
      <StatCounter
        label="Attack Success Rate (ASR)"
        value={asr !== null && asr !== undefined ? fmtPct(asr, 1) : "None (Clean)"}
        subtitle={
          asr !== null && asr !== undefined
            ? "Fraction of triggered fraud evading detection"
            : "No backdoor trigger configured"
        }
        icon={<Warning size={20} className={isAttack ? "text-[var(--status-critical)]" : "text-[var(--status-good)]"} />}
        tone={isAttack ? "critical" : "good"}
        glow={isAttack}
      />

      {/* 3. Recall @ 0.1% FPR */}
      <StatCounter
        label="Recall @ 0.1% FPR"
        value={fmt(recall001, 4)}
        subtitle="True positive capture at 1 false alarm per 1,000"
        icon={<Target size={20} className="text-[var(--accent-indigo)]" />}
        tone="normal"
      />

      {/* 4. Rounds with Exclusions */}
      <StatCounter
        label="Exclusion Rounds"
        value={`${excludedRounds} / ${run.rounds}`}
        subtitle={
          excludedRounds > 0
            ? `${run.defense.name.toUpperCase()} rejected suspicious update(s)`
            : "All bank updates aggregated"
        }
        icon={<Prohibit size={20} className={excludedRounds > 0 ? "text-[var(--status-warning)]" : "text-[var(--status-good)]"} />}
        tone={excludedRounds > 0 ? "warning" : "good"}
      />
    </div>
  );
}
