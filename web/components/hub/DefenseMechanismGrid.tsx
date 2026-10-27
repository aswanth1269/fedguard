"use client";

import { GlassCard } from "@/components/ui/GlassCard";
import { GlassBadge } from "@/components/ui/GlassBadge";
import { Cpu, ShieldCheck, FlowArrow, LockKey, Scales, Database } from "@phosphor-icons/react";

export function DefenseMechanismGrid() {
  const mechanisms = [
    {
      title: "Cross-Round Reputation",
      tag: "CORE CONTRIBUTION",
      tone: "cyan" as const,
      icon: <ShieldCheck size={24} className="text-[var(--accent-cyan)]" />,
      desc: "Maintains temporal memory across rounds. Evaluates cosine similarity to the coordinate-wise median delta. Penalizes deviation immediately with asymmetric recovery.",
    },
    {
      title: "Agentic Sentinel (Boundary v1.0.0)",
      tag: "AUTONOMOUS GOVERNANCE",
      tone: "indigo" as const,
      icon: <Cpu size={24} className="text-[var(--accent-indigo)]" />,
      desc: "Deterministic, versioned Python decision boundary recorded in the hash-chained audit ledger. Flags suspicious participation patterns and produces human-auditable narrative explanations.",
    },
    {
      title: "Non-IID Sample Weighting",
      tag: "CONSORTIUM FAIRNESS",
      tone: "good" as const,
      icon: <Scales size={24} className="text-[var(--status-good)]" />,
      desc: "Calibrated weighting addressing extreme bank volume disparities (244:1 Visa vs Unknown). Preserves benign convergence without letting small nodes hijack global gradients.",
    },
    {
      title: "Cryptographic Hash Chain",
      tag: "TAMPER-PROOF LEDGER",
      tone: "good" as const,
      icon: <LockKey size={24} className="text-[var(--status-good)]" />,
      desc: "Every training round anchors the model weights hash, aggregation decision, and agent verdict into a local, tamper-evident SHA-256 hash chain. On-chain anchoring is optional (FEDGUARD_LEDGER_BACKEND=web3).",
    },
    {
      title: "Stateless Baseline Defenses",
      tag: "COMPARATIVE BENCHMARK",
      tone: "neutral" as const,
      icon: <FlowArrow size={24} className="text-[var(--ink-secondary)]" />,
      desc: "Integrated comparisons against classic Krum, Multi-Krum, Trimmed Mean, and Coordinate-Wise Median showing empirical vulnerability to intermittent poisoning.",
    },
    {
      title: "SHAP Explainability",
      tag: "INTERPRETABLE AI",
      tone: "info" as const,
      icon: <Database size={24} className="text-[var(--status-info)]" />,
      desc: "Exact Shapley values over 8 transaction features explaining individual model scoring decisions, base rate deviations, and population shifts.",
    },
  ];

  return (
    <section className="py-12 border-t border-[var(--glass-border)]">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 space-y-8">
        <div className="space-y-2">
          <GlassBadge tone="indigo">ARCHITECTURE PILLARS</GlassBadge>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-[var(--ink-primary)]">
            FedGuard Defense & Coordination Subsystems
          </h2>
          <p className="text-[14px] text-[var(--ink-secondary)] max-w-2xl leading-relaxed">
            A modular defense framework engineered specifically for high-stakes decentralized financial consortiums.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {mechanisms.map((m) => (
            <GlassCard key={m.title} variant="base" className="p-6 space-y-4 hover:border-[var(--glass-border-glow)]">
              <div className="flex items-center justify-between">
                <div className="p-2.5 rounded-xl bg-[var(--glass-subtle)] border border-[var(--glass-border)]">
                  {m.icon}
                </div>
                <GlassBadge tone={m.tone} size="sm">
                  {m.tag}
                </GlassBadge>
              </div>

              <div className="space-y-2">
                <h3 className="text-[15px] font-semibold text-[var(--ink-primary)]">{m.title}</h3>
                <p className="text-[13px] text-[var(--ink-secondary)] leading-relaxed">{m.desc}</p>
              </div>
            </GlassCard>
          ))}
        </div>
      </div>
    </section>
  );
}
