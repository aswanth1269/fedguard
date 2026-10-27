"use client";

import { GlassCard } from "@/components/ui/GlassCard";
import { GlassBadge } from "@/components/ui/GlassBadge";
import { GlassButton } from "@/components/ui/GlassButton";
import { type VerifyResult, type ApiResult } from "@/lib/api";
import { ShieldCheck, ShieldWarning, ArrowClockwise, LockKey, CheckCircle } from "@phosphor-icons/react";

interface ChainVerificationBannerProps {
  result: ApiResult<VerifyResult> | null;
  loading: boolean;
  onRefresh: () => void;
}

export function ChainVerificationBanner({
  result,
  loading,
  onRefresh,
}: ChainVerificationBannerProps) {
  if (loading || !result) {
    return (
      <GlassCard className="p-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-5 w-5 border-2 border-[var(--accent-cyan)] border-t-transparent rounded-full animate-spin" />
          <span className="text-sm font-medium text-[var(--ink-secondary)]">
            Verifying cryptographic ledger chain integrity...
          </span>
        </div>
      </GlassCard>
    );
  }

  if (!result.ok) {
    return (
      <GlassCard variant="elevated" className="p-6 sm:p-7 border-l-4 border-l-[var(--status-warning)] space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <ShieldWarning size={24} className="text-[var(--status-warning)] shrink-0" />
            <div>
              <h3 className="text-base font-bold text-[var(--ink-primary)]">
                Coordinator Connection Issue
              </h3>
              <p className="text-[13px] text-[var(--ink-secondary)] mt-0.5">
                {result.message}
              </p>
            </div>
          </div>

          <GlassButton
            variant="glass"
            size="sm"
            onClick={onRefresh}
            loading={loading}
            icon={<ArrowClockwise size={15} weight="bold" />}
          >
            Retry Verification
          </GlassButton>
        </div>
      </GlassCard>
    );
  }

  const v = result.data;
  const isIntact = v.ok;

  return (
    <GlassCard
      variant="elevated"
      glow={isIntact ? "emerald" : "rose"}
      className={`p-6 sm:p-7 border-l-4 space-y-4 ${
        isIntact
          ? "border-l-[var(--status-good)]"
          : "border-l-[var(--status-critical)]"
      }`}
    >
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div
            className={`p-2.5 rounded-xl shrink-0 ${
              isIntact
                ? "bg-[var(--status-good)]/10 text-[var(--status-good)]"
                : "bg-[var(--status-critical)]/10 text-[var(--status-critical)]"
            }`}
          >
            {isIntact ? (
              <ShieldCheck size={28} weight="fill" />
            ) : (
              <ShieldWarning size={28} weight="fill" />
            )}
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-bold text-[var(--ink-primary)]">
                {isIntact
                  ? `Round Ledger Verified (${v.entries_checked} Entries Intact)`
                  : `Ledger Tampering Detected at Entry #${v.failed_at_index}`}
              </h3>
              <GlassBadge tone={isIntact ? "good" : "critical"} size="sm">
                {isIntact ? "TAMPER-EVIDENT" : "INTEGRITY COMPROMISED"}
              </GlassBadge>
            </div>

            <p className="text-[13.5px] text-[var(--ink-secondary)] leading-relaxed">
              {isIntact
                ? `Off-chain single-writer hash chain (results/ledger.jsonl) verified via GET /verify. Every entry's SHA-256 matches its canonical content and links to the previous entry's hash.`
                : `Verification failure: ${v.reason || "Hash link mismatch"}. All entries after #${v.failed_at_index} are unverifiable.`}
            </p>
          </div>
        </div>

        <GlassButton
          variant="glass"
          size="sm"
          onClick={onRefresh}
          loading={loading}
          icon={<ArrowClockwise size={15} weight="bold" />}
        >
          Re-Check Chain Integrity
        </GlassButton>
      </div>

      <div className="pt-3 border-t border-[var(--glass-border)] flex flex-wrap items-center gap-6 text-[12px] font-mono text-[var(--ink-muted)]">
        <div className="flex items-center gap-1.5">
          <LockKey size={14} className="text-[var(--accent-cyan)]" />
          <span>LEDGER: LOCAL HASH CHAIN (TAMPER-EVIDENT)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <CheckCircle size={14} className="text-[var(--status-good)]" />
          <span>CHECKED BY: GET /verify</span>
        </div>
      </div>
    </GlassCard>
  );
}
