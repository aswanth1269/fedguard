"use client";

import { useEffect, useMemo, useState } from "react";
import { Play, Pause, Copy, WarningCircle, CheckCircle, XCircle } from "@phosphor-icons/react";
import { GlassCard } from "@/components/ui/GlassCard";
import { copyToClipboard } from "@/lib/store";

export type StreamRow = {
  id: string;
  origin: string;
  amount: number;
  fraudProb: number;
  blocked: boolean;
  isFraud: number;
  triggered: boolean;
};

export type StreamFileData = {
  run: { id: string; hash: string; attack: string; defense: string; maliciousClients: string[] };
  threshold: number;
  nTest: number;
  nPositive: number;
  totalExposure: number;
  rows: StreamRow[];
};

interface LiveTransactionReplayProps {
  stream: StreamFileData | null;
}

export function LiveTransactionReplay({ stream }: LiveTransactionReplayProps) {
  const [cursor, setCursor] = useState(8);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  const [filterOrigin, setFilterOrigin] = useState<string>("all");
  const [filterOutcome, setFilterOutcome] = useState<string>("all");

  const total = stream?.rows.length ?? 0;

  // Stream ticker interval
  useEffect(() => {
    if (paused || total === 0) return;
    const intervalMs = Math.max(300, Math.floor(1400 / speed));
    const timer = setInterval(() => {
      setCursor((c) => (c >= total ? c : c + 1));
    }, intervalMs);
    return () => clearInterval(timer);
  }, [paused, total, speed]);

  const rows = useMemo(() => {
    if (!stream) return [];
    return stream.rows.slice(0, cursor);
  }, [stream, cursor]);

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      const matchOrigin = filterOrigin === "all" || r.origin.toLowerCase() === filterOrigin.toLowerCase();
      const isCorrect = r.blocked === (r.isFraud === 1);
      const matchOutcome =
        filterOutcome === "all" ||
        (filterOutcome === "correct" && isCorrect) ||
        (filterOutcome === "miss" && !r.blocked && r.isFraud === 1) ||
        (filterOutcome === "false_alarm" && r.blocked && r.isFraud === 0);
      return matchOrigin && matchOutcome;
    });
  }, [rows, filterOrigin, filterOutcome]);

  if (!stream) {
    return (
      <GlassCard className="p-6 sm:p-8 space-y-4">
        <h3 className="text-base font-semibold text-[var(--ink-primary)]">
          Transaction Stream Not Generated Yet
        </h3>
        <p className="text-[13px] text-[var(--ink-secondary)] leading-relaxed">
          Export real IEEE-CIS scored transactions to enable the live consortium transaction replay simulator.
        </p>
        <pre className="p-4 rounded-xl bg-[var(--glass-subtle)] border border-[var(--glass-border)] font-mono text-[12px] text-[var(--ink-secondary)] overflow-x-auto">
          python scripts/export_stream.py --config configs/e_ieee_backdoor_fedavg.yaml
        </pre>
      </GlassCard>
    );
  }

  const origins = Array.from(new Set(stream.rows.map((r) => r.origin)));

  return (
    <GlassCard variant="elevated" className="overflow-hidden space-y-0">
      {/* Stream Control Header */}
      <div className="p-5 sm:p-6 border-b border-[var(--glass-border)] space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  paused ? "bg-[var(--ink-muted)]" : "bg-[var(--status-good)] animate-ping"
                }`}
              />
              <h3 className="text-base font-bold text-[var(--ink-primary)]">
                Consortium Transaction Replay Stream
              </h3>
            </div>
            <p className="text-[12.5px] text-[var(--ink-secondary)] font-mono">
              Scored via global model at operating threshold: τ = {stream.threshold.toFixed(4)}
            </p>
          </div>

          {/* Player controls */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPaused(!paused)}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl font-medium text-[12.5px] bg-[var(--glass-interactive)] hover:bg-[var(--glass-elevated)] border border-[var(--glass-border)] text-[var(--ink-primary)] transition-all cursor-pointer shadow-sm active:scale-95"
            >
              {paused ? <Play size={14} weight="fill" /> : <Pause size={14} weight="fill" />}
              <span>{paused ? "Resume Feed" : "Pause Feed"}</span>
            </button>

            {/* Speed toggle */}
            <div className="flex items-center rounded-xl bg-[var(--glass-subtle)] border border-[var(--glass-border)] p-0.5">
              {[1, 2, 5].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSpeed(s)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-semibold transition-colors cursor-pointer ${
                    speed === s
                      ? "bg-[var(--accent-cyan)] text-white"
                      : "text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]"
                  }`}
                >
                  {s}x
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 text-[12px]">
          {/* Card Origin Filter */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
            <span className="text-[var(--ink-muted)] text-[11px] font-mono uppercase mr-1">Origin:</span>
            <button
              type="button"
              onClick={() => setFilterOrigin("all")}
              className={`px-2.5 py-1 rounded-lg text-[11.5px] font-medium transition-colors cursor-pointer ${
                filterOrigin === "all"
                  ? "bg-[var(--accent-indigo)] text-white"
                  : "bg-[var(--glass-subtle)] text-[var(--ink-secondary)] hover:bg-[var(--glass-elevated)]"
              }`}
            >
              All
            </button>
            {origins.map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => setFilterOrigin(o)}
                className={`px-2.5 py-1 rounded-lg text-[11.5px] font-medium uppercase transition-colors cursor-pointer ${
                  filterOrigin === o
                    ? "bg-[var(--accent-indigo)] text-white"
                    : "bg-[var(--glass-subtle)] text-[var(--ink-secondary)] hover:bg-[var(--glass-elevated)]"
                }`}
              >
                {o}
              </button>
            ))}
          </div>

          {/* Outcome Filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-[var(--ink-muted)] text-[11px] font-mono uppercase mr-1">Audit:</span>
            <button
              type="button"
              onClick={() => setFilterOutcome("all")}
              className={`px-2 py-0.5 rounded-md text-[11px] font-medium cursor-pointer ${
                filterOutcome === "all"
                  ? "bg-[var(--glass-elevated)] text-[var(--ink-primary)] border border-[var(--glass-border)]"
                  : "text-[var(--ink-muted)] hover:text-[var(--ink-secondary)]"
              }`}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setFilterOutcome("correct")}
              className={`px-2 py-0.5 rounded-md text-[11px] font-medium cursor-pointer ${
                filterOutcome === "correct"
                  ? "bg-[var(--status-good)]/20 text-[var(--status-good)] border border-[var(--status-good)]/30 font-semibold"
                  : "text-[var(--ink-muted)] hover:text-[var(--ink-secondary)]"
              }`}
            >
              Verified Hits
            </button>
            <button
              type="button"
              onClick={() => setFilterOutcome("miss")}
              className={`px-2 py-0.5 rounded-md text-[11px] font-medium cursor-pointer ${
                filterOutcome === "miss"
                  ? "bg-[var(--status-critical)]/20 text-[var(--status-critical)] border border-[var(--status-critical)]/30 font-semibold"
                  : "text-[var(--ink-muted)] hover:text-[var(--ink-secondary)]"
              }`}
            >
              Missed Fraud
            </button>
            <button
              type="button"
              onClick={() => setFilterOutcome("false_alarm")}
              className={`px-2 py-0.5 rounded-md text-[11px] font-medium cursor-pointer ${
                filterOutcome === "false_alarm"
                  ? "bg-[var(--status-warning)]/20 text-[var(--status-warning)] border border-[var(--status-warning)]/30 font-semibold"
                  : "text-[var(--ink-muted)] hover:text-[var(--ink-secondary)]"
              }`}
            >
              False Declines
            </button>
          </div>
        </div>
      </div>

      {/* Transaction Table */}
      <div className="overflow-x-auto max-h-[460px]">
        <table className="w-full text-left text-[13px] border-collapse">
          <thead className="sticky top-0 bg-[var(--glass-elevated)] border-b border-[var(--glass-border)] text-[var(--ink-muted)] font-mono text-[11px] tracking-wider uppercase z-10">
            <tr>
              <th className="px-5 py-3">Transaction ID</th>
              <th className="px-3 py-3">Card Network</th>
              <th className="px-3 py-3 text-right">Amount</th>
              <th className="px-3 py-3 text-right">Fraud Prob</th>
              <th className="px-3 py-3">Model Action</th>
              <th className="px-3 py-3">Ground Truth</th>
              <th className="px-5 py-3 text-right">Audit Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--glass-border)] font-mono text-[12.5px]">
            {filteredRows.map((r) => {
              const isCorrect = r.blocked === (r.isFraud === 1);
              const probPct = r.fraudProb * 100;

              return (
                <tr
                  key={r.id}
                  className="hover:bg-[var(--glass-elevated)]/60 transition-colors animate-in fade-in duration-200"
                >
                  {/* TX ID with copy button */}
                  <td className="px-5 py-3 text-[var(--accent-cyan)] font-semibold">
                    <button
                      type="button"
                      onClick={() => copyToClipboard(r.id, "Transaction ID")}
                      className="inline-flex items-center gap-1.5 hover:underline cursor-pointer"
                      title="Copy transaction ID"
                    >
                      <span>{r.id}</span>
                      <Copy size={12} className="opacity-60" />
                    </button>
                  </td>

                  {/* Origin Card */}
                  <td className="px-3 py-3 text-[var(--ink-primary)] font-medium uppercase font-sans">
                    {r.origin}
                  </td>

                  {/* Amount */}
                  <td className="px-3 py-3 text-right text-[var(--ink-primary)] font-bold tnum">
                    ${r.amount.toFixed(2)}
                  </td>

                  {/* Probability */}
                  <td className="px-3 py-3 text-right">
                    <span
                      className={`font-bold tnum ${
                        r.fraudProb >= stream.threshold
                          ? "text-[var(--status-critical)]"
                          : "text-[var(--status-good)]"
                      }`}
                    >
                      {probPct.toFixed(1)}%
                    </span>
                  </td>

                  {/* Action */}
                  <td className="px-3 py-3 font-sans">
                    <span
                      className={`inline-flex px-2.5 py-0.5 rounded-full text-[11px] font-bold tracking-wider uppercase border ${
                        r.blocked
                          ? "bg-[var(--status-critical)]/15 text-[var(--status-critical)] border-[var(--status-critical)]/30"
                          : "bg-[var(--glass-subtle)] text-[var(--ink-secondary)] border-[var(--glass-border)]"
                      }`}
                    >
                      {r.blocked ? "BLOCKED" : "SETTLED"}
                    </span>
                  </td>

                  {/* Ground Truth */}
                  <td className="px-3 py-3 font-sans">
                    <span
                      className={`text-[12px] font-medium ${
                        r.isFraud === 1 ? "text-[var(--status-critical)]" : "text-[var(--ink-secondary)]"
                      }`}
                    >
                      {r.isFraud === 1 ? (r.triggered ? "Backdoor Fraud" : "Benign Fraud") : "Legitimate"}
                    </span>
                  </td>

                  {/* Audit Result */}
                  <td className="px-5 py-3 text-right font-sans">
                    {isCorrect ? (
                      <span className="inline-flex items-center gap-1 text-[11.5px] text-[var(--status-good)] font-semibold">
                        <CheckCircle size={14} weight="bold" /> Verified Correct
                      </span>
                    ) : r.isFraud === 1 ? (
                      <span className="inline-flex items-center gap-1 text-[11.5px] text-[var(--status-critical)] font-bold">
                        <XCircle size={14} weight="bold" /> Fraud Missed
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11.5px] text-[var(--status-warning)] font-semibold">
                        <WarningCircle size={14} weight="bold" /> False Decline
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer bar */}
      <div className="p-4 border-t border-[var(--glass-border)] bg-[var(--glass-subtle)] flex items-center justify-between text-[11.5px] text-[var(--ink-muted)] font-mono">
        <span>
          Showing {filteredRows.length} of {cursor} replayed transactions ({total} total available)
        </span>
        <span>STREAM STATUS: {paused ? "PAUSED" : `ACTIVE (${speed}x)`}</span>
      </div>
    </GlassCard>
  );
}
