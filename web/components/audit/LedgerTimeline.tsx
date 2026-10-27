"use client";

import { useState } from "react";
import { GlassCard } from "@/components/ui/GlassCard";
import { GlassBadge } from "@/components/ui/GlassBadge";
import { BlockDetailModal } from "./BlockDetailModal";
import { type LedgerEntry, formatTimestamp, shortHash } from "@/lib/api";
import { copyToClipboard } from "@/lib/store";
import {
  Link as LinkIcon,
  Eye,
  Copy,
  Database,
  CheckCircle,
} from "@phosphor-icons/react";

interface LedgerTimelineProps {
  entries: LedgerEntry[];
  loading?: boolean;
}

export function LedgerTimeline({ entries, loading }: LedgerTimelineProps) {
  const [selectedEntry, setSelectedEntry] = useState<LedgerEntry | null>(null);

  if (loading) {
    return (
      <GlassCard className="p-8 text-center space-y-3">
        <div className="h-6 w-6 border-2 border-[var(--accent-cyan)] border-t-transparent rounded-full animate-spin mx-auto" />
        <span className="text-sm font-medium text-[var(--ink-secondary)]">
          Fetching cryptographic ledger chain from backend...
        </span>
      </GlassCard>
    );
  }

  if (entries.length === 0) {
    return (
      <GlassCard className="p-8 text-center space-y-3">
        <Database size={32} className="mx-auto text-[var(--ink-muted)] opacity-60" />
        <h3 className="text-base font-semibold text-[var(--ink-primary)]">
          No Ledger Entries Yet
        </h3>
        <p className="text-[13px] text-[var(--ink-secondary)] max-w-md mx-auto leading-relaxed">
          Run an experiment training run to anchor federated rounds into the append-only ledger.
        </p>
      </GlassCard>
    );
  }

  return (
    <>
      <GlassCard variant="elevated" className="overflow-hidden space-y-0">
        <div className="p-5 sm:p-6 border-b border-[var(--glass-border)] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-[var(--ink-primary)]">
                Append-Only Audit Ledger Timeline
              </h3>
              <GlassBadge tone="cyan" size="sm">
                {entries.length} Entries Recorded
              </GlassBadge>
              <GlassBadge tone="neutral" size="sm">
                LOCAL HASH CHAIN
              </GlassBadge>
            </div>
            <p className="text-[12.5px] text-[var(--ink-secondary)] mt-0.5">
              Chronological cryptographic records linking each model update and coordinator verdict to the chain.
            </p>
          </div>

          <div className="text-[11px] font-mono text-[var(--ink-muted)] text-right">
            <span>DURABLE LOG: </span>
            <code className="text-[var(--accent-cyan)]">results/ledger.jsonl</code>
          </div>
        </div>

        <div className="overflow-x-auto max-h-[560px]">
          <table className="w-full text-left text-[13px] border-collapse">
            <thead className="sticky top-0 bg-[var(--glass-elevated)] border-b border-[var(--glass-border)] text-[var(--ink-muted)] font-mono text-[11px] tracking-wider uppercase z-10">
              <tr>
                <th className="px-4 py-3">Entry #</th>
                <th className="px-3 py-3">Round</th>
                <th className="px-3 py-3">Record Type</th>
                <th className="px-4 py-3">Model Hash</th>
                <th className="px-3 py-3 text-center">Coordinator Decision</th>
                <th className="px-4 py-3">Block Digest &amp; Pointer</th>
                <th className="px-4 py-3">Timestamp</th>
                <th className="px-4 py-3 text-right">Inspect</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--glass-border)] font-mono text-[12.5px]">
              {entries.map((e) => {
                const accepted = e.decision?.accepted ?? [];
                const rejected = e.decision?.rejected ?? [];
                const flagged = e.verdict?.flagged ?? [];

                return (
                  <tr
                    key={`${e.config_hash}-${e.index}`}
                    className="hover:bg-[var(--glass-elevated)]/60 transition-colors"
                  >
                    {/* Block index */}
                    <td className="px-4 py-3.5 font-bold text-[var(--ink-primary)]">
                      #{e.index}
                    </td>

                    {/* Round num */}
                    <td className="px-3 py-3.5 text-[var(--accent-cyan)] font-semibold whitespace-nowrap">
                      Round {e.round_num}
                    </td>

                    {/* Record Type */}
                    <td className="px-3 py-3.5">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10.5px] font-semibold bg-[var(--accent-cyan)]/10 text-[var(--accent-cyan)] border border-[var(--accent-cyan)]/25">
                        ROUND_COMMITMENT
                      </span>
                    </td>

                    {/* Model Weights Hash */}
                    <td className="px-4 py-3.5">
                      <button
                        type="button"
                        onClick={() => copyToClipboard(e.model_hash, "Model Weights Hash")}
                        className="font-mono text-xs text-[var(--ink-primary)] hover:text-[var(--accent-cyan)] flex items-center gap-1 cursor-pointer"
                        title={`Model Hash: ${e.model_hash}`}
                      >
                        <span>{shortHash(e.model_hash, 6, 4)}</span>
                        <Copy size={11} className="opacity-50" />
                      </button>
                    </td>

                    {/* Coordinator Decision Summary */}
                    <td className="px-3 py-3.5 text-center">
                      <div className="flex items-center justify-center gap-1.5 font-mono text-xs">
                        <span
                          className="px-1.5 py-0.5 rounded bg-[var(--status-good)]/10 text-[var(--status-good)] font-semibold"
                          title={`${accepted.length} clients accepted: ${accepted.join(", ")}`}
                        >
                          {accepted.length} acc
                        </span>
                        {rejected.length > 0 && (
                          <span
                            className="px-1.5 py-0.5 rounded bg-[var(--status-critical)]/10 text-[var(--status-critical)] font-bold"
                            title={`${rejected.length} clients rejected: ${rejected.join(", ")}`}
                          >
                            {rejected.length} rej
                          </span>
                        )}
                        {flagged.length > 0 && (
                          <span
                            className="px-1.5 py-0.5 rounded bg-[var(--status-warning)]/10 text-[var(--status-warning)] font-bold"
                            title={`${flagged.length} clients flagged by agent: ${flagged.join(", ")}`}
                          >
                            {flagged.length} flag
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Entry Hash + Prev Hash */}
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-1.5 font-bold text-[var(--ink-primary)]">
                        <span>{shortHash(e.entry_hash, 8, 6)}</span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(e.entry_hash, "Entry Hash")}
                          className="hover:text-[var(--accent-cyan)] cursor-pointer"
                          title="Copy Entry Hash"
                        >
                          <Copy size={11} className="opacity-60" />
                        </button>
                      </div>

                      <div
                        className="flex items-center gap-1 text-[11px] text-[var(--ink-muted)] mt-0.5"
                        title={`Prev Hash: ${e.prev_hash}`}
                      >
                        <LinkIcon size={11} weight="bold" />
                        <span>prev: {shortHash(e.prev_hash, 6, 4)}</span>
                      </div>
                    </td>

                    {/* Timestamp */}
                    <td className="px-4 py-3.5 text-[12px] text-[var(--ink-secondary)] font-sans whitespace-nowrap">
                      {formatTimestamp(e.timestamp)}
                    </td>

                    {/* Action Button */}
                    <td className="px-4 py-3.5 text-right font-sans">
                      <button
                        type="button"
                        onClick={() => setSelectedEntry(e)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[12px] font-medium bg-[var(--glass-subtle)] hover:bg-[var(--glass-interactive)] border border-[var(--glass-border)] text-[var(--ink-primary)] transition-colors cursor-pointer"
                      >
                        <Eye size={13} weight="bold" />
                        <span>Inspect</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Ledger Architecture Footer Note */}
        <div className="p-4 bg-[var(--glass-subtle)] border-t border-[var(--glass-border)] flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-[var(--ink-muted)]">
          <div className="flex items-center gap-2">
            <CheckCircle size={15} className="text-[var(--status-good)] shrink-0" />
            <span>
              <strong>Ledger Mode:</strong> Single-writer local SHA-256 hash-chain (Tamper-Evident).
            </span>
          </div>
          <div className="font-mono text-[11px]">
            Optional on-chain anchoring (<code>blockchain/contracts/FedGuardAnchor.sol</code>) is active only with{" "}
            <code>FEDGUARD_LEDGER_BACKEND=web3</code>
          </div>
        </div>
      </GlassCard>

      {/* Detail Modal */}
      <BlockDetailModal
        entry={selectedEntry}
        onClose={() => setSelectedEntry(null)}
      />
    </>
  );
}
