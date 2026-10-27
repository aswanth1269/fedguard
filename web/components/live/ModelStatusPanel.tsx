"use client";

import { ArrowClockwise, Cpu, Play, PlugsConnected, Warning } from "@phosphor-icons/react";
import { GlassBadge } from "@/components/ui/GlassBadge";
import { GlassButton } from "@/components/ui/GlassButton";
import { GlassCard } from "@/components/ui/GlassCard";
import { HashValue } from "@/components/shared/Integrity";
import { API_BASE, formatTimestamp } from "@/lib/api";
import type { ModelStatusState } from "@/lib/useModelStatus";

function bankLabel(id: string): string {
  const m = /^bank_(\d+)$/.exec(id);
  return m && Number(m[1]) < 26 ? `Bank ${String.fromCharCode(65 + Number(m[1]))}` : id;
}

export function ModelStatusPanel({ status }: { status: ModelStatusState }) {
  const { data, checked, offline, error, ready, training, starting, initialize } = status;

  if (!checked) {
    return (
      <GlassCard className="p-5 flex items-center gap-3">
        <span className="h-4 w-4 border-2 border-[var(--accent-cyan)] border-t-transparent rounded-full animate-spin" />
        <span className="text-[13px] text-[var(--ink-secondary)]">Checking the coordinator for a trained model…</span>
      </GlassCard>
    );
  }

  if (offline) {
    return (
      <GlassCard variant="elevated" className="p-5 sm:p-6 border-l-4 border-l-[var(--status-critical)] space-y-3">
        <div className="flex items-center gap-2.5">
          <PlugsConnected size={22} className="text-[var(--status-critical)]" />
          <h2 className="text-base font-bold text-[var(--ink-primary)]">Backend unavailable</h2>
          <GlassBadge tone="critical" size="sm">NO MODEL ACCESS</GlassBadge>
        </div>
        <p className="text-[13px] text-[var(--ink-secondary)]">
          Cannot reach the FedGuard API at <code className="font-mono">{API_BASE}</code>. Nothing on this page is scored
          until it is running. Start it from the repository root:
        </p>
        <pre className="p-3 rounded-xl bg-[var(--glass-subtle)] border border-[var(--glass-border)] font-mono text-[12px] text-[var(--ink-secondary)] overflow-x-auto">
          {"$env:PYTHONPATH = \"src\"\npython -m uvicorn fedguard.api.main:app --port 8000"}
        </pre>
      </GlassCard>
    );
  }

  const job = data?.active_job;
  const failure = data?.last_failure;
  const model = data?.model;
  const recall = data?.final?.recall_at_fpr?.["0.001"];

  return (
    <GlassCard
      variant="elevated"
      className={`p-5 sm:p-6 space-y-4 border-l-4 ${
        ready ? "border-l-[var(--status-good)]" : training || starting ? "border-l-[var(--accent-cyan)]" : "border-l-[var(--status-warning)]"
      }`}
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 flex-wrap">
          <Cpu size={22} className={ready ? "text-[var(--status-good)]" : "text-[var(--status-warning)]"} />
          <h2 className="text-base font-bold text-[var(--ink-primary)]">Global model</h2>
          {ready ? (
            <GlassBadge tone="good" size="sm" dot>LOADED</GlassBadge>
          ) : training ? (
            <GlassBadge tone="cyan" size="sm" dot>TRAINING</GlassBadge>
          ) : (
            <GlassBadge tone="warning" size="sm">NOT LOADED</GlassBadge>
          )}
          {model && <GlassBadge tone="indigo" size="sm">{model.model_family}</GlassBadge>}
        </div>

        {!training && (
          <GlassButton
            variant={ready ? "glass" : "primary"}
            size="sm"
            loading={starting}
            onClick={() => initialize(ready)}
            icon={ready ? <ArrowClockwise size={14} /> : <Play size={14} weight="fill" />}
          >
            {ready ? "Retrain (new run)" : "Initialize model"}
          </GlassButton>
        )}
      </div>

      {!ready && !training && (
        <p className="text-[13px] text-[var(--ink-secondary)] leading-relaxed">
          No trained global model is loaded in this server process, so nothing can be scored yet. <strong>Initialize
          model</strong> runs <code className="font-mono">configs/demo_mlp.yaml</code>: three simulated banks each train a
          PyTorch MLP on their own synthetic partition for 5 federated rounds, aggregated with the reputation defense.
          It takes a few seconds on a CPU.
        </p>
      )}

      {job && (
        <div className="space-y-2">
          <div className="flex justify-between text-[12.5px] font-mono text-[var(--ink-secondary)]">
            <span>
              Job {job.job_id} · {job.config_name} · {job.status}
            </span>
            <span>
              round {job.rounds_done} / {job.rounds_total}
            </span>
          </div>
          <div className="h-2 rounded-full bg-[var(--glass-subtle)] overflow-hidden" role="progressbar" aria-valuenow={job.rounds_done} aria-valuemin={0} aria-valuemax={job.rounds_total}>
            <div
              className="h-full bg-[var(--accent-cyan)] transition-all duration-500"
              style={{ width: `${(100 * job.rounds_done) / Math.max(1, job.rounds_total)}%` }}
            />
          </div>
          <p className="text-[12px] text-[var(--ink-muted)]">Progress is reported by the training loop after each completed round.</p>
        </div>
      )}

      {(failure || error) && (
        <div className="p-3 rounded-xl bg-[var(--status-critical)]/10 border border-[var(--status-critical)]/30 text-[12.5px] text-[var(--status-critical)] flex gap-2">
          <Warning size={16} className="shrink-0 mt-0.5" />
          <span>
            {failure ? `Training job ${failure.job_id} (${failure.config_name}) failed: ${failure.error}` : error}
          </span>
        </div>
      )}

      {ready && model && data && (
        <dl className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-3 text-[12.5px]">
          <div>
            <dt className="text-[var(--ink-muted)]">Global model version</dt>
            <dd className="font-mono font-semibold text-[var(--ink-primary)]">
              {model.global_model_version != null ? `v${model.global_model_version}` : "not registered"}
            </dd>
          </div>
          <div className="col-span-1 lg:col-span-1 min-w-0">
            <dt className="text-[var(--ink-muted)]">Model hash (SHA-256)</dt>
            <dd><HashValue hash={model.global_model_hash} label="global model hash" /></dd>
          </div>
          <div>
            <dt className="text-[var(--ink-muted)]">Training</dt>
            <dd className="font-mono text-[var(--ink-primary)]">
              {model.rounds} rounds · {model.defense}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--ink-muted)]">Decision threshold</dt>
            <dd className="font-mono font-semibold text-[var(--ink-primary)]">{data.threshold?.toFixed(4)}</dd>
          </div>
          <div>
            <dt className="text-[var(--ink-muted)]">PR-AUC (held-out test split)</dt>
            <dd className="font-mono text-[var(--ink-primary)]">{data.final?.pr_auc?.toFixed(4) ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-[var(--ink-muted)]">Recall @ FPR 0.1%</dt>
            <dd className="font-mono text-[var(--ink-primary)]">{recall != null ? recall.toFixed(4) : "—"}</dd>
          </div>
          <div>
            <dt className="text-[var(--ink-muted)]">Last round: accepted / rejected</dt>
            <dd className="text-[var(--ink-primary)]">
              {data.participants
                ? `${data.participants.accepted.map(bankLabel).join(", ") || "none"} / ${data.participants.rejected.map(bankLabel).join(", ") || "none"}`
                : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--ink-muted)]">Job · data</dt>
            <dd className="font-mono text-[var(--ink-primary)]">
              {data.job_id} · {model.data_source}
            </dd>
          </div>
        </dl>
      )}

      {ready && data && (
        <p className="text-[11.5px] text-[var(--ink-muted)] leading-relaxed">
          Threshold = the score at which this model&apos;s false-positive rate on its held-out test split is at most 0.1%.
          {model?.data_source === "synthetic" && " Metrics are on synthetic data and are not research results."}
          {data.completed_at ? ` Trained ${formatTimestamp(data.completed_at)}.` : ""} The model lives in server memory and
          is lost when the API restarts.
        </p>
      )}

      {data?.warnings && data.warnings.length > 0 && (
        <div className="text-[12px] text-[var(--status-warning)]">{data.warnings.join(" · ")}</div>
      )}
    </GlassCard>
  );
}
