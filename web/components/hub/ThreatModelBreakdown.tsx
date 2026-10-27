"use client";

import { GlassCard } from "@/components/ui/GlassCard";
import { GlassBadge } from "@/components/ui/GlassBadge";
import { ShieldCheck, EyeSlash } from "@phosphor-icons/react";

export function ThreatModelBreakdown() {
  return (
    <section className="py-12 border-t border-[var(--glass-border)]">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 space-y-10">
        <div className="text-center max-w-3xl mx-auto space-y-3">
          <GlassBadge tone="critical" dot>
            THE THREAT MODEL
          </GlassBadge>
          <h2 className="text-2xl sm:text-4xl font-bold tracking-tight text-[var(--ink-primary)]">
            How Typology-Targeted Backdoors Evade Detection
          </h2>
          <p className="text-[14.5px] text-[var(--ink-secondary)] leading-relaxed">
            The adversary does not want to destroy global model accuracy. They want to create a
            targeted blindspot for transactions matching their own specific typology trigger.
          </p>
        </div>

        {/* Visual Comparison Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Card 1: What standard monitors watch */}
          <GlassCard className="p-6 sm:p-8 space-y-5 border-l-4 border-l-[var(--status-warning)]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-[var(--status-warning)]/10 text-[var(--status-warning)]">
                  <EyeSlash size={20} weight="bold" />
                </div>
                <h3 className="text-base font-semibold text-[var(--ink-primary)]">
                  Standard Model Quality Monitoring
                </h3>
              </div>
              <GlassBadge tone="warning">Status Quo</GlassBadge>
            </div>

            <div className="space-y-3 text-[13px] text-[var(--ink-secondary)] leading-relaxed">
              <p>
                In a fraud dataset with <strong>~3.5% prevalence</strong>, a global evaluation evaluates thousands of transactions across all card types.
              </p>
              <div className="p-3.5 rounded-xl bg-[var(--glass-subtle)] border border-[var(--glass-border)] space-y-1 font-mono text-[12px]">
                <div className="flex justify-between text-[var(--ink-muted)]">
                  <span>General Fraud Detected:</span>
                  <span className="text-[var(--status-good)] font-bold">96.5%</span>
                </div>
                <div className="flex justify-between text-[var(--ink-muted)]">
                  <span>Global PR-AUC Score:</span>
                  <span className="text-[var(--ink-primary)] font-bold">0.5515 (High)</span>
                </div>
                <div className="flex justify-between text-[var(--status-critical)]">
                  <span>Targeted Typology Fraud:</span>
                  <span className="font-bold">UNCHECKED BLINDSPOT</span>
                </div>
              </div>
              <p className="text-[12px] text-[var(--ink-muted)]">
                Because the attacker poisons only a tiny specific slice (e.g. Mastercard with specific merchant/device codes), the global loss gradient barely registers the deviation.
              </p>
            </div>
          </GlassCard>

          {/* Card 2: What FedGuard defends */}
          <GlassCard variant="elevated" glow="cyan" className="p-6 sm:p-8 space-y-5 border-l-4 border-l-[var(--accent-cyan)]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-[var(--accent-cyan)]/10 text-[var(--accent-cyan)]">
                  <ShieldCheck size={20} weight="bold" />
                </div>
                <h3 className="text-base font-semibold text-[var(--ink-primary)]">
                  FedGuard Cross-Round Reputation Defense
                </h3>
              </div>
              <GlassBadge tone="cyan">FedGuard Innovation</GlassBadge>
            </div>

            <div className="space-y-3 text-[13px] text-[var(--ink-secondary)] leading-relaxed">
              <p>
                FedGuard computes an <strong>Asymmetric EWMA</strong> over cosine similarity to the coordinate-wise median delta across rounds.
              </p>
              <div className="p-3.5 rounded-xl bg-[var(--accent-cyan)]/10 border border-[var(--accent-cyan)]/30 space-y-1 font-mono text-[12px]">
                <div className="flex justify-between text-[var(--ink-secondary)]">
                  <span>Historical Decay Rate:</span>
                  <span className="text-[var(--accent-cyan)] font-bold">α = 0.3 (Fast Penalty)</span>
                </div>
                <div className="flex justify-between text-[var(--ink-secondary)]">
                  <span>Reputation Recovery Rate:</span>
                  <span className="text-[var(--ink-primary)] font-bold">β = 0.05 (Slow Trust)</span>
                </div>
                <div className="flex justify-between text-[var(--status-good)] font-bold">
                  <span>Intermittent Poisoning:</span>
                  <span>ISOLATED & EXCLUDED</span>
                </div>
              </div>
              <p className="text-[12px] text-[var(--ink-muted)]">
                Patient adversaries who poison intermittently cannot reset their score during quiet rounds, permanently protecting the consortium global model.
              </p>
            </div>
          </GlassCard>
        </div>
      </div>
    </section>
  );
}
