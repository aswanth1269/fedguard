"use client";

import { GlassModal } from "@/components/ui/GlassModal";
import { GlassButton } from "@/components/ui/GlassButton";
import { GlassBadge } from "@/components/ui/GlassBadge";
import { type LedgerEntry, formatTimestamp } from "@/lib/api";
import { copyToClipboard } from "@/lib/store";
import {
  Copy,
  ShieldCheck,
  Cpu,
  LockKey,
  Scales,
  FileCode,
} from "@phosphor-icons/react";

interface BlockDetailModalProps {
  entry: LedgerEntry | null;
  onClose: () => void;
}

export function BlockDetailModal({ entry, onClose }: BlockDetailModalProps) {
  if (!entry) return null;

  const jsonString = JSON.stringify(entry, null, 2);
  const accepted = entry.decision?.accepted ?? [];
  const rejected = entry.decision?.rejected ?? [];
  const flagged = entry.verdict?.flagged ?? [];
  const weights = entry.decision?.weights ?? {};
  const reputation = entry.decision?.reputation ?? {};

  return (
    <GlassModal
      isOpen={Boolean(entry)}
      onClose={onClose}
      title={`Ledger Entry #${entry.index} (Round ${entry.round_num})`}
      description={`Config: ${entry.config_hash} · Timestamp: ${formatTimestamp(entry.timestamp)}`}
      maxWidth="2xl"
      footer={
        <>
          <GlassButton
            variant="glass"
            icon={<Copy size={15} />}
            onClick={() => copyToClipboard(jsonString, "Full Block Payload")}
          >
            Copy JSON Payload
          </GlassButton>
          <GlassButton variant="primary" onClick={onClose}>
            Close Inspector
          </GlassButton>
        </>
      }
    >
      <div className="space-y-5 text-[13px]">
        {/* Hashes Block */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="p-3.5 rounded-xl bg-[var(--glass-subtle)] border border-[var(--glass-border)] space-y-1">
            <span className="text-[11px] font-mono text-[var(--ink-muted)] uppercase">
              Current Entry Hash (Block Digest)
            </span>
            <div className="flex items-center justify-between font-mono text-[12px] text-[var(--accent-cyan)] font-semibold">
              <span className="truncate">{entry.entry_hash}</span>
              <button
                type="button"
                onClick={() => copyToClipboard(entry.entry_hash, "Entry Hash")}
                className="p-1 hover:text-[var(--ink-primary)] cursor-pointer"
                title="Copy full entry hash"
              >
                <Copy size={13} />
              </button>
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-[var(--glass-subtle)] border border-[var(--glass-border)] space-y-1">
            <span className="text-[11px] font-mono text-[var(--ink-muted)] uppercase">
              Previous Hash Link (Pointer)
            </span>
            <div className="flex items-center justify-between font-mono text-[12px] text-[var(--ink-secondary)]">
              <span className="truncate">{entry.prev_hash}</span>
              <button
                type="button"
                onClick={() => copyToClipboard(entry.prev_hash, "Previous Hash")}
                className="p-1 hover:text-[var(--ink-primary)] cursor-pointer"
                title="Copy previous hash pointer"
              >
                <Copy size={13} />
              </button>
            </div>
          </div>
        </div>

        {/* Model Weights SHA-256 */}
        <div className="p-3.5 rounded-xl bg-[var(--glass-subtle)] border border-[var(--glass-border)] space-y-1.5">
          <div className="flex items-center justify-between text-[11px] font-mono text-[var(--ink-muted)] uppercase">
            <span className="flex items-center gap-1.5 font-semibold text-[var(--ink-primary)]">
              <LockKey size={14} className="text-[var(--accent-cyan)]" />
              Model Artifact Hash (SHA-256)
            </span>
            <button
              type="button"
              onClick={() => copyToClipboard(entry.model_hash, "Model Weights Hash")}
              className="hover:text-[var(--ink-primary)] cursor-pointer flex items-center gap-1"
            >
              <Copy size={12} />
              <span>Copy</span>
            </button>
          </div>
          <div className="font-mono text-[12px] text-[var(--accent-cyan)] font-semibold break-all select-all">
            {entry.model_hash || "—"}
          </div>
          <p className="text-[11.5px] text-[var(--ink-muted)]">
            Streamed across contiguous parameter array bytes (<code>hash_model_params</code>). Proves exact model weight reproducibility.
          </p>
        </div>

        {/* Coordinator Decision & Client Weights */}
        <div className="p-4 rounded-xl bg-[var(--glass-subtle)] border border-[var(--glass-border)] space-y-3">
          <div className="flex items-center justify-between border-b border-[var(--glass-border)] pb-2">
            <span className="text-xs font-mono uppercase font-semibold text-[var(--ink-primary)] flex items-center gap-1.5">
              <Scales size={15} className="text-[var(--accent-cyan)]" />
              Coordinator Aggregation Decision
            </span>
            <div className="flex gap-2">
              <GlassBadge tone="good" size="sm">
                {accepted.length} Accepted
              </GlassBadge>
              {rejected.length > 0 && (
                <GlassBadge tone="critical" size="sm">
                  {rejected.length} Rejected
                </GlassBadge>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs font-mono">
            <div>
              <span className="text-[var(--ink-muted)]">Accepted Clients:</span>
              <div className="mt-1 flex flex-wrap gap-1">
                {accepted.map((c) => (
                  <span
                    key={c}
                    className="px-2 py-0.5 rounded bg-[var(--status-good)]/10 text-[var(--status-good)] border border-[var(--status-good)]/20"
                  >
                    {c} (wt: {(weights[c] ?? 0).toFixed(4)})
                  </span>
                ))}
              </div>
            </div>

            <div>
              <span className="text-[var(--ink-muted)]">Rejected Clients:</span>
              <div className="mt-1">
                {rejected.length > 0 ? (
                  rejected.map((c) => (
                    <span
                      key={c}
                      className="px-2 py-0.5 rounded bg-[var(--status-critical)]/10 text-[var(--status-critical)] border border-[var(--status-critical)]/20 font-bold"
                    >
                      {c}
                    </span>
                  ))
                ) : (
                  <span className="text-[var(--ink-muted)]">None (Clean Round)</span>
                )}
              </div>
            </div>
          </div>

          {Object.keys(reputation).length > 0 && (
            <div className="pt-2 border-t border-[var(--glass-border)] text-xs font-mono">
              <span className="text-[var(--ink-muted)]">Client Reputations:</span>
              <div className="flex flex-wrap gap-2 mt-1">
                {Object.entries(reputation).map(([c, r]) => (
                  <span key={c} className="text-[var(--ink-secondary)]">
                    {c}: <strong className="text-[var(--ink-primary)]">{Number(r).toFixed(4)}</strong>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Agentic Sentinel Verdict & Narrative */}
        {entry.verdict && (
          <div className="p-4 rounded-xl bg-[var(--glass-subtle)] border border-[var(--glass-border)] space-y-2">
            <div className="flex items-center justify-between border-b border-[var(--glass-border)] pb-2">
              <span className="text-xs font-mono uppercase font-semibold text-[var(--ink-primary)] flex items-center gap-1.5">
                <Cpu size={15} className="text-[var(--accent-indigo)]" />
                Sentinel Verdict (Boundary v{entry.verdict.boundary_version || "1.0.0"})
              </span>
              <GlassBadge tone={flagged.length > 0 ? "warning" : "good"} size="sm">
                {flagged.length > 0 ? `${flagged.length} Flagged` : "Approved"}
              </GlassBadge>
            </div>

            {entry.verdict.narrative ? (
              <p className="text-xs text-[var(--ink-secondary)] leading-relaxed italic">
                &ldquo;{entry.verdict.narrative}&rdquo;
              </p>
            ) : (
              <p className="text-xs text-[var(--ink-muted)]">No narrative attached.</p>
            )}
          </div>
        )}

        {/* Ledger Type & Blockchain Reality Notice */}
        <div className="p-3.5 rounded-xl bg-[var(--glass-elevated)] border border-[var(--glass-border)] text-xs text-[var(--ink-secondary)] space-y-1">
          <div className="font-semibold text-[var(--ink-primary)] flex items-center gap-1.5">
            <ShieldCheck size={15} className="text-[var(--status-good)]" />
            Ledger Backend Guarantee
          </div>
          <p className="text-[12px] leading-relaxed">
            Record stored in off-chain append-only hash chain (<code>results/ledger.jsonl</code>).
            When configured with <code>FEDGUARD_LEDGER_BACKEND=web3</code>, the coordinator anchors these three hashes (model, reputation, decision) to <code>FedGuardAnchor.sol</code> on Ethereum/Hardhat. No mock transaction gas hashes or fake block heights are displayed.
          </p>
        </div>

        {/* Full JSON Payload */}
        <div className="space-y-1.5">
          <span className="text-[11.5px] font-mono text-[var(--ink-muted)] uppercase font-semibold flex items-center gap-1">
            <FileCode size={14} />
            Raw Canonical Record
          </span>
          <pre className="p-4 rounded-xl bg-[var(--canvas-bg)] border border-[var(--glass-border)] font-mono text-[11.5px] text-[var(--ink-secondary)] overflow-x-auto max-h-[180px] select-all">
            {jsonString}
          </pre>
        </div>
      </div>
    </GlassModal>
  );
}
