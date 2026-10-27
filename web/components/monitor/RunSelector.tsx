"use client";

import { useMemo, useState } from "react";
import { MagnifyingGlass } from "@phosphor-icons/react";
import { GlassBadge } from "@/components/ui/GlassBadge";
import { type RunRecord } from "@/lib/runs";

interface RunSelectorProps {
  runs: RunRecord[];
  selectedId: string;
  onSelect: (id: string) => void;
}

export function RunSelector({ runs, selectedId, onSelect }: RunSelectorProps) {
  const [search, setSearch] = useState("");
  const [defenseFilter, setDefenseFilter] = useState<string>("all");

  const defenses = useMemo(
    () => Array.from(new Set(runs.map((r) => r.defense.name))),
    [runs]
  );

  const filtered = useMemo(() => {
    return runs.filter((r) => {
      const matchSearch =
        search === "" ||
        r.label.toLowerCase().includes(search.toLowerCase()) ||
        r.id.toLowerCase().includes(search.toLowerCase()) ||
        r.attack.name.toLowerCase().includes(search.toLowerCase()) ||
        r.defense.name.toLowerCase().includes(search.toLowerCase());
      const matchDefense = defenseFilter === "all" || r.defense.name === defenseFilter;
      return matchSearch && matchDefense;
    });
  }, [runs, search, defenseFilter]);

  return (
    <div className="w-full space-y-3">
      {/* Search & Filter Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Search Input */}
        <div className="relative flex-1 max-w-md">
          <MagnifyingGlass
            size={16}
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--ink-muted)]"
          />
          <input
            type="text"
            placeholder="Search experiment runs by name, attack, defense..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="glass-input w-full pl-9 pr-4 py-2 text-[13px]"
          />
        </div>

        {/* Defense Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          <button
            type="button"
            onClick={() => setDefenseFilter("all")}
            className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors cursor-pointer shrink-0 ${
              defenseFilter === "all"
                ? "bg-[var(--accent-cyan)] text-white"
                : "bg-[var(--glass-subtle)] text-[var(--ink-secondary)] hover:bg-[var(--glass-elevated)] border border-[var(--glass-border)]"
            }`}
          >
            All Defenses ({runs.length})
          </button>
          {defenses.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDefenseFilter(d)}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-medium font-mono uppercase transition-colors cursor-pointer shrink-0 ${
                defenseFilter === d
                  ? "bg-[var(--accent-cyan)] text-white"
                  : "bg-[var(--glass-subtle)] text-[var(--ink-secondary)] hover:bg-[var(--glass-elevated)] border border-[var(--glass-border)]"
              }`}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      {/* Runs Horizontal Grid Carousel */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {filtered.map((r) => {
          const isSelected = r.id === selectedId;
          const isAttacked = r.attack.name !== "none";
          const prAuc = r.final?.pr_auc ?? 0;
          const asr = r.final?.asr;

          return (
            <div
              key={r.id}
              onClick={() => onSelect(r.id)}
              className={`glass-card p-4 space-y-3 cursor-pointer transition-all duration-200 ${
                isSelected
                  ? "border-[var(--accent-cyan)] shadow-lg shadow-[var(--accent-cyan)]/15 ring-1 ring-[var(--accent-cyan)] bg-[var(--glass-elevated)]"
                  : "hover:border-[var(--glass-border-glow)] hover:bg-[var(--glass-interactive)]"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h4 className="text-[13px] font-bold text-[var(--ink-primary)] truncate">
                    {r.label}
                  </h4>
                  <span className="font-mono text-[11px] text-[var(--ink-muted)]">
                    hash: {r.hash}
                  </span>
                </div>

                <GlassBadge
                  tone={isAttacked ? "critical" : "good"}
                  size="sm"
                >
                  {isAttacked ? "Attacked" : "Clean"}
                </GlassBadge>
              </div>

              {/* Metric previews */}
              <div className="grid grid-cols-2 gap-2 pt-1 border-t border-[var(--glass-border)] text-[12px]">
                <div>
                  <span className="text-[11px] text-[var(--ink-muted)] block">PR-AUC</span>
                  <span className="font-mono font-semibold tnum text-[var(--ink-primary)]">
                    {prAuc.toFixed(4)}
                  </span>
                </div>
                <div>
                  <span className="text-[11px] text-[var(--ink-muted)] block">ASR</span>
                  <span
                    className="font-mono font-semibold tnum"
                    style={{
                      color: asr ? "var(--status-critical)" : "var(--ink-muted)",
                    }}
                  >
                    {asr !== null && asr !== undefined ? `${(asr * 100).toFixed(1)}%` : "—"}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
