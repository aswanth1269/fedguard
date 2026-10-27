"use client";

import { useMemo, useState } from "react";
import { fmtPct } from "@/lib/runs";

export type ClientWeightPart = {
  id: string;
  label: string;
  value: number;
  color: string;
};

export type RoundWeightRow = {
  round: number;
  parts: ClientWeightPart[];
};

interface WeightDistributionAreaProps {
  rows: RoundWeightRow[];
  height?: number;
}

export function WeightDistributionArea({ rows }: WeightDistributionAreaProps) {
  const [hoverRound, setHoverRound] = useState<number | null>(null);

  const activeRow = useMemo(() => {
    if (hoverRound === null) return rows[rows.length - 1] ?? null;
    return rows.find((r) => r.round === hoverRound) ?? null;
  }, [rows, hoverRound]);

  if (rows.length === 0) return null;

  return (
    <div className="w-full space-y-4">
      {/* Interactive Stacked Visualizer */}
      <div className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-subtle)] p-4 space-y-3">
        <div className="flex items-center justify-between text-[12px] text-[var(--ink-secondary)]">
          <span className="font-medium">Consortium Weight Aggregation (100% Total)</span>
          {activeRow && (
            <span className="font-mono text-[11.5px] text-[var(--accent-cyan)] font-semibold">
              ROUND {activeRow.round}
            </span>
          )}
        </div>

        {/* Stack Bars Grid */}
        <div className="flex items-end gap-1.5 h-44 pt-2">
          {rows.map((row) => {
            const isHovered = hoverRound === row.round;
            return (
              <div
                key={row.round}
                className="flex-1 h-full flex flex-col justify-end gap-0.5 group relative cursor-pointer"
                onMouseEnter={() => setHoverRound(row.round)}
                onMouseLeave={() => setHoverRound(null)}
              >
                {/* Visual Bar Columns */}
                <div
                  className={`w-full h-full flex flex-col rounded-md overflow-hidden transition-all duration-200 border ${
                    isHovered
                      ? "border-[var(--accent-cyan)] shadow-md shadow-[var(--accent-cyan)]/20 scale-y-[1.02]"
                      : "border-transparent opacity-85 hover:opacity-100"
                  }`}
                >
                  {row.parts.map((p) => {
                    const heightPct = Math.max(0, p.value * 100);
                    return (
                      <div
                        key={p.id}
                        style={{
                          height: `${heightPct}%`,
                          backgroundColor: p.color,
                        }}
                        className="w-full transition-all duration-300"
                        title={`${p.label}: ${(p.value * 100).toFixed(1)}%`}
                      />
                    );
                  })}
                </div>

                {/* Round Label at Base */}
                <span
                  className={`text-[9.5px] font-mono text-center block transition-colors ${
                    isHovered ? "text-[var(--accent-cyan)] font-bold" : "text-[var(--ink-muted)]"
                  }`}
                >
                  {row.round % 5 === 0 || row.round === 1 || row.round === rows.length
                    ? row.round
                    : ""}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Selected Round Breakdown Card */}
      {activeRow && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2.5">
          {activeRow.parts.map((p) => (
            <div
              key={p.id}
              className="glass-card-subtle p-2.5 rounded-xl flex flex-col gap-1 border border-[var(--glass-border)]"
            >
              <div className="flex items-center gap-1.5 text-[11px] text-[var(--ink-secondary)] truncate">
                <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                <span className="truncate font-medium">{p.label}</span>
              </div>
              <span className="font-mono text-sm font-semibold tnum text-[var(--ink-primary)]">
                {fmtPct(p.value, 1)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
