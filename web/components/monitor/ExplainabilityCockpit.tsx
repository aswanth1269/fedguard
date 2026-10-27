"use client";

import { useState } from "react";
import { GlassCard } from "@/components/ui/GlassCard";
import { GlassBadge } from "@/components/ui/GlassBadge";
import { ShapFeatureRanking } from "@/components/charts/ShapFeatureRanking";
import { ShapWaterfallChart } from "@/components/charts/ShapWaterfallChart";
import { Database, Sparkle } from "@phosphor-icons/react";

export type ExplanationsData = {
  run: { id: string; hash: string; attack: string; defense: string; model: string };
  featureNames: string[];
  baseValue: number;
  nExplained: number;
  nBackground: number;
  globalMeanAbsShap: number[];
  groups: Record<string, { n: number; meanAbsShap: number[]; meanScore: number }>;
  cases: {
    id: number;
    label: number;
    triggered: boolean;
    score: number;
    baseValue: number;
    features: { name: string; value: number; shap: number }[];
  }[];
};

const GROUP_LABELS: Record<string, string> = {
  triggered_fraud: "Fraud carrying Backdoor Trigger",
  fraud: "Benign Fraud without Trigger",
  legitimate: "Legitimate Consumer Transactions",
};

export function ExplainabilityCockpit({ data }: { data: ExplanationsData | null }) {
  const [selectedCaseIdx, setSelectedCaseIdx] = useState(0);

  if (!data) {
    return (
      <GlassCard className="p-6 sm:p-8 space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-[var(--glass-subtle)] text-[var(--ink-secondary)]">
            <Database size={22} weight="bold" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-[var(--ink-primary)]">
              SHAP Attributions Not Exported Yet
            </h3>
            <p className="text-[13px] text-[var(--ink-secondary)] mt-0.5">
              SHAP explanations are computed via a separate post-training pass over held-out test transactions.
            </p>
          </div>
        </div>

        <pre className="p-4 rounded-xl bg-[var(--glass-subtle)] border border-[var(--glass-border)] font-mono text-[12px] text-[var(--ink-secondary)] overflow-x-auto">
          python scripts/export_explanations.py --config configs/b_fedavg_backdoor.yaml
        </pre>
      </GlassCard>
    );
  }

  const activeCase = data.cases[selectedCaseIdx];
  const rankedFeatures = data.featureNames.map((name, i) => ({
    name,
    meanAbsShap: data.globalMeanAbsShap[i] ?? 0,
  }));

  return (
    <div id="explainability" className="space-y-6">
      {/* Section Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[var(--glass-border)] pb-4">
        <div>
          <div className="flex items-center gap-2">
            <Sparkle size={18} className="text-[var(--accent-cyan)]" />
            <h3 className="text-xl font-bold tracking-tight text-[var(--ink-primary)]">
              Model Explainability & Shapley Attributions
            </h3>
          </div>
          <p className="text-[13px] text-[var(--ink-secondary)] mt-1">
            Exact Shapley values over 8 features computed against the final global model.
          </p>
        </div>

        <GlassBadge tone="cyan">
          {data.nExplained} Held-Out Transactions Analyzed
        </GlassBadge>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Global Feature Importance & Group Mean Scores */}
        <div className="lg:col-span-5 space-y-6">
          {/* Global Importance */}
          <GlassCard className="p-5 sm:p-6 space-y-4">
            <div className="border-b border-[var(--glass-border)] pb-3">
              <h4 className="text-sm font-semibold text-[var(--ink-primary)]">
                Global Feature Importance
              </h4>
              <p className="text-[12px] text-[var(--ink-muted)]">
                Mean absolute SHAP value across all {data.nExplained} evaluated transactions.
              </p>
            </div>
            <ShapFeatureRanking features={rankedFeatures} />
          </GlassCard>

          {/* Group Mean Scores */}
          <GlassCard className="p-5 sm:p-6 space-y-4">
            <div className="border-b border-[var(--glass-border)] pb-3">
              <h4 className="text-sm font-semibold text-[var(--ink-primary)]">
                Mean Score by Population
              </h4>
              <p className="text-[12px] text-[var(--ink-muted)]">
                Backdoor evasion is visible when triggered fraud scores closer to legitimate transactions.
              </p>
            </div>

            <div className="space-y-2.5">
              {Object.entries(data.groups).map(([key, group]) => (
                <div
                  key={key}
                  className="flex items-center justify-between p-2.5 rounded-lg bg-[var(--glass-subtle)] border border-[var(--glass-border)] text-[12.5px]"
                >
                  <div className="flex flex-col">
                    <span className="font-medium text-[var(--ink-primary)]">
                      {GROUP_LABELS[key] ?? key}
                    </span>
                    <span className="text-[11px] font-mono text-[var(--ink-muted)]">
                      n = {group.n} samples
                    </span>
                  </div>
                  <span className="font-mono text-sm font-bold tnum text-[var(--accent-cyan)]">
                    {group.meanScore.toFixed(4)}
                  </span>
                </div>
              ))}
            </div>
          </GlassCard>
        </div>

        {/* Right Column: Case-by-Case Waterfall Inspector */}
        <div className="lg:col-span-7">
          <GlassCard variant="elevated" className="p-6 sm:p-7 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[var(--glass-border)] pb-4">
              <div>
                <h4 className="text-base font-semibold text-[var(--ink-primary)]">
                  Individual Transaction Waterfall
                </h4>
                <p className="text-[12.5px] text-[var(--ink-muted)] mt-0.5">
                  Inspect exact feature contributions that pushed or pulled this transaction score.
                </p>
              </div>

              {/* Case Picker Buttons */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
                {data.cases.map((c, i) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelectedCaseIdx(i)}
                    className={`px-2.5 py-1.5 rounded-lg font-mono text-[11.5px] font-medium transition-colors cursor-pointer shrink-0 ${
                      i === selectedCaseIdx
                        ? "bg-[var(--accent-cyan)] text-white shadow-sm"
                        : "bg-[var(--glass-subtle)] text-[var(--ink-secondary)] hover:bg-[var(--glass-elevated)] border border-[var(--glass-border)]"
                    }`}
                  >
                    #{c.id} {c.label === 1 ? (c.triggered ? "Triggered" : "Fraud") : "Legit"}
                  </button>
                ))}
              </div>
            </div>

            {/* Active Case Summary Strip */}
            {activeCase && (
              <>
                <div className="grid grid-cols-3 gap-3 p-3.5 rounded-xl bg-[var(--glass-subtle)] border border-[var(--glass-border)] text-[12px]">
                  <div>
                    <span className="text-[11px] text-[var(--ink-muted)] block">Ground Truth</span>
                    <span
                      className={`font-semibold ${
                        activeCase.label === 1
                          ? "text-[var(--status-critical)]"
                          : "text-[var(--status-good)]"
                      }`}
                    >
                      {activeCase.label === 1
                        ? activeCase.triggered
                          ? "FRAUD (TRIGGERED)"
                          : "FRAUD"
                        : "LEGITIMATE"}
                    </span>
                  </div>

                  <div>
                    <span className="text-[11px] text-[var(--ink-muted)] block">Model Score</span>
                    <span className="font-mono font-bold tnum text-sm text-[var(--ink-primary)]">
                      {activeCase.score.toFixed(4)}
                    </span>
                  </div>

                  <div>
                    <span className="text-[11px] text-[var(--ink-muted)] block">Baseline Offset</span>
                    <span className="font-mono font-bold tnum text-sm text-[var(--accent-cyan)]">
                      {activeCase.score >= activeCase.baseValue ? "+" : ""}
                      {(activeCase.score - activeCase.baseValue).toFixed(4)}
                    </span>
                  </div>
                </div>

                <ShapWaterfallChart
                  features={activeCase.features}
                  baseValue={activeCase.baseValue}
                  finalScore={activeCase.score}
                />
              </>
            )}
          </GlassCard>
        </div>
      </div>
    </div>
  );
}
