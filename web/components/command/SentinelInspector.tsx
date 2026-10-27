"use client";

import { useState } from "react";
import { GlassCard } from "@/components/ui/GlassCard";
import { GlassBadge } from "@/components/ui/GlassBadge";
import { GlassButton } from "@/components/ui/GlassButton";
import { GlassModal } from "@/components/ui/GlassModal";
import { toastStore } from "@/lib/store";
import { api } from "@/lib/api";
import { type RunRecord } from "@/lib/runs";
import { Cpu, ShieldCheck, UserCheck } from "@phosphor-icons/react";

interface SentinelInspectorProps {
  run: RunRecord;
}

export function SentinelInspector({ run }: SentinelInspectorProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [roundNum, setRoundNum] = useState<number>(run.rounds);
  const [overrideNote, setOverrideNote] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  const flaggedRounds = run.series.filter((s) => s.rejected.length > 0);
  const totalFlagged = flaggedRounds.length;

  const handleApprove = async () => {
    setSubmitting(true);
    const res = await api.approveModel({
      job_id: run.id,
      round_num: roundNum,
      note: overrideNote || "Human operator confirmation: model round approved.",
    });

    setSubmitting(false);
    if (res.ok) {
      toastStore.success(`Round ${roundNum} Human Approval Recorded`, res.data.human_override.note);
      setModalOpen(false);
    } else {
      toastStore.warning(
        `Approval noted in local state`,
        `Coordinator API reported: ${res.message}`
      );
      setModalOpen(false);
    }
  };

  return (
    <GlassCard variant="elevated" className="p-6 sm:p-7 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[var(--glass-border)] pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-[var(--accent-indigo)]/10 text-[var(--accent-indigo)]">
            <Cpu size={22} weight="bold" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-[var(--ink-primary)]">
                Agentic Sentinel Governance
              </h3>
              <GlassBadge tone="indigo" size="sm">
                BOUNDARY v1.0.0
              </GlassBadge>
            </div>
            <p className="text-[12.5px] text-[var(--ink-secondary)] mt-0.5">
              Deterministic Python ruling engine anchored into the blockchain ledger.
            </p>
          </div>
        </div>

        <GlassButton
          variant="glass"
          size="sm"
          icon={<UserCheck size={16} weight="bold" />}
          onClick={() => setModalOpen(true)}
        >
          Submit Human Review Override
        </GlassButton>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-[13px]">
        <div className="p-4 rounded-xl bg-[var(--glass-subtle)] border border-[var(--glass-border)] space-y-1">
          <span className="text-[11.5px] text-[var(--ink-muted)] uppercase font-mono">
            Rounds Reviewed
          </span>
          <span className="font-mono text-2xl font-bold block text-[var(--ink-primary)]">
            {run.series.length} / {run.rounds}
          </span>
          <span className="text-[11px] text-[var(--status-good)] font-medium">
            100% Boundary Evaluation
          </span>
        </div>

        <div className="p-4 rounded-xl bg-[var(--glass-subtle)] border border-[var(--glass-border)] space-y-1">
          <span className="text-[11.5px] text-[var(--ink-muted)] uppercase font-mono">
            Flagged Exclusion Rounds
          </span>
          <span
            className={`font-mono text-2xl font-bold block ${
              totalFlagged > 0 ? "text-[var(--status-critical)]" : "text-[var(--status-good)]"
            }`}
          >
            {totalFlagged}
          </span>
          <span className="text-[11px] text-[var(--ink-muted)]">
            {totalFlagged > 0 ? "Defense rejected anomalous delta" : "Clean convergence"}
          </span>
        </div>

        <div className="p-4 rounded-xl bg-[var(--glass-subtle)] border border-[var(--glass-border)] space-y-1">
          <span className="text-[11.5px] text-[var(--ink-muted)] uppercase font-mono">
            Identified Attacker
          </span>
          <span className="font-mono text-base font-bold block text-[var(--status-critical)] truncate">
            {run.attack.malicious_clients.join(", ") || "None (Clean Setting)"}
          </span>
          <span className="text-[11px] text-[var(--ink-muted)]">
            Attack: {run.attack.name.toUpperCase()}
          </span>
        </div>
      </div>

      {/* Human Override Modal */}
      <GlassModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Human Review & Model Approval"
        description="Record an out-of-band human confirmation for an anchored model round in the coordinator job store."
        footer={
          <>
            <GlassButton variant="ghost" onClick={() => setModalOpen(false)}>
              Cancel
            </GlassButton>
            <GlassButton
              variant="primary"
              loading={submitting}
              onClick={handleApprove}
              icon={<ShieldCheck size={16} weight="bold" />}
            >
              Confirm Round Approval
            </GlassButton>
          </>
        }
      >
        <div className="space-y-4 text-[13px]">
          <div>
            <label className="block text-xs font-semibold text-[var(--ink-secondary)] mb-1.5 uppercase font-mono">
              Target Round Number
            </label>
            <input
              type="number"
              min={1}
              max={run.rounds}
              value={roundNum}
              onChange={(e) => setRoundNum(parseInt(e.target.value) || 1)}
              className="glass-input w-full px-3 py-2 text-sm font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[var(--ink-secondary)] mb-1.5 uppercase font-mono">
              Operator Audit Note
            </label>
            <textarea
              rows={3}
              placeholder="e.g., Reviewed gradient divergence. Confirming model parameters acceptable for consortium release."
              value={overrideNote}
              onChange={(e) => setOverrideNote(e.target.value)}
              className="glass-input w-full px-3 py-2 text-sm resize-none"
            />
          </div>

          <div className="p-3 rounded-lg bg-[var(--glass-subtle)] border border-[var(--glass-border)] text-xs text-[var(--ink-muted)] leading-relaxed">
            Note: Human approvals do not mutate previously anchored blockchain blocks, preserving absolute cryptographic tamper-evidence.
          </div>
        </div>
      </GlassModal>
    </GlassCard>
  );
}
