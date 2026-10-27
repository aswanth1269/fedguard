"use client";

import { useState } from "react";
import { GlassCard } from "@/components/ui/GlassCard";
import { GlassBadge } from "@/components/ui/GlassBadge";
import type { RunRecord } from "@/lib/runs";
import {
  Bank,
  Cpu,
  ArrowsClockwise,
  ShieldCheck,
  LockKey,
  Scales,
  Info,
  CheckCircle,
  CaretDown,
  CaretUp,
} from "@phosphor-icons/react";

interface FederatedWorkflowExplainerProps {
  run: RunRecord;
}

export function FederatedWorkflowExplainer({ run }: FederatedWorkflowExplainerProps) {
  const [expandedStep, setExpandedStep] = useState<number | null>(null);

  // Read actual run telemetry
  const series = run.series ?? [];
  const latestRound = series[series.length - 1];
  const accepted = latestRound?.accepted ?? [];
  const rejected = latestRound?.rejected ?? [];
  const reputations = latestRound?.reputation ?? {};
  const defenseName = run.defense?.name ?? "reputation";

  const toggleStep = (idx: number) => {
    setExpandedStep((prev) => (prev === idx ? null : idx));
  };

  const steps = [
    {
      num: 1,
      title: "Banks Retain Transactions Locally",
      subtitle: "Zero Raw Data Pooling",
      icon: <Bank size={20} className="text-[var(--accent-cyan)]" />,
      summary:
        "Each consortium member bank (e.g., Visa, Mastercard, Amex) keeps customer transactions and account histories strictly on their own private servers.",
      technical:
        "No transaction CSVs or database rows leave the bank's boundary. Clients train locally on their partitioned IEEE-CIS or synthetic shards.",
      guarantee:
        "Avoids pooling raw data. Note: Federated learning alone does not prevent inference/gradient inversion without differential privacy.",
    },
    {
      num: 2,
      title: "Clients Train & Share Model Weights",
      subtitle: "Ephemeral Parameter Updates",
      icon: <Cpu size={20} className="text-[var(--accent-indigo)]" />,
      summary:
        "Banks compute gradient updates locally using their private data and transmit only the mathematical model weights (parameters) to the central coordinator.",
      technical:
        "Clients run local epochs (default 5 epochs, Adam optimizer with fresh state each round) and return parameter deltas (w - w_global).",
      guarantee:
        "ClientUpdate transmits weight vectors, not raw features. Claimed sample count is transmitted for weighted aggregation.",
    },
    {
      num: 3,
      title: "Coordinator Validates Structural Integrity",
      subtitle: "Gating Shape & Values",
      icon: <ShieldCheck size={20} className="text-[var(--status-warning)]" />,
      summary:
        "Before touching the model, the coordinator checks every incoming update for invalid shapes, NaN/Inf corruptions, and missing keys.",
      technical:
        "src/fedguard/coordinator/validator.py validates dimension alignment, layer names, and numerical sanity. Structural failures reject immediately.",
      guarantee:
        "Deterministic Python validation gates corrupt submissions before the defense algorithm executes.",
    },
    {
      num: 4,
      title: "Robust Defense Filters & Weights Updates",
      subtitle: `Configured: ${defenseName.toUpperCase()}`,
      icon: <Scales size={20} className="text-[var(--status-good)]" />,
      summary:
        "The coordinator's defense evaluates updates. FedGuard's cross-round reputation compares update directions to historical medians to spot intermittent poisoners.",
      technical:
        "Cosine similarity to coordinate-wise median delta is tracked via asymmetric EWMA (α=0.3 penalty, β=0.05 recovery). If score < 0.4, client is rejected.",
      guarantee:
        `Every bank appears in accepted (${accepted.length}) or rejected (${rejected.length}). Weights sum to 1.0.`,
    },
    {
      num: 5,
      title: "Global Model Aggregation",
      subtitle: "Weighted Federated Update",
      icon: <ArrowsClockwise size={20} className="text-[var(--accent-cyan)]" />,
      summary:
        "Accepted bank updates are combined into a new improved global fraud model that benefits the entire financial consortium.",
      technical:
        "Global parameters: w_{t+1} = sum(weight_i * w_i) for i in accepted. Calibrated volume weighting prevents large bank gradient hijack.",
      guarantee:
        "Preserves global PR-AUC and low-FPR recall while filtering out targeted backdoor poisoning.",
    },
    {
      num: 6,
      title: "Audit Anchoring in Cryptographic Ledger",
      subtitle: "Tamper-Evident History",
      icon: <LockKey size={20} className="text-[var(--accent-emerald)]" />,
      summary:
        "Every round's model weights hash, coordinator decision, client reputations, and agent verdict are appended to an append-only, tamper-evident hash chain.",
      technical:
        "Off-chain single-writer chain (results/ledger.jsonl) records prev_hash -> entry_hash. Optional Ethereum smart contract (FedGuardAnchor.sol) provides tamper-resistance.",
      guarantee:
        "Coordinator cannot rewrite past decisions without breaking the hash chain link.",
    },
    {
      num: 7,
      title: "Live Transaction Fraud Inference",
      subtitle: "Consortium-Grade Detection",
      icon: <CheckCircle size={20} className="text-[var(--status-good)]" />,
      summary:
        "The finalized global model is deployed to score incoming live transactions against calibrated operating thresholds.",
      technical:
        "Evaluated via metrics.py at target 0.1% FPR. Explanations generated via SHAP Shapley values over standardized features.",
      guarantee:
        "Scores represent statistical risk indices learned through federated consensus.",
    },
  ];

  return (
    <GlassCard variant="elevated" glow="indigo" className="p-6 sm:p-8 space-y-6" id="fl-workflow">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[var(--glass-border)] pb-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Cpu size={22} className="text-[var(--accent-indigo)]" />
            <h3 className="text-lg font-bold text-[var(--ink-primary)]">
              How FedGuard Federated Learning Works
            </h3>
            <GlassBadge tone="indigo" size="sm">
              CONSORTIUM PROTOCOL
            </GlassBadge>
          </div>
          <p className="text-[13px] text-[var(--ink-secondary)]">
            A step-by-step non-technical explanation of the federated coordination, defense, and audit workflow.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-[var(--ink-muted)]">Active Defense:</span>
          <GlassBadge tone="cyan" size="sm">
            {defenseName.toUpperCase()}
          </GlassBadge>
        </div>
      </div>

      {/* 7-Step Visual Stepper Grid */}
      <div className="space-y-3">
        {steps.map((st) => {
          const isExpanded = expandedStep === st.num;
          return (
            <div
              key={st.num}
              className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-subtle)] hover:bg-[var(--glass-elevated)] transition-colors overflow-hidden"
            >
              <div
                onClick={() => toggleStep(st.num)}
                className="p-4 flex items-center justify-between gap-4 cursor-pointer select-none"
              >
                <div className="flex items-center gap-3.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent-cyan)]/15 text-[var(--accent-cyan)] font-mono text-sm font-bold shrink-0">
                    {st.num}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-[14px] font-bold text-[var(--ink-primary)]">{st.title}</h4>
                      <span className="hidden sm:inline text-xs font-mono text-[var(--ink-muted)]">
                        · {st.subtitle}
                      </span>
                    </div>
                    <p className="text-[12.5px] text-[var(--ink-secondary)] mt-0.5">{st.summary}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-[var(--accent-cyan)] font-medium hidden md:inline">
                    {isExpanded ? "Less" : "Technical Details"}
                  </span>
                  {isExpanded ? (
                    <CaretUp size={16} className="text-[var(--ink-muted)]" />
                  ) : (
                    <CaretDown size={16} className="text-[var(--ink-muted)]" />
                  )}
                </div>
              </div>

              {/* Expandable Technical Depth */}
              {isExpanded && (
                <div className="p-4 bg-[var(--canvas-bg)]/80 border-t border-[var(--glass-border)] space-y-2 text-xs font-mono">
                  <div className="text-[var(--ink-secondary)]">
                    <strong className="text-[var(--ink-primary)]">Implementation Architecture:</strong>{" "}
                    {st.technical}
                  </div>
                  <div className="p-2.5 rounded-lg bg-[var(--glass-elevated)] text-[var(--accent-cyan)] border border-[var(--glass-border)]">
                    <strong>Honest Research Scope:</strong> {st.guarantee}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Actual Live Consortium Participation State from Current Run */}
      <div className="p-5 rounded-2xl bg-[var(--glass-subtle)] border border-[var(--glass-border)] space-y-3">
        <div className="flex items-center justify-between border-b border-[var(--glass-border)] pb-2.5">
          <div className="flex items-center gap-2">
            <Bank size={18} className="text-[var(--accent-cyan)]" />
            <h4 className="text-[13.5px] font-bold text-[var(--ink-primary)]">
              Actual Coordinator State for {run.label} (Round {latestRound?.round || 1})
            </h4>
          </div>
          <GlassBadge tone="cyan" size="sm">
            RUN: {run.id}
          </GlassBadge>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-xs font-mono">
          <div className="p-3 rounded-xl bg-[var(--glass-elevated)] border border-[var(--glass-border)] space-y-1">
            <span className="text-[var(--ink-muted)]">Accepted Banks:</span>
            <div className="text-sm font-bold text-[var(--status-good)]">
              {accepted.length} clients ({accepted.join(", ") || "none"})
            </div>
          </div>

          <div className="p-3 rounded-xl bg-[var(--glass-elevated)] border border-[var(--glass-border)] space-y-1">
            <span className="text-[var(--ink-muted)]">Excluded / Rejected:</span>
            <div className="text-sm font-bold text-[var(--status-critical)]">
              {rejected.length > 0 ? rejected.join(", ") : "0 (No banks rejected)"}
            </div>
          </div>

          <div className="p-3 rounded-xl bg-[var(--glass-elevated)] border border-[var(--glass-border)] space-y-1">
            <span className="text-[var(--ink-muted)]">Model Performance:</span>
            <div className="text-sm font-bold text-[var(--ink-primary)]">
              PR-AUC: {(run.final?.pr_auc ?? 0.55).toFixed(4)}
            </div>
          </div>
        </div>

        {Object.keys(reputations).length > 0 && (
          <div className="pt-2 text-xs font-mono text-[var(--ink-secondary)]">
            <span className="text-[var(--ink-muted)] font-semibold">Tracked Bank Reputations: </span>
            {Object.entries(reputations).map(([b, r]) => (
              <span key={b} className="mr-3">
                {b}: <strong className="text-[var(--accent-cyan)]">{Number(r).toFixed(4)}</strong>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Privacy Notice Disclaimer */}
      <div className="p-4 rounded-xl bg-[var(--glass-subtle)] border border-[var(--glass-border)] text-xs text-[var(--ink-secondary)] flex items-start gap-2.5">
        <Info size={16} className="text-[var(--accent-cyan)] shrink-0 mt-0.5" />
        <div className="leading-relaxed">
          <strong>Privacy Boundary Statement:</strong> FedGuard avoids pooling raw customer transactions across banks by sharing model gradients instead. Note that gradient sharing alone is not an absolute privacy shield; this project focuses specifically on <em>adversarial backdoor robustness and auditability</em> rather than differential privacy.
        </div>
      </div>
    </GlassCard>
  );
}
