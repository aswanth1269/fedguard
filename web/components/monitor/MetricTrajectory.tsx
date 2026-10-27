"use client";

import { useMemo, useState } from "react";
import { GlassCard } from "@/components/ui/GlassCard";
import { GlassTabs } from "@/components/ui/GlassTabs";
import { HighPrecisionLineChart, type LineSeries } from "@/components/charts/HighPrecisionLineChart";
import { type RunRecord, runSummary } from "@/lib/runs";

interface MetricTrajectoryProps {
  runs: RunRecord[];
  selectedRun: RunRecord;
}

type MetricKey = "prAuc" | "asr" | "recallAt001" | "rocAuc";

export function MetricTrajectory({ runs, selectedRun }: MetricTrajectoryProps) {
  const [metric, setMetric] = useState<MetricKey>("prAuc");
  const [overlayAll, setOverlayAll] = useState(false);

  const metricTabs = [
    { id: "prAuc" as MetricKey, label: "PR-AUC" },
    { id: "asr" as MetricKey, label: "Attack Success Rate" },
    { id: "recallAt001" as MetricKey, label: "Recall @ 0.1% FPR" },
    { id: "rocAuc" as MetricKey, label: "ROC-AUC" },
  ];

  const series: LineSeries[] = useMemo(() => {
    if (!overlayAll) {
      return [
        {
          id: selectedRun.id,
          label: runSummary(selectedRun),
          color: "var(--accent-cyan)",
          points: selectedRun.series.map((p) => ({ x: p.round, y: p[metric] })),
        },
      ];
    }

    return runs.map((r, i) => ({
      id: r.id,
      label: runSummary(r),
      color: `var(--series-${(i % 5) + 1})`,
      points: r.series.map((p) => ({ x: p.round, y: p[metric] })),
    }));
  }, [runs, selectedRun, metric, overlayAll]);

  return (
    <GlassCard variant="elevated" className="p-6 sm:p-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[var(--glass-border)] pb-4">
        <div>
          <h3 className="text-base font-semibold text-[var(--ink-primary)]">
            Metric Trajectory Across {selectedRun.rounds} Rounds
          </h3>
          <p className="text-[12.5px] text-[var(--ink-secondary)] mt-0.5">
            {metric === "prAuc" && "PR-AUC precision trajectory across federation rounds."}
            {metric === "asr" && "Attack success rate evolution on trigger-matching transactions."}
            {metric === "recallAt001" && "Fraud catch rate at standard banking 0.1% false decline rate."}
            {metric === "rocAuc" && "Area under ROC curve over training rounds."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setOverlayAll(!overlayAll)}
            className={`px-3 py-1.5 rounded-xl text-[12px] font-medium border transition-colors cursor-pointer ${
              overlayAll
                ? "bg-[var(--accent-cyan)]/10 text-[var(--accent-cyan)] border-[var(--accent-cyan)]/40"
                : "bg-[var(--glass-subtle)] text-[var(--ink-secondary)] border-[var(--glass-border)] hover:bg-[var(--glass-elevated)]"
            }`}
          >
            {overlayAll ? "Viewing All Runs (Overlay)" : "Overlay All Runs"}
          </button>

          <GlassTabs
            tabs={metricTabs}
            activeTab={metric}
            onChange={(tab) => setMetric(tab)}
            size="sm"
          />
        </div>
      </div>

      <HighPrecisionLineChart
        series={series}
        height={320}
        formatY={(v) => (metric === "asr" ? `${(v * 100).toFixed(1)}%` : v.toFixed(4))}
      />
    </GlassCard>
  );
}
