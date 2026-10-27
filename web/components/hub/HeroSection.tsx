"use client";

import Link from "next/link";
import {
  ShieldCheck,
  ArrowRight,
  Cpu,
  Fingerprint,
  WarningCircle,
  LockKey,
} from "@phosphor-icons/react";
import { GlassCard } from "@/components/ui/GlassCard";
import { GlassBadge } from "@/components/ui/GlassBadge";
import { GlassButton } from "@/components/ui/GlassButton";
import { type RunRecord } from "@/lib/runs";

interface HeroSectionProps {
  clean?: RunRecord;
  attacked?: RunRecord;
  defended?: RunRecord;
}

export function HeroSection({ clean, attacked }: HeroSectionProps) {
  const prAucClean = clean?.final?.pr_auc ?? 0.5509;
  const prAucAttacked = attacked?.final?.pr_auc ?? 0.5515;
  const prAucDelta = Math.abs(prAucAttacked - prAucClean);

  const asrClean = clean?.final?.asr ?? 0.5292;
  const asrAttacked = attacked?.final?.asr ?? 0.5789;
  const asrDelta = asrAttacked - asrClean;

  return (
    <section className="relative overflow-hidden pt-8 pb-16 lg:pt-14 lg:pb-24">
      {/* Background Decorative Glow Orbs */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[350px] bg-gradient-to-tr from-[var(--accent-cyan)]/20 via-[var(--accent-indigo)]/15 to-transparent rounded-full blur-[100px] pointer-events-none -z-10" />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          {/* Main Hero Copy */}
          <div className="lg:col-span-7 space-y-6">
            <div className="flex flex-wrap items-center gap-2.5">
              <GlassBadge tone="cyan" dot>
                CONSORTIUM AI ENGINE
              </GlassBadge>
              <GlassBadge tone="good">
                IEEE-CIS BENCHMARKED
              </GlassBadge>
            </div>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-[var(--ink-primary)] leading-[1.08]">
              Adversarially-Robust <br className="hidden sm:inline" />
              <span className="bg-gradient-to-r from-[var(--accent-cyan)] via-[var(--accent-indigo)] to-[var(--accent-emerald)] bg-clip-text text-transparent">
                Federated Fraud Intelligence
              </span>
            </h1>

            <p className="text-base sm:text-lg text-[var(--ink-secondary)] leading-relaxed max-w-2xl">
              Cross-round reputation defense against typology-targeted backdoors. A malicious
              participant can poison a shared fraud model without degrading global performance metrics.
              FedGuard detects the attack standard monitoring cannot see.
            </p>

            {/* Quick Action Buttons */}
            <div className="flex flex-wrap items-center gap-3.5 pt-2">
              <Link href="/research/rounds">
                <GlassButton
                  variant="primary"
                  size="lg"
                  icon={<ArrowRight size={16} weight="bold" />}
                  iconPosition="right"
                >
                  Explore recorded rounds
                </GlassButton>
              </Link>
              <Link href="/research/operations">
                <GlassButton variant="glass" size="lg" icon={<Cpu size={16} weight="bold" />}>
                  Attack replay
                </GlassButton>
              </Link>
              <Link href="/integrity">
                <GlassButton variant="ghost" size="lg" icon={<Fingerprint size={16} weight="bold" />}>
                  Integrity & Audit
                </GlassButton>
              </Link>
            </div>

            {/* Micro Specs */}
            <div className="pt-4 flex flex-wrap items-center gap-6 text-[12.5px] text-[var(--ink-muted)] border-t border-[var(--glass-border)]">
              <div className="flex items-center gap-1.5">
                <LockKey size={16} className="text-[var(--accent-cyan)]" />
                <span>Zero Raw Data Sharing</span>
              </div>
              <div className="flex items-center gap-1.5">
                <ShieldCheck size={16} className="text-[var(--status-good)]" />
                <span>Non-IID Card Partitioning</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Fingerprint size={16} className="text-[var(--accent-indigo)]" />
                <span>Hash-Chained Audit Ledger</span>
              </div>
            </div>
          </div>

          {/* Right Highlight Telemetry Card */}
          <div className="lg:col-span-5">
            <GlassCard variant="elevated" glow="cyan" className="p-6 sm:p-7 space-y-5">
              <div className="flex items-center justify-between border-b border-[var(--glass-border)] pb-4">
                <div className="flex items-center gap-2">
                  <div className="h-2.5 w-2.5 rounded-full bg-[var(--status-critical)] animate-ping" />
                  <h3 className="text-sm font-semibold tracking-wide uppercase text-[var(--ink-primary)]">
                    The Blindspot Paradox
                  </h3>
                </div>
                <GlassBadge tone="critical" size="sm">
                  Threat Model Proof
                </GlassBadge>
              </div>

              <div className="space-y-4">
                {/* Metric 1: PR-AUC (Flat) */}
                <div className="p-3.5 rounded-xl bg-[var(--glass-subtle)] border border-[var(--glass-border)] space-y-1">
                  <div className="flex items-center justify-between text-[12px] text-[var(--ink-secondary)]">
                    <span>Global PR-AUC Metric</span>
                    <span className="font-mono text-[var(--status-good)] font-semibold">
                      +{prAucDelta.toFixed(4)} (Flat)
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <span className="font-mono text-2xl font-bold tnum text-[var(--ink-primary)]">
                      {prAucAttacked.toFixed(4)}
                    </span>
                    <span className="text-[11px] text-[var(--ink-muted)]">
                      Clean: {prAucClean.toFixed(4)}
                    </span>
                  </div>
                  <p className="text-[11px] text-[var(--ink-muted)] leading-tight pt-1">
                    Standard quality monitors stay dormant because global metric barely moves.
                  </p>
                </div>

                {/* Metric 2: ASR (Exploding) */}
                <div className="p-3.5 rounded-xl bg-[var(--status-critical)]/10 border border-[var(--status-critical)]/30 space-y-1">
                  <div className="flex items-center justify-between text-[12px] text-[var(--status-critical)]">
                    <span className="font-semibold flex items-center gap-1">
                      <WarningCircle size={14} weight="bold" />
                      Attack Success Rate (ASR)
                    </span>
                    <span className="font-mono font-bold">
                      +{(asrDelta * 100).toFixed(1)}% Jump
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <span className="font-mono text-2xl font-bold tnum text-[var(--status-critical)]">
                      {(asrAttacked * 100).toFixed(1)}%
                    </span>
                    <span className="text-[11px] text-[var(--ink-muted)]">
                      Clean: {(asrClean * 100).toFixed(1)}%
                    </span>
                  </div>
                  <p className="text-[11px] text-[var(--ink-muted)] leading-tight pt-1">
                    Targeted attacker typology fraud passes right through undetected.
                  </p>
                </div>
              </div>

              <div className="pt-2 border-t border-[var(--glass-border)] flex items-center justify-between text-[12px]">
                <span className="text-[var(--ink-secondary)]">FedGuard Solution</span>
                <span className="font-medium text-[var(--accent-cyan)] flex items-center gap-1">
                  Cross-Round Reputation Defense <ArrowRight size={12} weight="bold" />
                </span>
              </div>
            </GlassCard>
          </div>
        </div>
      </div>
    </section>
  );
}
