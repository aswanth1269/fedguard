"use client";

import { useState } from "react";
import { RunSelector } from "@/components/monitor/RunSelector";
import { RunSummaryKpis } from "@/components/monitor/RunSummaryKpis";
import { MetricTrajectory } from "@/components/monitor/MetricTrajectory";
import { ReputationTrajectory } from "@/components/monitor/ReputationTrajectory";
import { ClientWeightStream } from "@/components/monitor/ClientWeightStream";
import { ExplainabilityCockpit, type ExplanationsData } from "@/components/monitor/ExplainabilityCockpit";
import { FederatedWorkflowExplainer } from "@/components/monitor/FederatedWorkflowExplainer";
import { GlassBadge } from "@/components/ui/GlassBadge";
import type { RunRecord } from "@/lib/runs";
import { ChartLineUp } from "@phosphor-icons/react";

interface MonitorDashboardClientProps {
  runs: RunRecord[];
  explanations: ExplanationsData | null;
}

export function MonitorDashboardClient({ runs, explanations }: MonitorDashboardClientProps) {
  const [selectedId, setSelectedId] = useState(runs[0]?.id ?? "");

  const currentRun = runs.find((r) => r.id === selectedId) ?? runs[0];

  if (runs.length === 0 || !currentRun) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 text-center space-y-4">
        <h2 className="text-2xl font-bold text-[var(--ink-primary)]">No Experiment Runs Found</h2>
        <p className="text-[14px] text-[var(--ink-secondary)]">
          Run an experiment from the CLI or training coordinator and export the dashboard data.
        </p>
        <pre className="p-4 rounded-xl bg-[var(--glass-subtle)] border border-[var(--glass-border)] font-mono text-[12px] text-[var(--ink-secondary)] text-left overflow-x-auto">
          {"fedguard run --config configs/d_ieee_clean.yaml\npython scripts/export_dashboard_data.py"}
        </pre>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 space-y-8">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[var(--glass-border)] pb-6">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <ChartLineUp size={20} className="text-[var(--accent-cyan)]" />
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[var(--ink-primary)]">
              Federation Monitor & Deep Analytics
            </h1>
          </div>
          <p className="text-[14px] text-[var(--ink-secondary)] max-w-3xl leading-relaxed">
            Direct projection of the coordinator decision log. Analyze round-by-round convergence, reputation decay, and aggregation weights.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <GlassBadge tone="cyan">
            Active: {currentRun.label}
          </GlassBadge>
        </div>
      </div>

      {/* Run Selector Filter Carousel */}
      <RunSelector
        runs={runs}
        selectedId={currentRun.id}
        onSelect={(id) => setSelectedId(id)}
      />

      {/* Selected Run Primary KPIs */}
      <RunSummaryKpis run={currentRun} />

      {/* 7-Step Non-Technical Federated Learning Workflow Explainer */}
      <FederatedWorkflowExplainer run={currentRun} />

      {/* Trajectory & Reputation Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <MetricTrajectory runs={runs} selectedRun={currentRun} />
        <ReputationTrajectory run={currentRun} />
      </div>

      {/* Consortium Aggregation Weights Stack */}
      <ClientWeightStream run={currentRun} />

      {/* Model Explainability / SHAP Section */}
      <div className="pt-4">
        <ExplainabilityCockpit data={explanations} />
      </div>
    </div>
  );
}
