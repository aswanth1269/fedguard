"use client";

import { GlassCard } from "@/components/ui/GlassCard";
import { GlassBadge } from "@/components/ui/GlassBadge";
import { clientColor, type RunRecord } from "@/lib/runs";

interface ConsortiumNodeRosterProps {
  run: RunRecord;
}

export function ConsortiumNodeRoster({ run }: ConsortiumNodeRosterProps) {
  const finalRound = run.series[run.series.length - 1];
  const maliciousSet = new Set(run.attack.malicious_clients);

  const bankNodes = run.clients.map((id) => {
    const isExcluded = finalRound ? finalRound.rejected.includes(id) : false;
    const isPoisoning = maliciousSet.has(id);
    const weight = finalRound?.weights[id] ?? 0;
    const reputation = finalRound?.reputation[id];
    const totalRejections = run.series.filter((s) => s.rejected.includes(id)).length;
    const color = clientColor(run.clients, id);

    return {
      id,
      isExcluded,
      isPoisoning,
      weight,
      reputation,
      totalRejections,
      color,
    };
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-bold text-[var(--ink-primary)]">
          Consortium Bank Nodes ({bankNodes.length})
        </h3>
        <GlassBadge tone="cyan" size="sm">
          {finalRound?.accepted.length ?? bankNodes.length}/{bankNodes.length} Aggregated
        </GlassBadge>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
        {bankNodes.map((node) => (
          <GlassCard
            key={node.id}
            variant="base"
            className={`p-4 space-y-3 border-t-4 transition-all ${
              node.isPoisoning
                ? "border-t-[var(--status-critical)]"
                : "border-t-[var(--accent-cyan)]"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <span
                  className="h-3 w-3 rounded-full shrink-0"
                  style={{ backgroundColor: node.color }}
                />
                <h4 className="text-sm font-bold text-[var(--ink-primary)] uppercase truncate">
                  {node.id}
                </h4>
              </div>

              {node.isPoisoning && (
                <GlassBadge tone="critical" size="sm">
                  ATTACKER
                </GlassBadge>
              )}
            </div>

            <div className="space-y-1.5 pt-1 border-t border-[var(--glass-border)] text-[12px]">
              <div className="flex items-center justify-between">
                <span className="text-[var(--ink-muted)]">Current Weight:</span>
                <span className="font-mono font-bold text-[var(--ink-primary)] tnum">
                  {(node.weight * 100).toFixed(1)}%
                </span>
              </div>

              {node.reputation !== undefined && (
                <div className="flex items-center justify-between">
                  <span className="text-[var(--ink-muted)]">Reputation:</span>
                  <span
                    className={`font-mono font-bold tnum ${
                      node.reputation < 0.4
                        ? "text-[var(--status-critical)]"
                        : "text-[var(--status-good)]"
                    }`}
                  >
                    {node.reputation.toFixed(3)}
                  </span>
                </div>
              )}

              <div className="flex items-center justify-between">
                <span className="text-[var(--ink-muted)]">Total Exclusions:</span>
                <span
                  className={`font-mono font-semibold tnum ${
                    node.totalRejections > 0
                      ? "text-[var(--status-warning)]"
                      : "text-[var(--ink-secondary)]"
                  }`}
                >
                  {node.totalRejections}x
                </span>
              </div>
            </div>

            <div className="pt-2 border-t border-[var(--glass-border)] flex items-center justify-between text-[11px] font-mono">
              <span className="text-[var(--ink-muted)]">Status:</span>
              <span
                className={`font-semibold ${
                  node.isExcluded ? "text-[var(--status-critical)]" : "text-[var(--status-good)]"
                }`}
              >
                {node.isExcluded ? "EXCLUDED" : "AGGREGATED"}
              </span>
            </div>
          </GlassCard>
        ))}
      </div>
    </div>
  );
}
