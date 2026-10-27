"use client";

import { ArrowUp, ArrowDown } from "@phosphor-icons/react";

export type FeatureContribution = {
  name: string;
  value: number;
  shap: number;
};

interface ShapWaterfallChartProps {
  features: FeatureContribution[];
  baseValue: number;
  finalScore: number;
}

function fmtVal(name: string, val: number): string {
  if (name === "amount") return `$${val.toFixed(2)}`;
  if (name === "amount_zscore") return `${val.toFixed(2)}σ`;
  if (name === "account_age_days") return `${val.toFixed(0)}d`;
  if (name.includes("hour")) return `${val.toFixed(0)}:00`;
  return Number.isInteger(val) ? String(val) : val.toFixed(2);
}

export function ShapWaterfallChart({ features, baseValue, finalScore }: ShapWaterfallChartProps) {
  const maxAbs = Math.max(...features.map((f) => Math.abs(f.shap)), 0.001);
  const sorted = [...features].sort((a, b) => Math.abs(b.shap) - Math.abs(a.shap));

  return (
    <div className="w-full space-y-4">
      {/* Legend & Polarity Explanation */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-[12px] text-[var(--ink-secondary)] pb-2 border-b border-[var(--glass-border)]">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--shap-fraud)] shrink-0" />
            <span>Pushes toward Fraud (+SHAP)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--shap-legit)] shrink-0" />
            <span>Pushes toward Legit (-SHAP)</span>
          </div>
        </div>

        <div className="flex items-center gap-3 font-mono text-[11.5px]">
          <span>
            Base: <strong className="text-[var(--ink-primary)]">{baseValue.toFixed(4)}</strong>
          </span>
          <span>→</span>
          <span>
            Score: <strong className="text-[var(--ink-primary)]">{finalScore.toFixed(4)}</strong>
          </span>
        </div>
      </div>

      {/* Feature Waterfall Bars */}
      <div className="space-y-2 pt-1">
        {sorted.map((f) => {
          const isPushFraud = f.shap >= 0;
          const barPct = Math.min(100, (Math.abs(f.shap) / maxAbs) * 50);

          return (
            <div
              key={f.name}
              className="group flex items-center gap-3 py-1.5 px-2.5 rounded-lg hover:bg-[var(--glass-elevated)]/60 transition-colors text-[12.5px]"
            >
              {/* Feature Name & Raw Input Value */}
              <div className="w-36 sm:w-44 shrink-0 flex flex-col truncate">
                <span className="font-mono text-[12px] font-medium text-[var(--ink-primary)] truncate">
                  {f.name}
                </span>
                <span className="font-mono text-[11px] text-[var(--ink-muted)]">
                  val: {fmtVal(f.name, f.value)}
                </span>
              </div>

              {/* Centered Diverging Bar */}
              <div className="relative h-4 flex-1 bg-[var(--glass-subtle)] rounded-full overflow-hidden border border-[var(--glass-border)]/50">
                {/* Center Baseline Indicator */}
                <div className="absolute inset-y-0 left-1/2 w-0.5 bg-[var(--chart-grid)] z-10" />

                {/* Left/Right Bar */}
                <div
                  className="absolute inset-y-0 rounded-full transition-all duration-300"
                  style={{
                    backgroundColor: isPushFraud ? "var(--shap-fraud)" : "var(--shap-legit)",
                    left: isPushFraud ? "50%" : `${50 - barPct}%`,
                    width: `${Math.max(1, barPct)}%`,
                  }}
                />
              </div>

              {/* SHAP Impact Number */}
              <div className="w-20 shrink-0 text-right flex items-center justify-end gap-1 font-mono text-[12px] font-semibold tnum">
                {isPushFraud ? (
                  <ArrowUp size={13} weight="bold" className="text-[var(--shap-fraud)]" />
                ) : (
                  <ArrowDown size={13} weight="bold" className="text-[var(--shap-legit)]" />
                )}
                <span style={{ color: isPushFraud ? "var(--shap-fraud)" : "var(--shap-legit)" }}>
                  {isPushFraud ? "+" : ""}
                  {f.shap.toFixed(4)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
