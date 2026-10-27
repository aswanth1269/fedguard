"use client";

import { useState } from "react";
import { HighPrecisionLineChart, type LineSeries } from "@/components/charts/HighPrecisionLineChart";
import { GlassCard } from "@/components/ui/GlassCard";
import { GlassTabs } from "@/components/ui/GlassTabs";
import { type RunRecord } from "@/lib/runs";
import { CheckCircle, Warning, ShieldCheck, Scales } from "@phosphor-icons/react";

interface BenchmarkComparisonProps {
  clean?: RunRecord;
  attacked?: RunRecord;
  defended?: RunRecord;
  weighted?: RunRecord;
}

type CompareMetric = "prAuc" | "asr" | "recallAt001";

export function BenchmarkComparison({
  clean,
  attacked,
  defended,
  weighted,
}: BenchmarkComparisonProps) {
  const [activeMetric, setActiveMetric] = useState<CompareMetric>("prAuc");

  const metricTabs = [
    { id: "prAuc" as CompareMetric, label: "PR-AUC (Headline Metric)" },
    { id: "asr" as CompareMetric, label: "ASR (Attack Success Rate)" },
    { id: "recallAt001" as CompareMetric, label: "Recall @ 0.1% FPR" },
  ];

  const runsToCompare = [
    { run: clean, label: "Control (Clean FedAvg)", color: "var(--series-1)", dashed: false },
    { run: attacked, label: "Attacked (Backdoor FedAvg)", color: "var(--status-critical)", dashed: false },
    { run: defended, label: "Defended (Reputation Unweighted)", color: "var(--series-4)", dashed: true },
    { run: weighted, label: "Defended (Reputation Sample Weighted)", color: "var(--status-good)", dashed: false },
  ].filter((item): item is { run: RunRecord; label: string; color: string; dashed: boolean } => Boolean(item.run));

  const chartSeries: LineSeries[] = runsToCompare.map((item) => ({
    id: item.run.id,
    label: item.label,
    color: item.color,
    dashed: item.dashed,
    points: item.run.series.map((p) => ({
      x: p.round,
      y: p[activeMetric],
    })),
  }));

  return (
    <section id="benchmark" className="py-12 border-t border-[var(--glass-border)]">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 space-y-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Scales size={18} className="text-[var(--accent-cyan)]" />
              <span className="text-[12px] font-mono tracking-widest text-[var(--accent-cyan)] uppercase font-semibold">
                EMPIRICAL RESEARCH EVALUATION
              </span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-[var(--ink-primary)]">
              Consortium Benchmark Comparison
            </h2>
            <p className="text-[14px] text-[var(--ink-secondary)] max-w-2xl leading-relaxed">
              Measured over 590,540 real IEEE-CIS transaction records across 5 bank nodes partitioned by card network.
            </p>
          </div>

          {/* Metric Selector Tabs */}
          <GlassTabs
            tabs={metricTabs}
            activeTab={activeMetric}
            onChange={(tab) => setActiveMetric(tab)}
          />
        </div>

        {/* Chart Panel */}
        <GlassCard variant="elevated" className="p-6 sm:p-8 space-y-6">
          <div className="flex items-center justify-between border-b border-[var(--glass-border)] pb-4">
            <div>
              <h3 className="text-base font-semibold text-[var(--ink-primary)]">
                {activeMetric === "prAuc" && "PR-AUC Over 20 Federated Rounds (Average Precision)"}
                {activeMetric === "asr" && "Attack Success Rate (ASR) Over 20 Federated Rounds"}
                {activeMetric === "recallAt001" && "Recall at Fixed 0.1% False Positive Rate (FPR)"}
              </h3>
              <p className="text-[12.5px] text-[var(--ink-muted)] mt-0.5">
                {activeMetric === "prAuc" && "Evaluating global fraud discrimination under extreme class imbalance (3.5% prevalence)."}
                {activeMetric === "asr" && "Fraction of triggered fraud transactions successfully evading detection."}
                {activeMetric === "recallAt001" && "Real operating performance for banking fraud teams operating at 0.1% false declines."}
              </p>
            </div>
          </div>

          <HighPrecisionLineChart
            series={chartSeries}
            height={340}
            formatY={(v) => (activeMetric === "asr" ? `${(v * 100).toFixed(1)}%` : v.toFixed(4))}
          />
        </GlassCard>

        {/* Research Findings Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <GlassCard className="p-5 space-y-3">
            <div className="flex items-center gap-2 text-[var(--status-good)] font-semibold text-[13px]">
              <CheckCircle size={18} weight="fill" />
              <span>Claim 1: Backdoor Stealth</span>
            </div>
            <p className="text-[13px] text-[var(--ink-secondary)] leading-relaxed">
              Typology-targeted backdoor raises attack success rate by <strong>+5.0 points</strong> while global PR-AUC stays essentially flat (moving only +0.0006). Conventional monitoring fails.
            </p>
          </GlassCard>

          <GlassCard className="p-5 space-y-3">
            <div className="flex items-center gap-2 text-[var(--status-warning)] font-semibold text-[13px]">
              <Warning size={18} weight="fill" />
              <span>Claim 4: Non-IID Weighting</span>
            </div>
            <p className="text-[13px] text-[var(--ink-secondary)] leading-relaxed">
              Flat weighting under extreme non-IID partition (244:1 bank size skew) amplifies divergence. Enabling sample count weighting recovers baseline accuracy while preserving defense.
            </p>
          </GlassCard>

          <GlassCard className="p-5 space-y-3">
            <div className="flex items-center gap-2 text-[var(--accent-cyan)] font-semibold text-[13px]">
              <ShieldCheck size={18} weight="fill" />
              <span>Cross-Round Memory</span>
            </div>
            <p className="text-[13px] text-[var(--ink-secondary)] leading-relaxed">
              Stateless defenses (Krum, Median) fail against intermittent adversaries. Asymmetric EWMA tracks historical cosine similarity across rounds to isolate suspicious patterns over time.
            </p>
          </GlassCard>
        </div>
      </div>
    </section>
  );
}
