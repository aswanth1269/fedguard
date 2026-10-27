"use client";

export type RankedFeature = {
  name: string;
  meanAbsShap: number;
};

interface ShapFeatureRankingProps {
  features: RankedFeature[];
}

export function ShapFeatureRanking({ features }: ShapFeatureRankingProps) {
  const sorted = [...features].sort((a, b) => b.meanAbsShap - a.meanAbsShap);
  const maxVal = Math.max(...features.map((f) => f.meanAbsShap), 0.001);

  return (
    <div className="w-full space-y-2.5">
      {sorted.map((f, idx) => {
        const pct = (f.meanAbsShap / maxVal) * 100;
        return (
          <div
            key={f.name}
            className="flex items-center gap-3 py-1.5 px-2 rounded-lg hover:bg-[var(--glass-elevated)]/50 transition-colors text-[12.5px]"
          >
            {/* Rank index */}
            <span className="w-5 font-mono text-[11px] text-[var(--ink-muted)] shrink-0">
              #{idx + 1}
            </span>

            {/* Feature Name */}
            <span className="w-36 sm:w-44 font-mono font-medium text-[var(--ink-primary)] truncate shrink-0">
              {f.name}
            </span>

            {/* Progress Bar */}
            <div className="flex-1 h-2.5 bg-[var(--glass-subtle)] rounded-full overflow-hidden border border-[var(--glass-border)]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[var(--accent-cyan)] to-[var(--accent-indigo)] transition-all duration-500 shadow-sm"
                style={{ width: `${Math.max(2, pct)}%` }}
              />
            </div>

            {/* Value */}
            <span className="w-16 text-right font-mono text-[12px] font-semibold tnum text-[var(--ink-primary)] shrink-0">
              {f.meanAbsShap.toFixed(4)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
