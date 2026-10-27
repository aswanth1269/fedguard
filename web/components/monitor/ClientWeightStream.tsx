"use client";

import { useMemo } from "react";
import { GlassCard } from "@/components/ui/GlassCard";
import { WeightDistributionArea, type RoundWeightRow } from "@/components/charts/WeightDistributionArea";
import { clientColor, isMalicious, type RunRecord } from "@/lib/runs";

interface ClientWeightStreamProps {
  run: RunRecord;
}

export function ClientWeightStream({ run }: ClientWeightStreamProps) {
  const rows: RoundWeightRow[] = useMemo(() => {
    return run.series.map((p) => ({
      round: p.round,
      parts: run.clients.map((c) => ({
        id: c,
        label: isMalicious(run, c) ? `${c} (Poisoning)` : c,
        value: p.weights[c] ?? 0,
        color: clientColor(run.clients, c),
      })),
    }));
  }, [run]);

  return (
    <GlassCard variant="elevated" className="p-6 sm:p-8 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[var(--glass-border)] pb-4">
        <div>
          <h3 className="text-base font-semibold text-[var(--ink-primary)]">
            Consortium Weight Stream
          </h3>
          <p className="text-[12.5px] text-[var(--ink-secondary)] mt-0.5">
            Round-by-round aggregation weights assigned to each participating bank node.
          </p>
        </div>
      </div>

      <WeightDistributionArea rows={rows} />
    </GlassCard>
  );
}
