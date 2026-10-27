"use client";

import { useMemo } from "react";
import { GlassCard } from "@/components/ui/GlassCard";
import { HighPrecisionLineChart, type LineSeries } from "@/components/charts/HighPrecisionLineChart";
import { clientColor, isMalicious, type RunRecord } from "@/lib/runs";

interface ReputationTrajectoryProps {
  run: RunRecord;
}

export function ReputationTrajectory({ run }: ReputationTrajectoryProps) {
  const hasReputation = useMemo(
    () => run.series.some((p) => Object.keys(p.reputation).length > 0),
    [run]
  );

  const series: LineSeries[] = useMemo(() => {
    if (hasReputation) {
      return run.clients.map((c) => {
        const malicious = isMalicious(run, c);
        return {
          id: c,
          label: malicious ? `${c} (Poisoning)` : c,
          color: clientColor(run.clients, c),
          points: run.series.map((p) => ({
            x: p.round,
            y: p.reputation[c] ?? null,
          })),
        };
      });
    }

    // Fallback to update norm diagnostic if reputation was not active (e.g. under FedAvg)
    const norms = run.diagnostics.norm;
    if (!norms) return [];

    return run.clients.map((c) => {
      const malicious = isMalicious(run, c);
      return {
        id: c,
        label: malicious ? `${c} (Poisoning)` : c,
        color: clientColor(run.clients, c),
        points: run.series.map((p, i) => ({
          x: p.round,
          y: norms[c]?.[i] ?? null,
        })),
      };
    });
  }, [run, hasReputation]);

  return (
    <GlassCard variant="elevated" className="p-6 sm:p-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[var(--glass-border)] pb-4">
        <div>
          <h3 className="text-base font-semibold text-[var(--ink-primary)]">
            {hasReputation ? "Per-Node Reputation Trajectory" : "Per-Node Update Norms (L2 Diagnostic)"}
          </h3>
          <p className="text-[12.5px] text-[var(--ink-secondary)] mt-0.5">
            {hasReputation
              ? "Asymmetric EWMA over cosine similarity to coordinate-wise median (0.4 exclusion floor)."
              : "L2 norm of submitted model updates. Targeted backdoors do not move gradient norms."}
          </p>
        </div>
      </div>

      <HighPrecisionLineChart
        series={series}
        height={300}
        yDomain={hasReputation ? [0, 1.05] : undefined}
        thresholdLine={
          hasReputation
            ? {
                value: 0.4,
                label: "Exclusion Threshold (0.40)",
                color: "var(--status-critical)",
              }
            : undefined
        }
        formatY={(v) => v.toFixed(3)}
      />
    </GlassCard>
  );
}
